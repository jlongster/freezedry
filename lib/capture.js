"use strict";

const util = require("util");
const { run } = require("./run");
const { openInspectorBridge } = require("./inspector-bridge");
const { indexScript, analyzeStandaloneSource, resolveVarKindFromAstScopes } = require("./ast-info");

const ITERATOR_CLASS_NAMES = new Set([
  "Array Iterator",
  "MapIterator",
  "Map Iterator",
  "SetIterator",
  "Set Iterator",
  "StringIterator",
  "String Iterator",
  "RegExpStringIterator",
  "RegExp String Iterator",
  "Segment String Iterator",
  "Iterator Helper",
  "AsyncFromSyncIterator",
]);

function sameDescriptor(a, b) {
  if (!a || !b) return false;
  const aData = "value" in a;
  const bData = "value" in b;
  if (aData !== bData) return false;
  if (aData) {
    if (!Object.is(a.value, b.value)) return false;
    if (Boolean(a.writable) !== Boolean(b.writable)) return false;
  } else {
    if (!Object.is(a.get, b.get) || !Object.is(a.set, b.set)) return false;
  }
  return Boolean(a.enumerable) === Boolean(b.enumerable) && Boolean(a.configurable) === Boolean(b.configurable);
}

function formatThrownError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "object" || typeof err === "function") {
    try {
      const name = err.name ? String(err.name) : "Error";
      const msg = err.message ? String(err.message) : "";
      return msg ? `${name}: ${msg}` : name;
    } catch {
      return "Error";
    }
  }
  return String(err);
}

function extractErrorWhere(err) {
  if (err && typeof err === "object") {
    try {
      if (typeof err.stack === "string") {
        const lines = err.stack.split("\n");
        if (lines[1]) return lines[1].trim();
      }
    } catch {
      // ignore getter error
    }
  }
  return "<script init>";
}

function isCanonicalArrayIndex(key, maxLen) {
  if (typeof key !== "string" || key.length === 0) return false;
  const n = Number(key);
  if (!Number.isInteger(n) || n < 0 || n >= maxLen) return false;
  return String(n) === key;
}

