"use strict";

const {
  formatMemberAccess,
  formatObjectLiteralKey,
  formatPrimitive,
  isArrayIndexKey,
  isIdentifierName,
  isStrictSafeBinding,
  quoteString,
  resolveIntrinsicExpr,
} = require("./intrinsics");
const { parseFunctionSource } = require("./fn-source");
const { analyzeFunctionSource } = require("./js-scan");
const { buildScopeTreeEmitter } = require("./scope-emitter");
const {
  STANDARD_ERROR_CTORS,
  TYPED_ARRAY_BYTES_PER_ELEMENT,
  canEmitAsPlainDataProp,
  decodeBase64Bytes,
  emitSetOrDefineProp,
  formatArrayBufferExpr,
  formatBoxedExpr,
  formatKeyForDefineProperty,
  formatPropertyDescriptor,
  formatRegExpBase,
  formatUnsharedTypedArrayExpr,
  sameKey,
  wrapExtensibilityInline,
} = require("./value-emitter");

const SUPPORTED_NODE_TYPES = new Set([
  "object",
  "array",
  "function",
  "scope",
  "map",
  "set",
  "weakmap",
  "weakset",
  "date",
  "regexp",
  "typedarray",
  "arraybuffer",
  "sharedarraybuffer",
  "dataview",
  "promise",
  "error",
  "boxed",
  "symbol",
]);

const MAX_INLINE_DEPTH = 32;

class BailoutError extends Error {
  constructor(bailouts, diagnostics = null) {
    const first = bailouts[0] || { reason: "unknown bailout" };
    super(`Hybrid bailout: ${first.reason}${first.where ? ` (${first.where})` : ""}`);
    this.name = "BailoutError";
    this.bailouts = bailouts;
    if (diagnostics) {
      this.diagnostics = diagnostics;
    }
  }
}

function chooseCollisionFreePrefix(graph) {
  const corpus = [];
  const nodes = (graph && graph.nodes) || {};
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    if (!n) continue;
    if (typeof n.source === "string") corpus.push(n.source);
    if (Array.isArray(n.vars)) {
      for (const v of n.vars) {
        if (v && typeof v.name === "string") corpus.push(v.name);
      }
    }
  }
  for (const r of (graph && graph.roots) || []) {
    if (r && typeof r.key === "string") corpus.push(r.key);
  }
  let idx = 0;
  while (true) {
    const cand = idx === 0 ? "__h$" : `__h${idx}$`;
    let collided = false;
    for (const s of corpus) {
      if (s.includes(cand)) {
        collided = true;
        break;
      }
    }
    if (!collided) return cand;
    idx++;
  }
}

function isDefinedRef(raw) {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "object" && raw.prim === "undefined") return false;
  return true;
}

function defaultProtoIntrinsicFor(node, parsedFn) {
  switch (node.type) {
    case "object":
      return "Object.prototype";
    case "array":
      return "Array.prototype";
    case "map":
      return "Map.prototype";
    case "set":
      return "Set.prototype";
    case "weakmap":
      return "WeakMap.prototype";
    case "weakset":
      return "WeakSet.prototype";
    case "date":
      return "Date.prototype";
    case "regexp":
      return "RegExp.prototype";
    case "promise":
      return "Promise.prototype";
    case "arraybuffer":
      return "ArrayBuffer.prototype";
    case "sharedarraybuffer":
      return "SharedArrayBuffer.prototype";
    case "dataview":
      return "DataView.prototype";
    case "typedarray":
      return `${node.ctor || "Uint8Array"}.prototype`;
    case "error": {
      const ctor = STANDARD_ERROR_CTORS.has(node.ctor) ? node.ctor : "Error";
      return `${ctor}.prototype`;
    }
    case "boxed": {
      const p = node.primitive;
      if (p && typeof p === "object" && p.prim) {
        if (p.prim === "number") return "Number.prototype";
        if (p.prim === "string") return "String.prototype";
        if (p.prim === "boolean") return "Boolean.prototype";
        if (p.prim === "bigint") return "BigInt.prototype";
        if (p.prim === "symbol") return "Symbol.prototype";
      }
      return "Object.prototype";
    }
    case "function": {
      if (parsedFn) {
        if (parsedFn.actualKind === "asyncGenerator") return "%AsyncGeneratorFunction.prototype%";
        if (parsedFn.actualKind === "generator") return "%GeneratorFunction.prototype%";
        if (parsedFn.actualKind === "async" || parsedFn.isAsync) return "%AsyncFunction.prototype%";
        if (parsedFn.isGenerator) return "%GeneratorFunction.prototype%";
      }
      return "Function.prototype";
    }
    default:
      return "Object.prototype";
  }
}

