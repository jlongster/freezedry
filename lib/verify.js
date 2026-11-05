"use strict";

const vm = require("vm");
const v8 = require("v8");
const util = require("util");
const inspector = require("inspector");
const { analyzeFunctionSource, computeStrictProfile, isPositionStrict } = require("./js-scan");
const { PROFILES, resolveProfile } = require("./env-profiles");

// Unbound host internal-slot readers (immune to user prototype/own-property tampering, work cross-realm)
const TypedArrayProto = Object.getPrototypeOf(Uint8Array.prototype);
const fnToString = Function.prototype.toString;
const dateGetTime = Date.prototype.getTime;
const regExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, "source").get;
const regExpFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;
const mapEntries = Map.prototype.entries;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, "size").get;
const setValues = Set.prototype.values;
const taTag = Object.getOwnPropertyDescriptor(TypedArrayProto, Symbol.toStringTag).get;
const taBuffer = Object.getOwnPropertyDescriptor(TypedArrayProto, "buffer").get;
const taByteOffset = Object.getOwnPropertyDescriptor(TypedArrayProto, "byteOffset").get;
const taByteLength = Object.getOwnPropertyDescriptor(TypedArrayProto, "byteLength").get;
const taLength = Object.getOwnPropertyDescriptor(TypedArrayProto, "length").get;
const dvBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer").get;
const dvByteOffset = Object.getOwnPropertyDescriptor(DataView.prototype, "byteOffset").get;
const dvByteLength = Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength").get;
const abByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const abDetached = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "detached")
  ? Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "detached").get
  : () => false;
const sabByteLength =
  typeof SharedArrayBuffer !== "undefined"
    ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength").get
    : null;
const numValueOf = Number.prototype.valueOf;
const strValueOf = String.prototype.valueOf;
const boolValueOf = Boolean.prototype.valueOf;
const symValueOf = Symbol.prototype.valueOf;
const bigIntValueOf = BigInt.prototype.valueOf;

const TDZ_SENTINEL = Symbol("verify.tdz");

// Collect all well-known symbols present on the Symbol constructor
const WELL_KNOWN_SYMBOLS = new Set();
for (const k of Reflect.ownKeys(Symbol)) {
  if (typeof k === "string") {
    const v = Symbol[k];
    if (typeof v === "symbol") WELL_KNOWN_SYMBOLS.add(v);
  }
}

function makeDiff(path, kind, expected, actual, detail) {
  const expStr = typeof expected === "string" ? expected : formatShortValue(expected);
  const actStr = typeof actual === "string" ? actual : formatShortValue(actual);
  const message = detail
    ? `${path}: ${detail} (expected ${expStr}, got ${actStr})`
    : `${path} [${kind}]: expected ${expStr}, got ${actStr}`;
  const diff = {
    path,
    kind,
    expected: expStr,
    actual: actStr,
    message,
  };
  Object.defineProperty(diff, "toString", {
    value() {
      return this.message;
    },
    enumerable: false,
  });
  return diff;
}

function formatShortValue(v) {
  if (v === TDZ_SENTINEL) return "<uninitialized TDZ>";
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "number") {
    if (Object.is(v, -0)) return "-0";
    return String(v);
  }
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    return v.length > 60 ? JSON.stringify(v.slice(0, 57) + "...") : JSON.stringify(v);
  }
  if (typeof v === "symbol") {
    const rk = Symbol.keyFor(v);
    if (rk !== undefined) return `Symbol.for(${JSON.stringify(rk)})`;
    return `Symbol(${v.description !== undefined ? JSON.stringify(v.description) : ""})`;
  }
  if (typeof v === "function") {
    return `[Function ${v.name || "(anonymous)"}]`;
  }
  return `[object ${classifyObject(v)}]`;
}

function isIdentKey(key) {
  return typeof key === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function formatPropPath(basePath, key) {
  if (typeof key === "symbol") {
    const rk = Symbol.keyFor(key);
    if (rk !== undefined) return `${basePath}[Symbol.for(${JSON.stringify(rk)})]`;
    return `${basePath}[Symbol(${key.description ?? ""})]`;
  }
  if (basePath === "<globalThis>" || basePath === "") {
    return isIdentKey(key) ? key : `globalThis[${JSON.stringify(key)}]`;
  }
  if (/^\d+$/.test(key)) {
    return `${basePath}[${key}]`;
  }
  if (isIdentKey(key)) {
    return `${basePath}.${key}`;
  }
  return `${basePath}[${JSON.stringify(key)}]`;
}

function isObjectOrFunction(v) {
  return (typeof v === "object" && v !== null) || typeof v === "function";
}

function isAccessorDescriptor(desc) {
  return Boolean(desc && ("get" in desc || "set" in desc) && !("value" in desc));
}

function isConstructor(fn) {
  if (typeof fn !== "function") return false;
  try {
    new new Proxy(fn, {
      construct() {
        return {};
      },
    })();
    return true;
  } catch {
    return false;
  }
}

function isWeakRefObject(obj) {
  if (typeof WeakRef === "undefined" || typeof obj !== "object" || obj === null) return false;
  try {
    WeakRef.prototype.deref.call(obj);
    return true;
  } catch {
    return false;
  }
}

function classifyObject(v) {
  if (v === null) return "Null";
  if (util.types.isProxy(v)) return "Proxy";
  if (typeof v === "function") return "Function";
  if (Array.isArray(v)) return "Array";
  if (util.types.isDate(v)) return "Date";
  if (util.types.isRegExp(v)) return "RegExp";
  if (util.types.isMap(v)) return "Map";
  if (util.types.isSet(v)) return "Set";
  if (util.types.isWeakMap(v)) return "WeakMap";
  if (util.types.isWeakSet(v)) return "WeakSet";
  if (util.types.isPromise(v)) return "Promise";
  if (util.types.isArrayBuffer(v)) return "ArrayBuffer";
  if (util.types.isSharedArrayBuffer(v)) return "SharedArrayBuffer";
  if (util.types.isDataView(v)) return "DataView";
  if (ArrayBuffer.isView(v)) return taTag.call(v);
  if (util.types.isNumberObject(v)) return "NumberObject";
  if (util.types.isStringObject(v)) return "StringObject";
  if (util.types.isBooleanObject(v)) return "BooleanObject";
  if (util.types.isSymbolObject(v)) return "SymbolObject";
  if (util.types.isBigIntObject(v)) return "BigIntObject";
  if (util.types.isNativeError(v)) return "Error";
  if (util.types.isGeneratorObject(v)) return "GeneratorObject";
  if (util.types.isArgumentsObject(v)) return "Arguments";
  if (util.types.isMapIterator(v)) return "MapIterator";
  if (util.types.isSetIterator(v)) return "SetIterator";
  if (isWeakRefObject(v)) return "WeakRef";
  return "Object";
}

function serializeAssumeLiteral(v) {
  if (v === undefined) return "void 0";
  if (v === null) return "null";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (Object.is(v, -0)) return "-0";
    if (v === Infinity) return "1 / 0";
    if (v === -Infinity) return "-1 / 0";
    return String(v);
  }
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  return JSON.stringify(v);
}

function buildSpecStubExpr(key, spec) {
  if (!spec || spec.primitiveUnknown) return null;
  if (key === "queueMicrotask") {
    return "function queueMicrotask(cb) { Promise.resolve().then(function() { cb(); }); }";
  }
  if (spec.type === "function") {
    const safeName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : "";
    return `function ${safeName}() {}`;
  }
  const propEntries = [];
  if (spec.toStringTag) {
    propEntries.push(`[Symbol.toStringTag]: ${JSON.stringify(spec.toStringTag)}`);
  }
  if (spec.props && typeof spec.props === "object") {
    for (const [pk, pSpec] of Object.entries(spec.props)) {
      const childExpr = buildSpecStubExpr(pk, pSpec);
      if (childExpr !== null) {
        propEntries.push(`${JSON.stringify(pk)}: ${childExpr}`);
      }
    }
  }
  return `{ ${propEntries.join(", ")} }`;
}

function emitAssumeStatements(parts, rawAssume, aliasSet) {
  if (!rawAssume || typeof rawAssume !== "object") return;
  const entries = Array.isArray(rawAssume)
    ? rawAssume.map(item => {
        const eq = String(item).indexOf("=");
        const k = eq > 0 ? String(item).slice(0, eq).trim() : String(item);
        const rawV = eq > 0 ? String(item).slice(eq + 1).trim() : "undefined";
        const val =
          rawV === "undefined"
            ? undefined
            : rawV === "NaN"
              ? NaN
              : rawV === "-0"
                ? -0
                : rawV === "Infinity"
                  ? Infinity
                  : rawV === "-Infinity"
                    ? -Infinity
                    : JSON.parse(rawV);
        return [k, val];
      })
    : Object.entries(rawAssume);

  for (const [origKey, val] of entries) {
    if (origKey.startsWith("$") || origKey.startsWith("--")) continue;
    let key = origKey.trim();
    let isTypeof = false;
    if (key.startsWith("typeof:")) {
      isTypeof = true;
      key = key.slice("typeof:".length).trim();
    } else if (key.startsWith("typeof ")) {
      isTypeof = true;
      key = key.slice("typeof ".length).trim();
    }
    const segs = key.includes(".") ? key.split(".") : [key];
    if (segs.length >= 2 && (segs[0] === "globalThis" || aliasSet.has(segs[0]))) {
      segs.shift();
    }

    let targetValExpr;
    let deleteLeaf = false;
    if (isTypeof) {
      if (val === "undefined") {
        deleteLeaf = true;
        targetValExpr = "void 0";
      } else if (val === "object") {
        targetValExpr = "{}";
      } else if (val === "function") {
        targetValExpr = "function() {}";
      } else {
        targetValExpr = serializeAssumeLiteral(val);
      }
    } else if (val === undefined) {
      deleteLeaf = segs.length === 1;
      targetValExpr = "void 0";
    } else {
      targetValExpr = serializeAssumeLiteral(val);
    }

    if (segs.length === 1) {
      if (deleteLeaf) {
        parts.push(`delete globalThis[${JSON.stringify(segs[0])}];`);
      } else {
        parts.push(`globalThis[${JSON.stringify(segs[0])}] = ${targetValExpr};`);
      }
    } else {
      let cur = "globalThis";
      for (let i = 0; i < segs.length - 1; i++) {
        const next = `${cur}[${JSON.stringify(segs[i])}]`;
        parts.push(`if (typeof ${next} !== "object" || ${next} === null) ${next} = {};`);
        cur = next;
      }
      const leafAccess = `${cur}[${JSON.stringify(segs[segs.length - 1])}]`;
      parts.push(`${leafAccess} = ${targetValExpr};`);
    }
  }
}