async function captureFromRun(runResult, opts = {}) {
  const {
    globalObj,
    intrinsicsMap,
    pristineGlobals,
    pristineIntrinsics,
    pristineIntrinsicProtos,
    helpers,
    error: initError,
    unhandledRejections,
  } = runResult;

  const assumptions = Array.isArray(runResult.assumptions) ? [...runResult.assumptions] : [];
  const bailouts = Array.isArray(runResult.bailouts) ? [...runResult.bailouts] : [];
  const seenBailoutKeys = new Set(bailouts.map((b) => `${b.reason}@@${b.where || ""}`));

  const addBailout = (reason, where) => {
    const loc = where || "<unknown>";
    const key = `${reason}@@${loc}`;
    if (!seenBailoutKeys.has(key)) {
      seenBailoutKeys.add(key);
      bailouts.push({ reason, where: loc });
    }
  };

  if (initError) {
    addBailout(`uncaught exception during init: ${formatThrownError(initError)}`, extractErrorWhere(initError));
    return {
      version: 1,
      roots: [],
      intrinsicPatches: [],
      nodes: {},
      assumptions,
      bailouts,
    };
  }

  const nodes = {};
  const idMap = new Map();
  const whereMap = new Map();
  const worklist = [];
  let idSeq = 0;

  // Check pre-parsed input scripts for any `#private` identifiers so we know whether plain objects need private-slot checks.
  let mightHavePrivateInstances = false;
  for (const s of runResult.sources || []) {
    const idx = indexScript(s.fileContents);
    if (idx.hasAnyPrivateIdentifier) {
      mightHavePrivateInstances = true;
      break;
    }
  }

  function prefixForValue(val) {
    if (typeof val === "symbol") return "y";
    if (typeof val === "function") return "f";
    if (util.types.isProxy(val)) return "o";
    if (Array.isArray(val)) return "a";
    if (util.types.isMap(val)) return "m";
    if (util.types.isSet(val)) return "c";
    if (util.types.isDate(val)) return "d";
    if (util.types.isRegExp(val)) return "r";
    if (util.types.isTypedArray(val)) return "t";
    if (util.types.isArrayBuffer(val) || util.types.isSharedArrayBuffer(val)) return "b";
    if (util.types.isDataView(val)) return "v";
    if (util.types.isPromise(val)) return "p";
    if (util.types.isNativeError(val)) return "e";
    if (util.types.isBoxedPrimitive(val)) return "x";
    if (util.types.isWeakMap(val) || util.types.isWeakSet(val)) return "w";
    return "o";
  }

  function encodeRef(val, wherePath) {
    if (val === undefined) return { prim: "undefined" };
    if (val === null) return { prim: "null" };

    const t = typeof val;
    if (t === "boolean") return { prim: "boolean", value: val };
    if (t === "string") return { prim: "string", value: val };
    if (t === "bigint") return { prim: "bigint", value: val.toString() };
    if (t === "number") {
      if (Number.isNaN(val)) return { prim: "number", special: "NaN" };
      if (Object.is(val, -0)) return { prim: "number", special: "-0" };
      if (val === Infinity) return { prim: "number", special: "Infinity" };
      if (val === -Infinity) return { prim: "number", special: "-Infinity" };
      return { prim: "number", value: val };
    }

    if (val === globalObj) {
      return { global: true };
    }
    if (intrinsicsMap.has(val)) {
      return { intrinsic: intrinsicsMap.get(val) };
    }

    if (t === "symbol") {
      let symId = idMap.get(val);
      if (!symId) {
        symId = `${prefixForValue(val)}${++idSeq}`;
        idMap.set(val, symId);
        whereMap.set(val, wherePath);
        const regKey = Symbol.keyFor(val);
        nodes[symId] = {
          type: "symbol",
          description: val.description !== undefined ? val.description : null,
          registered: regKey !== undefined ? regKey : null,
        };
      }
      return { symbol: symId };
    }

    // Object or Function
    let nodeId = idMap.get(val);
    if (!nodeId) {
      nodeId = `${prefixForValue(val)}${++idSeq}`;
      idMap.set(val, nodeId);
      whereMap.set(val, wherePath);
      worklist.push(val);
    }
    return { $: nodeId };
  }

  function encodePropertyKey(key, wherePath) {
    if (typeof key === "string") return key;
    return encodeRef(key, `${wherePath}[symbolKey]`);
  }

  function formatKeySegment(key) {
    if (typeof key === "string") {
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
    }
    return `[${String(key)}]`;
  }

  function encodeDescriptor(desc, propPath) {
    if ("value" in desc) {
      return {
        value: encodeRef(desc.value, propPath),
        get: null,
        set: null,
        enumerable: Boolean(desc.enumerable),
        writable: Boolean(desc.writable),
        configurable: Boolean(desc.configurable),
      };
    }
    return {
      value: null,
      get: desc.get ? encodeRef(desc.get, `${propPath}.get`) : null,
      set: desc.set ? encodeRef(desc.set, `${propPath}.set`) : null,
      enumerable: Boolean(desc.enumerable),
      writable: false,
      configurable: Boolean(desc.configurable),
    };
  }

  // 1. Collect roots: own properties of globalObj that are new or changed vs pristineGlobals.
  const roots = [];
  for (const key of Reflect.ownKeys(globalObj)) {
    const curDesc = Object.getOwnPropertyDescriptor(globalObj, key);
    const origDesc = pristineGlobals.get(key);
    if (!origDesc || !sameDescriptor(origDesc, curDesc)) {
      const propPath = `global${formatKeySegment(key)}`;
      const encodedDesc = encodeDescriptor(curDesc, propPath);
      roots.push({
        kind: "global",
        key: encodePropertyKey(key, propPath),
        value: encodedDesc.value,
        descriptor: encodedDesc,
      });
    }
  }
  for (const [key] of pristineGlobals) {
    if (!Object.prototype.hasOwnProperty.call(globalObj, key)) {
      const propPath = `global${formatKeySegment(key)}`;
      roots.push({
        kind: "global",
        key: encodePropertyKey(key, propPath),
        value: null,
        descriptor: null,
        deleted: true,
      });
    }
  }

  // 2. Collect intrinsicPatches: own-property changes on intrinsic objects/functions.
  const intrinsicPatches = [];
  for (const [intrObj, intrPath] of pristineIntrinsics) {
    const origProto = pristineIntrinsicProtos.get(intrObj);
    const curProto = Object.getPrototypeOf(intrObj);
    if (!Object.is(origProto, curProto)) {
      addBailout(`modified [[Prototype]] of intrinsic ${intrPath}`, intrPath);
    }

    const beforeDescs = pristineIntrinsics.get(intrObj);
    for (const key of Reflect.ownKeys(intrObj)) {
      const curDesc = Object.getOwnPropertyDescriptor(intrObj, key);
      const origDesc = beforeDescs.get(key);
      if (!origDesc || !sameDescriptor(origDesc, curDesc)) {
        const patchPath = `${intrPath}${formatKeySegment(key)}`;
        intrinsicPatches.push({
          path: intrPath,
          key: encodePropertyKey(key, patchPath),
          descriptor: encodeDescriptor(curDesc, patchPath),
        });
      }
    }
    for (const [key] of beforeDescs) {
      if (!Object.prototype.hasOwnProperty.call(intrObj, key)) {
        const patchPath = `${intrPath}${formatKeySegment(key)}`;
        intrinsicPatches.push({
          path: intrPath,
          key: encodePropertyKey(key, patchPath),
          descriptor: null,
          deleted: true,
        });
      }
    }
  }

  // 3. Open in-process Inspector bridge and drain reachable heap worklist.
  const bridge = await openInspectorBridge(globalObj);
  const parsedScriptsById = new Map();
  const contextIdToScopeResolution = new Map();

  async function getParsedScriptIndex(scriptId) {
    const key = String(scriptId);
    if (parsedScriptsById.has(key)) return parsedScriptsById.get(key);
    const src = await bridge.getScriptSource(key);
    const parsed = src !== null ? indexScript(src) : null;
    if (parsed && parsed.hasAnyPrivateIdentifier) {
      mightHavePrivateInstances = true;
    }
    parsedScriptsById.set(key, parsed);
    return parsed;
  }

  function isHostRealmChain(obj) {
    let cur = obj;
    let depth = 0;
    while (cur && depth++ < 100) {
      if (helpers.hostRealmObjects.has(cur)) return true;
      if (util.types.isProxy(cur)) return false;
      cur = Object.getPrototypeOf(cur);
    }
    return false;
  }

  function hasIteratorProtoInChain(obj) {
    let cur = Object.getPrototypeOf(obj);
    let depth = 0;
    while (cur && depth++ < 50) {
      if (helpers.iteratorProtoSet.has(cur)) return true;
      if (util.types.isProxy(cur)) return false;
      cur = Object.getPrototypeOf(cur);
    }
    return false;
  }

  function readCommonObjectFields(obj, wherePath, skipKeyFn) {
    const rawProto = Object.getPrototypeOf(obj);
    const proto =
      rawProto === helpers.globalHiddenProto
        ? { intrinsic: "Object.prototype" }
        : encodeRef(rawProto, `${wherePath}.[[Prototype]]`);
    const extensible = Object.isExtensible(obj);
    const frozen = Object.isFrozen(obj);
    const sealed = Object.isSealed(obj);
    const props = [];

    for (const key of Reflect.ownKeys(obj)) {
      if (skipKeyFn && skipKeyFn(key)) continue;
      const desc = Object.getOwnPropertyDescriptor(obj, key);
      if (!desc) continue;
      const propPath = `${wherePath}${formatKeySegment(key)}`;
      const encodedDesc = encodeDescriptor(desc, propPath);
      props.push({
        key: encodePropertyKey(key, propPath),
        ...encodedDesc,
      });
    }

    return {
      proto,
      extensible,
      frozen,
      sealed,
      props,
    };
  }

  async function resolveFunctionScopeId(fn, internalProperties, astEntry, wherePath) {
    const heapSnap = await bridge.ensureHeapSnapshot();
    const fnHeapId = await bridge.getHeapObjectId(fn);
    const ctxChain = heapSnap.getContextChain(fnHeapId);
    if (!ctxChain) {
      addBailout("function missing from heap snapshot", wherePath);
      return null;
    }
    if (ctxChain.length === 0) {
      return null;
    }

    // Fast path: if the innermost Context node was already resolved, its entire outer Context chain is already resolved too!
    const cachedTop = contextIdToScopeResolution.get(ctxChain[0].contextId);
    if (cachedTop) {
      if (cachedTop.bailReason) {
        addBailout(cachedTop.bailReason, wherePath);
        return null;
      }
      return cachedTop.effectiveScopeId;
    }

    for (const c of ctxChain) {
      if (c.ctxKind === "with" || c.ctxKind === "eval" || c.ctxKind === "module" || c.ctxKind === "await") {
        const reason = `unsupported ${c.ctxKind} context in closure scope chain`;
        contextIdToScopeResolution.set(ctxChain[0].contextId, { effectiveScopeId: null, bailReason: reason });
        addBailout(reason, wherePath);
        return null;
      }
    }

    const scopesProp = internalProperties.find((p) => p.name === "[[Scopes]]");
    const scopeEntries =
      scopesProp && scopesProp.value && scopesProp.value.objectId
        ? await bridge.listScopes(scopesProp.value.objectId)
        : [];

    for (const s of scopeEntries) {
      if (s.scopeKind === "with" || s.scopeKind === "eval" || s.scopeKind === "module" || s.scopeKind === "unknown") {
        const reason = `unsupported closure scope (${s.description})`;
        addBailout(reason, wherePath);
        return null;
      }
    }

    // Align scopeEntries [0..m-1] to ctxChain [0..k-1]
    const m = scopeEntries.length;
    const k = ctxChain.length;

    let chosen = null;
    if (m === k) {
      // Only one strictly increasing map from [0..k-1] to [0..k-1] is mathematically possible: i -> i!
      let kindsOk = true;
      for (let i = 0; i < k; i++) {
        if (ctxChain[i].ctxKind !== "unknown" && scopeEntries[i].scopeKind !== ctxChain[i].ctxKind) {
          kindsOk = false;
          break;
        }
      }
      if (!kindsOk) {
        addBailout("unable to align [[Scopes]] with heap Context chain", wherePath);
        return null;
      }
      chosen = Array.from({ length: m }, (_, idx) => idx);
    } else {
      // Populate raw variable names (1 getProperties call per scopeEntry, no value materialization yet)
      for (const s of scopeEntries) {
        await bridge.ensureScopeDescriptors(s);
      }

      const canMatch = (sEntry, cInfo) => {
        if (cInfo.ctxKind !== "unknown" && sEntry.scopeKind !== cInfo.ctxKind) {
          return false;
        }
        for (const vp of sEntry.rawDescriptors) {
          if (cInfo.ctxKind === "function" || cInfo.ctxKind === "script") {
            if (!cInfo.varEdges.has(vp.name)) return false;
          }
          if (cInfo.scopeInfoNames.size > 0 && !cInfo.scopeInfoNames.has(vp.name)) {
            return false;
          }
        }
        return true;
      };

      const canSkip = (cInfo) => {
        if (cInfo.ctxKind === "block") {
          return cInfo.varEdges.size === 0;
        }
        if (cInfo.ctxKind === "function") {
          if (cInfo.varEdges.size === 0) return true;
          if (cInfo.varEdges.size === 1) {
            const [, edge] = [...cInfo.varEdges.entries()][0];
            return edge.toType === "closure";
          }
          return false;
        }
        if (cInfo.ctxKind === "script") {
          return cInfo.varEdges.size === 0;
        }
        return false;
      };

      const alignments = [];
      const currentMap = new Array(m);

      const searchAlignments = (sIdx, cIdx) => {
        if (alignments.length > 1) return;
        if (sIdx === m) {
          for (let rem = cIdx; rem < k; rem++) {
            if (!canSkip(ctxChain[rem])) return;
          }
          alignments.push([...currentMap]);
          return;
        }
        if (k - cIdx < m - sIdx) return;

        if (canMatch(scopeEntries[sIdx], ctxChain[cIdx])) {
          currentMap[sIdx] = cIdx;
          searchAlignments(sIdx + 1, cIdx + 1);
        }
        if (alignments.length <= 1 && canSkip(ctxChain[cIdx])) {
          searchAlignments(sIdx, cIdx + 1);
        }
      };

      searchAlignments(0, 0);

      if (alignments.length === 0) {
        addBailout("unable to align [[Scopes]] with heap Context chain", wherePath);
        return null;
      }
      if (alignments.length > 1) {
        addBailout("ambiguous [[Scopes]] to Context chain alignment", wherePath);
        return null;
      }
      chosen = alignments[0];
    }

    const ctxIdxToScopeEntry = new Map();
    for (let i = 0; i < m; i++) {
      ctxIdxToScopeEntry.set(chosen[i], scopeEntries[i]);
    }

    // Build scope nodes from outermost (k - 1) to innermost (0), materializing ONLY uncached Contexts!
    let nearestScopeId = null;
    for (let j = k - 1; j >= 0; j--) {
      const cInfo = ctxChain[j];
      const existing = contextIdToScopeResolution.get(cInfo.contextId);
      if (existing) {
        if (existing.bailReason) {
          addBailout(existing.bailReason, wherePath);
          return null;
        }
        nearestScopeId = existing.effectiveScopeId;
        continue;
      }

      const sEntry = ctxIdxToScopeEntry.get(j) || null;
      const rawVars = [];
      const seenNames = new Set();

      if (sEntry) {
        const materialized = await bridge.materializeScopeVars(sEntry);
        for (const v of materialized) {
          if (!v.initialized) {
            const reason = `uninitialized TDZ binding "${v.name}" in closure scope`;
            contextIdToScopeResolution.set(cInfo.contextId, {
              ownScopeId: null,
              effectiveScopeId: null,
              bailReason: reason,
            });
            addBailout(reason, wherePath);
            return null;
          }
          if (cInfo.ctxKind === "function" || cInfo.ctxKind === "script") {
            if (!cInfo.varEdges.has(v.name)) {
              addBailout("scope variable missing from heap Context edges", wherePath);
              return null;
            }
          }
          seenNames.add(v.name);
          rawVars.push({
            name: v.name,
            jsValue: v.value,
            forceKind: null,
          });
        }
      }

      // Recover named function expression self-binding (`mySelf`) hidden by V8 [[Scopes]]
      if (cInfo.ctxKind === "function") {
        for (const [edgeVarName, edgeInfo] of cInfo.varEdges) {
          if (!seenNames.has(edgeVarName) && edgeInfo.toType === "closure") {
            const selfFnBox = await bridge.getObjectByHeapObjectIdBoxed(edgeInfo.toId);
            seenNames.add(edgeVarName);
            rawVars.push({
              name: edgeVarName,
              jsValue: selfFnBox.value,
              forceKind: "fn",
            });
          }
        }
      }

      if (rawVars.length === 0) {
        contextIdToScopeResolution.set(cInfo.contextId, {
          ownScopeId: null,
          effectiveScopeId: nearestScopeId,
          bailReason: null,
        });
      } else {
        const scopeId = `s${++idSeq}`;
        const encodedVars = rawVars.map((rv) => ({
          name: rv.name,
          value: encodeRef(rv.jsValue, `${wherePath}.[[Scope:${scopeId}]].${rv.name}`),
          kind: rv.forceKind || resolveVarKindFromAstScopes(rv.name, astEntry ? astEntry.scopes : null),
        }));
        nodes[scopeId] = {
          type: "scope",
          parent: nearestScopeId,
          vars: encodedVars,
        };
        nearestScopeId = scopeId;
        contextIdToScopeResolution.set(cInfo.contextId, {
          ownScopeId: scopeId,
          effectiveScopeId: scopeId,
          bailReason: null,
        });
      }
    }

    return nearestScopeId;
  }

  async function expandFunctionNode(fn, nodeId, wherePath) {
    if (util.types.isProxy(fn)) {
      addBailout("Proxy function", wherePath);
      return;
    }
    if (isHostRealmChain(fn)) {
      addBailout("host function from outer realm", wherePath);
      return;
    }

    const inspected = await bridge.inspectObject(fn);
    const { internalProperties, privateProperties } = inspected;

    if (privateProperties.length > 0) {
      addBailout(`function with private fields (${privateProperties[0].name})`, wherePath);
      return;
    }

    const fnName = typeof fn.name === "string" ? fn.name : "";

    // Check for bound function first
    const targetProp = internalProperties.find((p) => p.name === "[[TargetFunction]]");
    if (targetProp && targetProp.value) {
      const boundThisProp = internalProperties.find((p) => p.name === "[[BoundThis]]");
      const boundArgsProp = internalProperties.find((p) => p.name === "[[BoundArgs]]");
      const targetFn = (await bridge.fromRemoteObjectBoxed(targetProp.value)).value;
      const boundThis = boundThisProp ? (await bridge.fromRemoteObjectBoxed(boundThisProp.value)).value : undefined;
      const boundArgs =
        boundArgsProp && boundArgsProp.value && boundArgsProp.value.objectId
          ? await bridge.readBoundArgs(boundArgsProp.value.objectId)
          : [];

      const common = readCommonObjectFields(fn, wherePath, null);
      nodes[nodeId] = {
        type: "function",
        source: "",
        kind: "normal",
        strict: true,
        name: fnName,
        scope: null,
        bound: {
          target: encodeRef(targetFn, `${wherePath}.[[TargetFunction]]`),
          this: encodeRef(boundThis, `${wherePath}.[[BoundThis]]`),
          args: boundArgs.map((arg, idx) => encodeRef(arg, `${wherePath}.[[BoundArgs]][${idx}]`)),
        },
        ...common,
      };
      return;
    }

    const locProp = internalProperties.find((p) => p.name === "[[FunctionLocation]]");
    const loc = locProp && locProp.value ? locProp.value.value : null;
    if (!loc || !loc.scriptId) {
      addBailout(`native or host function (${fnName || "<anonymous>"})`, wherePath);
      return;
    }

    const source = helpers.origFnToString.call(fn);
    let astEntry = null;
    const scriptIdx = await getParsedScriptIndex(loc.scriptId);
    if (scriptIdx) {
      astEntry = scriptIdx.lookup(loc.lineNumber, loc.columnNumber);
    }
    if (!astEntry) {
      astEntry = analyzeStandaloneSource(source);
    }
    if (!astEntry) {
      addBailout(`unable to parse function source (${fnName || "<anonymous>"})`, wherePath);
      return;
    }

    if (astEntry.hasPrivateFields) {
      addBailout(`class or function with private fields (#x) (${fnName || "<anonymous>"})`, wherePath);
      return;
    }

    const scopeId = await resolveFunctionScopeId(fn, internalProperties, astEntry, wherePath);
    let homeObjectRef = undefined;
    if (astEntry.usesSuper) {
      const heapSnap = await bridge.ensureHeapSnapshot();
      const fnHeapId = await bridge.getHeapObjectId(fn);
      const ctxChain = heapSnap.getContextChain(fnHeapId) || [];
      const homeCtx = ctxChain.find((c) => c.hiddenEdges && c.hiddenEdges.size > 0);
      if (homeCtx) {
        const slotKey = astEntry.isStaticClassMember && homeCtx.hiddenEdges.has("1") ? "1" : "0";
        const homeHeapId = homeCtx.hiddenEdges.get(slotKey);
        if (homeHeapId) {
          const homeBox = await bridge.getObjectByHeapObjectIdBoxed(homeHeapId);
          if (homeBox.value && (typeof homeBox.value === "object" || typeof homeBox.value === "function")) {
            homeObjectRef = encodeRef(homeBox.value, `${wherePath}.[[HomeObject]]`);
          }
        }
      }
    }
    const common = readCommonObjectFields(fn, wherePath, null);

    const fnNode = {
      type: "function",
      source,
      kind: astEntry.kind,
      strict: Boolean(astEntry.strict),
      name: fnName,
      declaration: Boolean(astEntry.isDeclaration),
      scope: scopeId,
      bound: null,
      ...common,
    };
    if (homeObjectRef) {
      fnNode.homeObject = homeObjectRef;
    }
    nodes[nodeId] = fnNode;
  }

  async function expandObjectNode(obj, nodeId, wherePath) {
    // 1. Proxy check MUST come first so no user traps ever execute!
    if (util.types.isProxy(obj)) {
      addBailout("Proxy object", wherePath);
      return;
    }

    // 2. Host/external checks
    if (util.types.isExternal(obj)) {
      addBailout("external host object", wherePath);
      return;
    }
    if (Buffer.isBuffer(obj)) {
      addBailout("host Buffer object", wherePath);
      return;
    }
    if (isHostRealmChain(obj)) {
      addBailout("host object from outer realm", wherePath);
      return;
    }

    // 3. Direct bailout JS built-in types
    if (util.types.isArgumentsObject(obj)) {
      addBailout("Arguments object", wherePath);
      return;
    }
    if (util.types.isGeneratorObject(obj)) {
      const inspected = await bridge.inspectObject(obj);
      const st = inspected.internalProperties.find((p) => p.name === "[[GeneratorState]]");
      const stateStr = st && st.value ? st.value.value || st.value.description : "unknown";
      addBailout(`generator object (state: ${stateStr})`, wherePath);
      return;
    }
    if (util.types.isMapIterator(obj)) {
      addBailout("Map iterator object", wherePath);
      return;
    }
    if (util.types.isSetIterator(obj)) {
      addBailout("Set iterator object", wherePath);
      return;
    }
    if (util.types.isSharedArrayBuffer(obj)) {
      addBailout("SharedArrayBuffer", wherePath);
      return;
    }

    // Brand-check genuine unmodeled built-in C++ slot instances (WeakRef, FinalizationRegistry, Intl.*, DisposableStack)
    const unmodeledSlotKind = helpers.detectUnmodeledBuiltinSlot(obj);
    if (unmodeledSlotKind) {
      addBailout(`unserializable built-in instance (${unmodeledSlotKind})`, wherePath);
      return;
    }

    let inspected = null;
    const ensureInspected = async () => {
      if (!inspected) inspected = await bridge.inspectObject(obj);
      return inspected;
    };

    if (mightHavePrivateInstances) {
      const info = await ensureInspected();
      if (info.privateProperties.length > 0) {
        addBailout(`object with private fields (${info.privateProperties[0].name})`, wherePath);
        return;
      }
    }

    if (hasIteratorProtoInChain(obj)) {
      const info = await ensureInspected();
      const clsName = info.remote.className || "";
      if (info.remote.subtype === "iterator" || ITERATOR_CLASS_NAMES.has(clsName)) {
        addBailout(`iterator object (${clsName || "iterator"})`, wherePath);
        return;
      }
    }

    // 4. Specialized supported object types
    if (Array.isArray(obj)) {
      const length = obj.length;
      const lengthDesc = Object.getOwnPropertyDescriptor(obj, "length");
      const skipLength = Boolean(lengthDesc && lengthDesc.writable === !Object.isFrozen(obj));
      const common = readCommonObjectFields(obj, wherePath, (k) => skipLength && k === "length");
      nodes[nodeId] = {
        type: "array",
        ...common,
        length,
      };
      return;
    }

    if (util.types.isDate(obj)) {
      const timeVal = helpers.origDateGetTime.call(obj);
      const common = readCommonObjectFields(obj, wherePath, null);
      nodes[nodeId] = {
        type: "date",
        time: Number.isNaN(timeVal) ? "NaN" : timeVal,
        ...common,
      };
      return;
    }

    if (util.types.isRegExp(obj)) {
      const source = helpers.origRegExpSourceGet.call(obj);
      const flags = helpers.origRegExpFlagsGet.call(obj);
      const lastIndexDesc = Object.getOwnPropertyDescriptor(obj, "lastIndex");
      const standardNumericLastIndex =
        lastIndexDesc &&
        "value" in lastIndexDesc &&
        typeof lastIndexDesc.value === "number" &&
        Number.isFinite(lastIndexDesc.value) &&
        !Object.is(lastIndexDesc.value, -0) &&
        lastIndexDesc.writable === !Object.isFrozen(obj);
      const common = readCommonObjectFields(
        obj,
        wherePath,
        (k) => standardNumericLastIndex && k === "lastIndex"
      );
      nodes[nodeId] = {
        type: "regexp",
        source,
        flags,
        lastIndex: standardNumericLastIndex ? lastIndexDesc.value : 0,
        ...common,
      };
      return;
    }

    if (util.types.isMap(obj)) {
      const entries = [];
      let idx = 0;
      for (const [k, v] of helpers.origMapEntries.call(obj)) {
        entries.push([
          encodeRef(k, `${wherePath}.[[MapKey:${idx}]]`),
          encodeRef(v, `${wherePath}.[[MapValue:${idx}]]`),
        ]);
        idx++;
      }
      const common = readCommonObjectFields(obj, wherePath, null);
      nodes[nodeId] = {
        type: "map",
        entries,
        ...common,
      };
      return;
    }

    if (util.types.isSet(obj)) {
      const entries = [];
      let idx = 0;
      for (const v of helpers.origSetValues.call(obj)) {
        entries.push(encodeRef(v, `${wherePath}.[[SetValue:${idx}]]`));
        idx++;
      }
      const common = readCommonObjectFields(obj, wherePath, null);
      nodes[nodeId] = {
        type: "set",
        entries,
        ...common,
      };
      return;
    }

    if (util.types.isWeakMap(obj) || util.types.isWeakSet(obj)) {
      const kindName = util.types.isWeakMap(obj) ? "WeakMap" : "WeakSet";
      const info = await ensureInspected();
      const entriesProp = info.internalProperties.find((p) => p.name === "[[Entries]]");
      const count =
        entriesProp && entriesProp.value && entriesProp.value.objectId
          ? await bridge.readCollectionEntryCount(entriesProp.value.objectId)
          : 0;
      if (count > 0) {
        addBailout(`${kindName} with contents (${count} entries)`, wherePath);
        return;
      }
      const common = readCommonObjectFields(obj, wherePath, null);
      nodes[nodeId] = {
        type: kindName.toLowerCase(),
        ...common,
      };
      return;
    }

    if (util.types.isArrayBuffer(obj)) {
      if (obj.detached) {
        addBailout("detached ArrayBuffer", wherePath);
        return;
      }
      const bytes = Buffer.from(obj, 0, obj.byteLength).toString("base64");
      const common = readCommonObjectFields(obj, wherePath, null);
      nodes[nodeId] = {
        type: "arraybuffer",
        bytes,
        byteLength: obj.byteLength,
        ...common,
      };
      return;
    }

    if (util.types.isTypedArray(obj)) {
      if (obj.buffer.detached) {
        addBailout("TypedArray viewing detached ArrayBuffer", wherePath);
        return;
      }
      if (util.types.isSharedArrayBuffer(obj.buffer)) {
        addBailout("TypedArray viewing SharedArrayBuffer", wherePath);
        return;
      }
      let ctorName = "Uint8Array";
      for (const [name, ctor] of helpers.typedArrayConstructors) {
        if (obj instanceof ctor) {
          ctorName = name;
          break;
        }
      }
      const len = obj.length;
      const bytes = Buffer.from(obj.buffer, obj.byteOffset, obj.byteLength).toString("base64");
      const bufferRef = encodeRef(obj.buffer, `${wherePath}.buffer`);
      const common = readCommonObjectFields(obj, wherePath, (k) => isCanonicalArrayIndex(k, len));
      nodes[nodeId] = {
        type: "typedarray",
        ctor: ctorName,
        bytes,
        byteOffset: obj.byteOffset,
        length: len,
        buffer: bufferRef,
        ...common,
      };
      return;
    }

    if (util.types.isDataView(obj)) {
      if (obj.buffer.detached) {
        addBailout("DataView viewing detached ArrayBuffer", wherePath);
        return;
      }
      if (util.types.isSharedArrayBuffer(obj.buffer)) {
        addBailout("DataView viewing SharedArrayBuffer", wherePath);
        return;
      }
      const bufferRef = encodeRef(obj.buffer, `${wherePath}.buffer`);
      const common = readCommonObjectFields(obj, wherePath, null);
      nodes[nodeId] = {
        type: "dataview",
        byteOffset: obj.byteOffset,
        byteLength: obj.byteLength,
        buffer: bufferRef,
        ...common,
      };
      return;
    }

    if (util.types.isPromise(obj)) {
      const info = await ensureInspected();
      const stateProp = info.internalProperties.find((p) => p.name === "[[PromiseState]]");
      const resProp = info.internalProperties.find((p) => p.name === "[[PromiseResult]]");
      const state = stateProp && stateProp.value ? stateProp.value.value : "pending";
      if (state === "pending") {
        addBailout("pending promise", wherePath);
        return;
      }
      const resultVal = resProp && resProp.value ? (await bridge.fromRemoteObjectBoxed(resProp.value)).value : undefined;
      const common = readCommonObjectFields(obj, wherePath, null);
      nodes[nodeId] = {
        type: "promise",
        state,
        value: encodeRef(resultVal, `${wherePath}.[[PromiseResult]]`),
        ...common,
      };
      return;
    }

    if (util.types.isNativeError(obj)) {
      let ctorName = "Error";
      for (const [name, ctor] of helpers.errorConstructors) {
        if (obj instanceof ctor) {
          ctorName = name;
          break;
        }
      }
      const msgDesc = Object.getOwnPropertyDescriptor(obj, "message");
      const message = msgDesc && "value" in msgDesc && typeof msgDesc.value === "string" ? msgDesc.value : "";
      const common = readCommonObjectFields(obj, wherePath, (k) => {
        if (k === "stack") {
          const sd = Object.getOwnPropertyDescriptor(obj, "stack");
          // Skip untouched V8 internal C++ lazy stack getter/setter (build-host specific & [native code])
          if (sd && !("value" in sd) && sd.get === helpers.origErrorStackGet && sd.set === helpers.origErrorStackSet) {
            return true;
          }
        }
        return false;
      });
      nodes[nodeId] = {
        type: "error",
        ctor: ctorName,
        message,
        ...common,
      };
      return;
    }

    if (util.types.isBoxedPrimitive(obj)) {
      let primVal;
      let isBoxedString = false;
      let strLen = 0;
      if (util.types.isNumberObject(obj)) {
        primVal = helpers.origNumberValueOf.call(obj);
      } else if (util.types.isStringObject(obj)) {
        primVal = helpers.origStringValueOf.call(obj);
        isBoxedString = true;
        strLen = primVal.length;
      } else if (util.types.isBooleanObject(obj)) {
        primVal = helpers.origBooleanValueOf.call(obj);
      } else if (util.types.isBigIntObject(obj)) {
        primVal = helpers.origBigIntValueOf.call(obj);
      } else if (util.types.isSymbolObject(obj)) {
        primVal = helpers.origSymbolValueOf.call(obj);
      } else {
        const info = await ensureInspected();
        const pv = info.internalProperties.find((p) => p.name === "[[PrimitiveValue]]");
        primVal = pv && pv.value ? (await bridge.fromRemoteObjectBoxed(pv.value)).value : undefined;
      }
      const common = readCommonObjectFields(obj, wherePath, (k) => {
        if (!isBoxedString) return false;
        return k === "length" || isCanonicalArrayIndex(k, strLen);
      });
      nodes[nodeId] = {
        type: "boxed",
        primitive: encodeRef(primVal, `${wherePath}.[[PrimitiveValue]]`),
        ...common,
      };
      return;
    }

    // 5. Ordinary JS object
    const common = readCommonObjectFields(obj, wherePath, null);
    nodes[nodeId] = {
      type: "object",
      ...common,
    };
  }

  try {
    let cursor = 0;
    while (cursor < worklist.length) {
      const item = worklist[cursor++];
      const nodeId = idMap.get(item);
      const wherePath = whereMap.get(item) || nodeId;
      if (typeof item === "function") {
        await expandFunctionNode(item, nodeId, wherePath);
      } else {
        await expandObjectNode(item, nodeId, wherePath);
      }
    }

    // Check if any unhandled promise rejection occurred on a non-captured background init promise
    if (Array.isArray(unhandledRejections)) {
      for (const ur of unhandledRejections) {
        if (!idMap.has(ur.promise)) {
          addBailout(
            `unhandled promise rejection during init: ${formatThrownError(ur.reason)}`,
            "<init microtask>"
          );
        }
      }
    }
  } finally {
    bridge.close();
  }

  return {
    version: 1,
    roots,
    intrinsicPatches,
    nodes,
    assumptions,
    bailouts,
  };
}

async function capture(src, opts = {}) {
  const runResult = await run(src, opts);
  return captureFromRun(runResult, opts);
}

module.exports = {
  capture,
  captureFromRun,
};