function emit(captureGraph, opts = {}) {
  const t0 = performance.now();
  if (!captureGraph || typeof captureGraph !== "object") {
    throw new TypeError("emit: captureGraph must be an object");
  }

  const rawNodes = captureGraph.nodes || {};
  let nodes = rawNodes;
  const roots = Array.isArray(captureGraph.roots) ? captureGraph.roots : [];
  const intrinsicPatches = Array.isArray(captureGraph.intrinsicPatches)
    ? captureGraph.intrinsicPatches
    : [];
  const inputBytes =
    typeof opts.inputBytes === "number"
      ? opts.inputBytes
      : typeof opts.originalCode === "string"
        ? Buffer.byteLength(opts.originalCode, "utf8")
        : null;

  const bailouts = Array.isArray(captureGraph.bailouts)
    ? captureGraph.bailouts.map((b) => ({
        reason: b && b.reason ? String(b.reason) : "capture bailout",
        where: b && b.where ? String(b.where) : null,
      }))
    : [];

  function bail(reason, where = null) {
    bailouts.push({ reason, where });
  }

  function finishBailout() {
    const emitMs = Math.round((performance.now() - t0) * 1000) / 1000;
    const stats = {
      emitMs,
      bailedOut: true,
      nodesTotal: Object.keys(nodes).length,
      nodesReachable: 0,
      nodesEmitted: 0,
      nodesInlined: 0,
      scopesEmitted: 0,
      closuresEmitted: 0,
      classesEmitted: 0,
      rootsEmitted: 0,
      intrinsicPatchesEmitted: 0,
      outputBytes: 0,
      inputBytes,
      sizeRatio: null,
    };
    if (opts.throwOnBailout) {
      throw new BailoutError(bailouts);
    }
    return { code: null, bailouts, stats };
  }

  if (bailouts.length > 0) {
    return finishBailout();
  }

  const prefix = chooseCollisionFreePrefix(captureGraph);
  const globalVar = `${prefix}g`;

  function normalizeRef(raw) {
    if (raw === null) return { kind: "prim", prim: "null" };
    if (raw === undefined) return { kind: "prim", prim: "undefined" };
    if (typeof raw === "boolean") return { kind: "prim", prim: "boolean", value: raw };
    if (typeof raw === "number") return { kind: "prim", prim: "number", value: raw };
    if (typeof raw === "string") return { kind: "prim", prim: "string", value: raw };
    if (typeof raw === "bigint") return { kind: "prim", prim: "bigint", value: String(raw) };
    if (typeof raw === "object") {
      if (typeof raw.$ === "string") return { kind: "node", id: raw.$ };
      if (typeof raw.symbol === "string") return { kind: "node", id: raw.symbol };
      if (raw.global === true) return { kind: "global" };
      if (typeof raw.intrinsic === "string" && !raw.prim) {
        return { kind: "intrinsic", path: raw.intrinsic };
      }
      if (typeof raw.prim === "string") {
        return Object.assign({ kind: "prim" }, raw);
      }
    }
    bail(`invalid value reference: ${ JSON.stringify(raw) }`);
    return { kind: "prim", prim: "undefined" };
  }

  function normalizeKey(rawKey) {
    if (typeof rawKey === "string") return { kind: "string", key: rawKey };
    if (typeof rawKey === "number") return { kind: "string", key: String(rawKey) };
    if (rawKey && typeof rawKey === "object") {
      if (rawKey.prim === "string") {
        return { kind: "string", key: String(rawKey.value ?? "") };
      }
      return { kind: "symbol", ref: normalizeRef(rawKey) };
    }
    bail(`invalid property key: ${String(rawKey)}`);
    return { kind: "string", key: "" };
  }

  function normalizeProp(rawProp) {
    const keyNorm = normalizeKey(rawProp.key);
    const hasGet = isDefinedRef(rawProp.get);
    const hasSet = isDefinedRef(rawProp.set);
    const isAccessor =
      hasGet ||
      hasSet ||
      (("get" in rawProp || "set" in rawProp) &&
        (rawProp.value === null ||
          (typeof rawProp.writable !== "boolean" && rawProp.value === undefined)));
    if (isAccessor) {
      return {
        keyNorm,
        isAccessor: true,
        get: hasGet ? normalizeRef(rawProp.get) : null,
        set: hasSet ? normalizeRef(rawProp.set) : null,
        enumerable: rawProp.enumerable !== false,
        configurable: rawProp.configurable !== false,
      };
    }
    return {
      keyNorm,
      isAccessor: false,
      value: rawProp.value === undefined ? { kind: "prim", prim: "undefined" } : normalizeRef(rawProp.value),
      writable: rawProp.writable !== false,
      enumerable: rawProp.enumerable !== false,
      configurable: rawProp.configurable !== false,
    };
  }

  function normalizeProtoRef(rawProto, defaultIntrinsic) {
    if (rawProto === undefined) {
      return { kind: "intrinsic", path: defaultIntrinsic };
    }
    if (rawProto === null) {
      return { kind: "prim", prim: "null" };
    }
    return normalizeRef(rawProto);
  }

  // Track intrinsic patches for safe-assignment checks
  const patchedIntrinsicKeys = new Set();
  let hasPatchedIntrinsicSymbols = false;
  const normPatches = intrinsicPatches.map((patch) => {
    const keyNorm = normalizeKey(patch.key);
    if (keyNorm.kind === "string") patchedIntrinsicKeys.add(keyNorm.key);
    else hasPatchedIntrinsicSymbols = true;
    if (patch.deleted) {
      return { path: patch.path, keyNorm, deleted: true };
    }
    const descSrc = Object.assign({}, patch.descriptor || {});
    if (descSrc.value === undefined && patch.value !== undefined && !isDefinedRef(descSrc.get) && !isDefinedRef(descSrc.set)) {
      descSrc.value = patch.value;
    }
    descSrc.key = patch.key;
    return {
      path: patch.path,
      keyNorm,
      deleted: false,
      prop: normalizeProp(descSrc),
    };
  });

  const normRoots = roots.map((r) => {
    const kind = r.kind || "global";
    const keyNorm = normalizeKey(r.key);
    if (r.deleted) {
      return { kind, keyNorm, deleted: true };
    }
    if (kind === "lexical" || kind === "script") {
      return {
        kind,
        keyNorm,
        mutable: r.mutable !== false && r.varKind !== "const",
        value: normalizeRef(r.value !== undefined ? r.value : r.descriptor && r.descriptor.value),
      };
    }
    const descSrc = Object.assign(
      { enumerable: true, writable: true, configurable: true },
      r.descriptor || {}
    );
    if (descSrc.value === undefined && r.value !== undefined && !isDefinedRef(descSrc.get) && !isDefinedRef(descSrc.set)) {
      descSrc.value = r.value;
    }
    descSrc.key = r.key;
    return {
      kind,
      keyNorm,
      deleted: false,
      prop: normalizeProp(descSrc),
    };
  });

  // Demand-driven reachability walk (prunes unreferenced init-only scope variables & dead heap subgraphs!)
  const reachableNodes = [];
  const reachableSet = new Set();
  const validScopeChainOrder = [];
  const validScopeSet = new Set();
  const liveScopeVarKeys = new Set(); // `${sId}\0${varName}` or `${sId}\0$this`
  const reachableScopes = [];
  const reachableScopeSet = new Set();
  const reachableFunctions = [];
  const refCount = new Map();
  const normNodes = new Map();
  const parsedFns = new Map();

  function touchValueRef(ref) {
    if (!ref || ref.kind !== "node") return;
    const id = ref.id;
    refCount.set(id, (refCount.get(id) || 0) + 1);
    visitNode(id);
  }

  function validateScopeChain(sId, visiting = new Set()) {
    if (!sId) return true;
    if (validScopeSet.has(sId)) return true;
    if (visiting.has(sId)) {
      bail(`cycle in scope parent chain: ${String(sId)}`, sId);
      return false;
    }
    const sNode = nodes[sId];
    if (!sNode || sNode.type !== "scope") {
      bail(`invalid scope reference: ${String(sId)}`, sId);
      return false;
    }
    visiting.add(sId);
    if (sNode.parent && !validateScopeChain(sNode.parent, visiting)) {
      return false;
    }
    visiting.delete(sId);
    validScopeSet.add(sId);
    validScopeChainOrder.push(sId);
    return true;
  }

  function markScopeSlotLive(sId, slotName) {
    const key = `${sId}\0${slotName}`;
    if (liveScopeVarKeys.has(key)) return;
    liveScopeVarKeys.add(key);
    const sNode = nodes[sId];
    if (!sNode) return;
    if (slotName === "$this") {
      if (sNode.this !== undefined) {
        touchValueRef(normalizeRef(sNode.this));
      }
      return;
    }
    if (Array.isArray(sNode.vars)) {
      for (const v of sNode.vars) {
        if (v && v.name === slotName && v.value !== undefined) {
          touchValueRef(normalizeRef(v.value));
        }
      }
    }
  }

  function markAllScopeAncestorsLive(sId) {
    let cur = sId;
    while (cur && validScopeSet.has(cur)) {
      const sNode = nodes[cur];
      if (sNode.this !== undefined) markScopeSlotLive(cur, "$this");
      if (Array.isArray(sNode.vars)) {
        for (const v of sNode.vars) {
          if (v && typeof v.name === "string") markScopeSlotLive(cur, v.name);
        }
      }
      cur = sNode.parent || null;
    }
  }

  function resolveAndMarkFreeVars(startScopeId, freeIdents, needsThis) {
    if (!startScopeId || !validScopeSet.has(startScopeId)) return;
    for (const ident of freeIdents) {
      let cur = startScopeId;
      while (cur) {
        const sNode = nodes[cur];
        if (!sNode) break;
        if (Array.isArray(sNode.vars) && sNode.vars.some((v) => v && v.name === ident)) {
          markScopeSlotLive(cur, ident);
          break;
        }
        cur = sNode.parent || null;
      }
    }
    if (needsThis) {
      let cur = startScopeId;
      while (cur) {
        const sNode = nodes[cur];
        if (!sNode) break;
        if (sNode.this !== undefined) {
          markScopeSlotLive(cur, "$this");
          break;
        }
        if (Array.isArray(sNode.vars) && sNode.vars.some((v) => v && v.name === "this")) {
          markScopeSlotLive(cur, "this");
          break;
        }
        cur = sNode.parent || null;
      }
    }
  }

  function visitNode(id) {
    if (reachableSet.has(id)) return;
    const raw = nodes[id];
    if (!raw || typeof raw !== "object") {
      bail(`dangling node reference: ${String(id)}`, id);
      return;
    }
    if (!SUPPORTED_NODE_TYPES.has(raw.type)) {
      bail(`unsupported node type: ${String(raw.type)}`, id);
      return;
    }
    if (raw.type === "scope") {
      if (validateScopeChain(id)) {
        markAllScopeAncestorsLive(id);
      }
      return;
    }
    reachableSet.add(id);
    reachableNodes.push(id);

    let parsedFn = null;
    if (raw.type === "function" && !raw.bound) {
      parsedFn = parseFunctionSource(raw);
      if (parsedFn.bailout) {
        bail(parsedFn.bailout, id);
        return;
      }
      const scanInfo = analyzeFunctionSource(raw.source);
      parsedFn.freeIdentifiers = scanInfo.freeIdentifiers;
      parsedFn.hasEvalOrWith = scanInfo.hasEvalOrWith;
      parsedFns.set(id, parsedFn);
      reachableFunctions.push(id);
    } else if (raw.type === "function" && raw.bound) {
      reachableFunctions.push(id);
    }

    const defaultProto =
      raw.type === "symbol" ? null : defaultProtoIntrinsicFor(raw, parsedFn);
    const protoRef =
      raw.type === "symbol" ? null : normalizeProtoRef(raw.proto, defaultProto);
    const hasExplicitProps = Array.isArray(raw.props);
    const filteredRawProps =
      hasExplicitProps && raw.type === "promise"
        ? raw.props.filter((rp) => {
            // Strip Node host async_hooks symbols attached during test-runner capture
            if (rp && rp.key && typeof rp.key === "object" && typeof rp.key.symbol === "string") {
              const symNode = nodes[rp.key.symbol];
              if (
                symNode &&
                symNode.registered === null &&
                (symNode.description === "async_id_symbol" ||
                  symNode.description === "trigger_async_id_symbol" ||
                  symNode.description === "destroyed")
              ) {
                return false;
              }
            }
            return true;
          })
        : raw.props;
    const normProps = hasExplicitProps ? filteredRawProps.map(normalizeProp) : [];

    const norm = {
      id,
      raw,
      type: raw.type,
      protoRef,
      defaultProtoIntrinsic: defaultProto,
      hasExplicitProps,
      props: normProps,
      extensible: raw.extensible !== false && !raw.sealed && !raw.frozen,
      sealed: !!raw.sealed || !!raw.frozen,
      frozen: !!raw.frozen,
    };

    if (raw.type === "promise") {
      if (raw.state !== "fulfilled" && raw.state !== "rejected") {
        bail(`pending or invalid promise state: ${String(raw.state)}`, id);
        return;
      }
      norm.state = raw.state;
      norm.valueRef = normalizeRef(raw.value);
    } else if (raw.type === "boxed") {
      norm.primRef = normalizeRef(raw.primitive);
    } else if (raw.type === "map") {
      norm.entries = Array.isArray(raw.entries)
        ? raw.entries.map((pair) => [normalizeRef(pair[0]), normalizeRef(pair[1])])
        : [];
    } else if (raw.type === "set") {
      norm.entries = Array.isArray(raw.entries)
        ? raw.entries.map((el) => normalizeRef(el))
        : [];
    } else if (raw.type === "weakmap" || raw.type === "weakset") {
      if (Array.isArray(raw.entries) && raw.entries.length > 0) {
        bail(`${raw.type} with contents cannot be emitted`, id);
        return;
      }
    } else if (raw.type === "typedarray" || raw.type === "dataview") {
      norm.bufferRef = isDefinedRef(raw.buffer) ? normalizeRef(raw.buffer) : null;
    } else if (raw.type === "function" && raw.bound) {
      norm.bound = {
        target: normalizeRef(raw.bound.target),
        thisArg: normalizeRef(raw.bound.this),
        args: Array.isArray(raw.bound.args) ? raw.bound.args.map(normalizeRef) : [],
      };
    }

    normNodes.set(id, norm);

    // Traverse outgoing references deterministically
    if (protoRef) touchValueRef(protoRef);
    if (raw.type === "function") {
      if (raw.scope && validateScopeChain(raw.scope)) {
        if (parsedFn) {
          if (parsedFn.hasEvalOrWith) {
            markAllScopeAncestorsLive(raw.scope);
          } else {
            resolveAndMarkFreeVars(
              raw.scope,
              parsedFn.freeIdentifiers,
              Boolean(parsedFn.capturesThis)
            );
          }
        }
      }
      if (raw.this !== undefined) touchValueRef(normalizeRef(raw.this));
      if (norm.bound) {
        touchValueRef(norm.bound.target);
        touchValueRef(norm.bound.thisArg);
        for (const a of norm.bound.args) touchValueRef(a);
      }
    }
    if (norm.bufferRef) touchValueRef(norm.bufferRef);
    if (norm.primRef) touchValueRef(norm.primRef);
    if (norm.valueRef) touchValueRef(norm.valueRef);
    if (norm.entries) {
      if (raw.type === "map") {
        for (const [k, v] of norm.entries) {
          touchValueRef(k);
          touchValueRef(v);
        }
      } else {
        for (const el of norm.entries) touchValueRef(el);
      }
    }
    for (const p of normProps) {
      if (p.keyNorm.kind === "symbol") touchValueRef(p.keyNorm.ref);
      if (p.isAccessor) {
        if (p.get) touchValueRef(p.get);
        if (p.set) touchValueRef(p.set);
      } else if (p.value) {
        touchValueRef(p.value);
      }
    }
  }

  for (const r of normRoots) {
    if (r.keyNorm.kind === "symbol") touchValueRef(r.keyNorm.ref);
    if (r.deleted) continue;
    if (r.kind === "lexical" || r.kind === "script") {
      touchValueRef(r.value);
    } else if (r.prop.isAccessor) {
      if (r.prop.get) touchValueRef(r.prop.get);
      if (r.prop.set) touchValueRef(r.prop.set);
    } else {
      touchValueRef(r.prop.value);
    }
  }

  for (const p of normPatches) {
    if (p.keyNorm.kind === "symbol") touchValueRef(p.keyNorm.ref);
    if (p.deleted) continue;
    if (p.prop.isAccessor) {
      if (p.prop.get) touchValueRef(p.prop.get);
      if (p.prop.set) touchValueRef(p.prop.set);
    } else {
      touchValueRef(p.prop.value);
    }
  }

  if (bailouts.length > 0) {
    return finishBailout();
  }

  // Materialize pruned scope views & collapse any scope frames that have 0 live variables
  // (never mutates `captureGraph.nodes` in place).
  const clonedNodes = Object.assign({}, rawNodes);
  const effectiveScopeMap = new Map(); // rawScopeId -> nearest live ancestor scopeId | null
  for (const sId of validScopeChainOrder) {
    const rawS = rawNodes[sId];
    const hasLiveThis = rawS.this !== undefined && liveScopeVarKeys.has(`${sId}\0$this`);
    const liveVars = Array.isArray(rawS.vars)
      ? rawS.vars.filter((v) => v && liveScopeVarKeys.has(`${sId}\0${v.name}`))
      : [];
    const effParent = rawS.parent ? effectiveScopeMap.get(rawS.parent) || null : null;
    if (!hasLiveThis && liveVars.length === 0) {
      effectiveScopeMap.set(sId, effParent);
    } else {
      effectiveScopeMap.set(sId, sId);
      reachableScopeSet.add(sId);
      reachableScopes.push(sId);
      const prunedScope = {
        type: "scope",
        parent: effParent,
        vars: liveVars,
      };
      if (hasLiveThis) {
        prunedScope.this = rawS.this;
      }
      clonedNodes[sId] = prunedScope;
    }
  }
  for (const fnId of reachableFunctions) {
    const fnNorm = normNodes.get(fnId);
    if (fnNorm && fnNorm.raw.scope) {
      const effScope = effectiveScopeMap.get(fnNorm.raw.scope) || null;
      if (effScope !== fnNorm.raw.scope) {
        const updatedRaw = Object.assign({}, fnNorm.raw, { scope: effScope });
        clonedNodes[fnId] = updatedRaw;
        fnNorm.raw = updatedRaw;
      }
    }
  }
  nodes = clonedNodes;

  // Reconcile shared ArrayBuffer bytes if views carried bytes and buffer omitted them
  const reconstructedBufferBytes = new Map();
  for (const id of reachableNodes) {
    const norm = normNodes.get(id);
    if (norm.type === "arraybuffer" || norm.type === "sharedarraybuffer") {
      if (typeof norm.raw.bytes === "string") {
        reconstructedBufferBytes.set(id, decodeBase64Bytes(norm.raw.bytes));
      } else {
        const len = typeof norm.raw.byteLength === "number" ? norm.raw.byteLength : 0;
        reconstructedBufferBytes.set(id, Buffer.alloc(len));
      }
    }
  }
  for (const id of reachableNodes) {
    const norm = normNodes.get(id);
    if (
      (norm.type === "typedarray" || norm.type === "dataview") &&
      norm.bufferRef &&
      norm.bufferRef.kind === "node" &&
      typeof norm.raw.bytes === "string"
    ) {
      const bufId = norm.bufferRef.id;
      const bufNode = normNodes.get(bufId);
      if (bufNode && typeof bufNode.raw.bytes !== "string") {
        const viewBytes = decodeBase64Bytes(norm.raw.bytes);
        const offset = typeof norm.raw.byteOffset === "number" ? norm.raw.byteOffset : 0;
        let target = reconstructedBufferBytes.get(bufId);
        if (!target || target.length < offset + viewBytes.length) {
          const grown = Buffer.alloc(offset + viewBytes.length);
          if (target) target.copy(grown);
          target = grown;
          reconstructedBufferBytes.set(bufId, target);
        }
        viewBytes.copy(target, offset);
      }
    }
  }

  // Step 3: Claim class `.prototype` objects, class methods, and regular function `.prototype` objects
  const claimedClassProtos = new Map(); // classId -> protoId
  const protoClaimedByClass = new Map(); // protoId -> classId
  const extractedClassMembers = new Map(); // classId -> Array<memberDescriptor>
  const memberExtractedFnIds = new Set(); // fnIds extracted from a class rather than evaluated standalone
  const claimedFnProtos = new Map(); // fnId -> protoId
  const protoClaimedByFn = new Map(); // protoId -> fnId
  const lazyDefaultFnProtos = new Set(); // protoIds left to V8's lazy built-in JSFunction.prototype
  const fnHasLazyDefaultProto = new Map(); // fnId -> protoId

  function inheritsFromNode(nodeId, targetProtoId) {
    let cur = normNodes.get(nodeId) && normNodes.get(nodeId).protoRef;
    const seen = new Set();
    while (cur && cur.kind === "node") {
      if (cur.id === targetProtoId) return true;
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      const next = normNodes.get(cur.id);
      cur = next ? next.protoRef : null;
    }
    return false;
  }

  for (const fnId of reachableFunctions) {
    const parsed = parsedFns.get(fnId);
    if (!parsed || parsed.actualKind !== "class") continue;
    const clsNorm = normNodes.get(fnId);
    const classInfo = parsed.classInfo;

    if (classInfo.hasStaticPrivate) {
      bail("class with static private members", fnId);
      continue;
    }

    const protoProp = clsNorm.props.find(
      (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "prototype" && !p.isAccessor
    );
    const protoId =
      protoProp && protoProp.value && protoProp.value.kind === "node"
        ? protoProp.value.id
        : null;

    if (classInfo.hasInstancePrivate && protoId) {
      for (const otherId of reachableNodes) {
        if (otherId !== protoId && inheritsFromNode(otherId, protoId)) {
          bail("instance of class with private members", fnId);
          break;
        }
      }
    }

    if (
      protoId &&
      normNodes.has(protoId) &&
      normNodes.get(protoId).type === "object" &&
      !protoClaimedByClass.has(protoId) &&
      !protoClaimedByFn.has(protoId)
    ) {
      claimedClassProtos.set(fnId, protoId);
      protoClaimedByClass.set(protoId, fnId);
    }

    const extracted = [];
    for (const m of classInfo.members) {
      const holderNorm = m.static
        ? clsNorm
        : protoId && protoClaimedByClass.get(protoId) === fnId
          ? normNodes.get(protoId)
          : null;
      if (!holderNorm) continue;

      const matchProp = holderNorm.props.find((p) => {
        if (m.keyName !== null) {
          return p.keyNorm.kind === "string" && p.keyNorm.key === m.keyName;
        }
        if (m.symbolIntrinsic !== null) {
          return (
            p.keyNorm.kind === "symbol" &&
            p.keyNorm.ref.kind === "intrinsic" &&
            p.keyNorm.ref.path === m.symbolIntrinsic
          );
        }
        return false;
      });
      if (!matchProp) continue;

      let candRef = null;
      if (m.kind === "method" && !matchProp.isAccessor) candRef = matchProp.value;
      else if (m.kind === "get" && matchProp.isAccessor) candRef = matchProp.get;
      else if (m.kind === "set" && matchProp.isAccessor) candRef = matchProp.set;
      if (!candRef || candRef.kind !== "node") continue;

      const mFnId = candRef.id;
      const mFnNorm = normNodes.get(mFnId);
      if (
        !mFnNorm ||
        mFnNorm.type !== "function" ||
        mFnNorm.raw.bound ||
        memberExtractedFnIds.has(mFnId) ||
        claimedClassProtos.has(mFnId)
      ) {
        continue;
      }
      if (typeof mFnNorm.raw.source !== "string") continue;
      if (mFnNorm.raw.source.trim() !== m.strippedSource.trim()) continue;

      memberExtractedFnIds.add(mFnId);
      const keyDescExpr =
        m.keyName !== null ? quoteString(m.keyName) : resolveIntrinsicExpr(m.symbolIntrinsic, globalVar);
      const directDotKey =
        m.kind === "method" &&
        m.keyName !== null &&
        m.keyName !== "__proto__" &&
        isIdentifierName(m.keyName)
          ? m.keyName
          : null;

      extracted.push({
        fnId: mFnId,
        static: m.static,
        kind: m.kind,
        keyName: m.keyName,
        symbolIntrinsic: m.symbolIntrinsic,
        keyDescExpr,
        directDotKey,
        propRef: matchProp,
        naturalLength: m.naturalLength,
        hasPrototypeProp: m.hasPrototypeProp,
      });
    }
    extractedClassMembers.set(fnId, extracted);
  }

  // Claim regular function `.prototype` objects when uniquely owned and default proto
  for (const fnId of reachableFunctions) {
    if (memberExtractedFnIds.has(fnId)) continue;
    const parsed = parsedFns.get(fnId);
    if (!parsed || !parsed.hasPrototypeProp || parsed.actualKind === "class") continue;
    const fnNorm = normNodes.get(fnId);
    const protoProp = fnNorm.props.find(
      (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "prototype" && !p.isAccessor
    );
    if (!protoProp || !protoProp.value || protoProp.value.kind !== "node") continue;
    if (protoProp.enumerable !== false || protoProp.configurable !== false) continue;

    const protoId = protoProp.value.id;
    const protoNorm = normNodes.get(protoId);
    if (
      !protoNorm ||
      protoNorm.type !== "object" ||
      protoClaimedByClass.has(protoId) ||
      protoClaimedByFn.has(protoId)
    ) {
      continue;
    }

    const expectedProtoIntrinsic =
      parsed.actualKind === "generator" || parsed.isGenerator
        ? parsed.isAsync
          ? "%AsyncGeneratorPrototype%"
          : "%GeneratorPrototype%"
        : "Object.prototype";
    const expectNaturalCtor = parsed.actualKind === "normal" && !parsed.isGenerator;
    let ctorOrderCompatible = true;
    if (expectNaturalCtor && protoNorm.hasExplicitProps) {
      const ctorIdx = protoNorm.props.findIndex(
        (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "constructor"
      );
      const firstNonIndexIdx = protoNorm.props.findIndex(
        (p) => p.keyNorm.kind === "string" && !isArrayIndexKey(p.keyNorm.key)
      );
      if (ctorIdx !== -1 && ctorIdx !== firstNonIndexIdx) {
        ctorOrderCompatible = false;
      }
    }
    if (
      ctorOrderCompatible &&
      protoNorm.protoRef.kind === "intrinsic" &&
      (protoNorm.protoRef.path === expectedProtoIntrinsic ||
        resolveIntrinsicExpr(protoNorm.protoRef.path, globalVar) ===
          resolveIntrinsicExpr(expectedProtoIntrinsic, globalVar))
    ) {
      // Check if `protoId` is completely untouched default `fn.prototype` referenced ONLY by `fnId.prototype`!
      // Leaving it untouched avoids forcing V8's C++ runtime to allocate hundreds of unused prototype objects at startup.
      const defaultProtoWritable = fnNorm.frozen ? false : parsed.prototypeWritable;
      const isUntouchedProtoObj =
        (refCount.get(protoId) || 0) === 1 &&
        protoProp.writable === defaultProtoWritable &&
        protoNorm.extensible &&
        !protoNorm.sealed &&
        !protoNorm.frozen &&
        (!protoNorm.hasExplicitProps ||
          (expectNaturalCtor
            ? protoNorm.props.length === 1 &&
              protoNorm.props[0].keyNorm.kind === "string" &&
              protoNorm.props[0].keyNorm.key === "constructor" &&
              !protoNorm.props[0].isAccessor &&
              protoNorm.props[0].writable === true &&
              protoNorm.props[0].enumerable === false &&
              protoNorm.props[0].configurable === true &&
              protoNorm.props[0].value.kind === "node" &&
              protoNorm.props[0].value.id === fnId
            : protoNorm.props.length === 0));

      if (isUntouchedProtoObj) {
        lazyDefaultFnProtos.add(protoId);
        fnHasLazyDefaultProto.set(fnId, protoId);
        if (protoNorm.hasExplicitProps && protoNorm.props.length === 1) {
          // Remove the back-edge `protoNorm.constructor -> fnId` since `protoNorm` is elided
          refCount.set(fnId, Math.max(0, (refCount.get(fnId) || 1) - 1));
        }
      } else {
        claimedFnProtos.set(fnId, protoId);
        protoClaimedByFn.set(protoId, fnId);
      }
    }
  }

  for (const fnId of reachableFunctions) {
    if (memberExtractedFnIds.has(fnId)) continue;
    const parsed = parsedFns.get(fnId);
    const fnRaw = normNodes.get(fnId).raw;
    if ((parsed && parsed.requiresOwnerClass) || (fnRaw && fnRaw.ownerClass)) {
      bail("method using #private was not claimed by its ownerClass", fnId);
      continue;
    }
    if (parsed && parsed.usesFreeSuper) {
      bail("standalone method/accessor uses super without home class", fnId);
    }
  }

  if (bailouts.length > 0) {
    return finishBailout();
  }

  // Reverse map from prototypeId -> constructible constructor fnId (for Reflect.construct on custom-proto Error/Array/Map/Set)
  const constructorForProtoId = new Map();
  for (const [clsId, pId] of claimedClassProtos) constructorForProtoId.set(pId, clsId);
  for (const [fnId, pId] of claimedFnProtos) {
    const parsed = parsedFns.get(fnId);
    if (parsed && parsed.isConstructible) constructorForProtoId.set(pId, fnId);
  }

  // Determine whether an extracted class member needs a variable at all
  function hasNonDefaultFnState(fnId, expectedName, expectedLength, hasProtoProp) {
    const fnNorm = normNodes.get(fnId);
    if (!fnNorm.extensible || fnNorm.sealed || fnNorm.frozen) return true;
    if (
      fnNorm.protoRef.kind !== "intrinsic" ||
      resolveIntrinsicExpr(fnNorm.protoRef.path, globalVar) !==
        resolveIntrinsicExpr(fnNorm.defaultProtoIntrinsic, globalVar)
    ) {
      return true;
    }
    if (!fnNorm.hasExplicitProps) {
      if (
        typeof fnNorm.raw.name === "string" &&
        expectedName !== null &&
        fnNorm.raw.name !== expectedName
      ) {
        return true;
      }
      return false;
    }
    const allowedCount = (hasProtoProp ? 1 : 0) + 2; // length, name, [prototype]
    if (fnNorm.props.length !== allowedCount) return true;
    for (const p of fnNorm.props) {
      if (p.keyNorm.kind !== "string" || p.isAccessor) return true;
      if (p.keyNorm.key === "length") {
        if (
          p.writable !== false ||
          p.enumerable !== false ||
          p.configurable !== true ||
          p.value.kind !== "prim" ||
          Number(p.value.value) !== expectedLength
        ) {
          return true;
        }
      } else if (p.keyNorm.key === "name") {
        if (
          expectedName === null ||
          p.writable !== false ||
          p.enumerable !== false ||
          p.configurable !== true ||
          p.value.kind !== "prim" ||
          p.value.value !== expectedName
        ) {
          return true;
        }
      } else if (p.keyNorm.key === "prototype" && hasProtoProp) {
        if (!claimedFnProtos.has(fnId) && !claimedClassProtos.has(fnId) && !fnHasLazyDefaultProto.has(fnId)) {
          return true;
        }
      } else {
        return true;
      }
    }
    return false;
  }

  const classMemberInfoById = new Map();
  for (const [, list] of extractedClassMembers) {
    for (const m of list) classMemberInfoById.set(m.fnId, m);
  }

  function needsVariableForClassMember(mFnId) {
    if ((refCount.get(mFnId) || 0) > 1) return true;
    const m = classMemberInfoById.get(mFnId);
    const expectedName =
      m.keyName !== null
        ? m.kind === "get"
          ? `get ${m.keyName}`
          : m.kind === "set"
            ? `set ${m.keyName}`
            : m.keyName
        : null;
    return hasNonDefaultFnState(mFnId, expectedName, m.naturalLength, m.hasPrototypeProp);
  }

  // Step 4: Single-use inlining analysis
  const inlinedSet = new Set();
  const inlineState = new Map(); // id -> 0 (checking) | 1 (yes) | 2 (no)

  function isDefaultProto(norm) {
    if (!norm.protoRef) return true;
    return (
      norm.protoRef.kind === "intrinsic" &&
      resolveIntrinsicExpr(norm.protoRef.path, globalVar) ===
        resolveIntrinsicExpr(norm.defaultProtoIntrinsic, globalVar)
    );
  }

  function canInlineRef(ref, depth) {
    if (!ref) return true;
    if (ref.kind === "prim" || ref.kind === "intrinsic" || ref.kind === "global") return true;
    if (ref.kind === "node") {
      // Either inlineable itself, OR we only inline expressions whose non-inlined children already exist at use site!
      // During static precheck we only treat recursively inlineable children or symbols/buffers as guaranteed available;
      // node-var refs will be checked for availability at actual emission time!
      if ((refCount.get(ref.id) || 0) === 1) {
        return canInlineNode(ref.id, depth + 1);
      }
      return true;
    }
    return false;
  }

  function canInlineNode(id, depth) {
    if (depth > MAX_INLINE_DEPTH) return false;
    if ((refCount.get(id) || 0) !== 1) return false;
    if (
      lazyDefaultFnProtos.has(id) ||
      protoClaimedByClass.has(id) ||
      protoClaimedByFn.has(id) ||
      memberExtractedFnIds.has(id) ||
      claimedClassProtos.has(id) ||
      claimedFnProtos.has(id)
    ) {
      return false;
    }
    if (inlineState.has(id)) {
      return inlineState.get(id) === 1;
    }
    inlineState.set(id, 0);

    const norm = normNodes.get(id);
    if (!norm) {
      inlineState.set(id, 2);
      return false;
    }

    let ok = false;
    switch (norm.type) {
      case "symbol":
        ok = true;
        break;

      case "date":
        ok = isDefaultProto(norm) && norm.props.length === 0;
        break;

      case "regexp": {
        const li = norm.raw.lastIndex;
        const defaultLi = li === undefined || (typeof li === "number" && Object.is(li, 0));
        const onlyDefaultLiProp = norm.props.every(
          (p) =>
            p.keyNorm.kind === "string" &&
            p.keyNorm.key === "lastIndex" &&
            !p.isAccessor &&
            p.writable === true &&
            p.value.kind === "prim" &&
            p.value.prim === "number" &&
            Object.is(Number(p.value.value), 0) &&
            p.value.special !== "-0"
        );
        ok = isDefaultProto(norm) && defaultLi && onlyDefaultLiProp;
        break;
      }

      case "boxed": {
        const isStr = norm.primRef.kind === "prim" && norm.primRef.prim === "string";
        const strLen = isStr ? String(norm.primRef.value ?? "").length : 0;
        const noExtraProps = norm.props.every((p) => {
          if (!isStr || p.keyNorm.kind !== "string") return false;
          if (p.keyNorm.key === "length") return true;
          return isArrayIndexKey(p.keyNorm.key) && Number(p.keyNorm.key) < strLen;
        });
        ok = isDefaultProto(norm) && noExtraProps && canInlineRef(norm.primRef, depth);
        break;
      }

      case "arraybuffer":
        ok = isDefaultProto(norm) && norm.props.length === 0 && norm.extensible;
        break;

      case "typedarray": {
        const len = typeof norm.raw.length === "number" ? norm.raw.length : 0;
        const noExtraProps = norm.props.every(
          (p) => p.keyNorm.kind === "string" && isArrayIndexKey(p.keyNorm.key) && Number(p.keyNorm.key) < len
        );
        ok =
          isDefaultProto(norm) &&
          noExtraProps &&
          norm.extensible &&
          (!norm.bufferRef || canInlineRef(norm.bufferRef, depth));
        break;
      }

      case "promise":
        // Only inline fulfilled/rejected promises when value is primitive (never a thenable)
        ok =
          isDefaultProto(norm) &&
          norm.props.length === 0 &&
          norm.extensible &&
          norm.valueRef.kind === "prim";
        break;

      case "object": {
        const protoOk =
          isDefaultProto(norm) ||
          (norm.protoRef.kind === "prim" && norm.protoRef.prim === "null") ||
          canInlineRef(norm.protoRef, depth);
        if (protoOk) {
          ok = norm.props.every(
            (p) =>
              canEmitAsPlainDataProp(p, norm) &&
              (p.keyNorm.kind === "string" || canInlineRef(p.keyNorm.ref, depth)) &&
              canInlineRef(p.value, depth)
          );
        }
        break;
      }

      case "array": {
        if (isDefaultProto(norm)) {
          const len = typeof norm.raw.length === "number" ? norm.raw.length : 0;
          let maxPresentIdx = -1;
          let propsOk = true;
          for (const p of norm.props) {
            if (p.keyNorm.kind !== "string") {
              propsOk = false;
              break;
            }
            if (p.keyNorm.key === "length") {
              const expectWritable = !norm.frozen;
              if (p.isAccessor || p.writable !== expectWritable) {
                propsOk = false;
                break;
              }
              continue;
            }
            if (!isArrayIndexKey(p.keyNorm.key) || Number(p.keyNorm.key) >= len) {
              propsOk = false;
              break;
            }
            if (!canEmitAsPlainDataProp(p, norm) || !canInlineRef(p.value, depth)) {
              propsOk = false;
              break;
            }
            const idx = Number(p.keyNorm.key);
            if (idx > maxPresentIdx) maxPresentIdx = idx;
          }
          const trailingHoles = len - 1 - maxPresentIdx;
          if (propsOk && trailingHoles <= 16) {
            ok = true;
          }
        }
        break;
      }

      case "map":
        if (isDefaultProto(norm) && norm.props.length === 0 && norm.extensible) {
          ok = norm.entries.every(
            ([k, v]) => canInlineRef(k, depth) && canInlineRef(v, depth)
          );
        }
        break;

      case "set":
        if (isDefaultProto(norm) && norm.props.length === 0 && norm.extensible) {
          ok = norm.entries.every((el) => canInlineRef(el, depth));
        }
        break;

      case "weakmap":
      case "weakset":
        ok = isDefaultProto(norm) && norm.props.length === 0 && norm.extensible;
        break;

      default:
        ok = false;
    }

    inlineState.set(id, ok ? 1 : 2);
    if (ok) inlinedSet.add(id);
    return ok;
  }

  for (const id of reachableNodes) {
    canInlineNode(id, 0);
  }

  // Step 5: Build Creation Units & Prototype-Tier Topological Sort
  // Units:
  // - "symbol:<id>"
  // - "buffer:<id>"
  // - "scope:<rootScopeId>"
  // - "fn:<fnId>" (for scope === null non-bound functions/classes)
  // - "node:<id>" (for all other non-claimed, non-inlined nodes)
  const units = [];
  const unitById = new Map();
  const producerUnitOfNode = new Map(); // nodeId -> unitKey

  function rootScopeOf(sId) {
    let cur = sId;
    while (nodes[cur] && nodes[cur].parent) {
      cur = nodes[cur].parent;
    }
    return cur;
  }

  function registerUnit(key, kind, payload, producedNodeIds) {
    const u = { key, kind, payload, producedNodeIds, hardDeps: new Set(), softDeps: new Set() };
    units.push(u);
    unitById.set(key, u);
    for (const nId of producedNodeIds) {
      producerUnitOfNode.set(nId, key);
    }
    return u;
  }

  // Helper counters & var allocator
  let varCounter = 0;
  const nodeVarNames = new Map();
  const directSlotExprByNodeId = new Map(); // nodeId -> `${resVar}[${i}]` when outer use count === 1 & 0 phase-3 fixups
  function varName(nodeId) {
    if (directSlotExprByNodeId.has(nodeId)) return directSlotExprByNodeId.get(nodeId);
    if (nodeVarNames.has(nodeId)) return nodeVarNames.get(nodeId);
    const v = `${prefix}${varCounter++}`;
    nodeVarNames.set(nodeId, v);
    return v;
  }
  function allocTempVar() {
    return `${prefix}${varCounter++}`;
  }

  let needB64Helper = false;
  let needRejectHelper = false;
  let needExtractMemberHelper = false;
  let definePropCount = 0;
  const b64HelperName = `${prefix}b64`;
  const rejectHelperName = `${prefix}rj`;
  const extractMemberHelperName = `${prefix}xm`;
  const dpHelperName = `${prefix}dp`;

  const strippedIdFnIds = new Set();
  const namedAtCreationFnIds = new Map(); // fnId -> assignedNameString (via SetFunctionName)
  const desiredAutoNameByFnId = new Map(); // fnId -> desired name string for anonymous functions/arrows
  for (const fnId of reachableFunctions) {
    if (memberExtractedFnIds.has(fnId)) continue;
    const fnNorm = normNodes.get(fnId);
    if (!fnNorm || fnNorm.raw.bound) continue;
    const parsed = parsedFns.get(fnId);
    if (!parsed || (parsed.form !== "expression" && parsed.form !== "arrow")) continue;
    if (parsed.naturalName !== "" && !parsed.mutatesOwnId) continue;

    let desired = null;
    if (!fnNorm.hasExplicitProps) {
      if (typeof fnNorm.raw.name === "string" && fnNorm.raw.name.length > 0) {
        desired = fnNorm.raw.name;
      }
    } else {
      let seenCustom = false;
      let reorderedName = false;
      let nameProp = null;
      for (const p of fnNorm.props) {
        if (p.keyNorm.kind !== "string") continue;
        const k = p.keyNorm.key;
        if (k === "name") {
          nameProp = p;
          if (seenCustom) reorderedName = true;
        } else if (k !== "length" && k !== "prototype") {
          seenCustom = true;
        }
      }
      if (
        nameProp &&
        !reorderedName &&
        !nameProp.isAccessor &&
        nameProp.writable === false &&
        nameProp.enumerable === false &&
        nameProp.configurable === (!fnNorm.sealed && !fnNorm.frozen) &&
        nameProp.value.kind === "prim" &&
        nameProp.value.prim === "string" &&
        typeof nameProp.value.value === "string" &&
        nameProp.value.value.length > 0
      ) {
        desired = nameProp.value.value;
      }
    }
    if (
      desired &&
      isStrictSafeBinding(desired) &&
      (!parsed.freeIdentifiers || !parsed.freeIdentifiers.has(desired))
    ) {
      desiredAutoNameByFnId.set(fnId, desired);
    }
  }

  // Identify scope-internal functions that are ONLY referenced by their own scope variable in `fn.scope`,
  // have no claimed non-lazy prototype / extracted class members, and need zero Phase-3 reconciliation:
  // these stay pure local `var`/`function` bindings inside their scope IIFE with zero `__h$o` slot!
  const directSelfScopeBindCount = new Map();
  for (const sId of reachableScopes) {
    const sNode = nodes[sId];
    for (const v of sNode.vars || []) {
      if (!v || v.name === "this" || v.value === undefined) continue;
      const vr = normalizeRef(v.value);
      if (vr.kind === "node" && normNodes.has(vr.id) && normNodes.get(vr.id).type === "function") {
        const fnRaw = normNodes.get(vr.id).raw;
        if (fnRaw && fnRaw.scope === sId) {
          directSelfScopeBindCount.set(vr.id, (directSelfScopeBindCount.get(vr.id) || 0) + 1);
        }
      }
    }
  }

  const omitOutSlotFnIds = new Set();
  for (const fnId of reachableFunctions) {
    if (memberExtractedFnIds.has(fnId)) continue;
    const fnNorm = normNodes.get(fnId);
    if (!fnNorm || fnNorm.raw.bound || !fnNorm.raw.scope) continue;
    const parsed = parsedFns.get(fnId);
    if (!parsed || parsed.actualKind === "class") continue;
    if (claimedClassProtos.has(fnId) || claimedFnProtos.has(fnId)) continue;
    const selfBinds = directSelfScopeBindCount.get(fnId) || 0;
    if (selfBinds !== 1 || (refCount.get(fnId) || 0) !== 1) continue;

    // Determine effective name after creation in `sId`
    const sNode = nodes[fnNorm.raw.scope];
    const matchingVar = (sNode.vars || []).find((v) => {
      if (!v || v.value === undefined) return false;
      const vr = normalizeRef(v.value);
      return vr.kind === "node" && vr.id === fnId;
    });
    if (!matchingVar) continue;

    let effectiveNameAtCreation = parsed.naturalName;
    if (parsed.naturalName === "") {
      const autoName = desiredAutoNameByFnId.get(fnId);
      if (autoName && matchingVar.name === autoName) {
        effectiveNameAtCreation = autoName;
      } else if (
        fnNorm.hasExplicitProps
          ? fnNorm.props.some(
              (p) =>
                p.keyNorm.kind === "string" &&
                p.keyNorm.key === "name" &&
                p.value &&
                p.value.value === ""
            )
          : !fnNorm.raw.name
      ) {
        // Function expects empty `.name === ""`! Note: `var x = (0, function(){})` preserves `.name === ""`!
        effectiveNameAtCreation = "";
      } else {
        continue;
      }
    } else if (parsed.mutatesOwnId && matchingVar.name !== parsed.naturalName) {
      continue;
    } else if (
      parsed.naturalName &&
      (fnNorm.raw.declaration === true || parsed.mutatesOwnId) &&
      matchingVar.name === parsed.naturalName &&
      matchingVar.kind !== "const"
    ) {
      effectiveNameAtCreation = parsed.naturalName;
    }

    if (!hasNonDefaultFnState(fnId, effectiveNameAtCreation, parsed.naturalLength, parsed.hasPrototypeProp)) {
      omitOutSlotFnIds.add(fnId);
    }
  }

  const globalRootStringKeys = new Set(
    normRoots
      .filter((r) => !r.deleted && r.keyNorm.kind === "string")
      .map((r) => r.keyNorm.key)
  );

  const scopeHelperCtx = {
    prefix,
    nodes,
    normNodes,
    parsedFns,
    reachableScopes,
    reachableFunctions,
    claimedClassProtos,
    extractedClassMembers,
    claimedFnProtos,
    memberExtractedFnIds,
    strippedIdFnIds,
    namedAtCreationFnIds,
    desiredAutoNameByFnId,
    omitOutSlotFnIds,
    globalRootStringKeys,
    patchedIntrinsicKeys,
    hasPatchedIntrinsicSymbols,
    bail,
    hasBailouts: () => bailouts.length > 0,
    varName,
    allocTempVar,
    normalizeRef,
    normalizeProtoRef,
    exprForPrimitive: formatPrimitive,
    needsVariableForClassMember,
    ensureExtractMemberHelper() {
      needExtractMemberHelper = true;
      return extractMemberHelperName;
    },
    ensureB64Helper() {
      needB64Helper = true;
      return b64HelperName;
    },
    ensureRejectHelper() {
      needRejectHelper = true;
      return rejectHelperName;
    },
    definePropertyFn() {
      definePropCount++;
      return `__DP_PLACEHOLDER__`;
    },
  };

  const scopeTreeEmitter = buildScopeTreeEmitter(scopeHelperCtx);

  // Register root scope units
  const rootScopeIds = reachableScopes.filter((sId) => !nodes[sId].parent);
  for (const rsId of rootScopeIds) {
    const meta = scopeTreeEmitter.computeSubtreeMeta(rsId);
    if (meta.producedIds.size === 0) continue;
    registerUnit(`scope:${rsId}`, "scope", rsId, Array.from(meta.producedIds));
  }

  // Register top-level function/class units
  for (const fnId of reachableFunctions) {
    const fnNorm = normNodes.get(fnId);
    if (fnNorm.raw.bound || memberExtractedFnIds.has(fnId) || fnNorm.raw.scope) continue;
    const produced = [fnId];
    if (claimedClassProtos.has(fnId)) produced.push(claimedClassProtos.get(fnId));
    if (claimedFnProtos.has(fnId)) produced.push(claimedFnProtos.get(fnId));
    const members = extractedClassMembers.get(fnId);
    if (members) {
      for (const m of members) produced.push(m.fnId);
    }
    registerUnit(`fn:${fnId}`, "topFn", fnId, produced);
  }

  // Register all remaining non-inlined, non-claimed heap nodes
  for (const id of reachableNodes) {
    if (inlinedSet.has(id) || lazyDefaultFnProtos.has(id)) continue;
    if (producerUnitOfNode.has(id)) continue;
    const norm = normNodes.get(id);
    if (norm.type === "symbol") {
      registerUnit(`symbol:${id}`, "symbol", id, [id]);
    } else if (norm.type === "arraybuffer" || norm.type === "sharedarraybuffer") {
      registerUnit(`buffer:${id}`, "buffer", id, [id]);
    } else {
      registerUnit(`node:${id}`, "node", id, [id]);
    }
  }

  // Count references to `nodeId` coming from `vars`/`this` inside the SAME rootScope so we know exact outer use count!
  const sameRootScopeRefCount = new Map();
  for (const sId of reachableScopes) {
    const rs = rootScopeOf(sId);
    const sNode = nodes[sId];
    if (sNode.this !== undefined) {
      const tr = normalizeRef(sNode.this);
      if (tr.kind === "node" && producerUnitOfNode.get(tr.id) === `scope:${rs}`) {
        sameRootScopeRefCount.set(tr.id, (sameRootScopeRefCount.get(tr.id) || 0) + 1);
      }
    }
    for (const v of sNode.vars || []) {
      if (!v || v.value === undefined) continue;
      const vr = normalizeRef(v.value);
      if (vr.kind === "node" && producerUnitOfNode.get(vr.id) === `scope:${rs}`) {
        sameRootScopeRefCount.set(vr.id, (sameRootScopeRefCount.get(vr.id) || 0) + 1);
      }
    }
  }

  function canUseDirectOutSlotExpr(nodeId) {
    const nNorm = normNodes.get(nodeId);
    if (!nNorm || nNorm.type !== "function" || nNorm.raw.bound) return false;
    if (claimedClassProtos.has(nodeId) || claimedFnProtos.has(nodeId)) return false;
    if (memberExtractedFnIds.has(nodeId)) return false;
    const outerRefs = (refCount.get(nodeId) || 0) - (sameRootScopeRefCount.get(nodeId) || 0);
    if (outerRefs !== 1) return false;
    const parsed = parsedFns.get(nodeId);
    if (!parsed || parsed.actualKind === "class") return false;
    const effName = namedAtCreationFnIds.has(nodeId)
      ? namedAtCreationFnIds.get(nodeId)
      : strippedIdFnIds.has(nodeId)
        ? ""
        : parsed.naturalName;
    return !hasNonDefaultFnState(nodeId, effName, parsed.naturalLength, parsed.hasPrototypeProp);
  }
  scopeHelperCtx.canUseDirectOutSlotExpr = canUseDirectOutSlotExpr;
  scopeHelperCtx.registerDirectSlotExpr = (nodeId, slotExpr) => {
    directSlotExprByNodeId.set(nodeId, slotExpr);
  };

  // Collect transitive non-inlined node dependencies inside an inlineable node
  function collectUnderlyingNodeDeps(ref, outSet) {
    if (!ref || ref.kind !== "node") return;
    if (!inlinedSet.has(ref.id)) {
      outSet.add(ref.id);
      return;
    }
    const norm = normNodes.get(ref.id);
    if (!norm) return;
    if (norm.protoRef) collectUnderlyingNodeDeps(norm.protoRef, outSet);
    if (norm.bufferRef) collectUnderlyingNodeDeps(norm.bufferRef, outSet);
    if (norm.primRef) collectUnderlyingNodeDeps(norm.primRef, outSet);
    if (norm.valueRef) collectUnderlyingNodeDeps(norm.valueRef, outSet);
    if (norm.entries) {
      if (norm.type === "map") {
        for (const [k, v] of norm.entries) {
          collectUnderlyingNodeDeps(k, outSet);
          collectUnderlyingNodeDeps(v, outSet);
        }
      } else {
        for (const el of norm.entries) collectUnderlyingNodeDeps(el, outSet);
      }
    }
    for (const p of norm.props) {
      if (p.keyNorm.kind === "symbol") collectUnderlyingNodeDeps(p.keyNorm.ref, outSet);
      if (p.isAccessor) {
        if (p.get) collectUnderlyingNodeDeps(p.get, outSet);
        if (p.set) collectUnderlyingNodeDeps(p.set, outSet);
      } else if (p.value) {
        collectUnderlyingNodeDeps(p.value, outSet);
      }
    }
  }

  function addDepRef(u, ref, isHard) {
    const depIds = new Set();
    collectUnderlyingNodeDeps(ref, depIds);
    for (const dId of depIds) {
      const targetUnitKey = producerUnitOfNode.get(dId);
      if (targetUnitKey && targetUnitKey !== u.key) {
        if (isHard) u.hardDeps.add(targetUnitKey);
        else u.softDeps.add(targetUnitKey);
      }
    }
  }

  // Populate hard & soft dependency edges on creation units
  for (const u of units) {
    if (u.kind === "scope") {
      // Classes with `extends` in this scope tree have hard deps on superClass;
      // Scope vars (especially `const` and lexical `this`) have soft deps!
      for (const sId of reachableScopes) {
        if (rootScopeOf(sId) !== u.payload) continue;
        const sNode = nodes[sId];
        if (sNode.this !== undefined) addDepRef(u, normalizeRef(sNode.this), true);
        if (Array.isArray(sNode.vars)) {
          for (const v of sNode.vars) {
            if (v && v.value !== undefined) {
              const vRef = normalizeRef(v.value);
              addDepRef(u, vRef, v.name === "this");
            }
          }
        }
      }
      for (const nId of u.producedNodeIds) {
        const nNorm = normNodes.get(nId);
        if (!nNorm) continue;
        if (nNorm.type === "function") {
          const parsed = parsedFns.get(nId);
          if (
            parsed &&
            parsed.actualKind === "class" &&
            parsed.classInfo.superInfo &&
            !parsed.classInfo.superInfo.isNullLiteral
          ) {
            addDepRef(u, nNorm.protoRef, true);
          }
          if (nNorm.raw.this !== undefined) {
            addDepRef(u, normalizeRef(nNorm.raw.this), true);
          }
        }
      }
    } else if (u.kind === "topFn") {
      const fnNorm = normNodes.get(u.payload);
      const parsed = parsedFns.get(u.payload);
      if (
        parsed &&
        parsed.actualKind === "class" &&
        parsed.classInfo.superInfo &&
        !parsed.classInfo.superInfo.isNullLiteral
      ) {
        addDepRef(u, fnNorm.protoRef, true);
      }
      if (fnNorm.raw.this !== undefined) {
        addDepRef(u, normalizeRef(fnNorm.raw.this), true);
      }
    } else if (u.kind === "node") {
      const norm = normNodes.get(u.payload);
      if (norm.protoRef) addDepRef(u, norm.protoRef, true);
      if (norm.bufferRef) addDepRef(u, norm.bufferRef, true);
      if (norm.primRef) addDepRef(u, norm.primRef, true);
      if (norm.bound) {
        addDepRef(u, norm.bound.target, true);
        addDepRef(u, norm.bound.thisArg, true);
        for (const a of norm.bound.args) addDepRef(u, a, true);
      }
      if (norm.valueRef) addDepRef(u, norm.valueRef, true);
      if (norm.entries) {
        if (norm.type === "map") {
          for (const [k, v] of norm.entries) {
            addDepRef(u, k, false);
            addDepRef(u, v, false);
          }
        } else {
          for (const el of norm.entries) addDepRef(u, el, false);
        }
      }
      for (const p of norm.props) {
        if (p.keyNorm.kind === "symbol") addDepRef(u, p.keyNorm.ref, false);
        if (p.isAccessor) {
          if (p.get) addDepRef(u, p.get, false);
          if (p.set) addDepRef(u, p.set, false);
        } else if (p.value) {
          addDepRef(u, p.value, false);
        }
      }
    }
  }

  // Pre-break any hard cycle between a `node` unit's `protoRef` and a `scope`/`topFn` unit's lexical `this`
  // (e.g. `marked`: `class Marked` is in `scope:s1`, `inst = new Marked()` has `proto = Marked.prototype`,
  // and `inst.parse = (n, s) => this.defaults` in `scope:s1` has lexical `this = inst`).
  // Deferring `inst`'s prototype via `Object.setPrototypeOf` lets `inst` allocate before `scope:s1` runs!
  const brokenProtoNodes = new Set();
  function canReachHard(startKey, goalKey, seen = new Set()) {
    if (startKey === goalKey) return true;
    if (seen.has(startKey)) return false;
    seen.add(startKey);
    const u = unitById.get(startKey);
    if (!u) return false;
    for (const nextKey of u.hardDeps) {
      if (canReachHard(nextKey, goalKey, seen)) return true;
    }
    return false;
  }
  for (const u of units) {
    if (u.kind !== "node") continue;
    const norm = normNodes.get(u.payload);
    if (!norm || !norm.protoRef) continue;
    const protoDeps = new Set();
    collectUnderlyingNodeDeps(norm.protoRef, protoDeps);
    for (const pNodeId of protoDeps) {
      const pUnitKey = producerUnitOfNode.get(pNodeId);
      if (pUnitKey && pUnitKey !== u.key && u.hardDeps.has(pUnitKey) && canReachHard(pUnitKey, u.key)) {
        brokenProtoNodes.add(u.payload);
        u.hardDeps.delete(pUnitKey);
      }
    }
  }

  // Compute hard-edge sink distance h(u): if w hard-depends on u, h(u) >= 1 + h(w)
  const hardDependents = new Map();
  for (const u of units) hardDependents.set(u.key, []);
  for (const u of units) {
    for (const depKey of u.hardDeps) {
      hardDependents.get(depKey).push(u.key);
    }
  }

  const hScore = new Map();
  const hState = new Map();

  function computeHScore(uKey) {
    if (hState.get(uKey) === 2) return hScore.get(uKey);
    if (hState.get(uKey) === 1) {
      // Break hard cycle by deferring prototype via Object.setPrototypeOf if node unit
      const u = unitById.get(uKey);
      if (u && u.kind === "node") {
        brokenProtoNodes.add(u.payload);
      }
      return 0;
    }
    hState.set(uKey, 1);
    let maxDep = 0;
    const u = unitById.get(uKey);
    // Symbols and buffers get highest boost so they always come first
    if (u.kind === "symbol") maxDep = 1000000;
    else if (u.kind === "buffer") maxDep = 999999;
    for (const wKey of hardDependents.get(uKey) || []) {
      const sub = computeHScore(wKey) + 1;
      if (sub > maxDep) maxDep = sub;
    }
    hScore.set(uKey, maxDep);
    hState.set(uKey, 2);
    return maxDep;
  }

  for (const u of units) computeHScore(u.key);

  // Promote acyclic `softDeps` (e.g. `topFn` / leaf `node` units) up to their consumer's `hScore` tier
  // so scopes with `hScore > 0` receive their non-cyclic soft dependencies BEFORE executing instead of
  // falling back to Phase-3 deferred scope setters!
  function canReachAnyDep(startKey, goalKey, seen = new Set()) {
    if (startKey === goalKey) return true;
    if (seen.has(startKey)) return false;
    seen.add(startKey);
    const u = unitById.get(startKey);
    if (!u) return false;
    for (const nk of u.hardDeps) {
      if (canReachAnyDep(nk, goalKey, seen)) return true;
    }
    for (const nk of u.softDeps) {
      if (canReachAnyDep(nk, goalKey, seen)) return true;
    }
    return false;
  }
  let promoted = true;
  let promotePasses = 0;
  while (promoted && promotePasses++ < 8) {
    promoted = false;
    for (const u of units) {
      const uSc = hScore.get(u.key) || 0;
      if (uSc <= 0 || uSc >= 999999) continue;
      for (const depKey of u.softDeps) {
        const dSc = hScore.get(depKey) || 0;
        if (dSc < uSc && !canReachAnyDep(depKey, u.key)) {
          hScore.set(depKey, uSc);
          promoted = true;
        }
      }
    }
  }

  // Group units by hScore descending; within same hScore, post-order DFS over softDeps!
  const tierMap = new Map();
  for (const u of units) {
    const sc = hScore.get(u.key);
    if (!tierMap.has(sc)) tierMap.set(sc, []);
    tierMap.get(sc).push(u);
  }
  const sortedTierScores = Array.from(tierMap.keys()).sort((a, b) => b - a);
  const orderedUnits = [];
  for (const sc of sortedTierScores) {
    const bucket = tierMap.get(sc);
    const bucketSet = new Set(bucket.map((u) => u.key));
    const visited = new Set();
    function dfsSoft(u) {
      if (visited.has(u.key)) return;
      visited.add(u.key);
      for (const depKey of u.softDeps) {
        if (!bucketSet.has(depKey)) continue;
        const depUnit = unitById.get(depKey);
        // In a mutual soft-dependency cycle between a `scope` unit and a `node` unit (e.g. `immutable`
        // prototypes referencing 60 scope methods while the scope holds 1 variable pointing back to the prototype),
        // emit the `scope` unit FIRST so all 60 methods are available inline in the prototype's `{ ... }` literal
        // instead of emitting 60 `void 0` placeholders + 60 Phase-3 assignments!
        if (u.kind === "scope" && depUnit && depUnit.kind === "node" && depUnit.softDeps.has(u.key)) {
          continue;
        }
        dfsSoft(depUnit);
      }
      orderedUnits.push(u);
    }
    for (const u of bucket) dfsSoft(u);
  }

  // Step 6: Emit Code across Phases!
  const availableNodeIds = new Set();
  const phase2Lines = []; // Declarations, scope factories, object/collection creation
  const phase3Tasks = []; // Thunks run after Phase 2 completes -> populate phase3Lines
  const phase3Lines = []; // Deferred property definitions, Map/Set entries, scope setters
  const phase4Lines = []; // Extensibility: freeze / seal / preventExtensions
  const phase5Lines = []; // intrinsicPatches & roots
  const allDeferredScopeSetters = [];

  function deferPhase3(fn) {
    phase3Tasks.push(fn);
  }

  function isRefAvailableNow(ref) {
    if (!ref) return true;
    if (ref.kind === "prim" || ref.kind === "intrinsic" || ref.kind === "global") return true;
    if (ref.kind === "node") {
      if (availableNodeIds.has(ref.id)) return true;
      if (inlinedSet.has(ref.id)) {
        const deps = new Set();
        collectUnderlyingNodeDeps(ref, deps);
        for (const dId of deps) {
          if (!availableNodeIds.has(dId)) return false;
        }
        return true;
      }
      return false;
    }
    return false;
  }

  function exprForRef(ref) {
    if (!ref) return "void 0";
    switch (ref.kind) {
      case "prim":
        return formatPrimitive(ref);
      case "global":
        return globalVar;
      case "intrinsic":
        return resolveIntrinsicExpr(ref.path, globalVar);
      case "node":
        if (inlinedSet.has(ref.id) && isRefAvailableNow(ref)) {
          return emitInlineNodeExpr(ref.id);
        }
        // If an inline candidate's child wasn't available yet (cycle), demote from inlinedSet
        if (inlinedSet.has(ref.id)) {
          inlinedSet.delete(ref.id);
        }
        return varName(ref.id);
      default:
        return "void 0";
    }
  }

  function emitInlineNodeExpr(id) {
    const norm = normNodes.get(id);
    switch (norm.type) {
      case "symbol":
        return formatSymbolExpr(norm);
      case "date":
        return wrapExtensibilityInline(formatDateExpr(norm), norm);
      case "regexp":
        return wrapExtensibilityInline(formatRegExpBase(norm.raw), norm);
      case "boxed":
        return wrapExtensibilityInline(formatBoxedExpr(norm.primRef, exprForRef), norm);
      case "arraybuffer": {
        const bytes = reconstructedBufferBytes.get(id);
        return formatArrayBufferExpr(
          bytes,
          norm.raw.byteLength,
          false,
          scopeHelperCtx.ensureB64Helper
        );
      }
      case "typedarray":
        if (norm.bufferRef) {
          const bufExpr = exprForRef(norm.bufferRef);
          const off = norm.raw.byteOffset || 0;
          const len = norm.raw.length || 0;
          return `new ${norm.raw.ctor || "Uint8Array"}(${bufExpr}, ${off}, ${len})`;
        }
        return formatUnsharedTypedArrayExpr(norm.raw, scopeHelperCtx.ensureB64Helper);
      case "promise":
        if (norm.state === "fulfilled") {
          return `Promise.resolve(${exprForRef(norm.valueRef)})`;
        }
        return `${scopeHelperCtx.ensureRejectHelper()}(${exprForRef(norm.valueRef)})`;
      case "object": {
        const entries = [];
        if (!isDefaultProto(norm)) {
          const pExpr =
            norm.protoRef.kind === "prim" && norm.protoRef.prim === "null"
              ? "null"
              : exprForRef(norm.protoRef);
          entries.push(`__proto__: ${pExpr}`);
        }
        for (const p of norm.props) {
          const vExpr = exprForRef(p.value);
          if (p.keyNorm.kind === "string") {
            entries.push(`${formatObjectLiteralKey(p.keyNorm.key)}: ${vExpr}`);
          } else {
            entries.push(`[${exprForRef(p.keyNorm.ref)}]: ${vExpr}`);
          }
        }
        const lit = entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
        return wrapExtensibilityInline(lit, norm);
      }
      case "array": {
        const len = typeof norm.raw.length === "number" ? norm.raw.length : 0;
        const byIdx = new Map();
        for (const p of norm.props) {
          if (p.keyNorm.kind === "string" && isArrayIndexKey(p.keyNorm.key)) {
            byIdx.set(Number(p.keyNorm.key), p);
          }
        }
        const parts = [];
        for (let i = 0; i < len; i++) {
          if (byIdx.has(i)) {
            parts.push(exprForRef(byIdx.get(i).value));
          } else {
            parts.push("");
          }
        }
        // In JS, `[a, ]` has length 1, whereas `[a, ,]` has length 2!
        const trailingHole = len > 0 && !byIdx.has(len - 1);
        const lit =
          len === 0
            ? "[]"
            : `[${parts.join(", ")}${trailingHole ? "," : ""}]`;
        return wrapExtensibilityInline(lit, norm);
      }
      case "map": {
        if (norm.entries.length === 0) return "new Map()";
        const pairs = norm.entries.map(([k, v]) => `[${exprForRef(k)}, ${exprForRef(v)}]`);
        return `new Map([${pairs.join(", ")}])`;
      }
      case "set": {
        if (norm.entries.length === 0) return "new Set()";
        const els = norm.entries.map((el) => exprForRef(el));
        return `new Set([${els.join(", ")}])`;
      }
      case "weakmap":
        return "new WeakMap()";
      case "weakset":
        return "new WeakSet()";
      default:
        return "void 0";
    }
  }

  function formatSymbolExpr(norm) {
    if (norm.raw.registered != null) {
      return `Symbol.for(${quoteString(norm.raw.registered)})`;
    }
    if (norm.raw.description == null) return "Symbol()";
    return `Symbol(${quoteString(norm.raw.description)})`;
  }

  function formatDateExpr(norm) {
    const t = norm.raw.time;
    if (t === null || t === undefined || norm.raw.special === "NaN" || Number.isNaN(Number(t))) {
      return "new Date(NaN)";
    }
    return `new Date(${Number(t)})`;
  }

  function scheduleExtensibility(norm, targetExpr) {
    if (norm.frozen) {
      phase4Lines.push(`Object.freeze(${targetExpr});`);
    } else if (norm.sealed) {
      phase4Lines.push(`Object.seal(${targetExpr});`);
    } else if (!norm.extensible) {
      phase4Lines.push(`Object.preventExtensions(${targetExpr});`);
    }
  }

  function emitNodeUnit(id) {
    const norm = normNodes.get(id);
    const vName = varName(id);
    const deferProto = brokenProtoNodes.has(id) || (norm.protoRef && !isRefAvailableNow(norm.protoRef));

    switch (norm.type) {
      case "symbol":
        phase2Lines.push(`var ${vName} = ${formatSymbolExpr(norm)};`);
        availableNodeIds.add(id);
        return;

      case "arraybuffer":
      case "sharedarraybuffer": {
        const isShared = norm.type === "sharedarraybuffer" || !!norm.raw.shared;
        const bytes = reconstructedBufferBytes.get(id);
        const expr = formatArrayBufferExpr(
          bytes,
          norm.raw.byteLength,
          isShared,
          scopeHelperCtx.ensureB64Helper
        );
        phase2Lines.push(`var ${vName} = ${wrapProtoIfNeeded(expr, norm, deferProto)};`);
        availableNodeIds.add(id);
        emitExtraPropsGeneric(vName, norm, new Set());
        scheduleExtensibility(norm, vName);
        return;
      }

      case "object":
        emitPlainObjectNode(id, vName, norm, deferProto);
        return;

      case "array":
        emitArrayNode(id, vName, norm, deferProto);
        return;

      case "map":
        emitMapNode(id, vName, norm, deferProto);
        return;

      case "set":
        emitSetNode(id, vName, norm, deferProto);
        return;

      case "weakmap":
      case "weakset": {
        const Ctor = norm.type === "weakmap" ? "WeakMap" : "WeakSet";
        const expr = wrapProtoIfNeeded(`new ${Ctor}()`, norm, deferProto);
        phase2Lines.push(`var ${vName} = ${expr};`);
        availableNodeIds.add(id);
        emitExtraPropsGeneric(vName, norm, new Set());
        scheduleExtensibility(norm, vName);
        return;
      }

      case "date": {
        const expr = wrapProtoIfNeeded(formatDateExpr(norm), norm, deferProto);
        phase2Lines.push(`var ${vName} = ${expr};`);
        availableNodeIds.add(id);
        emitExtraPropsGeneric(vName, norm, new Set());
        scheduleExtensibility(norm, vName);
        return;
      }

      case "regexp": {
        const expr = wrapProtoIfNeeded(formatRegExpBase(norm.raw), norm, deferProto);
        phase2Lines.push(`var ${vName} = ${expr};`);
        availableNodeIds.add(id);
        emitRegExpPostProps(vName, norm);
        scheduleExtensibility(norm, vName);
        return;
      }

      case "typedarray": {
        let baseExpr;
        if (norm.bufferRef) {
          const bufExpr = exprForRef(norm.bufferRef);
          const off = norm.raw.byteOffset || 0;
          const len = norm.raw.length || 0;
          baseExpr = `new ${norm.raw.ctor || "Uint8Array"}(${bufExpr}, ${off}, ${len})`;
        } else {
          baseExpr = formatUnsharedTypedArrayExpr(norm.raw, scopeHelperCtx.ensureB64Helper);
        }
        phase2Lines.push(`var ${vName} = ${wrapProtoIfNeeded(baseExpr, norm, deferProto)};`);
        availableNodeIds.add(id);
        const len = typeof norm.raw.length === "number" ? norm.raw.length : 0;
        const hasBytes = !!norm.bufferRef || typeof norm.raw.bytes === "string";
        deferPhase3(() => {
          for (const p of norm.props) {
            if (
              hasBytes &&
              p.keyNorm.kind === "string" &&
              isArrayIndexKey(p.keyNorm.key) &&
              Number(p.keyNorm.key) < len
            ) {
              continue;
            }
            phase3Lines.push(
              emitSetOrDefineProp(vName, norm, p, false, scopeHelperCtx, exprForRef)
            );
          }
        });
        scheduleExtensibility(norm, vName);
        return;
      }

      case "dataview": {
        const bufExpr = norm.bufferRef
          ? exprForRef(norm.bufferRef)
          : formatArrayBufferExpr(
              typeof norm.raw.bytes === "string" ? decodeBase64Bytes(norm.raw.bytes) : null,
              norm.raw.byteLength || 0,
              false,
              scopeHelperCtx.ensureB64Helper
            );
        const off = norm.raw.byteOffset || 0;
        const byteLen = norm.raw.byteLength;
        const baseExpr =
          byteLen !== undefined
            ? `new DataView(${bufExpr}, ${off}, ${byteLen})`
            : `new DataView(${bufExpr}, ${off})`;
        phase2Lines.push(`var ${vName} = ${wrapProtoIfNeeded(baseExpr, norm, deferProto)};`);
        availableNodeIds.add(id);
        emitExtraPropsGeneric(vName, norm, new Set());
        scheduleExtensibility(norm, vName);
        return;
      }

      case "boxed": {
        const baseExpr = formatBoxedExpr(norm.primRef, exprForRef);
        phase2Lines.push(`var ${vName} = ${wrapProtoIfNeeded(baseExpr, norm, deferProto)};`);
        availableNodeIds.add(id);
        const isStr = norm.primRef.kind === "prim" && norm.primRef.prim === "string";
        const strLen = isStr ? String(norm.primRef.value ?? "").length : 0;
        deferPhase3(() => {
          for (const p of norm.props) {
            if (isStr && p.keyNorm.kind === "string") {
              if (p.keyNorm.key === "length") continue;
              if (isArrayIndexKey(p.keyNorm.key) && Number(p.keyNorm.key) < strLen) continue;
            }
            phase3Lines.push(
              emitSetOrDefineProp(vName, norm, p, false, scopeHelperCtx, exprForRef)
            );
          }
        });
        scheduleExtensibility(norm, vName);
        return;
      }

      case "error":
        emitErrorNode(id, vName, norm, deferProto);
        return;

      case "promise": {
        // If fulfilled value is a node not yet available, we must wait or bail if unsettled
        if (!isRefAvailableNow(norm.valueRef)) {
          bail("cyclic promise resolution value", id);
          return;
        }
        const valExpr = exprForRef(norm.valueRef);
        const baseExpr =
          norm.state === "fulfilled"
            ? `Promise.resolve(${valExpr})`
            : `${scopeHelperCtx.ensureRejectHelper()}(${valExpr})`;
        phase2Lines.push(`var ${vName} = ${wrapProtoIfNeeded(baseExpr, norm, deferProto)};`);
        availableNodeIds.add(id);
        emitExtraPropsGeneric(vName, norm, new Set());
        scheduleExtensibility(norm, vName);
        return;
      }

      case "function": {
        // Bound function
        if (!isRefAvailableNow(norm.bound.target)) {
          bail("cyclic bound function target", id);
          return;
        }
        // Reconcile target's name/length before .bind if target is a function with custom name/length!
        const tExpr = exprForRef(norm.bound.target);
        const thisExpr = isRefAvailableNow(norm.bound.thisArg)
          ? exprForRef(norm.bound.thisArg)
          : "void 0";
        const argExprs = norm.bound.args.map((a) => {
          if (!isRefAvailableNow(a)) {
            bail("cyclic bound function argument", id);
            return "void 0";
          }
          return exprForRef(a);
        });
        const allArgs = [thisExpr, ...argExprs].join(", ");
        const bindExpr = `Function.prototype.bind.call(${tExpr}, ${allArgs})`;
        phase2Lines.push(`var ${vName} = ${wrapProtoIfNeeded(bindExpr, norm, deferProto)};`);
        availableNodeIds.add(id);
        emitBoundFunctionPostProps(vName, norm);
        scheduleExtensibility(norm, vName);
        return;
      }
    }
  }

  function wrapProtoIfNeeded(baseExpr, norm, deferProto) {
    if (isDefaultProto(norm)) return baseExpr;
    if (deferProto) {
      deferPhase3(() => {
        phase3Lines.push(`Object.setPrototypeOf(${varName(norm.id)}, ${protoExprOf(norm)});`);
      });
      return baseExpr;
    }
    return `Object.setPrototypeOf(${baseExpr}, ${protoExprOf(norm)})`;
  }

  function protoExprOf(norm) {
    if (norm.protoRef.kind === "prim" && norm.protoRef.prim === "null") return "null";
    return exprForRef(norm.protoRef);
  }

  function emitPlainObjectNode(id, vName, norm, deferProto) {
    const litParts = [];
    if (!isDefaultProto(norm) && !deferProto) {
      litParts.push(`__proto__: ${protoExprOf(norm)}`);
    } else if (!isDefaultProto(norm) && deferProto) {
      deferPhase3(() => {
        phase3Lines.push(`Object.setPrototypeOf(${vName}, ${protoExprOf(norm)});`);
      });
    }

    // Partition props into array-index, non-index strings, and symbols to preserve exact OwnPropertyKeys order!
    const indexProps = [];
    const stringProps = [];
    const symbolProps = [];
    for (const p of norm.props) {
      if (p.keyNorm.kind === "symbol") symbolProps.push(p);
      else if (isArrayIndexKey(p.keyNorm.key)) indexProps.push(p);
      else stringProps.push(p);
    }

    const deferredProps = []; // Array<{ prop, alreadyOwnWritable }>

    for (const p of indexProps) {
      if (canEmitAsPlainDataProp(p, norm) && isRefAvailableNow(p.value)) {
        litParts.push(`${p.keyNorm.key}: ${exprForRef(p.value)}`);
      } else {
        deferredProps.push({ prop: p, alreadyOwnWritable: false });
      }
    }

    let stopStringLiteral = false;
    for (const p of stringProps) {
      if (!stopStringLiteral && canEmitAsPlainDataProp(p, norm)) {
        if (isRefAvailableNow(p.value)) {
          litParts.push(`${formatObjectLiteralKey(p.keyNorm.key)}: ${exprForRef(p.value)}`);
        } else {
          // Placeholder preserves exact insertion order and hidden-class shape!
          litParts.push(`${formatObjectLiteralKey(p.keyNorm.key)}: void 0`);
          deferredProps.push({ prop: p, alreadyOwnWritable: true });
        }
      } else {
        stopStringLiteral = true;
        deferredProps.push({ prop: p, alreadyOwnWritable: false });
      }
    }

    let stopSymbolLiteral = false;
    for (const p of symbolProps) {
      if (
        !stopSymbolLiteral &&
        canEmitAsPlainDataProp(p, norm) &&
        isRefAvailableNow(p.keyNorm.ref)
      ) {
        if (isRefAvailableNow(p.value)) {
          litParts.push(`[${exprForRef(p.keyNorm.ref)}]: ${exprForRef(p.value)}`);
        } else {
          litParts.push(`[${exprForRef(p.keyNorm.ref)}]: void 0`);
          deferredProps.push({ prop: p, alreadyOwnWritable: true });
        }
      } else {
        stopSymbolLiteral = true;
        deferredProps.push({ prop: p, alreadyOwnWritable: false });
      }
    }

    const litExpr = litParts.length === 0 ? "{}" : `{ ${litParts.join(", ")} }`;
    phase2Lines.push(`var ${vName} = ${litExpr};`);
    availableNodeIds.add(id);

    if (deferredProps.length > 0) {
      deferPhase3(() => {
        for (const item of deferredProps) {
          phase3Lines.push(
            emitSetOrDefineProp(
              vName,
              norm,
              item.prop,
              item.alreadyOwnWritable,
              scopeHelperCtx,
              exprForRef
            )
          );
        }
      });
    }
    scheduleExtensibility(norm, vName);
  }

  function emitArrayNode(id, vName, norm, deferProto) {
    const len = typeof norm.raw.length === "number" ? norm.raw.length : 0;
    const byIdx = new Map();
    const extraProps = [];
    let lengthProp = null;

    for (const p of norm.props) {
      if (p.keyNorm.kind === "string" && p.keyNorm.key === "length") {
        lengthProp = p;
        continue;
      }
      if (p.keyNorm.kind === "string" && isArrayIndexKey(p.keyNorm.key) && Number(p.keyNorm.key) < len) {
        byIdx.set(Number(p.keyNorm.key), p);
      } else {
        extraProps.push(p);
      }
    }

    let maxPresentIdx = -1;
    for (const idx of byIdx.keys()) {
      if (idx > maxPresentIdx) maxPresentIdx = idx;
    }
    const trailingHoles = len - 1 - maxPresentIdx;
    const deferredIndexProps = [];

    let arrExpr;
    const useNewArray = len > 0 && (byIdx.size === 0 ? len > 8 : trailingHoles > 16);

    if (useNewArray) {
      arrExpr = `new Array(${len})`;
      for (const idx of Array.from(byIdx.keys()).sort((a, b) => a - b)) {
        deferredIndexProps.push({ prop: byIdx.get(idx), alreadyOwnWritable: false });
      }
    } else {
      const elExprs = [];
      const litEnd = trailingHoles <= 16 ? len : maxPresentIdx + 1;
      for (let i = 0; i < litEnd; i++) {
        if (!byIdx.has(i)) {
          elExprs.push("");
          continue;
        }
        const p = byIdx.get(i);
        if (canEmitAsPlainDataProp(p, norm)) {
          if (isRefAvailableNow(p.value)) {
            elExprs.push(exprForRef(p.value));
          } else {
            elExprs.push("void 0");
            deferredIndexProps.push({ prop: p, alreadyOwnWritable: true });
          }
        } else {
          elExprs.push("");
          deferredIndexProps.push({ prop: p, alreadyOwnWritable: false });
        }
      }
      const endHole = litEnd > 0 && !byIdx.has(litEnd - 1);
      arrExpr = litEnd === 0 ? "[]" : `[${elExprs.join(", ")}${endHole ? "," : ""}]`;
      if (litEnd < len) {
        deferPhase3(() => {
          phase3Lines.push(`${vName}.length = ${len};`);
        });
      }
    }

    // Custom prototype on Array: use Reflect.construct(Array, [], Ctor) if possible to avoid setPrototypeOf!
    if (!isDefaultProto(norm) && !deferProto) {
      const ctorId =
        norm.protoRef.kind === "node" ? constructorForProtoId.get(norm.protoRef.id) : null;
      if (ctorId && availableNodeIds.has(ctorId) && arrExpr === "[]") {
        arrExpr = `Reflect.construct(Array, [], ${varName(ctorId)})`;
      } else if (ctorId && availableNodeIds.has(ctorId) && useNewArray) {
        arrExpr = `Reflect.construct(Array, [${len}], ${varName(ctorId)})`;
      } else {
        arrExpr = `Object.setPrototypeOf(${arrExpr}, ${protoExprOf(norm)})`;
      }
    } else if (!isDefaultProto(norm) && deferProto) {
      deferPhase3(() => {
        phase3Lines.push(`Object.setPrototypeOf(${vName}, ${protoExprOf(norm)});`);
      });
    }

    phase2Lines.push(`var ${vName} = ${arrExpr};`);
    availableNodeIds.add(id);

    deferPhase3(() => {
      for (const item of deferredIndexProps) {
        phase3Lines.push(
          emitSetOrDefineProp(
            vName,
            norm,
            item.prop,
            item.alreadyOwnWritable,
            scopeHelperCtx,
            exprForRef
          )
        );
      }
      for (const p of extraProps) {
        phase3Lines.push(
          emitSetOrDefineProp(vName, norm, p, false, scopeHelperCtx, exprForRef)
        );
      }
      if (lengthProp && !lengthProp.isAccessor && lengthProp.writable === false && !norm.frozen) {
        const dp = scopeHelperCtx.definePropertyFn();
        phase3Lines.push(`${dp}(${vName}, "length", { value: ${len}, writable: false });`);
      }
    });
    scheduleExtensibility(norm, vName);
  }

  function emitMapNode(id, vName, norm, deferProto) {
    const allAvail = norm.entries.every(
      ([k, v]) => isRefAvailableNow(k) && isRefAvailableNow(v)
    );
    let baseExpr;
    if (allAvail && norm.entries.length > 0 && isDefaultProto(norm)) {
      const pairs = norm.entries.map(([k, v]) => `[${exprForRef(k)}, ${exprForRef(v)}]`);
      baseExpr = `new Map([${pairs.join(", ")}])`;
    } else {
      const ctorId =
        !isDefaultProto(norm) && !deferProto && norm.protoRef.kind === "node"
          ? constructorForProtoId.get(norm.protoRef.id)
          : null;
      if (ctorId && availableNodeIds.has(ctorId)) {
        baseExpr = `Reflect.construct(Map, [], ${varName(ctorId)})`;
      } else {
        baseExpr = wrapProtoIfNeeded("new Map()", norm, deferProto);
      }
      if (norm.entries.length > 0) {
        deferPhase3(() => {
          const sets = norm.entries.map(([k, v]) => `.set(${exprForRef(k)}, ${exprForRef(v)})`);
          phase3Lines.push(`${vName}${sets.join("")};`);
        });
      }
    }
    phase2Lines.push(`var ${vName} = ${baseExpr};`);
    availableNodeIds.add(id);
    emitExtraPropsGeneric(vName, norm, new Set());
    scheduleExtensibility(norm, vName);
  }

  function emitSetNode(id, vName, norm, deferProto) {
    const allAvail = norm.entries.every((el) => isRefAvailableNow(el));
    let baseExpr;
    if (allAvail && norm.entries.length > 0 && isDefaultProto(norm)) {
      const els = norm.entries.map((el) => exprForRef(el));
      baseExpr = `new Set([${els.join(", ")}])`;
    } else {
      const ctorId =
        !isDefaultProto(norm) && !deferProto && norm.protoRef.kind === "node"
          ? constructorForProtoId.get(norm.protoRef.id)
          : null;
      if (ctorId && availableNodeIds.has(ctorId)) {
        baseExpr = `Reflect.construct(Set, [], ${varName(ctorId)})`;
      } else {
        baseExpr = wrapProtoIfNeeded("new Set()", norm, deferProto);
      }
      if (norm.entries.length > 0) {
        deferPhase3(() => {
          const adds = norm.entries.map((el) => `.add(${exprForRef(el)})`);
          phase3Lines.push(`${vName}${adds.join("")};`);
        });
      }
    }
    phase2Lines.push(`var ${vName} = ${baseExpr};`);
    availableNodeIds.add(id);
    emitExtraPropsGeneric(vName, norm, new Set());
    scheduleExtensibility(norm, vName);
  }

  function emitErrorNode(id, vName, norm, deferProto) {
    const stdCtor = STANDARD_ERROR_CTORS.has(norm.raw.ctor) ? norm.raw.ctor : "Error";
    const msgProp = norm.props.find(
      (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "message"
    );
    const hasOwnMessage = norm.hasExplicitProps
      ? !!msgProp
      : norm.raw.message !== undefined;
    const initMsgStr =
      msgProp && !msgProp.isAccessor && msgProp.value.kind === "prim" && msgProp.value.prim === "string"
        ? String(msgProp.value.value ?? "")
        : typeof norm.raw.message === "string"
          ? norm.raw.message
          : null;

    let ctorArgs = "";
    if (stdCtor === "AggregateError") {
      ctorArgs = hasOwnMessage && initMsgStr !== null ? `[], ${quoteString(initMsgStr)}` : "[]";
    } else if (hasOwnMessage && initMsgStr !== null) {
      ctorArgs = quoteString(initMsgStr);
    }

    let baseExpr;
    const customCtorId =
      !isDefaultProto(norm) && !deferProto && norm.protoRef.kind === "node"
        ? constructorForProtoId.get(norm.protoRef.id)
        : null;
    if (customCtorId && availableNodeIds.has(customCtorId)) {
      baseExpr = `Reflect.construct(${stdCtor}, [${ctorArgs}], ${varName(customCtorId)})`;
    } else {
      baseExpr = wrapProtoIfNeeded(`new ${stdCtor}(${ctorArgs})`, norm, deferProto);
    }

    phase2Lines.push(`var ${vName} = ${baseExpr};`);
    availableNodeIds.add(id);

    const skipKeys = new Set();
    if (
      msgProp &&
      !msgProp.isAccessor &&
      initMsgStr !== null &&
      msgProp.enumerable === false &&
      msgProp.configurable === true &&
      (msgProp.writable === true || (norm.frozen && msgProp.writable === false))
    ) {
      skipKeys.add("message");
    }

    deferPhase3(() => {
      if (norm.hasExplicitProps) {
        if (norm.raw.stackDeleted) {
          phase3Lines.push(`delete ${vName}.stack;`);
        }
        for (const p of norm.props) {
          if (p.keyNorm.kind === "string" && skipKeys.has(p.keyNorm.key)) continue;
          if (p.keyNorm.kind === "string" && p.keyNorm.key === "stack") {
            const dp = scopeHelperCtx.definePropertyFn();
            phase3Lines.push(
              `${dp}(${vName}, "stack", ${formatPropertyDescriptor(p, exprForRef)});`
            );
          } else {
            phase3Lines.push(
              emitSetOrDefineProp(vName, norm, p, false, scopeHelperCtx, exprForRef)
            );
          }
        }
      } else if (norm.raw.stack !== undefined) {
        const dp = scopeHelperCtx.definePropertyFn();
        const stackRef = normalizeRef(norm.raw.stack);
        phase3Lines.push(
          `${dp}(${vName}, "stack", { value: ${exprForRef(stackRef)}, writable: true, enumerable: false, configurable: true });`
        );
      }
    });
    scheduleExtensibility(norm, vName);
  }

  function emitRegExpPostProps(vName, norm) {
    deferPhase3(() => {
      const rawLi = norm.raw.lastIndex;
      const liProp = norm.props.find(
        (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "lastIndex"
      );
      if (liProp) {
        const isZero =
          !liProp.isAccessor &&
          liProp.writable === true &&
          liProp.value.kind === "prim" &&
          liProp.value.prim === "number" &&
          Object.is(Number(liProp.value.value), 0) &&
          liProp.value.special !== "-0";
        if (!isZero) {
          if (!liProp.isAccessor && (liProp.writable === true || norm.frozen)) {
            phase3Lines.push(`${vName}.lastIndex = ${exprForRef(liProp.value)};`);
          } else {
            const dp = scopeHelperCtx.definePropertyFn();
            phase3Lines.push(
              `${dp}(${vName}, "lastIndex", { value: ${exprForRef(liProp.value)}, writable: false });`
            );
          }
        }
      } else if (rawLi !== undefined && !(typeof rawLi === "number" && Object.is(rawLi, 0))) {
        const liRef = normalizeRef(rawLi);
        phase3Lines.push(`${vName}.lastIndex = ${exprForRef(liRef)};`);
      }

      for (const p of norm.props) {
        if (p.keyNorm.kind === "string" && p.keyNorm.key === "lastIndex") continue;
        phase3Lines.push(emitSetOrDefineProp(vName, norm, p, false, scopeHelperCtx, exprForRef));
      }
    });
  }

  function emitExtraPropsGeneric(vName, norm, skipStringKeys) {
    if (norm.props.length === 0) return;
    deferPhase3(() => {
      for (const p of norm.props) {
        if (p.keyNorm.kind === "string" && skipStringKeys.has(p.keyNorm.key)) continue;
        phase3Lines.push(emitSetOrDefineProp(vName, norm, p, false, scopeHelperCtx, exprForRef));
      }
    });
  }

  function emitBoundFunctionPostProps(vName, norm) {
    deferPhase3(() => {
      if (!norm.hasExplicitProps) {
        if (typeof norm.raw.name === "string") {
          const dp = scopeHelperCtx.definePropertyFn();
          phase3Lines.push(
            `${dp}(${vName}, "name", { value: ${quoteString(norm.raw.name)}, writable: false, enumerable: false, configurable: true });`
          );
        }
        return;
      }
      const hasLen = norm.props.some(
        (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "length"
      );
      const hasName = norm.props.some(
        (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "name"
      );
      if (!hasLen) phase3Lines.push(`delete ${vName}.length;`);
      if (!hasName) phase3Lines.push(`delete ${vName}.name;`);
      for (const p of norm.props) {
        const dp = scopeHelperCtx.definePropertyFn();
        if (
          p.keyNorm.kind === "string" &&
          (p.keyNorm.key === "length" || p.keyNorm.key === "name")
        ) {
          phase3Lines.push(
            `${dp}(${vName}, ${quoteString(p.keyNorm.key)}, ${formatPropertyDescriptor(p, exprForRef)});`
          );
        } else {
          phase3Lines.push(
            emitSetOrDefineProp(vName, norm, p, false, scopeHelperCtx, exprForRef)
          );
        }
      }
    });
  }

  /**
   * Reconcile own properties, prototype, and extensibility of recreated functions, classes,
   * claimed class prototypes, and claimed function prototypes!
   */
  function reconcileFunctionAndClaimedProto(fnId) {
    const fnNorm = normNodes.get(fnId);
    const parsed = parsedFns.get(fnId);
    const isExtractedMember = memberExtractedFnIds.has(fnId);
    if (isExtractedMember && !needsVariableForClassMember(fnId)) {
      return;
    }

    const vName = varName(fnId);

    // Check custom [[Prototype]] on the function/class itself
    if (parsed && parsed.actualKind === "class" && parsed.classInfo.superInfo && !parsed.classInfo.superInfo.isNullLiteral) {
      // `class extends Super` already set Object.getPrototypeOf(Cls) === Super!
    } else if (!isDefaultProto(fnNorm)) {
      phase3Lines.push(`Object.setPrototypeOf(${vName}, ${protoExprOf(fnNorm)});`);
    }

    const mInfo = classMemberInfoById.get(fnId);
    const naturalName = isExtractedMember
      ? mInfo.keyName !== null
        ? mInfo.kind === "get"
          ? `get ${mInfo.keyName}`
          : mInfo.kind === "set"
            ? `set ${mInfo.keyName}`
            : mInfo.keyName
        : null
      : namedAtCreationFnIds.has(fnId)
        ? namedAtCreationFnIds.get(fnId)
        : strippedIdFnIds.has(fnId)
          ? ""
          : parsed.naturalName;
    const naturalLen = isExtractedMember ? mInfo.naturalLength : parsed.naturalLength;
    const hasNaturalProto = isExtractedMember ? mInfo.hasPrototypeProp : parsed.hasPrototypeProp;
    const naturalProtoWritable = isExtractedMember ? mInfo.hasPrototypeProp : parsed.prototypeWritable;

    if (!fnNorm.hasExplicitProps) {
      if (
        typeof fnNorm.raw.name === "string" &&
        (naturalName === null || fnNorm.raw.name !== naturalName)
      ) {
        const dp = scopeHelperCtx.definePropertyFn();
        phase3Lines.push(
          `${dp}(${vName}, "name", { value: ${quoteString(fnNorm.raw.name)}, writable: false, enumerable: false, configurable: true });`
        );
      }
      scheduleExtensibility(fnNorm, vName);
    } else {
      // Build natural own-keys map on `fnId`
      const naturalProps = new Map(); // stringKey -> checkFn(prop)
      naturalProps.set("length", (p) =>
        !p.isAccessor &&
        (p.writable === false) &&
        p.enumerable === false &&
        (p.configurable === (!fnNorm.sealed && !fnNorm.frozen)) &&
        p.value.kind === "prim" &&
        Number(p.value.value) === naturalLen
      );
      naturalProps.set("name", (p) =>
        naturalName !== null &&
        !p.isAccessor &&
        p.writable === false &&
        p.enumerable === false &&
        (p.configurable === (!fnNorm.sealed && !fnNorm.frozen)) &&
        p.value.kind === "prim" &&
        p.value.value === naturalName
      );
      if (hasNaturalProto) {
        const claimedPId =
          claimedClassProtos.get(fnId) ||
          claimedFnProtos.get(fnId) ||
          fnHasLazyDefaultProto.get(fnId);
        naturalProps.set("prototype", (p) =>
          claimedPId != null &&
          !p.isAccessor &&
          p.value.kind === "node" &&
          p.value.id === claimedPId &&
          p.enumerable === false &&
          p.configurable === false &&
          p.writable === (fnNorm.frozen ? false : naturalProtoWritable)
        );
      }

      // Static members on a class
      const staticMemberMap = new Map();
      if (parsed && parsed.actualKind === "class") {
        for (const m of extractedClassMembers.get(fnId) || []) {
          if (!m.static) continue;
          const kKey = m.keyName !== null ? `str:${m.keyName}` : `sym:${m.symbolIntrinsic}`;
          staticMemberMap.set(kKey, m);
        }
      }

      const presentStringKeys = new Set(
        fnNorm.props.filter((p) => p.keyNorm.kind === "string").map((p) => p.keyNorm.key)
      );
      if (!presentStringKeys.has("length")) phase3Lines.push(`delete ${vName}.length;`);
      if (!presentStringKeys.has("name")) phase3Lines.push(`delete ${vName}.name;`);

      // Check if `length` or `name` was deleted and re-added AFTER custom properties!
      let seenCustomStringKey = false;
      const reorderedNaturalKeys = new Set();
      for (const p of fnNorm.props) {
        if (p.keyNorm.kind !== "string") continue;
        const k = p.keyNorm.key;
        if (naturalProps.has(k)) {
          if (seenCustomStringKey && k !== "prototype") {
            reorderedNaturalKeys.add(k);
            phase3Lines.push(`delete ${vName}.${k};`);
          }
        } else if (!staticMemberMap.has(`str:${k}`)) {
          seenCustomStringKey = true;
        }
      }

      for (const p of fnNorm.props) {
        let preExistingNonEnum = false;
        if (p.keyNorm.kind === "string") {
          const k = p.keyNorm.key;
          if (naturalProps.has(k) && !reorderedNaturalKeys.has(k)) {
            if (naturalProps.get(k)(p)) continue;
            if (k === "prototype") {
              if (!p.isAccessor && p.writable === true && p.enumerable === false && p.configurable === false) {
                phase3Lines.push(`${vName}.prototype = ${exprForRef(p.value)};`);
              } else {
                const dp = scopeHelperCtx.definePropertyFn();
                phase3Lines.push(
                  `${dp}(${vName}, "prototype", ${formatPropertyDescriptor(p, exprForRef)});`
                );
              }
              continue;
            }
            preExistingNonEnum = true;
          }
          const sm = staticMemberMap.get(`str:${k}`);
          if (sm) {
            if (isUnchangedExtractedMemberProp(p, sm, fnNorm)) continue;
            preExistingNonEnum = true;
          }
        } else if (p.keyNorm.kind === "symbol" && p.keyNorm.ref.kind === "intrinsic") {
          const sm = staticMemberMap.get(`sym:${p.keyNorm.ref.path}`);
          if (sm) {
            if (isUnchangedExtractedMemberProp(p, sm, fnNorm)) continue;
            preExistingNonEnum = true;
          }
        }

        if (preExistingNonEnum) {
          const dp = scopeHelperCtx.definePropertyFn();
          phase3Lines.push(
            `${dp}(${vName}, ${formatKeyForDefineProperty(p.keyNorm, exprForRef)}, ${formatPropertyDescriptor(p, exprForRef)});`
          );
        } else {
          phase3Lines.push(emitSetOrDefineProp(vName, fnNorm, p, false, scopeHelperCtx, exprForRef));
        }
      }
      scheduleExtensibility(fnNorm, vName);
    }

    // Reconcile claimed `.prototype` object if any!
    const claimedPId = claimedClassProtos.get(fnId) || claimedFnProtos.get(fnId);
    if (claimedPId) {
      reconcileClaimedPrototype(fnId, claimedPId, parsed && parsed.actualKind === "class");
    }
  }

  function isUnchangedExtractedMemberProp(p, m, holderNorm) {
    const expectConfigurable = !holderNorm.sealed && !holderNorm.frozen;
    if (p.enumerable !== false || p.configurable !== expectConfigurable) return false;
    if (m.kind === "method") {
      const expectWritable = !holderNorm.frozen;
      return (
        !p.isAccessor &&
        p.writable === expectWritable &&
        p.value.kind === "node" &&
        p.value.id === m.fnId
      );
    }
    if (m.kind === "get") {
      return p.isAccessor && p.get && p.get.kind === "node" && p.get.id === m.fnId && !p.set;
    }
    if (m.kind === "set") {
      return p.isAccessor && p.set && p.set.kind === "node" && p.set.id === m.fnId && !p.get;
    }
    return false;
  }

  function reconcileClaimedPrototype(fnId, protoId, isClass) {
    const protoNorm = normNodes.get(protoId);
    const pVar = varName(protoId);
    const parsed = parsedFns.get(fnId);

    // Check prototype of `Cls.prototype` on classes with `extends`
    if (isClass) {
      const superInfo = parsed.classInfo.superInfo;
      if (!superInfo && !isDefaultProto(protoNorm)) {
        phase3Lines.push(`Object.setPrototypeOf(${pVar}, ${protoExprOf(protoNorm)});`);
      } else if (superInfo && superInfo.isNullLiteral) {
        if (!(protoNorm.protoRef.kind === "prim" && protoNorm.protoRef.prim === "null")) {
          phase3Lines.push(`Object.setPrototypeOf(${pVar}, ${protoExprOf(protoNorm)});`);
        }
      }
    }

    const expectHasCtor =
      isClass || (parsed.actualKind === "normal" && !parsed.isGenerator);
    const instanceMemberMap = new Map();
    if (isClass) {
      for (const m of extractedClassMembers.get(fnId) || []) {
        if (m.static) continue;
        const kKey = m.keyName !== null ? `str:${m.keyName}` : `sym:${m.symbolIntrinsic}`;
        instanceMemberMap.set(kKey, m);
      }
    }

    if (protoNorm.hasExplicitProps) {
      const hasCtorInProps = protoNorm.props.some(
        (p) => p.keyNorm.kind === "string" && p.keyNorm.key === "constructor"
      );
      if (expectHasCtor && !hasCtorInProps) {
        phase3Lines.push(`delete ${pVar}.constructor;`);
      }
      // Delete any class prototype methods that were deleted after class definition
      if (isClass) {
        for (const m of parsed.classInfo.members) {
          if (m.static) continue;
          if (m.keyName !== null) {
            const exists = protoNorm.props.some(
              (p) => p.keyNorm.kind === "string" && p.keyNorm.key === m.keyName
            );
            if (!exists) {
              phase3Lines.push(`delete ${formatMemberAccess(pVar, m.keyName)};`);
            }
          }
        }
      }

      for (const p of protoNorm.props) {
        let preExistingNonEnum = false;
        if (p.keyNorm.kind === "string" && p.keyNorm.key === "constructor" && expectHasCtor) {
          const expectWritable = !protoNorm.frozen;
          const expectConfigurable = !protoNorm.sealed && !protoNorm.frozen;
          if (
            !p.isAccessor &&
            p.value.kind === "node" &&
            p.value.id === fnId &&
            p.writable === expectWritable &&
            p.enumerable === false &&
            p.configurable === expectConfigurable
          ) {
            continue;
          }
          preExistingNonEnum = true;
        }
        if (p.keyNorm.kind === "string") {
          const im = instanceMemberMap.get(`str:${p.keyNorm.key}`);
          if (im) {
            if (isUnchangedExtractedMemberProp(p, im, protoNorm)) continue;
            preExistingNonEnum = true;
          }
        } else if (p.keyNorm.kind === "symbol" && p.keyNorm.ref.kind === "intrinsic") {
          const im = instanceMemberMap.get(`sym:${p.keyNorm.ref.path}`);
          if (im) {
            if (isUnchangedExtractedMemberProp(p, im, protoNorm)) continue;
            preExistingNonEnum = true;
          }
        }
        if (preExistingNonEnum) {
          const dp = scopeHelperCtx.definePropertyFn();
          phase3Lines.push(
            `${dp}(${pVar}, ${formatKeyForDefineProperty(p.keyNorm, exprForRef)}, ${formatPropertyDescriptor(p, exprForRef)});`
          );
        } else {
          phase3Lines.push(
            emitSetOrDefineProp(pVar, protoNorm, p, false, scopeHelperCtx, exprForRef)
          );
        }
      }
    }
    scheduleExtensibility(protoNorm, pVar);
  }

  // Execute ordered Creation Units!
  let scopesEmittedCount = 0;
  let closuresEmittedCount = 0;
  let classesEmittedCount = 0;

  for (const u of orderedUnits) {
    if (bailouts.length > 0) break;

    if (u.kind === "scope") {
      const res = scopeTreeEmitter.emitRootScope(
        u.payload,
        isRefAvailableNow,
        (ref) => exprForRef(ref)
      );
      for (const l of res.lines) phase2Lines.push(l);
      for (const s of res.deferredSetters) allDeferredScopeSetters.push(s);
      for (const nId of u.producedNodeIds) availableNodeIds.add(nId);

      // Count scopes & closures & reconcile produced functions/classes/prototypes
      for (const sId of reachableScopes) {
        if (rootScopeOf(sId) === u.payload) scopesEmittedCount++;
      }
      for (const nId of u.producedNodeIds) {
        const nNorm = normNodes.get(nId);
        if (nNorm && nNorm.type === "function") {
          const parsed = parsedFns.get(nId);
          if (parsed && parsed.actualKind === "class") classesEmittedCount++;
          else if (!memberExtractedFnIds.has(nId)) closuresEmittedCount++;
          if (!omitOutSlotFnIds.has(nId) && !directSlotExprByNodeId.has(nId)) {
            deferPhase3(() => reconcileFunctionAndClaimedProto(nId));
          }
        }
      }
    } else if (u.kind === "topFn") {
      const lines = scopeTreeEmitter.emitTopLevelFunction(
        u.payload,
        isRefAvailableNow,
        (ref) => exprForRef(ref)
      );
      for (const l of lines) phase2Lines.push(l);
      for (const nId of u.producedNodeIds) availableNodeIds.add(nId);
      const parsed = parsedFns.get(u.payload);
      if (parsed && parsed.actualKind === "class") classesEmittedCount++;
      else closuresEmittedCount++;
      for (const nId of u.producedNodeIds) {
        const nNorm = normNodes.get(nId);
        if (nNorm && nNorm.type === "function") {
          deferPhase3(() => reconcileFunctionAndClaimedProto(nId));
        }
      }
    } else {
      emitNodeUnit(u.payload);
    }
  }

  for (const task of phase3Tasks) {
    if (bailouts.length > 0) break;
    task();
  }

  if (bailouts.length > 0) {
    return finishBailout();
  }

  // Invoke deferred scope variable setters in Phase 3 (now that all nodes exist!)
  for (const ds of allDeferredScopeSetters) {
    const argList = ds.valueRefs.map((vr) => exprForRef(vr)).join(", ");
    phase3Lines.push(`${ds.setterExpr}(${argList});`);
  }

  // Step 7: Emit `intrinsicPatches` and `roots` in Phase 5!
  for (const patch of normPatches) {
    const targetExpr = resolveIntrinsicExpr(patch.path, globalVar);
    if (patch.deleted) {
      if (patch.keyNorm.kind === "string") {
        phase5Lines.push(`delete ${formatMemberAccess(targetExpr, patch.keyNorm.key)};`);
      } else {
        phase5Lines.push(`delete ${targetExpr}[${exprForRef(patch.keyNorm.ref)}];`);
      }
      continue;
    }
    const dp = scopeHelperCtx.definePropertyFn();
    const keyExpr = formatKeyForDefineProperty(patch.keyNorm, exprForRef);
    const descExpr = formatPropertyDescriptor(patch.prop, exprForRef);
    phase5Lines.push(`${dp}(${targetExpr}, ${keyExpr}, ${descExpr});`);
  }

  const lexicalConstRoots = [];
  const lexicalLetRoots = [];

  for (const r of normRoots) {
    if (r.deleted) {
      if (r.keyNorm.kind === "string") {
        phase5Lines.push(`delete ${formatMemberAccess(globalVar, r.keyNorm.key)};`);
      } else {
        phase5Lines.push(`delete ${globalVar}[${exprForRef(r.keyNorm.ref)}];`);
      }
      continue;
    }
    if (r.kind === "lexical" || r.kind === "script") {
      const kName = r.keyNorm.key;
      const valExpr = exprForRef(r.value);
      if (r.mutable) lexicalLetRoots.push({ name: kName, valExpr });
      else lexicalConstRoots.push({ name: kName, valExpr });
      continue;
    }

    // Global property root
    const p = r.prop;
    const isDefaultGlobalAssign =
      !p.isAccessor &&
      p.writable === true &&
      p.enumerable === true &&
      p.configurable === true &&
      r.keyNorm.kind === "string" &&
      r.keyNorm.key !== "__proto__" &&
      !patchedIntrinsicKeys.has(r.keyNorm.key);

    if (isDefaultGlobalAssign) {
      phase5Lines.push(
        `${formatMemberAccess(globalVar, r.keyNorm.key)} = ${exprForRef(p.value)};`
      );
    } else {
      const dp = scopeHelperCtx.definePropertyFn();
      const keyExpr = formatKeyForDefineProperty(r.keyNorm, exprForRef);
      const descExpr = formatPropertyDescriptor(p, exprForRef);
      phase5Lines.push(`${dp}(${globalVar}, ${keyExpr}, ${descExpr});`);
    }
  }

  if (bailouts.length > 0) {
    return finishBailout();
  }

  // Assemble runtime helpers (only those actually used!)
  const helperLines = [];
  const useDpAlias = definePropCount >= 2;
  const actualDpFn = useDpAlias ? dpHelperName : "Object.defineProperty";
  if (useDpAlias) {
    helperLines.push(`var ${dpHelperName} = Object.defineProperty;`);
  }
  if (needRejectHelper) {
    helperLines.push(
      `function ${rejectHelperName}(v) { var p = Promise.reject(v); p.catch(function() {}); return p; }`
    );
  }
  if (needExtractMemberHelper) {
    helperLines.push(
      `function ${extractMemberHelperName}(o, k) { var d = Object.getOwnPropertyDescriptor(o, Reflect.ownKeys(o)[0]); return k === 1 ? d.get : k === 2 ? d.set : d.value; }`
    );
  }
  if (needB64Helper) {
    helperLines.push(
      `function ${b64HelperName}(s) {` +
        ` if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(s).buffer;` +
        ` var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", p = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0, n = (s.length * 3 >> 2) - p, u = new Uint8Array(n), j = 0;` +
        ` for (var i = 0; i < s.length; i += 4) { var v = (t.indexOf(s[i]) << 18) | (t.indexOf(s[i + 1]) << 12) | ((t.indexOf(s[i + 2]) & 63) << 6) | (t.indexOf(s[i + 3]) & 63); u[j++] = v >> 16; if (j < n) u[j++] = (v >> 8) & 255; if (j < n) u[j++] = v & 255; }` +
        ` return u.buffer; }`
    );
  }

  const allInnerLines = [
    ...helperLines,
    ...phase2Lines,
    ...phase3Lines,
    ...phase4Lines,
    ...phase5Lines,
  ].map((line) => line.replace(/__DP_PLACEHOLDER__/g, actualDpFn));

  const lexicalAll = [...lexicalConstRoots, ...lexicalLetRoots];
  if (lexicalAll.length > 0) {
    allInnerLines.push(`return [${lexicalAll.map((x) => x.valExpr).join(", ")}];`);
  }

  const globalArg = 'typeof globalThis !== "undefined" ? globalThis : this';
  let code;
  if (allInnerLines.length === 0) {
    code = "";
  } else if (lexicalAll.length === 0) {
    const indented = allInnerLines.map((l) => `  ${l}`).join("\n");
    code = `(function(${globalVar}) {\n${indented}\n})(${globalArg});\n`;
  } else {
    const indented = allInnerLines.map((l) => `  ${l}`).join("\n");
    const iife = `(function(${globalVar}) {\n${indented}\n})(${globalArg})`;
    if (lexicalConstRoots.length > 0 && lexicalLetRoots.length === 0) {
      code = `const [${lexicalConstRoots.map((x) => x.name).join(", ")}] = ${iife};\n`;
    } else if (lexicalLetRoots.length > 0 && lexicalConstRoots.length === 0) {
      code = `let [${lexicalLetRoots.map((x) => x.name).join(", ")}] = ${iife};\n`;
    } else {
      // Mix of const and let lexical roots: slice without leaking any binding!
      // Wait: two IIFEs? No! `const [c1] = ...` can't split without a binding unless 1 IIFE sets globals and returns!
      // If both const and let exist, store let initializers via a temporary Symbol property deleted on globalThis!
      const tmpSymExpr = `Symbol.for(${quoteString(prefix + "lex")})`;
      const innerNoRet = allInnerLines.slice(0, -1);
      innerNoRet.push(
        `${actualDpFn}(${globalVar}, ${tmpSymExpr}, { value: [${lexicalLetRoots.map((x) => x.valExpr).join(", ")}], configurable: true });`
      );
      innerNoRet.push(`return [${lexicalConstRoots.map((x) => x.valExpr).join(", ")}];`);
      const ind2 = innerNoRet.map((l) => `  ${l}`).join("\n");
      code =
        `const [${lexicalConstRoots.map((x) => x.name).join(", ")}] = (function(${globalVar}) {\n${ind2}\n})(${globalArg});\n` +
        `let [${lexicalLetRoots.map((x) => x.name).join(", ")}] = (function(${globalVar}, s) { var v = ${globalVar}[s]; delete ${globalVar}[s]; return v; })(${globalArg}, ${tmpSymExpr});\n`;
    }
  }

  const outputBytes = Buffer.byteLength(code, "utf8");
  const emitMs = Math.round((performance.now() - t0) * 1000) / 1000;
  const nodesReachable = reachableNodes.length;
  const nodesInlined = inlinedSet.size;
  const nodesEmitted = nodesReachable - nodesInlined;

  const stats = {
    emitMs,
    bailedOut: false,
    nodesTotal: Object.keys(nodes).length,
    nodesReachable,
    nodesEmitted,
    nodesInlined,
    scopesEmitted: scopesEmittedCount,
    closuresEmitted: closuresEmittedCount,
    classesEmitted: classesEmittedCount,
    rootsEmitted: normRoots.length,
    intrinsicPatchesEmitted: normPatches.length,
    outputBytes,
    inputBytes,
    sizeRatio:
      inputBytes && inputBytes > 0
        ? Math.round((outputBytes / inputBytes) * 10000) / 10000
        : null,
  };

  return { code, bailouts: [], stats };
}

module.exports = {
  BailoutError,
  emit,
};