function buildProfilePrelude(opts = {}) {
  const rawProfile = opts.profile || opts.env || "bare";
  const parts = [];
  let aliasSet = new Set();

  if (rawProfile === "bare") {
    // Default bare realm (leaves V8's built-in context untouched for standalone verify() callers)
  } else if (rawProfile === "node-react") {
    aliasSet = new Set(["global"]);
    parts.push(
      "var global = globalThis;",
      "globalThis.console = { log: function(){}, warn: function(){}, error: function(){}, info: function(){} };",
      "globalThis.process = { env: { NODE_ENV: 'production' }, version: " +
        JSON.stringify(process.version) +
        ", versions: { node: " +
        JSON.stringify(process.versions.node) +
        " }, cwd: function(){ return '/'; }, nextTick: function(fn){ Promise.resolve().then(fn); } };"
    );
  } else {
    const spec = resolveProfile(rawProfile);
    aliasSet = new Set(spec.aliases || []);
    const specGlobals = spec.globals || {};
    if (!specGlobals.console) {
      parts.push("delete globalThis.console;");
    }
    if (!specGlobals.WebAssembly) {
      parts.push("delete globalThis.WebAssembly;");
    }
    if (spec.globalToStringTag !== undefined) {
      parts.push(
        `Object.defineProperty(Object.getPrototypeOf(globalThis), Symbol.toStringTag, { value: ${JSON.stringify(
          spec.globalToStringTag
        )}, configurable: true });`
      );
    }
    for (const alias of spec.aliases || []) {
      parts.push(`Object.defineProperty(globalThis, ${JSON.stringify(alias)}, { value: globalThis, writable: true, enumerable: false, configurable: true });`);
    }
    for (const [gk, gSpec] of Object.entries(specGlobals)) {
      if (gk === "WebAssembly" && typeof WebAssembly === "object") {
        // Keep real realm WebAssembly when present in profile
        continue;
      }
      const stubExpr = buildSpecStubExpr(gk, gSpec);
      if (stubExpr !== null) {
        parts.push(
          `Object.defineProperty(globalThis, ${JSON.stringify(gk)}, { value: ${stubExpr}, writable: true, enumerable: false, configurable: true });`
        );
      }
    }
  }

  if (opts.mathRandomSeed !== undefined && opts.mathRandomSeed !== null) {
    // Deterministic xorshift32 PRNG matching across both contexts when seeded
    const seedStr = String(opts.mathRandomSeed);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    if (h === 0) h = 0x9e3779b9;
    parts.push(
      "(function(){ var __s = " +
        h +
        " >>> 0; Math.random = function random() { __s ^= __s << 13; __s ^= __s >>> 17; __s ^= __s << 5; return (__s >>> 0) / 4294967296; }; })();"
    );
  }

  if (typeof opts.fixedTime === "number") {
    const fixedMs = Number(opts.fixedTime);
    parts.push(
      `(function(){
        var __OrigDate = Date;
        var __t = ${fixedMs};
        function FixedDate() {
          if (!new.target) return new __OrigDate(__t).toString();
          if (arguments.length === 0) return new __OrigDate(__t);
          return Reflect.construct(__OrigDate, arguments, new.target === FixedDate ? __OrigDate : new.target);
        }
        Object.setPrototypeOf(FixedDate, __OrigDate);
        FixedDate.prototype = __OrigDate.prototype;
        FixedDate.now = function now() { return __t; };
        FixedDate.UTC = __OrigDate.UTC;
        FixedDate.parse = __OrigDate.parse;
        globalThis.Date = FixedDate;
        if (typeof performance === "object" && performance) {
          performance.now = function now() { return 0; };
        }
      })();`
    );
  }

  if (opts.assume) {
    emitAssumeStatements(parts, opts.assume, aliasSet);
  }

  if (opts.globals && typeof opts.globals === "object") {
    for (const [k, v] of Object.entries(opts.globals)) {
      parts.push(`globalThis[${JSON.stringify(k)}] = ${v === undefined ? "undefined" : JSON.stringify(v)};`);
    }
  }

  if (typeof opts.prelude === "string" && opts.prelude.length > 0) {
    parts.push(opts.prelude);
  }

  return parts.join("\n");
}

// Create an Inspector controller over the current V8 isolate, supporting multiple VM contexts
function createInspectorController() {
  const session = new inspector.Session();
  session.connect();

  function post(method, params = {}) {
    let res;
    let err;
    let sync = false;
    session.post(method, params, (e, r) => {
      sync = true;
      err = e;
      res = r;
    });
    if (!sync) {
      throw new Error(`Unexpected async inspector command: ${method}`);
    }
    if (err) throw err;
    return res;
  }

  let latestContextId = null;
  session.on("Runtime.executionContextCreated", ({ params }) => {
    latestContextId = params.context.id;
  });

  post("Runtime.enable");

  let trackingHeapObjects = false;
  let debuggerEnabled = false;
  const scriptStrictCache = new Map();

  function ensureHeapTracking() {
    if (!trackingHeapObjects) {
      post("HeapProfiler.enable");
      post("HeapProfiler.startTrackingHeapObjects", { trackAllocations: false });
      trackingHeapObjects = true;
    }
  }

  function ensureDebugger() {
    if (!debuggerEnabled) {
      post("Debugger.enable");
      debuggerEnabled = true;
    }
  }

  function getScriptStrictProfile(scriptId) {
    if (scriptStrictCache.has(scriptId)) return scriptStrictCache.get(scriptId);
    ensureDebugger();
    let profile = null;
    try {
      const { scriptSource } = post("Debugger.getScriptSource", { scriptId });
      profile = computeStrictProfile(scriptSource);
    } catch {
      profile = null;
    }
    scriptStrictCache.set(scriptId, profile);
    return profile;
  }

  function takeSnapshotIndex() {
    ensureHeapTracking();
    const stream = v8.getHeapSnapshot();
    const chunks = [];
    let chunk;
    while ((chunk = stream.read()) !== null) {
      chunks.push(chunk);
    }
    stream.destroy();
    const snap = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const { node_fields, edge_fields, edge_types } = snap.snapshot.meta;
    const nfLen = node_fields.length;
    const efLen = edge_fields.length;
    const strings = snap.strings;
    const edgeTypeList = edge_types[0];
    const contextEdgeCode = edgeTypeList.indexOf("context");
    const internalEdgeCode = edgeTypeList.indexOf("internal");
    const nodeTypeList = snap.snapshot.meta.node_types[0];
    const closureTypeCode = nodeTypeList.indexOf("closure");
    const stringTypeCode = nodeTypeList.indexOf("string");

    const idToNodeIdx = new Map();
    const edgeOffsets = new Int32Array(snap.nodes.length / nfLen);
    let edgeCursor = 0;
    for (let i = 0, nIdx = 0; i < snap.nodes.length; i += nfLen, nIdx++) {
      idToNodeIdx.set(snap.nodes[i + 2], nIdx);
      edgeOffsets[nIdx] = edgeCursor;
      edgeCursor += snap.nodes[i + 4] * efLen;
    }

    function getContextVarEdges(ctxHeapId) {
      const nIdx = idToNodeIdx.get(ctxHeapId);
      if (nIdx === undefined) return null;
      const base = nIdx * nfLen;
      const ec = snap.nodes[base + 4];
      let eOff = edgeOffsets[nIdx];
      const map = new Map();
      for (let e = 0; e < ec; e++, eOff += efLen) {
        if (snap.edges[eOff] === contextEdgeCode) {
          const varName = strings[snap.edges[eOff + 1]];
          const targetBase = snap.edges[eOff + 2];
          if (snap.nodes[targetBase] === closureTypeCode || varName === "this") {
            map.set(varName, {
              heapId: snap.nodes[targetBase + 2],
              nodeType: nodeTypeList[snap.nodes[targetBase]],
              nodeName: strings[snap.nodes[targetBase + 1]],
              nodeBase: targetBase,
            });
          }
        }
      }
      return map;
    }

    function getContextAllEdgeNames(ctxHeapId) {
      const nIdx = idToNodeIdx.get(ctxHeapId);
      if (nIdx === undefined) return null;
      const base = nIdx * nfLen;
      const ec = snap.nodes[base + 4];
      let eOff = edgeOffsets[nIdx];
      const names = new Set();
      let scopeInfoBase = -1;
      for (let e = 0; e < ec; e++, eOff += efLen) {
        if (snap.edges[eOff] === contextEdgeCode) {
          names.add(strings[snap.edges[eOff + 1]]);
        } else if (snap.edges[eOff] === internalEdgeCode && strings[snap.edges[eOff + 1]] === "scope_info") {
          scopeInfoBase = snap.edges[eOff + 2];
        }
      }
      if (scopeInfoBase >= 0) {
        const siIdx = scopeInfoBase / nfLen;
        const siEc = snap.nodes[scopeInfoBase + 4];
        let siOff = edgeOffsets[siIdx];
        for (let e = 0; e < siEc; e++, siOff += efLen) {
          const toBase = snap.edges[siOff + 2];
          if (snap.nodes[toBase] === stringTypeCode) {
            names.add(strings[snap.nodes[toBase + 1]]);
          }
        }
      }
      return names;
    }

    function getContextChainIds(fnHeapId) {
      let nIdx = idToNodeIdx.get(fnHeapId);
      const chain = [];
      let first = true;
      while (nIdx !== undefined) {
        const base = nIdx * nfLen;
        const name = strings[snap.nodes[base + 1]];
        const ec = snap.nodes[base + 4];
        if (!first) {
          if (name === "system / NativeContext") break;
          chain.push(snap.nodes[base + 2]);
        }
        const wantEdgeName = first ? "context" : "previous";
        first = false;
        let nextIdx;
        let eOff = edgeOffsets[nIdx];
        for (let e = 0; e < ec; e++, eOff += efLen) {
          if (snap.edges[eOff] === internalEdgeCode && strings[snap.edges[eOff + 1]] === wantEdgeName) {
            nextIdx = snap.edges[eOff + 2] / nfLen;
            break;
          }
        }
        nIdx = nextIdx;
      }
      return chain;
    }

    return { getContextChainIds, getContextVarEdges, getContextAllEdgeNames };
  }

  function createEnv(label, opts = {}) {
    latestContextId = null;
    const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    const contextId = latestContextId;
    if (contextId === null) {
      throw new Error(`Failed to capture inspector executionContextId for ${label}`);
    }

    // Install zero-footprint bidirectional JS <-> RemoteObject bridge without leaving global keys
    const bridge = { cur: undefined };
    vm.runInContext(
      "(function(b){ Object.defineProperty(globalThis, '__verify_bridge__', { value: { toRemote: function(){ return b.cur; }, fromRemote: function(x){ b.cur = x; } }, configurable: true }); })",
      ctx
    )(bridge);
    const toRemoteObjId = post("Runtime.evaluate", {
      contextId,
      expression: "globalThis.__verify_bridge__.toRemote",
      returnByValue: false,
    }).result.objectId;
    const fromRemoteObjId = post("Runtime.evaluate", {
      contextId,
      expression: "globalThis.__verify_bridge__.fromRemote",
      returnByValue: false,
    }).result.objectId;
    vm.runInContext("delete globalThis.__verify_bridge__;", ctx);

    const prelude = buildProfilePrelude(opts);
    if (prelude) {
      vm.runInContext(prelude, ctx, { filename: `${label}-prelude.js` });
    }

    // Discover all baseline intrinsics and snapshot their descriptors before user script runs
    const seeds = vm.runInContext(
      `({
        globalThis: globalThis,
        callerGetter: Object.getOwnPropertyDescriptor(Function.prototype, "caller").get,
        "%ErrorStackGetter%": Object.getOwnPropertyDescriptor(new Error(), "stack").get,
        "%ErrorStackSetter%": Object.getOwnPropertyDescriptor(new Error(), "stack").set,
        "%GeneratorFunction%": (function*(){}).constructor,
        "%GeneratorFunction.prototype%": Object.getPrototypeOf(function*(){}),
        "%GeneratorPrototype%": Object.getPrototypeOf((function*(){}).prototype),
        "%AsyncFunction%": (async function(){}).constructor,
        "%AsyncFunction.prototype%": Object.getPrototypeOf(async function(){}),
        "%AsyncGeneratorFunction%": (async function*(){}).constructor,
        "%AsyncGeneratorFunction.prototype%": Object.getPrototypeOf(async function*(){}),
        "%AsyncGeneratorPrototype%": Object.getPrototypeOf((async function*(){}).prototype),
        "%ArrayIteratorPrototype%": Object.getPrototypeOf([][Symbol.iterator]()),
        "%StringIteratorPrototype%": Object.getPrototypeOf(""[Symbol.iterator]()),
        "%MapIteratorPrototype%": Object.getPrototypeOf(new Map()[Symbol.iterator]()),
        "%SetIteratorPrototype%": Object.getPrototypeOf(new Set()[Symbol.iterator]()),
        "%RegExpStringIteratorPrototype%": Object.getPrototypeOf((/a/)[Symbol.matchAll]("")),
      })`,
      ctx
    );

    const callerGetter = seeds.callerGetter;
    const globalObj = seeds.globalThis;
    const intrinsicToPath = new Map();
    const pathToIntrinsic = new Map();
    const baselineSnapshots = new Map();
    const bfs = [];

    function enqueueIntrinsic(val, intrPath) {
      if (!isObjectOrFunction(val)) return;
      if (intrinsicToPath.has(val)) return;
      intrinsicToPath.set(val, intrPath);
      pathToIntrinsic.set(intrPath, val);
      bfs.push([val, intrPath]);
    }

    enqueueIntrinsic(globalObj, "<globalThis>");
    for (const [k, v] of Object.entries(seeds)) {
      if (k !== "globalThis" && k !== "callerGetter") {
        enqueueIntrinsic(v, k);
      }
    }

    for (let head = 0; head < bfs.length; head++) {
      const [obj, intrPath] = bfs[head];
      const proto = Object.getPrototypeOf(obj);
      const keys = Reflect.ownKeys(obj);
      const descs = new Map();
      for (const key of keys) {
        const desc = Object.getOwnPropertyDescriptor(obj, key);
        if (!desc) continue;
        descs.set(key, desc);
        const childPath = formatPropPath(intrPath, key);
        if ("value" in desc) enqueueIntrinsic(desc.value, childPath);
        if (desc.get) enqueueIntrinsic(desc.get, `get ${childPath}`);
        if (desc.set) enqueueIntrinsic(desc.set, `set ${childPath}`);
      }
      if (proto !== null) {
        enqueueIntrinsic(proto, `${intrPath}.[[Prototype]]`);
      }
      baselineSnapshots.set(intrPath, {
        obj,
        proto,
        extensible: Object.isExtensible(obj),
        sealed: Object.isSealed(obj),
        frozen: Object.isFrozen(obj),
        keys,
        descs,
      });
    }

    const objectIdCache = new WeakMap();

    function jsToObjectId(val) {
      if (isObjectOrFunction(val) && objectIdCache.has(val)) {
        return objectIdCache.get(val);
      }
      bridge.cur = val;
      const r = post("Runtime.callFunctionOn", {
        objectId: toRemoteObjId,
        functionDeclaration: "function() { return this(); }",
        returnByValue: false,
      }).result;
      bridge.cur = undefined;
      if (isObjectOrFunction(val) && r.objectId) {
        objectIdCache.set(val, r.objectId);
      }
      return r.objectId;
    }

    function remoteToJs(remoteObj) {
      if (!remoteObj) return TDZ_SENTINEL;
      if (remoteObj.objectId) {
        post("Runtime.callFunctionOn", {
          objectId: fromRemoteObjId,
          arguments: [{ objectId: remoteObj.objectId }],
          functionDeclaration: "function(x) { this(x); }",
        });
        const val = bridge.cur;
        bridge.cur = undefined;
        return val;
      }
      if ("unserializableValue" in remoteObj) {
        const u = remoteObj.unserializableValue;
        if (u === "-0") return -0;
        if (u === "NaN") return NaN;
        if (u === "Infinity") return Infinity;
        if (u === "-Infinity") return -Infinity;
        if (typeof u === "string" && u.endsWith("n")) return BigInt(u.slice(0, -1));
      }
      if (remoteObj.type === "undefined") return undefined;
      return remoteObj.value;
    }

    function getHeapObjectId(val) {
      const objectId = jsToObjectId(val);
      const { heapSnapshotObjectId } = post("HeapProfiler.getHeapObjectId", { objectId });
      return Number(heapSnapshotObjectId);
    }

    function getObjectByHeapId(heapId) {
      const r = post("HeapProfiler.getObjectByHeapObjectId", { objectId: String(heapId) });
      return remoteToJs(r.result);
    }

    function getInternalProperties(val) {
      const objectId = jsToObjectId(val);
      const props = post("Runtime.getProperties", {
        objectId,
        ownProperties: false,
        accessorPropertiesOnly: false,
      });
      return props.internalProperties || [];
    }

    function readPromiseDetails(promiseVal) {
      const internal = getInternalProperties(promiseVal);
      const stateProp = internal.find(p => p.name === "[[PromiseState]]");
      const resultProp = internal.find(p => p.name === "[[PromiseResult]]");
      const state = stateProp && stateProp.value ? stateProp.value.value : "unknown";
      const result = state === "pending" ? undefined : resultProp ? remoteToJs(resultProp.value) : undefined;
      return { state, result };
    }

    function readFunctionDetails(fnVal) {
      const internal = getInternalProperties(fnVal);
      const targetProp = internal.find(p => p.name === "[[TargetFunction]]");
      if (targetProp && targetProp.value) {
        const boundThisProp = internal.find(p => p.name === "[[BoundThis]]");
        const boundArgsProp = internal.find(p => p.name === "[[BoundArgs]]");
        return {
          isBound: true,
          kind: "bound",
          target: remoteToJs(targetProp.value),
          boundThis: boundThisProp ? remoteToJs(boundThisProp.value) : undefined,
          boundArgs: boundArgsProp ? Array.from(remoteToJs(boundArgsProp.value) || []) : [],
        };
      }

      const source = fnToString.call(fnVal);
      const locProp = internal.find(p => p.name === "[[FunctionLocation]]");
      const isNative = !locProp && /^function\s*[^\s(]*\s*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/.test(source);
      if (isNative) {
        return {
          isBound: false,
          isNative: true,
          kind: "native",
          strict: true,
          source,
          scopesProp: null,
        };
      }

      const kind = classifyFunctionKind(fnVal, source);
      let strict;
      if (kind === "class") {
        strict = true;
      } else if (kind === "normal") {
        try {
          callerGetter.call(fnVal);
          strict = false;
        } catch {
          strict = true;
        }
      } else {
        const loc = locProp && locProp.value && locProp.value.value ? locProp.value.value : null;
        const scriptProfile = loc && loc.scriptId ? getScriptStrictProfile(loc.scriptId) : null;
        strict = isPositionStrict(scriptProfile, loc ? loc.lineNumber : 0, loc ? loc.columnNumber : 0, source);
      }

      const scopesProp = internal.find(p => p.name === "[[Scopes]]");
      return {
        isBound: false,
        isNative: false,
        kind,
        strict,
        source,
        scopesObjectId: scopesProp && scopesProp.value ? scopesProp.value.objectId : null,
      };
    }

    function hasNonGlobalScope(scopesObjectId) {
      if (!scopesObjectId) return false;
      const list = post("Runtime.getProperties", { objectId: scopesObjectId, ownProperties: true }).result || [];
      for (const sc of list) {
        if (sc.value && sc.value.objectId && sc.value.description !== "Global") {
          return true;
        }
      }
      return false;
    }

    function readScopeFramesForChain(scopesObjectId, ctxChainIds, cache, snap = null) {
      if (!scopesObjectId || ctxChainIds.length === 0) return;
      const list = post("Runtime.getProperties", { objectId: scopesObjectId, ownProperties: true }).result || [];
      const nonGlobal = [];
      for (const sc of list) {
        if (!sc.value || !sc.value.objectId) continue;
        const desc = sc.value.description || "";
        if (desc === "Global") continue;
        nonGlobal.push({ desc, objectId: sc.value.objectId });
      }

      // Align nonGlobal [0..m-1] to ctxChainIds [0..k-1]
      const m = nonGlobal.length;
      const k = ctxChainIds.length;
      let rawVarsByFrame = null;
      let alignedCtxIdx = null;
      if (m === k || !snap) {
        alignedCtxIdx = Array.from({ length: Math.min(m, k) }, (_, i) => i);
      } else {
        rawVarsByFrame = nonGlobal.map(
          f => post("Runtime.getProperties", { objectId: f.objectId, ownProperties: true }).result || []
        );
        const ctxEdgeNames = ctxChainIds.map(cid => snap.getContextAllEdgeNames(cid) || new Set());
        alignedCtxIdx = [];
        let cIdx = 0;
        for (let sIdx = 0; sIdx < m && cIdx < k; sIdx++) {
          const vList = rawVarsByFrame[sIdx];
          while (
            cIdx < k - (m - sIdx) &&
            vList.length > 0 &&
            !vList.every(v => ctxEdgeNames[cIdx].has(v.name))
          ) {
            cIdx++;
          }
          alignedCtxIdx.push(cIdx);
          cIdx++;
        }
      }

      for (let i = 0; i < alignedCtxIdx.length; i++) {
        const ctxId = ctxChainIds[alignedCtxIdx[i]];
        if (ctxId === undefined || cache.has(ctxId)) continue;
        const rawVars =
          rawVarsByFrame !== null
            ? rawVarsByFrame[i]
            : post("Runtime.getProperties", { objectId: nonGlobal[i].objectId, ownProperties: true }).result || [];
        const vars = new Map();
        for (const v of rawVars) {
          vars.set(v.name, v.value ? remoteToJs(v.value) : TDZ_SENTINEL);
        }
        cache.set(ctxId, { description: nonGlobal[i].desc, vars });
      }
      for (const id of ctxChainIds) {
        if (!cache.has(id)) {
          cache.set(id, { description: "Closure", vars: new Map() });
        }
      }
    }

    function runScript(code, filename = `${label}.js`, timeout = 30000) {
      return vm.runInContext(code, ctx, { filename, timeout });
    }

    return {
      label,
      ctx,
      contextId,
      globalObj,
      intrinsicToPath,
      pathToIntrinsic,
      baselineSnapshots,
      runScript,
      getHeapObjectId,
      getObjectByHeapId,
      readPromiseDetails,
      readFunctionDetails,
      hasNonGlobalScope,
      readScopeFramesForChain,
    };
  }

  function close() {
    if (trackingHeapObjects) {
      try {
        post("HeapProfiler.stopTrackingHeapObjects", { reportProgress: false });
      } catch {}
    }
    try {
      session.disconnect();
    } catch {}
  }

  return {
    createEnv,
    takeSnapshotIndex,
    close,
  };
}

function classifyFunctionKind(fnVal, source) {
  const isGen = util.types.isGeneratorFunction(fnVal);
  const isAsync = util.types.isAsyncFunction(fnVal);
  if (isGen && isAsync) return "asyncGenerator";
  if (isGen) return "generator";
  const trimmed = source.trimStart();
  if (/^class(?:\s|\{|$)/.test(trimmed)) return "class";
  if (isAsync) {
    if (/^async\s+function\b/.test(trimmed)) return "async";
    if (isArrowSource(trimmed)) return "asyncArrow";
    return "asyncMethod";
  }
  if (isConstructor(fnVal)) return "normal";
  if (/^get(?:\s+\S|\s*\[)/.test(trimmed)) return "getter";
  if (/^set(?:\s+\S|\s*\[)/.test(trimmed)) return "setter";
  if (isArrowSource(trimmed)) return "arrow";
  return "method";
}

function isArrowSource(trimmed) {
  if (/^(?:async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*=>/.test(trimmed)) return true;
  if (/^(?:async\s+)?\(/.test(trimmed)) return true;
  return false;
}

function descriptorsMatchBaseline(desc, baseDesc) {
  if (!desc || !baseDesc) return false;
  if (isAccessorDescriptor(desc) !== isAccessorDescriptor(baseDesc)) return false;
  if (Boolean(desc.enumerable) !== Boolean(baseDesc.enumerable)) return false;
  if (Boolean(desc.configurable) !== Boolean(baseDesc.configurable)) return false;
  if (isAccessorDescriptor(desc)) {
    return Object.is(desc.get, baseDesc.get) && Object.is(desc.set, baseDesc.set);
  }
  return Boolean(desc.writable) === Boolean(baseDesc.writable) && Object.is(desc.value, baseDesc.value);
}

// Compare two already-initialized environments (envA = original, envB = output) for heap isomorphism.
function compareEnvironments(controller, envA, envB, opts = {}) {
  const stats = {
    rootsCompared: 0,
    intrinsicPatchesCompared: 0,
    objectsCompared: 0,
    functionsCompared: 0,
    scopesCompared: 0,
    primitivesCompared: 0,
  };

  // Bijection maps for non-intrinsic heap objects/functions
  const mapAtoB = new Map();
  const mapBtoA = new Map();

  // Bijection maps for unique unregistered symbols
  const symMapAtoB = new Map();
  const symMapBtoA = new Map();

  // Bijection maps for closure variable bindings `(ctxHeapId + ":" + varName)` (and raw Context IDs when eval/with)
  const bindingMapAtoB = new Map();
  const bindingMapBtoA = new Map();
  const rawCtxMapAtoB = new Map();
  const rawCtxMapBtoA = new Map();

  // Cache of `ctxHeapId -> { description, vars: Map<name, val> }` per side so shared Contexts are inspected once
  const ctxVarsCacheA = new Map();
  const ctxVarsCacheB = new Map();

  let snapshotIndex = null;
  function ensureSnapshot() {
    if (!snapshotIndex) {
      snapshotIndex = controller.takeSnapshotIndex();
    }
    return snapshotIndex;
  }

  // BFS work queue of `{ a, b, path }`
  const queue = [];
  let qHead = 0;

  function enqueue(a, b, path) {
    queue.push({ a, b, path });
  }

  function compareSymbols(symA, symB, path) {
    if (WELL_KNOWN_SYMBOLS.has(symA) || WELL_KNOWN_SYMBOLS.has(symB)) {
      if (symA !== symB) {
        return makeDiff(path, "symbol", symA, symB, "well-known symbol mismatch");
      }
      return null;
    }
    const keyA = Symbol.keyFor(symA);
    const keyB = Symbol.keyFor(symB);
    if (keyA !== undefined || keyB !== undefined) {
      if (keyA !== keyB) {
        return makeDiff(path, "symbol", symA, symB, "registered Symbol.for key mismatch");
      }
      return null;
    }
    if (symA.description !== symB.description) {
      return makeDiff(path, "symbol", symA, symB, "unique symbol description mismatch");
    }
    if (symMapAtoB.has(symA)) {
      const mapped = symMapAtoB.get(symA);
      if (mapped.symB !== symB) {
        return makeDiff(
          path,
          "symbol-identity",
          `<same symbol as ${mapped.path}>`,
          symMapBtoA.has(symB) ? `<same symbol as ${symMapBtoA.get(symB).path}>` : "<distinct symbol>"
        );
      }
      return null;
    }
    if (symMapBtoA.has(symB)) {
      return makeDiff(path, "symbol-identity", "<distinct symbol>", `<aliased to ${symMapBtoA.get(symB).path}>`);
    }
    symMapAtoB.set(symA, { symB, path });
    symMapBtoA.set(symB, { symA, path });
    return null;
  }

  function checkIntegrity(objA, objB, path) {
    const frozenA = Object.isFrozen(objA);
    const frozenB = Object.isFrozen(objB);
    if (frozenA !== frozenB) {
      return makeDiff(path, "integrity", `frozen=${frozenA}`, `frozen=${frozenB}`, "object frozen state differs");
    }
    const sealedA = Object.isSealed(objA);
    const sealedB = Object.isSealed(objB);
    if (sealedA !== sealedB) {
      return makeDiff(path, "integrity", `sealed=${sealedA}`, `sealed=${sealedB}`, "object sealed state differs");
    }
    const extA = Object.isExtensible(objA);
    const extB = Object.isExtensible(objB);
    if (extA !== extB) {
      return makeDiff(path, "integrity", `extensible=${extA}`, `extensible=${extB}`, "object extensibility differs");
    }
    return null;
  }

  function compareDescriptorMetaAndEnqueue(descA, descB, propPath, optsLocal = {}) {
    const accA = isAccessorDescriptor(descA);
    const accB = isAccessorDescriptor(descB);
    if (accA !== accB) {
      return makeDiff(
        propPath,
        "descriptor-kind",
        accA ? "accessor (get/set)" : "data",
        accB ? "accessor (get/set)" : "data",
        "property descriptor kind differs"
      );
    }
    if (Boolean(descA.enumerable) !== Boolean(descB.enumerable)) {
      return makeDiff(
        propPath,
        "descriptor-attrs",
        `enumerable=${Boolean(descA.enumerable)}`,
        `enumerable=${Boolean(descB.enumerable)}`,
        "property enumerable attribute differs"
      );
    }
    if (Boolean(descA.configurable) !== Boolean(descB.configurable)) {
      return makeDiff(
        propPath,
        "descriptor-attrs",
        `configurable=${Boolean(descA.configurable)}`,
        `configurable=${Boolean(descB.configurable)}`,
        "property configurable attribute differs"
      );
    }
    if (!accA) {
      if (Boolean(descA.writable) !== Boolean(descB.writable)) {
        return makeDiff(
          propPath,
          "descriptor-attrs",
          `writable=${Boolean(descA.writable)}`,
          `writable=${Boolean(descB.writable)}`,
          "property writable attribute differs"
        );
      }
      if (!optsLocal.skipValue) {
        enqueue(descA.value, descB.value, propPath);
      }
    } else {
      enqueue(descA.get, descB.get, `get ${propPath}`);
      enqueue(descA.set, descB.set, `set ${propPath}`);
    }
    return null;
  }

  function isNodeAsyncHooksSymbol(k) {
    return (
      typeof k === "symbol" &&
      Symbol.keyFor(k) === undefined &&
      (k.description === "async_id_symbol" ||
        k.description === "trigger_async_id_symbol" ||
        k.description === "destroyed")
    );
  }

  function compareOwnProperties(objA, objB, basePath, typedArrayLen = -1, isErrorObj = false, isPromiseObj = false) {
    const keysA = isPromiseObj ? Reflect.ownKeys(objA).filter(k => !isNodeAsyncHooksSymbol(k)) : Reflect.ownKeys(objA);
    const keysB = isPromiseObj ? Reflect.ownKeys(objB).filter(k => !isNodeAsyncHooksSymbol(k)) : Reflect.ownKeys(objB);

    if (keysA.length !== keysB.length) {
      // Find first mismatched or missing/extra key for a sharp diagnostic
      const minLen = Math.min(keysA.length, keysB.length);
      for (let i = 0; i < minLen; i++) {
        if (typeof keysA[i] === "string" && keysA[i] !== keysB[i]) {
          const propPath = formatPropPath(basePath, keysA[i]);
          return makeDiff(
            propPath,
            "property-keys",
            String(keysA[i]),
            String(keysB[i]),
            `own key mismatch at index ${i}`
          );
        }
      }
      if (keysA.length > keysB.length) {
        const missingKey = keysA[minLen];
        return makeDiff(
          formatPropPath(basePath, missingKey),
          "missing-property",
          "present",
          "missing",
          "missing own property"
        );
      }
      const extraKey = keysB[minLen];
      return makeDiff(
        formatPropPath(basePath, extraKey),
        "extra-property",
        "absent",
        "present",
        "unexpected extra own property"
      );
    }

    const startIdx = typedArrayLen > 0 ? typedArrayLen : 0;
    for (let i = startIdx; i < keysA.length; i++) {
      const kA = keysA[i];
      const kB = keysB[i];
      if (typeof kA !== typeof kB) {
        return makeDiff(
          basePath,
          "property-order",
          formatShortValue(kA),
          formatShortValue(kB),
          `own key type mismatch at index ${i}`
        );
      }
      if (typeof kA === "string") {
        if (kA !== kB) {
          const existsInB = Object.prototype.hasOwnProperty.call(objB, kA);
          const kind = existsInB ? "property-order" : "property-keys";
          const detail = existsInB
            ? `own property order differs at index ${i}`
            : `own property key differs at index ${i}`;
          return makeDiff(basePath, kind, JSON.stringify(kA), JSON.stringify(kB), detail);
        }
      } else {
        const symDiff = compareSymbols(kA, kB, formatPropPath(basePath, kA));
        if (symDiff) return symDiff;
      }

      const descA = Object.getOwnPropertyDescriptor(objA, kA);
      const descB = Object.getOwnPropertyDescriptor(objB, kB);
      const propPath = formatPropPath(basePath, kA);
      const skipValue = Boolean(opts.ignoreErrorStack && isErrorObj && kA === "stack");
      const dDiff = compareDescriptorMetaAndEnqueue(descA, descB, propPath, { skipValue });
      if (dDiff) return dDiff;
    }

    return null;
  }

  // Step 1: Compare roots — `<globalThis>` + all baseline intrinsics for patches!
  for (const [intrPath, snapA] of envA.baselineSnapshots.entries()) {
    const snapB = envB.baselineSnapshots.get(intrPath);
    if (!snapB) continue;

    const objA = snapA.obj;
    const objB = snapB.obj;
    const isGlobalRoot = intrPath === "<globalThis>";

    const integDiff = checkIntegrity(objA, objB, intrPath);
    if (integDiff) return { ok: false, firstDiff: integDiff, stats };

    const protoA = Object.getPrototypeOf(objA);
    const protoB = Object.getPrototypeOf(objB);
    if (!Object.is(protoA, snapA.proto) || !Object.is(protoB, snapB.proto)) {
      if (isGlobalRoot) stats.rootsCompared++;
      else stats.intrinsicPatchesCompared++;
      enqueue(protoA, protoB, `${intrPath}.[[Prototype]]`);
    }

    const keysA = Reflect.ownKeys(objA);
    const keysB = Reflect.ownKeys(objB);

    // Quick check if neither side changed this intrinsic at all
    let changed = keysA.length !== snapA.keys.length || keysB.length !== snapB.keys.length;
    if (!changed) {
      for (let i = 0; i < keysA.length; i++) {
        if (keysA[i] !== snapA.keys[i] || keysB[i] !== snapB.keys[i]) {
          changed = true;
          break;
        }
        const dA = Object.getOwnPropertyDescriptor(objA, keysA[i]);
        const dB = Object.getOwnPropertyDescriptor(objB, keysB[i]);
        if (
          !descriptorsMatchBaseline(dA, snapA.descs.get(keysA[i])) ||
          !descriptorsMatchBaseline(dB, snapB.descs.get(keysB[i]))
        ) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) continue;

    // Keys must match in exact order on modified globals / intrinsics
    if (keysA.length !== keysB.length) {
      const minLen = Math.min(keysA.length, keysB.length);
      for (let i = 0; i < minLen; i++) {
        if (typeof keysA[i] === "string" && keysA[i] !== keysB[i]) {
          return {
            ok: false,
            firstDiff: makeDiff(
              formatPropPath(intrPath, keysA[i]),
              "property-keys",
              String(keysA[i]),
              String(keysB[i]),
              `root key mismatch on ${intrPath}`
            ),
            stats,
          };
        }
      }
      const diffKey = keysA.length > keysB.length ? keysA[minLen] : keysB[minLen];
      return {
        ok: false,
        firstDiff: makeDiff(
          formatPropPath(intrPath, diffKey),
          keysA.length > keysB.length ? "missing-property" : "extra-property",
          keysA.length > keysB.length ? "present" : "absent",
          keysA.length > keysB.length ? "missing" : "present",
          keysA.length > keysB.length ? `missing property on ${intrPath}` : `unexpected property on ${intrPath}`
        ),
        stats,
      };
    }

    for (let i = 0; i < keysA.length; i++) {
      const kA = keysA[i];
      const kB = keysB[i];
      if (typeof kA !== typeof kB) {
        return {
          ok: false,
          firstDiff: makeDiff(intrPath, "property-order", formatShortValue(kA), formatShortValue(kB)),
          stats,
        };
      }
      if (typeof kA === "string") {
        if (kA !== kB) {
          const existsInB = Object.prototype.hasOwnProperty.call(objB, kA);
          return {
            ok: false,
            firstDiff: makeDiff(
              intrPath,
              existsInB ? "property-order" : "property-keys",
              JSON.stringify(kA),
              JSON.stringify(kB),
              existsInB ? `property order differs on ${intrPath}` : `property key differs on ${intrPath}`
            ),
            stats,
          };
        }
      } else {
        const symDiff = compareSymbols(kA, kB, formatPropPath(intrPath, kA));
        if (symDiff) return { ok: false, firstDiff: symDiff, stats };
      }

      const dA = Object.getOwnPropertyDescriptor(objA, kA);
      const dB = Object.getOwnPropertyDescriptor(objB, kB);
      const unchangedA = snapA.descs.has(kA) && descriptorsMatchBaseline(dA, snapA.descs.get(kA));
      const unchangedB = snapB.descs.has(kB) && descriptorsMatchBaseline(dB, snapB.descs.get(kB));
      if (unchangedA && unchangedB) continue;

      if (isGlobalRoot) stats.rootsCompared++;
      else stats.intrinsicPatchesCompared++;

      const propPath = formatPropPath(intrPath, kA);
      const dDiff = compareDescriptorMetaAndEnqueue(dA, dB, propPath);
      if (dDiff) return { ok: false, firstDiff: dDiff, stats };
    }
  }

  function populateScopeCache(env, snap, ctxChainIds, scopesObjectId, cache) {
    if (ctxChainIds.length === 0) return [];
    let missing = false;
    for (const id of ctxChainIds) {
      if (!cache.has(id)) {
        missing = true;
        break;
      }
    }
    if (missing) {
      env.readScopeFramesForChain(scopesObjectId, ctxChainIds, cache, snap);
      // Recover Named FunctionExpression self-bindings & lexical `this` hidden by V8's [[Scopes]]
      for (const id of ctxChainIds) {
        const frame = cache.get(id);
        if (!frame) continue;
        const cEdges = snap.getContextVarEdges(id);
        if (!cEdges || cEdges.size === 0) continue;
        for (const [vName, edgeInfo] of cEdges.entries()) {
          if (!frame.vars.has(vName)) {
            if (
              edgeInfo.nodeType === "closure" ||
              edgeInfo.nodeType === "object" ||
              edgeInfo.nodeType === "array" ||
              edgeInfo.nodeType === "regexp"
            ) {
              try {
                frame.vars.set(vName, env.getObjectByHeapId(edgeInfo.heapId));
              } catch {
                // ignore unmaterializable edge
              }
            } else if (edgeInfo.nodeType === "hidden") {
              if (edgeInfo.nodeName === "undefined") frame.vars.set(vName, undefined);
              else if (edgeInfo.nodeName === "null") frame.vars.set(vName, null);
              else if (edgeInfo.nodeName === "true") frame.vars.set(vName, true);
              else if (edgeInfo.nodeName === "false") frame.vars.set(vName, false);
            } else if (edgeInfo.nodeType === "string") {
              frame.vars.set(vName, edgeInfo.nodeName);
            }
          }
        }
      }
    }
    return ctxChainIds.map(id => ({
      ctxId: id,
      description: cache.get(id).description,
      vars: cache.get(id).vars,
    }));
  }

  function resolveBinding(chain, varName) {
    for (const frame of chain) {
      if (frame.vars.has(varName)) {
        return { ctxId: frame.ctxId, value: frame.vars.get(varName) };
      }
    }
    return null;
  }

  function compareFunctionScopes(fnA, fnB, detailsA, detailsB, fnPath) {
    if (!snapshotIndex) {
      // Fast-path: avoid taking a full V8 heap snapshot until at least one function actually has a lexical scope
      if (!envA.hasNonGlobalScope(detailsA.scopesObjectId) && !envB.hasNonGlobalScope(detailsB.scopesObjectId)) {
        return null;
      }
    }
    const snap = ensureSnapshot();
    const heapIdA = envA.getHeapObjectId(fnA);
    const heapIdB = envB.getHeapObjectId(fnB);
    const ctxIdsA = snap.getContextChainIds(heapIdA);
    const ctxIdsB = snap.getContextChainIds(heapIdB);

    if (ctxIdsA.length === 0 && ctxIdsB.length === 0) {
      return null;
    }

    const chainA = populateScopeCache(envA, snap, ctxIdsA, detailsA.scopesObjectId, ctxVarsCacheA).filter(
      f => f.vars.size > 0
    );
    const chainB = populateScopeCache(envB, snap, ctxIdsB, detailsB.scopesObjectId, ctxVarsCacheB).filter(
      f => f.vars.size > 0
    );

    if (chainA.length === 0 && chainB.length === 0) {
      return null;
    }

    const analysis = analyzeFunctionSource(detailsA.source);
    const hasWithScope =
      chainA.some(f => f.description.startsWith("With")) || chainB.some(f => f.description.startsWith("With"));
    const strictRaw = Boolean(opts.strictRawScopes || analysis.hasEvalOrWith || hasWithScope);

    if (strictRaw) {
      if (chainA.length !== chainB.length) {
        return makeDiff(
          fnPath,
          "scope-depth",
          `${chainA.length} scope(s)`,
          `${chainB.length} scope(s)`,
          "closure scope chain depth differs"
        );
      }
      for (let i = 0; i < chainA.length; i++) {
        const fA = chainA[i];
        const fB = chainB[i];
        if (rawCtxMapAtoB.has(fA.ctxId)) {
          const prev = rawCtxMapAtoB.get(fA.ctxId);
          if (prev.ctxIdB !== fB.ctxId) {
            return makeDiff(
              `${fnPath} (scope #${i})`,
              "scope-sharing",
              `<shared scope with ${prev.path}>`,
              "<unshared/different scope>",
              `lost closure scope sharing with ${prev.path}`
            );
          }
          continue;
        }
        if (rawCtxMapBtoA.has(fB.ctxId)) {
          const prev = rawCtxMapBtoA.get(fB.ctxId);
          return makeDiff(
            `${fnPath} (scope #${i})`,
            "scope-sharing",
            "<distinct scope>",
            `<shared scope with ${prev.path}>`,
            `spurious closure scope sharing with ${prev.path}`
          );
        }
        rawCtxMapAtoB.set(fA.ctxId, { ctxIdB: fB.ctxId, path: fnPath });
        rawCtxMapBtoA.set(fB.ctxId, { ctxIdA: fA.ctxId, path: fnPath });
        stats.scopesCompared++;

        for (const name of fA.vars.keys()) {
          if (!fB.vars.has(name)) {
            return makeDiff(`${fnPath} (scope var "${name}")`, "scope-var-missing", "present", "missing");
          }
        }
        for (const name of fB.vars.keys()) {
          if (!fA.vars.has(name)) {
            return makeDiff(`${fnPath} (scope var "${name}")`, "scope-var-extra", "absent", "present");
          }
        }
        for (const [name, valA] of fA.vars.entries()) {
          enqueue(valA, fB.vars.get(name), `${fnPath} (scope var "${name}")`);
        }
      }
      return null;
    }

    // Collect every variable in chainA or chainB that is referenced in `fn`'s source
    const candidateNames = [];
    const seenNames = new Set();
    for (const frame of chainA) {
      for (const name of frame.vars.keys()) {
        if (!seenNames.has(name) && analysis.freeIdentifiers.has(name)) {
          seenNames.add(name);
          candidateNames.push(name);
        }
      }
    }
    for (const frame of chainB) {
      for (const name of frame.vars.keys()) {
        if (!seenNames.has(name) && analysis.freeIdentifiers.has(name)) {
          seenNames.add(name);
          candidateNames.push(name);
        }
      }
    }

    for (const name of candidateNames) {
      const boundA = resolveBinding(chainA, name);
      const boundB = resolveBinding(chainB, name);
      const varPath = `${fnPath} (scope var "${name}")`;

      if (boundA && !boundB) {
        return makeDiff(
          varPath,
          "scope-var-missing",
          formatShortValue(boundA.value),
          "<unbound>",
          "missing closure variable"
        );
      }
      if (!boundA && boundB) {
        return makeDiff(
          varPath,
          "scope-var-shadowing",
          "<global/unbound>",
          formatShortValue(boundB.value),
          "extra outer scope variable shadows identifier"
        );
      }

      const keyA = `${boundA.ctxId}:${name}`;
      const keyB = `${boundB.ctxId}:${name}`;

      if (bindingMapAtoB.has(keyA)) {
        const prev = bindingMapAtoB.get(keyA);
        if (prev.keyB !== keyB) {
          return makeDiff(
            varPath,
            "scope-sharing",
            `<shared binding with ${prev.path}>`,
            "<distinct binding>",
            `lost closure scope sharing with ${prev.path}`
          );
        }
        continue;
      }

      if (bindingMapBtoA.has(keyB)) {
        const prev = bindingMapBtoA.get(keyB);
        return makeDiff(
          varPath,
          "scope-sharing",
          "<distinct binding>",
          `<shared binding with ${prev.path}>`,
          `spurious closure scope sharing with ${prev.path}`
        );
      }

      bindingMapAtoB.set(keyA, { keyB, path: fnPath });
      bindingMapBtoA.set(keyB, { keyA, path: fnPath });
      stats.scopesCompared++;
      enqueue(boundA.value, boundB.value, varPath);
    }

    return null;
  }

  // Step 2: Iterative BFS over queued value pairs
  while (qHead < queue.length) {
    const { a, b, path } = queue[qHead++];

    if (a === TDZ_SENTINEL || b === TDZ_SENTINEL) {
      if (a !== b) {
        return { ok: false, firstDiff: makeDiff(path, "tdz", a, b, "TDZ uninitialized state differs"), stats };
      }
      continue;
    }

    const typeA = typeof a;
    const typeB = typeof b;
    if (typeA !== typeB) {
      return { ok: false, firstDiff: makeDiff(path, "typeof", typeA, typeB, "typeof differs"), stats };
    }

    if (a === null || b === null) {
      if (a !== b) {
        return { ok: false, firstDiff: makeDiff(path, "primitive-value", a, b), stats };
      }
      stats.primitivesCompared++;
      continue;
    }

    if (typeA !== "object" && typeA !== "function") {
      stats.primitivesCompared++;
      if (typeA === "symbol") {
        const symDiff = compareSymbols(a, b, path);
        if (symDiff) return { ok: false, firstDiff: symDiff, stats };
        continue;
      }
      if (!Object.is(a, b)) {
        return { ok: false, firstDiff: makeDiff(path, "primitive-value", a, b), stats };
      }
      continue;
    }

    // Check baseline intrinsics first
    const intrA = envA.intrinsicToPath.get(a);
    const intrB = envB.intrinsicToPath.get(b);
    if (intrA !== undefined || intrB !== undefined) {
      if (intrA !== intrB) {
        return {
          ok: false,
          firstDiff: makeDiff(
            path,
            "intrinsic",
            intrA || formatShortValue(a),
            intrB || formatShortValue(b),
            "intrinsic reference mismatch"
          ),
          stats,
        };
      }
      continue;
    }

    // Object/function bijection check
    if (mapAtoB.has(a)) {
      const prev = mapAtoB.get(a);
      if (prev.objB !== b) {
        return {
          ok: false,
          firstDiff: makeDiff(
            path,
            "object-identity",
            `<same object as ${prev.path}>`,
            mapBtoA.has(b) ? `<same object as ${mapBtoA.get(b).path}>` : "<distinct object>",
            `lost object identity/sharing with ${prev.path}`
          ),
          stats,
        };
      }
      continue;
    }
    if (mapBtoA.has(b)) {
      const prev = mapBtoA.get(b);
      return {
        ok: false,
        firstDiff: makeDiff(
          path,
          "object-identity",
          "<distinct object>",
          `<same object as ${prev.path}>`,
          `spurious object aliasing with ${prev.path}`
        ),
        stats,
      };
    }

    mapAtoB.set(a, { objB: b, path });
    mapBtoA.set(b, { objA: a, path });
    stats.objectsCompared++;

    const kindA = classifyObject(a);
    const kindB = classifyObject(b);
    if (kindA !== kindB) {
      return {
        ok: false,
        firstDiff: makeDiff(path, "object-kind", kindA, kindB, "object kind/exotic slot differs"),
        stats,
      };
    }

    if (kindA === "Proxy") {
      return {
        ok: false,
        firstDiff: makeDiff(
          path,
          "unsupported-slot",
          "non-Proxy",
          "Proxy",
          "Proxy objects cannot be verified as plain state"
        ),
        stats,
      };
    }

    const integDiff = checkIntegrity(a, b, path);
    if (integDiff) return { ok: false, firstDiff: integDiff, stats };

    // Compare [[Prototype]]
    const protoA = Object.getPrototypeOf(a);
    const protoB = Object.getPrototypeOf(b);
    if (protoA === null || protoB === null) {
      if (protoA !== protoB) {
        return {
          ok: false,
          firstDiff: makeDiff(`${path}.[[Prototype]]`, "prototype", protoA, protoB, "prototype differs"),
          stats,
        };
      }
    } else {
      // Check prototype mismatch eagerly when one is an intrinsic so prototype diffs report `kind: "prototype"`
      const pIntrA = envA.intrinsicToPath.get(protoA);
      const pIntrB = envB.intrinsicToPath.get(protoB);
      if ((pIntrA !== undefined || pIntrB !== undefined) && pIntrA !== pIntrB) {
        return {
          ok: false,
          firstDiff: makeDiff(
            `${path}.[[Prototype]]`,
            "prototype",
            pIntrA || formatShortValue(protoA),
            pIntrB || formatShortValue(protoB),
            "prototype differs"
          ),
          stats,
        };
      }
      enqueue(protoA, protoB, `${path}.[[Prototype]]`);
    }

    let typedArrayFastLen = -1;

    // Exotic internal slots
    if (kindA === "Date") {
      const tA = dateGetTime.call(a);
      const tB = dateGetTime.call(b);
      if (!Object.is(tA, tB)) {
        return {
          ok: false,
          firstDiff: makeDiff(path, "date-time", tA, tB, "Date [[DateValue]] timestamp differs"),
          stats,
        };
      }
    } else if (kindA === "RegExp") {
      const srcA = regExpSource.call(a);
      const srcB = regExpSource.call(b);
      if (srcA !== srcB) {
        return {
          ok: false,
          firstDiff: makeDiff(`${path}.source`, "regexp", srcA, srcB, "RegExp source differs"),
          stats,
        };
      }
      const flgA = regExpFlags.call(a);
      const flgB = regExpFlags.call(b);
      if (flgA !== flgB) {
        return { ok: false, firstDiff: makeDiff(`${path}.flags`, "regexp", flgA, flgB, "RegExp flags differs"), stats };
      }
    } else if (kindA === "NumberObject") {
      const vA = numValueOf.call(a);
      const vB = numValueOf.call(b);
      if (!Object.is(vA, vB)) {
        return { ok: false, firstDiff: makeDiff(`${path} ([[PrimitiveValue]])`, "boxed-primitive", vA, vB), stats };
      }
    } else if (kindA === "StringObject") {
      const vA = strValueOf.call(a);
      const vB = strValueOf.call(b);
      if (vA !== vB) {
        return { ok: false, firstDiff: makeDiff(`${path} ([[PrimitiveValue]])`, "boxed-primitive", vA, vB), stats };
      }
    } else if (kindA === "BooleanObject") {
      const vA = boolValueOf.call(a);
      const vB = boolValueOf.call(b);
      if (vA !== vB) {
        return { ok: false, firstDiff: makeDiff(`${path} ([[PrimitiveValue]])`, "boxed-primitive", vA, vB), stats };
      }
    } else if (kindA === "SymbolObject") {
      const symDiff = compareSymbols(symValueOf.call(a), symValueOf.call(b), `${path} ([[PrimitiveValue]])`);
      if (symDiff) return { ok: false, firstDiff: symDiff, stats };
    } else if (kindA === "BigIntObject") {
      const vA = bigIntValueOf.call(a);
      const vB = bigIntValueOf.call(b);
      if (vA !== vB) {
        return { ok: false, firstDiff: makeDiff(`${path} ([[PrimitiveValue]])`, "boxed-primitive", vA, vB), stats };
      }
    } else if (kindA === "Map") {
      const szA = mapSize.call(a);
      const szB = mapSize.call(b);
      if (szA !== szB) {
        return { ok: false, firstDiff: makeDiff(`${path}.size`, "map-size", szA, szB, "Map size differs"), stats };
      }
      const entA = Array.from(mapEntries.call(a));
      const entB = Array.from(mapEntries.call(b));
      for (let i = 0; i < entA.length; i++) {
        enqueue(entA[i][0], entB[i][0], `${path} (Map key #${i})`);
        enqueue(entA[i][1], entB[i][1], `${path} (Map entry #${i} value)`);
      }
    } else if (kindA === "Set") {
      const szA = setSize.call(a);
      const szB = setSize.call(b);
      if (szA !== szB) {
        return { ok: false, firstDiff: makeDiff(`${path}.size`, "set-size", szA, szB, "Set size differs"), stats };
      }
      const valsA = Array.from(setValues.call(a));
      const valsB = Array.from(setValues.call(b));
      for (let i = 0; i < valsA.length; i++) {
        enqueue(valsA[i], valsB[i], `${path} (Set entry #${i})`);
      }
    } else if (kindA === "ArrayBuffer") {
      const detA = abDetached.call(a);
      const detB = abDetached.call(b);
      if (detA !== detB) {
        return {
          ok: false,
          firstDiff: makeDiff(`${path}.detached`, "arraybuffer", detA, detB, "ArrayBuffer detached state differs"),
          stats,
        };
      }
      if (!detA) {
        const lenA = abByteLength.call(a);
        const lenB = abByteLength.call(b);
        if (lenA !== lenB) {
          return {
            ok: false,
            firstDiff: makeDiff(`${path}.byteLength`, "arraybuffer", lenA, lenB, "ArrayBuffer byteLength differs"),
            stats,
          };
        }
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        if (!bufA.equals(bufB)) {
          const idx = findFirstByteDiff(bufA, bufB);
          return {
            ok: false,
            firstDiff: makeDiff(
              `${path}[byte ${idx}]`,
              "arraybuffer-bytes",
              bufA[idx],
              bufB[idx],
              "ArrayBuffer bytes differ"
            ),
            stats,
          };
        }
      }
    } else if (kindA === "SharedArrayBuffer" && sabByteLength) {
      const lenA = sabByteLength.call(a);
      const lenB = sabByteLength.call(b);
      if (lenA !== lenB) {
        return { ok: false, firstDiff: makeDiff(`${path}.byteLength`, "sharedarraybuffer", lenA, lenB), stats };
      }
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      if (!bufA.equals(bufB)) {
        const idx = findFirstByteDiff(bufA, bufB);
        return {
          ok: false,
          firstDiff: makeDiff(`${path}[byte ${idx}]`, "sharedarraybuffer-bytes", bufA[idx], bufB[idx]),
          stats,
        };
      }
    } else if (kindA === "DataView") {
      const offA = dvByteOffset.call(a);
      const offB = dvByteOffset.call(b);
      if (offA !== offB) {
        return { ok: false, firstDiff: makeDiff(`${path}.byteOffset`, "dataview", offA, offB), stats };
      }
      const blA = dvByteLength.call(a);
      const blB = dvByteLength.call(b);
      if (blA !== blB) {
        return { ok: false, firstDiff: makeDiff(`${path}.byteLength`, "dataview", blA, blB), stats };
      }
      enqueue(dvBuffer.call(a), dvBuffer.call(b), `${path}.buffer`);
    } else if (ArrayBuffer.isView(a)) {
      const lenA = taLength.call(a);
      const lenB = taLength.call(b);
      if (lenA !== lenB) {
        return {
          ok: false,
          firstDiff: makeDiff(`${path}.length`, "typedarray", lenA, lenB, "TypedArray length differs"),
          stats,
        };
      }
      const offA = taByteOffset.call(a);
      const offB = taByteOffset.call(b);
      if (offA !== offB) {
        return {
          ok: false,
          firstDiff: makeDiff(`${path}.byteOffset`, "typedarray", offA, offB, "TypedArray byteOffset differs"),
          stats,
        };
      }
      const blA = taByteLength.call(a);
      const blB = taByteLength.call(b);
      const abA = taBuffer.call(a);
      const abB = taBuffer.call(b);
      // Compare element values via Object.is (handles NaN canonicalization and -0 vs +0)
      for (let i = 0; i < lenA; i++) {
        if (!Object.is(a[i], b[i])) {
          return {
            ok: false,
            firstDiff: makeDiff(`${path}[${i}]`, "typedarray-element", a[i], b[i], "TypedArray element differs"),
            stats,
          };
        }
      }
      if (blA !== blB) {
        return { ok: false, firstDiff: makeDiff(`${path}.byteLength`, "typedarray", blA, blB), stats };
      }
      enqueue(abA, abB, `${path}.buffer`);
      typedArrayFastLen = lenA;
    } else if (kindA === "Promise") {
      const pA = envA.readPromiseDetails(a);
      const pB = envB.readPromiseDetails(b);
      if (pA.state !== pB.state) {
        return {
          ok: false,
          firstDiff: makeDiff(
            `${path} ([[PromiseState]])`,
            "promise-state",
            pA.state,
            pB.state,
            "Promise state differs"
          ),
          stats,
        };
      }
      if (pA.state === "pending" && opts.rejectPendingPromises !== false) {
        return {
          ok: false,
          firstDiff: makeDiff(
            `${path} ([[PromiseState]])`,
            "pending-promise",
            "settled",
            "pending",
            "pending Promise is not reproducible"
          ),
          stats,
        };
      }
      if (pA.state !== "pending") {
        enqueue(pA.result, pB.result, `${path} ([[PromiseResult]])`);
      }
    } else if (kindA === "Function") {
      stats.functionsCompared++;
      const fnA = envA.readFunctionDetails(a);
      const fnB = envB.readFunctionDetails(b);
      if (fnA.kind !== fnB.kind) {
        return {
          ok: false,
          firstDiff: makeDiff(path, "function-kind", fnA.kind, fnB.kind, "function kind differs"),
          stats,
        };
      }
      if (fnA.isBound) {
        if (fnA.boundArgs.length !== fnB.boundArgs.length) {
          return {
            ok: false,
            firstDiff: makeDiff(
              `${path} ([[BoundArgs]].length)`,
              "bound-function",
              fnA.boundArgs.length,
              fnB.boundArgs.length
            ),
            stats,
          };
        }
        enqueue(fnA.target, fnB.target, `${path} ([[TargetFunction]])`);
        enqueue(fnA.boundThis, fnB.boundThis, `${path} ([[BoundThis]])`);
        for (let i = 0; i < fnA.boundArgs.length; i++) {
          enqueue(fnA.boundArgs[i], fnB.boundArgs[i], `${path} ([[BoundArgs]][${i}])`);
        }
      } else if (!fnA.isNative) {
        if (fnA.strict !== fnB.strict) {
          return {
            ok: false,
            firstDiff: makeDiff(
              path,
              "function-strictness",
              fnA.strict ? "strict" : "sloppy",
              fnB.strict ? "strict" : "sloppy",
              "function strict mode differs"
            ),
            stats,
          };
        }
        if (fnA.source !== fnB.source) {
          return {
            ok: false,
            firstDiff: makeDiff(path, "function-source", fnA.source, fnB.source, "function source text differs"),
            stats,
          };
        }
        const scopeDiff = compareFunctionScopes(a, b, fnA, fnB, path);
        if (scopeDiff) return { ok: false, firstDiff: scopeDiff, stats };
      }
    }

    const ownDiff = compareOwnProperties(a, b, path, typedArrayFastLen, kindA === "Error", kindA === "Promise");
    if (ownDiff) return { ok: false, firstDiff: ownDiff, stats };
  }

  return { ok: true, firstDiff: null, stats };
}

function findFirstByteDiff(bufA, bufB) {
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i++) {
    if (bufA[i] !== bufB[i]) return i;
  }
  return len;
}

function installBakedVolatileReplay(env, bakedVolatiles) {
  if (!Array.isArray(bakedVolatiles) || bakedVolatiles.length === 0) return null;
  const queues = {};
  for (const item of bakedVolatiles) {
    if (!item || !item.api) continue;
    if (!queues[item.api]) queues[item.api] = [];
    queues[item.api].push(item.value);
  }
  const registered = [];
  function registerReplayIntrinsic(fnOrObj, pathStr) {
    if (fnOrObj && !env.intrinsicToPath.has(fnOrObj)) {
      env.intrinsicToPath.set(fnOrObj, pathStr);
      registered.push(fnOrObj);
    }
  }
  const restoreFn = vm.runInContext(
    `(function(queues, regIntr) {
      var Obj = Object;
      var g = globalThis;
      var restores = [];
      function popVal(api, fallbackFn) {
        var q = queues[api];
        if (q && q.length > 0) return q.shift();
        return fallbackFn();
      }
      if (queues["Math.random"]) {
        var origRandDesc = Obj.getOwnPropertyDescriptor(Math, "random");
        var origRand = Math.random;
        var replayRand = function random() { return popVal("Math.random", function() { return origRand.call(Math); }); };
        regIntr(replayRand, "Math.random");
        Obj.defineProperty(Math, "random", {
          value: replayRand,
          writable: true, enumerable: false, configurable: true
        });
        restores.push(function() {
          if (Obj.getOwnPropertyDescriptor(Math, "random").value === replayRand && origRandDesc) {
            Obj.defineProperty(Math, "random", origRandDesc);
          }
        });
      }
      if (queues["Date.now"] || queues["new Date()"] || queues["Date()"]) {
        var OrigDate = Date;
        var origDateDesc = Obj.getOwnPropertyDescriptor(g, "Date");
        var origDateNowDesc = Obj.getOwnPropertyDescriptor(OrigDate, "now");
        var origDateProtoCtorDesc = Obj.getOwnPropertyDescriptor(OrigDate.prototype, "constructor");
        if (queues["Date.now"]) {
          var origNow = OrigDate.now;
          var replayNow = function now() { return popVal("Date.now", function() { return origNow.call(OrigDate); }); };
          regIntr(replayNow, "Date.now");
          Obj.defineProperty(OrigDate, "now", {
            value: replayNow,
            writable: true, enumerable: false, configurable: true
          });
          restores.push(function() {
            if (Obj.getOwnPropertyDescriptor(OrigDate, "now").value === replayNow && origDateNowDesc) {
              Obj.defineProperty(OrigDate, "now", origDateNowDesc);
            }
          });
        }
        if (queues["new Date()"] || queues["Date()"]) {
          var ReplayDate = new Proxy(OrigDate, {
            construct(target, args, newTarget) {
              if (args.length === 0 && queues["new Date()"]) {
                var ms = popVal("new Date()", function() { return OrigDate.now(); });
                return Reflect.construct(target, [ms], newTarget === ReplayDate ? target : newTarget);
              }
              return Reflect.construct(target, args, newTarget === ReplayDate ? target : newTarget);
            },
            apply(target, thisArg, args) {
              if (queues["Date()"]) {
                return popVal("Date()", function() { return Reflect.apply(target, thisArg, args); });
              }
              return Reflect.apply(target, thisArg, args);
            }
          });
          regIntr(ReplayDate, "Date");
          Obj.defineProperty(g, "Date", { value: ReplayDate, writable: true, enumerable: false, configurable: true });
          Obj.defineProperty(OrigDate.prototype, "constructor", { value: ReplayDate, writable: true, enumerable: false, configurable: true });
          restores.push(function() {
            if (Obj.getOwnPropertyDescriptor(g, "Date").value === ReplayDate && origDateDesc) {
              Obj.defineProperty(g, "Date", origDateDesc);
            }
            if (Obj.getOwnPropertyDescriptor(OrigDate.prototype, "constructor").value === ReplayDate && origDateProtoCtorDesc) {
              Obj.defineProperty(OrigDate.prototype, "constructor", origDateProtoCtorDesc);
            }
          });
        }
      }
      if (queues["Error.stack"]) {
        var origPstDesc = Obj.getOwnPropertyDescriptor(Error, "prepareStackTrace");
        var replayPst = function(err, frames) {
          return popVal("Error.stack", function() {
            var t = Error.prototype.toString.call(err);
            for (var i = 0; i < frames.length; i++) t += "\\n    at " + frames[i];
            return t;
          });
        };
        Obj.defineProperty(Error, "prepareStackTrace", { value: replayPst, writable: true, enumerable: false, configurable: true });
        restores.push(function() {
          if (origPstDesc) Obj.defineProperty(Error, "prepareStackTrace", origPstDesc);
          else delete Error.prepareStackTrace;
        });
      }
      if (queues["performance.now"] && typeof performance === "object" && performance !== null) {
        var origPerfNow = performance.now;
        var replayPerfNow = function now() { return popVal("performance.now", function() { return 0; }); };
        regIntr(replayPerfNow, "performance.now");
        performance.now = replayPerfNow;
        restores.push(function() {
          if (performance.now === replayPerfNow) performance.now = origPerfNow;
        });
      }
      return function restoreReplay() {
        for (var i = restores.length - 1; i >= 0; i--) restores[i]();
      };
    })`,
    env.ctx
  )(queues, registerReplayIntrinsic);
  return restoreFn;
}

// Primary oracle interface:
// verify(originalSrc, outputSrc, opts) -> { ok, firstDiff, stats }
function verify(originalSrc, outputSrc, opts = {}) {
  const t0 = Date.now();
  const hadPrevTz = Object.prototype.hasOwnProperty.call(process.env, "TZ");
  const prevTz = process.env.TZ;
  if (opts.tz) {
    process.env.TZ = String(opts.tz);
  }
  const controller = createInspectorController();
  try {
    const envA = controller.createEnv("original", opts);
    const envB = controller.createEnv("output", opts);

    if (typeof opts.guardCondition === "string" && opts.guardCondition.length > 0) {
      let guardPassed = false;
      try {
        guardPassed = Boolean(envB.runScript(`Boolean(${opts.guardCondition})`, "guard-check.js", 5000));
      } catch (ge) {
        return {
          ok: false,
          firstDiff: makeDiff("<guard>", "guard-error", "true", String(ge), "runtime guard threw during verification"),
          stats: {
            rootsCompared: 0,
            intrinsicPatchesCompared: 0,
            objectsCompared: 0,
            functionsCompared: 0,
            scopesCompared: 0,
            primitivesCompared: 0,
            smokeChecked: false,
            mutationProbesRun: 0,
            durationMs: Date.now() - t0,
          },
        };
      }
      if (!guardPassed) {
        return {
          ok: false,
          firstDiff: makeDiff(
            "<guard>",
            "guard-fallback",
            "true",
            "false",
            `runtime guard evaluated to false (${opts.guardCondition}); verification must exercise rebuilt heap, not fallback`
          ),
          stats: {
            rootsCompared: 0,
            intrinsicPatchesCompared: 0,
            objectsCompared: 0,
            functionsCompared: 0,
            scopesCompared: 0,
            primitivesCompared: 0,
            smokeChecked: false,
            mutationProbesRun: 0,
            durationMs: Date.now() - t0,
          },
        };
      }
    }

    let errA = null;
    let errB = null;
    const restoreReplay = installBakedVolatileReplay(envA, opts.bakedVolatiles);
    try {
      envA.runScript(originalSrc, opts.originalFilename || "original.js", opts.timeout || 30000);
    } catch (e) {
      errA = e;
    } finally {
      if (restoreReplay) restoreReplay();
    }
    try {
      envB.runScript(outputSrc, opts.outputFilename || "output.js", opts.timeout || 30000);
    } catch (e) {
      errB = e;
    }

    if (errA || errB) {
      const msgA = errA ? `${errA.name || "Error"}: ${errA.message || errA}` : "<completed normally>";
      const msgB = errB ? `${errB.name || "Error"}: ${errB.message || errB}` : "<completed normally>";
      return {
        ok: false,
        firstDiff: makeDiff("<init>", "runtime-exception", msgA, msgB, "script initialization threw"),
        stats: {
          rootsCompared: 0,
          intrinsicPatchesCompared: 0,
          objectsCompared: 0,
          functionsCompared: 0,
          scopesCompared: 0,
          primitivesCompared: 0,
          smokeChecked: false,
          mutationProbesRun: 0,
          durationMs: Date.now() - t0,
        },
      };
    }

    const iso = compareEnvironments(controller, envA, envB, opts);
    const stats = Object.assign({}, iso.stats, {
      smokeChecked: false,
      mutationProbesRun: 0,
      durationMs: Date.now() - t0,
    });

    if (!iso.ok) {
      return { ok: false, firstDiff: iso.firstDiff, stats };
    }

    // Optional behavioral checks if requested in `opts`
    if (opts.smokeCode || opts.specId) {
      const { runSmokeComparison } = require("./behavioral");
      const smokeRes = runSmokeComparison(originalSrc, outputSrc, opts);
      stats.smokeChecked = true;
      stats.durationMs = Date.now() - t0;
      if (!smokeRes.ok) {
        return { ok: false, firstDiff: smokeRes.firstDiff, stats };
      }
    }

    if (opts.mutationProbe || opts.probes) {
      const { runMutationProbeOnEnvs } = require("./behavioral");
      const probeRes = runMutationProbeOnEnvs(controller, envA, envB, opts);
      stats.mutationProbesRun = probeRes.callsRun;
      stats.durationMs = Date.now() - t0;
      if (!probeRes.ok) {
        return { ok: false, firstDiff: probeRes.firstDiff, stats };
      }
    }

    stats.durationMs = Date.now() - t0;
    return { ok: true, firstDiff: null, stats };
  } finally {
    controller.close();
    if (opts.tz) {
      if (hadPrevTz) process.env.TZ = prevTz;
      else delete process.env.TZ;
    }
  }
}

function verifySmoke(originalSrc, outputSrc, opts = {}) {
  return require("./behavioral").runSmokeComparison(originalSrc, outputSrc, opts);
}

function verifyMutationProbe(originalSrc, outputSrc, opts = {}) {
  return require("./behavioral").runMutationProbe(originalSrc, outputSrc, opts);
}

module.exports = {
  verify,
  verifySmoke,
  verifyMutationProbe,
  makeDiff,
  formatPropPath,
  formatShortValue,
  createInspectorController,
  compareEnvironments,
};
