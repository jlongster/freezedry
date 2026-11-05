"use strict";

const vm = require("vm");
const nodeCrypto = require("crypto");

const { ES_GLOBALS, PROFILES, resolveProfile } = require("./env-profiles.js");
const {
  isValidIdentifier,
  escapeScriptSafeJsonString,
  formatGlobalAccess,
  formatTypeofGlobal,
  formatPropertyAccess,
  emitGuard,
  measureGuardOverhead,
} = require("./guard.js");

const INTERNAL_SETUP_FILENAME = "[hybrid-env-setup]";

class EnvironmentBailoutError extends Error {
  constructor(reason, where, kind, name) {
    super(where ? `${reason} (${where})` : reason);
    this.name = "EnvironmentBailoutError";
    this.isEnvironmentBailout = true;
    this.bailout = {
      reason,
      where: where || "",
      kind: kind || "env",
      name: name || "",
    };
  }
}

// ISO-8601 date-only ("2026", "2026-03", "2026-03-15") -> UTC per ES2015+
const ISO_DATE_ONLY_RE = /^(?:[+-]\d{6}|\d{4})(?:-\d{2}(?:-\d{2})?)?$/;

// ISO-8601 date-time with explicit Z or +-HH:MM / +-HHMM offset -> UTC per ES2015+
const ISO_DATETIME_WITH_TZ_RE = /^(?:[+-]\d{6}|\d{4})(?:-\d{2}(?:-\d{2})?)?[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:?\d{2})$/;

// Explicit GMT/UTC suffix in RFC-2822/UTC strings
const EXPLICIT_UTC_SUFFIX_RE = /\b(?:GMT|UTC)\s*$/i;

function isTimezoneDependentDateString(str) {
  const trimmed = String(str).trim();
  if (trimmed.length === 0) return false;
  if (ISO_DATE_ONLY_RE.test(trimmed)) return false;
  if (ISO_DATETIME_WITH_TZ_RE.test(trimmed)) return false;
  if (EXPLICIT_UTC_SUFFIX_RE.test(trimmed)) return false;
  return true;
}

function captureCallSite() {
  const prevPrepare = Error.prepareStackTrace;
  let frames = null;
  try {
    Error.prepareStackTrace = function(_, structuredStack) {
      return structuredStack;
    };
    const holder = {};
    Error.captureStackTrace(holder, captureCallSite);
    frames = holder.stack;
  } finally {
    Error.prepareStackTrace = prevPrepare;
  }

  if (!Array.isArray(frames)) return "";

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const file = (typeof f.getFileName === "function" && f.getFileName()) || "";
    if (
      file === INTERNAL_SETUP_FILENAME ||
      file === __filename ||
      file.startsWith("node:") ||
      file.startsWith("internal/")
    ) {
      continue;
    }
    const line = typeof f.getLineNumber === "function" ? f.getLineNumber() : null;
    const col = typeof f.getColumnNumber === "function" ? f.getColumnNumber() : null;
    const label = file || "<anonymous>";
    if (line != null && col != null) return `${label}:${line}:${col}`;
    if (line != null) return `${label}:${line}`;
    return label;
  }
  return "";
}

function parseAssumeValue(raw) {
  if (raw === "undefined") return undefined;
  if (raw === "NaN") return NaN;
  if (raw === "Infinity") return Infinity;
  if (raw === "-Infinity") return -Infinity;
  if (raw === "-0") return -0;
  return JSON.parse(raw);
}

function parseAssumeEntry(spec) {
  if (typeof spec !== "string") {
    throw new TypeError(`Invalid --assume entry: expected "NAME=JSON" string, got ${typeof spec}`);
  }
  const eq = spec.indexOf("=");
  if (eq <= 0) {
    throw new Error(`Invalid --assume "${spec}": expected NAME=JSON`);
  }
  const key = spec.slice(0, eq).trim();
  const rawVal = spec.slice(eq + 1).trim();
  if (key === "seed" || key === "--seed" || key === "mathRandomSeed") {
    rejectRandomSeed();
  }
  return { key, value: parseAssumeValue(rawVal) };
}

function rejectRandomSeed() {
  throw new Error(
    "Seeding Math.random (--seed / mathRandomSeed) is not allowed: random values must not be baked in silently. " +
      "Use --allow-volatile=Math.random to explicitly bake and document random values."
  );
}

function parseEnvFlags(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let profile = "ecmascript";
  const assumptions = {};
  let tz = null;
  const allowVolatile = [];
  let fallback = "eval";
  let externalPath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg === "--seed" ||
      arg.startsWith("--seed=") ||
      arg === "--mathRandomSeed" ||
      arg.startsWith("--mathRandomSeed=")
    ) {
      rejectRandomSeed();
    }
    if (arg === "--profile" && i + 1 < args.length) {
      profile = args[++i];
    } else if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
    } else if (arg === "--assume" && i + 1 < args.length) {
      const parsed = parseAssumeEntry(args[++i]);
      assumptions[parsed.key] = parsed.value;
    } else if (arg.startsWith("--assume=")) {
      const parsed = parseAssumeEntry(arg.slice("--assume=".length));
      assumptions[parsed.key] = parsed.value;
    } else if (arg === "--assume-tz" && i + 1 < args.length) {
      tz = args[++i];
    } else if (arg.startsWith("--assume-tz=")) {
      tz = arg.slice("--assume-tz=".length);
    } else if (arg === "--allow-volatile" && i + 1 < args.length) {
      allowVolatile.push(...splitCsv(args[++i]));
    } else if (arg.startsWith("--allow-volatile=")) {
      allowVolatile.push(...splitCsv(arg.slice("--allow-volatile=".length)));
    } else if (arg === "--fallback" && i + 1 < args.length) {
      fallback = args[++i];
    } else if (arg.startsWith("--fallback=")) {
      fallback = arg.slice("--fallback=".length);
    } else if (arg === "--fallback-file" && i + 1 < args.length) {
      externalPath = args[++i];
    } else if (arg.startsWith("--fallback-file=")) {
      externalPath = arg.slice("--fallback-file=".length);
    }
  }

  return {
    profile,
    assumptions,
    opts: {
      tz,
      allowVolatile,
      fallback,
      externalPath,
    },
  };
}

function splitCsv(str) {
  return String(str)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeAllowVolatile(raw) {
  const set = new Set();
  if (!raw) return set;
  if (typeof raw === "string") {
    for (const item of splitCsv(raw)) set.add(item);
    return set;
  }
  if (raw instanceof Set || Array.isArray(raw)) {
    for (const item of raw) {
      for (const part of splitCsv(item)) set.add(part);
    }
    return set;
  }
  throw new TypeError("allowVolatile must be a string, Array, or Set");
}

function isVolatileAllowed(allowSet, apiName) {
  if (allowSet.has("*")) return true;
  if (allowSet.has(apiName)) return true;
  if (apiName === "new Date" && allowSet.has("Date")) return true;
  if (apiName === "Date.now" && allowSet.has("Date")) return true;
  if (apiName === "Date()" && allowSet.has("Date")) return true;
  if (apiName === "performance.now" && allowSet.has("performance")) return true;
  if ((apiName === "crypto.getRandomValues" || apiName === "crypto.randomUUID") && allowSet.has("crypto")) {
    return true;
  }
  if (apiName.startsWith("Intl.") && (allowSet.has("Intl") || allowSet.has("locale"))) return true;
  if (apiName.startsWith("locale:") && (allowSet.has("Intl") || allowSet.has("locale"))) return true;
  if (apiName.startsWith("console.") && allowSet.has("console")) return true;
  return false;
}

function normalizeAssumptionsAndOpts(rawAssumptions, rawOpts, profileSpec) {
  const opts = Object.assign({}, rawOpts || null);
  const flatEntries = [];

  if (opts.seed !== undefined || opts.mathRandomSeed !== undefined) {
    rejectRandomSeed();
  }

  if (Array.isArray(rawAssumptions)) {
    for (let i = 0; i < rawAssumptions.length; i++) {
      flatEntries.push(parseAssumeEntry(rawAssumptions[i]));
    }
  } else if (rawAssumptions && typeof rawAssumptions === "object") {
    const keys = Object.keys(rawAssumptions);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = rawAssumptions[k];
      if (k === "seed" || k === "--seed" || k === "mathRandomSeed") {
        rejectRandomSeed();
      }
      if (k === "$tz" || k === "--assume-tz") {
        if (opts.tz === undefined) opts.tz = v;
        continue;
      }
      if (k === "$allowVolatile" || k === "--allow-volatile") {
        if (opts.allowVolatile === undefined) opts.allowVolatile = v;
        continue;
      }
      if (k === "$intrinsicsMap") {
        if (opts.intrinsicsMap === undefined) opts.intrinsicsMap = v;
        continue;
      }
      if (k === "$throwOnBailout") {
        if (opts.throwOnBailout === undefined) opts.throwOnBailout = v;
        continue;
      }
      flatEntries.push({ key: k, value: v });
    }
  }

  const tz = opts.tz || opts.assumeTz || opts.timezone || null;
  const allowVolatile = normalizeAllowVolatile(opts.allowVolatile);
  const intrinsicsMap = opts.intrinsicsMap || null;
  const throwOnBailout = opts.throwOnBailout !== false;

  // Build assertion tree:
  // Nodes:
  //   { mode: "typeof", typeofStr: "object"|"function"|"undefined"|... }
  //   { mode: "value", value: <primitive|plainObj|array>, closedJson: boolean }
  //   { mode: "partial", children: Map<string, Node> }
  const rootMap = new Map();
  const aliasSet = new Set(profileSpec.aliases || []);

  for (let i = 0; i < flatEntries.length; i++) {
    let rawKey = flatEntries[i].key.trim();
    const val = flatEntries[i].value;

    let isTypeofOnly = false;
    if (rawKey.startsWith("typeof:")) {
      isTypeofOnly = true;
      rawKey = rawKey.slice("typeof:".length).trim();
    } else if (rawKey.startsWith("typeof ")) {
      isTypeofOnly = true;
      rawKey = rawKey.slice("typeof ".length).trim();
    }

    const segments = splitPathSegments(rawKey);
    // Normalize `globalThis.X` or `<alias>.X` (e.g. `window.DEBUG` in browser profile)
    // so `window === globalThis` stays preserved while `window.DEBUG` and `DEBUG` both work.
    if (segments.length >= 2 && (segments[0] === "globalThis" || aliasSet.has(segments[0]))) {
      segments.shift();
    }

    insertAssertionNode(rootMap, segments, 0, isTypeofOnly, val, profileSpec);
  }

  return {
    tz,
    allowVolatile,
    intrinsicsMap,
    throwOnBailout,
    assertionMap: rootMap,
  };
}

function splitPathSegments(rawKey) {
  // If key contains dots and every segment is a valid property token, split on dots;
  // otherwise treat as a single global property name (e.g. "__core-js_shared__").
  if (!rawKey.includes(".")) return [rawKey];
  return rawKey.split(".");
}

function insertAssertionNode(map, segments, idx, isTypeofOnly, val, profileSpec) {
  const seg = segments[idx];
  const isLeaf = idx === segments.length - 1;

  if (isLeaf) {
    if (isTypeofOnly) {
      map.set(seg, { mode: "typeof", typeofStr: String(val) });
      return;
    }
    if (val !== null && typeof val === "object") {
      // If seg is a top-level known host object in the profile (like `process`, `document`, `navigator`),
      // treat object keys as partial assertions so unmentioned host properties still bail out!
      const isKnownHostObj = idx === 0 && Boolean(profileSpec.globals && profileSpec.globals[seg]);
      if (isKnownHostObj && !Array.isArray(val)) {
        let partial = map.get(seg);
        if (!partial || partial.mode !== "partial") {
          partial = { mode: "partial", children: new Map() };
          map.set(seg, partial);
        }
        for (const childKey of Object.keys(val)) {
          insertAssertionNode(partial.children, [childKey], 0, false, val[childKey], profileSpec);
        }
        return;
      }
      map.set(seg, { mode: "jsonValue", value: val });
      return;
    }
    map.set(seg, { mode: "primitive", value: val });
    return;
  }

  let existing = map.get(seg);
  if (!existing || existing.mode !== "partial") {
    existing = { mode: "partial", children: new Map() };
    map.set(seg, existing);
  }
  insertAssertionNode(existing.children, segments, idx + 1, isTypeofOnly, val, profileSpec);
}

function registerInIntrinsicsMap(intrinsicsMap, obj, canonicalPath) {
  if (!intrinsicsMap || (typeof obj !== "object" && typeof obj !== "function") || obj === null) {
    return;
  }
  if (intrinsicsMap instanceof WeakMap) {
    intrinsicsMap.set(obj, canonicalPath);
    return;
  }
  if (intrinsicsMap instanceof Map) {
    if (intrinsicsMap.size > 0) {
      const firstKey = intrinsicsMap.keys().next().value;
      if (typeof firstKey === "string") {
        intrinsicsMap.set(canonicalPath, obj);
        return;
      }
    }
    intrinsicsMap.set(obj, canonicalPath);
  }
}

// Executed INSIDE the target vm.Context so every object, function, Proxy, and Error
// belongs to `ctx`'s own realm (zero cross-realm prototype leaks).
function setupHybridEnvironment(bridge) {
  "use strict";

  const g = globalThis;
  const Obj = Object;
  const objProto = Obj.prototype;
  const fnProto = Function.prototype;
  const Sym = Symbol;
  const OrigDate = Date;
  const OrigMath = Math;
  const OrigIntl = typeof Intl === "object" && Intl !== null ? Intl : null;
  const OrigPromise = Promise;
  const OrigError = Error;
  const OrigTypeError = TypeError;
  const OrigReflect = Reflect;
  const OrigProxy = Proxy;
  const OrigJSON = JSON;
  const OrigWeakMap = WeakMap;
  const OrigMap = Map;
  const OrigSet = Set;
  const OrigArray = Array;
  const OrigNumber = Number;
  const OrigString = String;
  const OrigBigInt = typeof BigInt === "function" ? BigInt : null;
  const OrigUint8Array = Uint8Array;

  const gProto = Obj.getPrototypeOf(g);
  const origGProtoParent = Obj.getPrototypeOf(gProto);

  const nativeSourceMap = new OrigWeakMap();
  const origFnToString = fnProto.toString;

  const wrappedFnToString = function toString() {
    if ((typeof this === "function" || (typeof this === "object" && this !== null)) && nativeSourceMap.has(this)) {
      return nativeSourceMap.get(this);
    }
    return origFnToString.call(this);
  };
  nativeSourceMap.set(wrappedFnToString, origFnToString.call(origFnToString));
  Obj.defineProperty(fnProto, "toString", {
    value: wrappedFnToString,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  bridge.registerIntrinsic(wrappedFnToString, "Function.prototype.toString");

  function setFnMeta(fn, name, length, nativeStr) {
    try {
      Obj.defineProperty(fn, "name", { value: name, writable: false, enumerable: false, configurable: true });
      Obj.defineProperty(fn, "length", { value: length, writable: false, enumerable: false, configurable: true });
    } catch (_e) {}
    nativeSourceMap.set(fn, nativeStr || "function " + name + "() { [native code] }");
    return fn;
  }

  function triggerBailout(reason, kind, name) {
    const entry = bridge.recordBailout(reason, kind, name);
    if (bridge.throwOnBailout) {
      const err = new OrigError(entry.where ? reason + " (" + entry.where + ")" : reason);
      err.name = "EnvironmentBailoutError";
      err.isEnvironmentBailout = true;
      err.bailout = entry;
      throw err;
    }
  }

  function handleTimezoneOp(opName) {
    if (bridge.tz) {
      bridge.recordTimezoneAssumption(opName);
      return;
    }
    triggerBailout(
      'timezone-dependent API "' + opName + '" called during initialization; pass --assume-tz=UTC to pin timezone',
      "volatile",
      opName
    );
  }

  const restoreTasks = [];
  let restored = false;

  function patchMethod(holder, prop, canonicalPath, makeReplacement) {
    if (!holder) return;
    const desc = Obj.getOwnPropertyDescriptor(holder, prop);
    if (!desc || typeof desc.value !== "function") return;
    const origFn = desc.value;
    const nativeStr = origFnToString.call(origFn);
    const wrapped = makeReplacement(origFn);
    setFnMeta(wrapped, origFn.name || String(prop), origFn.length, nativeStr);
    Obj.defineProperty(holder, prop, {
      value: wrapped,
      writable: desc.writable,
      enumerable: desc.enumerable,
      configurable: desc.configurable,
    });
    bridge.registerIntrinsic(wrapped, canonicalPath);
    restoreTasks.push(function() {
      const cur = Obj.getOwnPropertyDescriptor(holder, prop);
      if (cur && cur.value === wrapped) {
        Obj.defineProperty(holder, prop, desc);
      }
    });
  }

  // 1. Wrap Math.random
  patchMethod(OrigMath, "random", "Math.random", function(origRandom) {
    return function random() {
      if (bridge.isVolatileAllowed("Math.random")) {
        const val = origRandom.call(OrigMath);
        bridge.recordBakedVolatile("Math.random", val);
        return val;
      }
      triggerBailout(
        'volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it',
        "volatile",
        "Math.random"
      );
      return NaN;
    };
  });

  // 2. Wrap Date.now & Date.parse & Date.prototype local-time / locale methods + Date constructor Proxy
  patchMethod(OrigDate, "now", "Date.now", function(origNow) {
    return function now() {
      if (bridge.isVolatileAllowed("Date.now")) {
        const val = origNow.call(OrigDate);
        bridge.recordBakedVolatile("Date.now", val);
        return val;
      }
      triggerBailout('volatile API "Date.now()" called during initialization', "volatile", "Date.now");
      return NaN;
    };
  });

  patchMethod(OrigDate, "parse", "Date.parse", function(origParse) {
    return function parse(dateString) {
      const str = String(dateString);
      if (bridge.isTimezoneDependentDateString(str)) {
        handleTimezoneOp("Date.parse");
      }
      return origParse.call(OrigDate, str);
    };
  });

  const dateLocalMethods = [
    "getFullYear",
    "getYear",
    "getMonth",
    "getDate",
    "getDay",
    "getHours",
    "getMinutes",
    "getSeconds",
    "getMilliseconds",
    "getTimezoneOffset",
    "setFullYear",
    "setYear",
    "setMonth",
    "setDate",
    "setHours",
    "setMinutes",
    "setSeconds",
    "setMilliseconds",
    "toString",
    "toDateString",
    "toTimeString",
  ];

  for (let i = 0; i < dateLocalMethods.length; i++) {
    const m = dateLocalMethods[i];
    patchMethod(OrigDate.prototype, m, "Date.prototype." + m, function(origMethod) {
      return function() {
        handleTimezoneOp("Date.prototype." + m);
        return origMethod.apply(this, arguments);
      };
    });
  }

  const dateLocaleMethods = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"];
  for (let i = 0; i < dateLocaleMethods.length; i++) {
    const m = dateLocaleMethods[i];
    patchMethod(OrigDate.prototype, m, "Date.prototype." + m, function(origMethod) {
      return function() {
        const api = "locale:Date.prototype." + m;
        if (bridge.isVolatileAllowed(api)) {
          const out = origMethod.apply(this, arguments);
          bridge.recordBakedVolatile("Date.prototype." + m, out);
          return out;
        }
        triggerBailout(
          'locale-dependent API "Date.prototype.' + m + '()" called during initialization',
          "volatile",
          "Date.prototype." + m
        );
      };
    });
  }

  const origDateDesc = Obj.getOwnPropertyDescriptor(g, "Date");
  const origDateProtoCtorDesc = Obj.getOwnPropertyDescriptor(OrigDate.prototype, "constructor");
  const DateProxy = new OrigProxy(OrigDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) {
        if (bridge.isVolatileAllowed("new Date")) {
          const inst = OrigReflect.construct(target, args, newTarget === DateProxy ? target : newTarget);
          bridge.recordBakedVolatile("new Date()", inst.getTime());
          return inst;
        }
        triggerBailout(
          'volatile API "new Date()" without arguments called during initialization',
          "volatile",
          "new Date()"
        );
      } else if (args.length === 1) {
        let a0 = args[0];
        if (typeof a0 === "object" && a0 !== null && !(a0 instanceof OrigDate)) {
          a0 = Number.isNaN ? a0.valueOf() : a0;
          if (typeof a0 === "object" && a0 !== null) a0 = String(a0);
        }
        if (typeof a0 === "string" && bridge.isTimezoneDependentDateString(a0)) {
          handleTimezoneOp("new Date(string)");
        }
      } else {
        handleTimezoneOp("new Date(year, month, ...)");
      }
      return OrigReflect.construct(target, args, newTarget === DateProxy ? target : newTarget);
    },
    apply(target, thisArg, args) {
      if (bridge.isVolatileAllowed("Date()")) {
        handleTimezoneOp("Date()");
        const out = OrigReflect.apply(target, thisArg, args);
        bridge.recordBakedVolatile("Date()", out);
        return out;
      }
      triggerBailout('volatile API "Date()" called during initialization', "volatile", "Date()");
    },
  });
  nativeSourceMap.set(DateProxy, origFnToString.call(OrigDate));
  Obj.defineProperty(g, "Date", {
    value: DateProxy,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  Obj.defineProperty(OrigDate.prototype, "constructor", {
    value: DateProxy,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  bridge.registerIntrinsic(DateProxy, "Date");
  restoreTasks.push(function() {
    const curDate = Obj.getOwnPropertyDescriptor(g, "Date");
    if (curDate && curDate.value === DateProxy && origDateDesc) {
      Obj.defineProperty(g, "Date", origDateDesc);
    }
    const curCtor = Obj.getOwnPropertyDescriptor(OrigDate.prototype, "constructor");
    if (curCtor && curCtor.value === DateProxy && origDateProtoCtorDesc) {
      Obj.defineProperty(OrigDate.prototype, "constructor", origDateProtoCtorDesc);
    }
  });

  // 3. Wrap locale-sensitive methods on Number, BigInt, Array, %TypedArray%, String, and Intl
  patchMethod(OrigNumber.prototype, "toLocaleString", "Number.prototype.toLocaleString", function(orig) {
    return function toLocaleString() {
      if (bridge.isVolatileAllowed("locale:Number.prototype.toLocaleString")) {
        const out = orig.apply(this, arguments);
        bridge.recordBakedVolatile("Number.prototype.toLocaleString", out);
        return out;
      }
      triggerBailout(
        'locale-dependent API "Number.prototype.toLocaleString()" called during initialization',
        "volatile",
        "Number.prototype.toLocaleString"
      );
    };
  });

  if (OrigBigInt) {
    patchMethod(OrigBigInt.prototype, "toLocaleString", "BigInt.prototype.toLocaleString", function(orig) {
      return function toLocaleString() {
        if (bridge.isVolatileAllowed("locale:BigInt.prototype.toLocaleString")) {
          const out = orig.apply(this, arguments);
          bridge.recordBakedVolatile("BigInt.prototype.toLocaleString", out);
          return out;
        }
        triggerBailout(
          'locale-dependent API "BigInt.prototype.toLocaleString()" called during initialization',
          "volatile",
          "BigInt.prototype.toLocaleString"
        );
      };
    });
  }

  patchMethod(OrigArray.prototype, "toLocaleString", "Array.prototype.toLocaleString", function(orig) {
    return function toLocaleString() {
      if (bridge.isVolatileAllowed("locale:Array.prototype.toLocaleString")) {
        const out = orig.apply(this, arguments);
        bridge.recordBakedVolatile("Array.prototype.toLocaleString", out);
        return out;
      }
      triggerBailout(
        'locale-dependent API "Array.prototype.toLocaleString()" called during initialization',
        "volatile",
        "Array.prototype.toLocaleString"
      );
    };
  });

  const TypedArrayProto = Obj.getPrototypeOf(OrigUint8Array.prototype);
  if (TypedArrayProto && TypedArrayProto !== objProto) {
    patchMethod(TypedArrayProto, "toLocaleString", "%TypedArray%.prototype.toLocaleString", function(orig) {
      return function toLocaleString() {
        if (bridge.isVolatileAllowed("locale:TypedArray.prototype.toLocaleString")) {
          const out = orig.apply(this, arguments);
          bridge.recordBakedVolatile("TypedArray.prototype.toLocaleString", out);
          return out;
        }
        triggerBailout(
          'locale-dependent API "TypedArray.prototype.toLocaleString()" called during initialization',
          "volatile",
          "TypedArray.prototype.toLocaleString"
        );
      };
    });
  }

  const stringLocaleMethods = ["localeCompare", "toLocaleLowerCase", "toLocaleUpperCase"];
  for (let i = 0; i < stringLocaleMethods.length; i++) {
    const m = stringLocaleMethods[i];
    patchMethod(OrigString.prototype, m, "String.prototype." + m, function(orig) {
      return function() {
        if (bridge.isVolatileAllowed("locale:String.prototype." + m)) {
          const out = orig.apply(this, arguments);
          bridge.recordBakedVolatile("String.prototype." + m, out);
          return out;
        }
        triggerBailout(
          'locale-dependent API "String.prototype.' + m + '()" called during initialization',
          "volatile",
          "String.prototype." + m
        );
      };
    });
  }

  if (OrigIntl) {
    const intlCtors = [
      "Collator",
      "DateTimeFormat",
      "DisplayNames",
      "DurationFormat",
      "ListFormat",
      "Locale",
      "NumberFormat",
      "PluralRules",
      "RelativeTimeFormat",
      "Segmenter",
    ];
    for (let i = 0; i < intlCtors.length; i++) {
      const name = intlCtors[i];
      const desc = Obj.getOwnPropertyDescriptor(OrigIntl, name);
      if (!desc || typeof desc.value !== "function") continue;
      const OrigCtor = desc.value;
      const origProtoCtorDesc = OrigCtor.prototype
        ? Obj.getOwnPropertyDescriptor(OrigCtor.prototype, "constructor")
        : null;
      const CtorProxy = new OrigProxy(OrigCtor, {
        construct(target, args, newTarget) {
          if (bridge.isVolatileAllowed("Intl." + name)) {
            bridge.recordBakedVolatile("new Intl." + name + "()", args.length > 0 ? String(args[0]) : "default");
            return OrigReflect.construct(target, args, newTarget === CtorProxy ? target : newTarget);
          }
          triggerBailout(
            'locale-dependent API "new Intl.' + name + '()" called during initialization',
            "volatile",
            "Intl." + name
          );
        },
        apply(target, thisArg, args) {
          if (bridge.isVolatileAllowed("Intl." + name)) {
            bridge.recordBakedVolatile("Intl." + name + "()", args.length > 0 ? String(args[0]) : "default");
            return OrigReflect.apply(target, thisArg, args);
          }
          triggerBailout(
            'locale-dependent API "Intl.' + name + '()" called during initialization',
            "volatile",
            "Intl." + name
          );
        },
      });
      nativeSourceMap.set(CtorProxy, origFnToString.call(OrigCtor));
      Obj.defineProperty(OrigIntl, name, {
        value: CtorProxy,
        writable: desc.writable,
        enumerable: desc.enumerable,
        configurable: desc.configurable,
      });
      if (OrigCtor.prototype && origProtoCtorDesc) {
        Obj.defineProperty(OrigCtor.prototype, "constructor", {
          value: CtorProxy,
          writable: origProtoCtorDesc.writable,
          enumerable: origProtoCtorDesc.enumerable,
          configurable: origProtoCtorDesc.configurable,
        });
      }
      bridge.registerIntrinsic(CtorProxy, "Intl." + name);
      restoreTasks.push(function() {
        const cur = Obj.getOwnPropertyDescriptor(OrigIntl, name);
        if (cur && cur.value === CtorProxy) {
          Obj.defineProperty(OrigIntl, name, desc);
        }
        if (OrigCtor.prototype && origProtoCtorDesc) {
          const curP = Obj.getOwnPropertyDescriptor(OrigCtor.prototype, "constructor");
          if (curP && curP.value === CtorProxy) {
            Obj.defineProperty(OrigCtor.prototype, "constructor", origProtoCtorDesc);
          }
        }
      });
    }

    const intlFns = ["getCanonicalLocales", "supportedValuesOf"];
    for (let i = 0; i < intlFns.length; i++) {
      const fnName = intlFns[i];
      patchMethod(OrigIntl, fnName, "Intl." + fnName, function(orig) {
        return function() {
          if (bridge.isVolatileAllowed("Intl." + fnName)) {
            const out = orig.apply(this, arguments);
            bridge.recordBakedVolatile("Intl." + fnName, out);
            return out;
          }
          triggerBailout(
            'locale-dependent API "Intl.' + fnName + '()" called during initialization',
            "volatile",
            "Intl." + fnName
          );
        };
      });
    }
  }

  // 4. Detach host-injected non-ES globals (`console`, `WebAssembly`) from `globalThis` own properties
  // so every access is routed through our profile/assumption interceptor!
  const hostInjectedGlobals = ["console", "WebAssembly"];
  for (let i = 0; i < hostInjectedGlobals.length; i++) {
    const gk = hostInjectedGlobals[i];
    const desc = Obj.getOwnPropertyDescriptor(g, gk);
    if (desc && desc.configurable) {
      delete g[gk];
      restoreTasks.push(function() {
        if (!Obj.prototype.hasOwnProperty.call(g, gk)) {
          Obj.defineProperty(g, gk, desc);
        }
      });
    }
  }

  // 5. Build realm-local stand-in factories for profile globals & user-asserted paths
  const standInCache = new OrigMap();

  function cloneJsonIntoRealm(hostVal) {
    if (hostVal === null || typeof hostVal !== "object") return hostVal;
    return OrigJSON.parse(OrigJSON.stringify(hostVal));
  }

  function makeClosedJsonProxy(exprPath, rawJsonStr, realmObj) {
    return new OrigProxy(realmObj, {
      get(t, prop, receiver) {
        if (prop === Sym.toStringTag) return OrigReflect.get(t, prop, receiver);
        if (OrigArray.isArray(t) && prop === "length") {
          bridge.recordAssumption("json", exprPath, rawJsonStr, exprPath + ".length");
          return t.length;
        }
        if (typeof prop === "symbol" || prop in objProto || (OrigArray.isArray(t) && prop in OrigArray.prototype)) {
          bridge.recordAssumption("json", exprPath, rawJsonStr, exprPath);
          const v = OrigReflect.get(t, prop, t);
          return typeof v === "function" ? v.bind(t) : v;
        }
        const subExpr = bridge.formatPropertyAccess(exprPath, prop);
        if (!Obj.prototype.hasOwnProperty.call(t, prop)) {
          bridge.recordAssumption("value", JSON.stringify(String(prop)) + " in " + exprPath, false, subExpr);
          return undefined;
        }
        const child = t[prop];
        if (child !== null && typeof child === "object") {
          const childJson = OrigJSON.stringify(child);
          bridge.recordAssumption("typeof", "typeof " + subExpr, "object", subExpr);
          bridge.recordAssumption("value", subExpr + " !== null", true, subExpr);
          return makeClosedJsonProxy(subExpr, childJson, child);
        }
        bridge.recordAssumption("value", subExpr, child, subExpr);
        return child;
      },
      has(t, prop) {
        if (typeof prop === "symbol") return OrigReflect.has(t, prop);
        const exists = Obj.prototype.hasOwnProperty.call(t, prop);
        bridge.recordAssumption("value", JSON.stringify(String(prop)) + " in " + exprPath, exists, exprPath);
        return exists;
      },
      ownKeys(t) {
        bridge.recordAssumption("json", exprPath, rawJsonStr, "Object.keys(" + exprPath + ")");
        return OrigReflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, prop) {
        bridge.recordAssumption("json", exprPath, rawJsonStr, exprPath);
        return OrigReflect.getOwnPropertyDescriptor(t, prop);
      },
      set(_t, prop) {
        triggerBailout(
          'cannot mutate assumed environment object "' + exprPath + "." + String(prop) + '" during initialization',
          "env",
          exprPath + "." + String(prop)
        );
        return false;
      },
      defineProperty(_t, prop) {
        triggerBailout(
          'cannot define property on assumed environment object "' +
            exprPath +
            "." +
            String(prop) +
            '" during initialization',
          "env",
          exprPath + "." + String(prop)
        );
        return false;
      },
      deleteProperty(_t, prop) {
        triggerBailout(
          'cannot delete property on assumed environment object "' +
            exprPath +
            "." +
            String(prop) +
            '" during initialization',
          "env",
          exprPath + "." + String(prop)
        );
        return false;
      },
    });
  }

  function makeVolatileLeafFunction(canonicalPath, volatileKind) {
    if (canonicalPath === "queueMicrotask") {
      const qm = function queueMicrotask(callback) {
        if (typeof callback !== "function") {
          throw new OrigTypeError('The "callback" argument must be of type function');
        }
        OrigPromise.resolve().then(function() {
          callback();
        });
      };
      setFnMeta(qm, "queueMicrotask", 1);
      bridge.registerIntrinsic(qm, canonicalPath);
      return qm;
    }

    if (canonicalPath === "performance.now") {
      const pNow = function now() {
        if (bridge.isVolatileAllowed("performance.now")) {
          const val = bridge.hostPerformanceNow();
          bridge.recordBakedVolatile("performance.now", val);
          return val;
        }
        triggerBailout('volatile API "performance.now()" called during initialization', "volatile", "performance.now");
        return NaN;
      };
      setFnMeta(pNow, "now", 0);
      bridge.registerIntrinsic(pNow, canonicalPath);
      return pNow;
    }

    if (canonicalPath === "crypto.getRandomValues") {
      const grv = function getRandomValues(typedArray) {
        if (bridge.isVolatileAllowed("crypto.getRandomValues")) {
          if (!ArrayBuffer.isView(typedArray) || typedArray instanceof DataView) {
            throw new OrigTypeError(
              "Failed to execute 'getRandomValues' on 'Crypto': parameter 1 is not of type 'ArrayBufferView'"
            );
          }
          const bytes = bridge.hostRandomBytes(typedArray.byteLength);
          const view = new OrigUint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
          for (let i = 0; i < bytes.length; i++) view[i] = bytes[i];
          bridge.recordBakedVolatile("crypto.getRandomValues", typedArray.byteLength + " bytes");
          return typedArray;
        }
        triggerBailout(
          'volatile API "crypto.getRandomValues()" called during initialization',
          "volatile",
          "crypto.getRandomValues"
        );
        return typedArray;
      };
      setFnMeta(grv, "getRandomValues", 1);
      bridge.registerIntrinsic(grv, canonicalPath);
      return grv;
    }

    if (canonicalPath === "crypto.randomUUID") {
      const ruuid = function randomUUID() {
        if (bridge.isVolatileAllowed("crypto.randomUUID")) {
          const uuid = bridge.hostRandomUUID();
          bridge.recordBakedVolatile("crypto.randomUUID", uuid);
          return uuid;
        }
        triggerBailout(
          'volatile API "crypto.randomUUID()" called during initialization',
          "volatile",
          "crypto.randomUUID"
        );
        return "";
      };
      setFnMeta(ruuid, "randomUUID", 0);
      bridge.registerIntrinsic(ruuid, canonicalPath);
      return ruuid;
    }

    if (volatileKind === "console") {
      const shortName = canonicalPath.split(".").pop();
      const cfn = function() {
        if (bridge.isVolatileAllowed(canonicalPath)) {
          bridge.recordBakedVolatile(canonicalPath, arguments.length);
          return undefined;
        }
        triggerBailout(
          'volatile I/O "' + canonicalPath + '()" called during initialization',
          "volatile",
          canonicalPath
        );
      };
      setFnMeta(cfn, shortName, 0);
      bridge.registerIntrinsic(cfn, canonicalPath);
      return cfn;
    }

    if (volatileKind === "timer") {
      const shortName = canonicalPath.split(".").pop();
      const tfn = function() {
        triggerBailout(
          'volatile timer API "' + canonicalPath + '()" called during initialization',
          "volatile",
          canonicalPath
        );
      };
      setFnMeta(tfn, shortName, 1);
      bridge.registerIntrinsic(tfn, canonicalPath);
      return tfn;
    }

    return null;
  }

  function getOrCreateStandIn(canonicalPath, exprPath, spec, partialNode) {
    const cacheKey = canonicalPath;
    if (standInCache.has(cacheKey)) return standInCache.get(cacheKey);

    // Check if this is a special volatile leaf function (plain function, non-Proxy!)
    if (!partialNode && spec && spec.type === "function" && (spec.volatile || spec.microtask)) {
      const leafFn = makeVolatileLeafFunction(canonicalPath, spec.volatile || (spec.microtask ? "microtask" : ""));
      if (leafFn) {
        standInCache.set(cacheKey, leafFn);
        return leafFn;
      }
    }

    const expectedType = (spec && spec.type) || "object";
    const target =
      expectedType === "function" ? setFnMeta(function() {}, canonicalPath.split(".").pop() || "anonymous", 0) : {};

    const proxy = new OrigProxy(target, {
      get(t, prop) {
        if (prop === Sym.toStringTag) {
          if (spec && spec.toStringTag) {
            const tagExpr = exprPath + "[Symbol.toStringTag]";
            bridge.recordAssumption("value", tagExpr, spec.toStringTag, tagExpr);
            return spec.toStringTag;
          }
          const label = canonicalPath + "[Symbol.toStringTag]";
          triggerBailout('unknown environment value "' + label + '" read during initialization', "env", label);
          return undefined;
        }

        if (typeof prop === "symbol") {
          const symDesc = prop.description || String(prop);
          const label = canonicalPath + "[" + symDesc + "]";
          triggerBailout(
            'unknown environment symbol property "' + label + '" read during initialization',
            "env",
            label
          );
          return undefined;
        }

        const propKey = String(prop);
        const childCanonical = canonicalPath + "." + propKey;
        const childExpr = bridge.formatPropertyAccess(exprPath, propKey);

        // 1. Check user partial assertion node first
        const childAssert = partialNode && partialNode.children ? partialNode.children.get(propKey) : null;
        const childSpec = spec && spec.props ? spec.props[propKey] : null;

        if (childAssert) {
          return resolveAssertionValue(childCanonical, childExpr, childAssert, childSpec);
        }

        // 2. Check profile sub-spec (e.g. performance.now, crypto.getRandomValues, process.env, console.log)
        if (childSpec) {
          if (childSpec.primitiveUnknown) {
            triggerBailout(
              'unknown environment value "' + childCanonical + '" read during initialization',
              "env",
              childCanonical
            );
            return undefined;
          }
          const subType = childSpec.type || "object";
          bridge.recordAssumption("typeof", "typeof " + childExpr, subType, childCanonical);
          if (subType === "object") {
            bridge.recordAssumption("value", childExpr + " !== null", true, childCanonical);
          }
          return getOrCreateStandIn(childCanonical, childExpr, childSpec, null);
        }

        // 3. Unasserted property on unknown environment object => bailout!
        triggerBailout(
          'unknown environment value "' + childCanonical + '" read during initialization',
          "env",
          childCanonical
        );
        return undefined;
      },

      has(_t, prop) {
        if (typeof prop === "symbol") {
          const label = String(prop) + " in " + canonicalPath;
          triggerBailout('unknown environment check "' + label + '" during initialization', "env", label);
          return false;
        }
        const propKey = String(prop);
        const childAssert = partialNode && partialNode.children ? partialNode.children.get(propKey) : null;
        const childSpec = spec && spec.props ? spec.props[propKey] : null;

        if (childAssert) {
          const present = childAssert.mode !== "typeof" || childAssert.typeofStr !== "undefined";
          if (childAssert.mode === "primitive" && childAssert.value === undefined) {
            bridge.recordAssumption(
              "value",
              JSON.stringify(propKey) + " in " + exprPath,
              false,
              canonicalPath + "." + propKey
            );
            return false;
          }
          bridge.recordAssumption(
            "value",
            JSON.stringify(propKey) + " in " + exprPath,
            present,
            canonicalPath + "." + propKey
          );
          return present;
        }

        if (childSpec) {
          bridge.recordAssumption(
            "value",
            JSON.stringify(propKey) + " in " + exprPath,
            true,
            canonicalPath + "." + propKey
          );
          return true;
        }

        const checkDesc = JSON.stringify(propKey) + " in " + canonicalPath;
        triggerBailout(
          "unknown environment check (" + checkDesc + ") during initialization",
          "env",
          canonicalPath + "." + propKey
        );
        return false;
      },

      apply() {
        const kind = spec && spec.volatile ? "volatile" : "env";
        const label = canonicalPath + "()";
        const prefix = kind === "volatile" ? "volatile API" : "unknown environment function";
        triggerBailout(prefix + ' "' + label + '" called during initialization', kind, canonicalPath);
      },

      construct() {
        const label = "new " + canonicalPath + "()";
        triggerBailout(
          'unknown environment constructor "' + label + '" called during initialization',
          "env",
          canonicalPath
        );
        return {};
      },

      set(_t, prop) {
        const targetProp = canonicalPath + "." + String(prop);
        triggerBailout(
          'cannot mutate unknown environment object "' + targetProp + '" during initialization',
          "env",
          targetProp
        );
        return false;
      },

      defineProperty(_t, prop) {
        const targetProp = canonicalPath + "." + String(prop);
        triggerBailout(
          'cannot define property on unknown environment object "' + targetProp + '" during initialization',
          "env",
          targetProp
        );
        return false;
      },

      deleteProperty(_t, prop) {
        const targetProp = canonicalPath + "." + String(prop);
        triggerBailout(
          'cannot delete property on unknown environment object "' + targetProp + '" during initialization',
          "env",
          targetProp
        );
        return false;
      },

      ownKeys() {
        triggerBailout(
          'cannot enumerate keys of unknown environment object "' + canonicalPath + '" during initialization',
          "env",
          canonicalPath
        );
        return [];
      },
    });

    bridge.registerIntrinsic(proxy, canonicalPath);
    standInCache.set(cacheKey, proxy);
    return proxy;
  }

  function resolveAssertionValue(canonicalPath, exprPath, assertNode, profileSubSpec) {
    const isTopLevel = !canonicalPath.includes(".");
    const typeofExpr = isTopLevel ? bridge.formatTypeofGlobal(canonicalPath) : "typeof " + exprPath;

    if (assertNode.mode === "typeof") {
      const tStr = assertNode.typeofStr;
      bridge.recordAssumption("typeof", typeofExpr, tStr, canonicalPath);
      if (tStr === "undefined") {
        return undefined;
      }
      if (tStr === "object") {
        bridge.recordAssumption("value", exprPath + " !== null", true, canonicalPath);
        return getOrCreateStandIn(canonicalPath, exprPath, { type: "object" }, null);
      }
      if (tStr === "function") {
        return getOrCreateStandIn(canonicalPath, exprPath, { type: "function" }, null);
      }
      triggerBailout(
        'unasserted concrete value for "' + canonicalPath + '" (only typeof="' + tStr + '" was asserted)',
        "env",
        canonicalPath
      );
      return undefined;
    }

    if (assertNode.mode === "primitive") {
      const v = assertNode.value;
      if (v === undefined) {
        if (isTopLevel) {
          bridge.recordAssumption("typeof", typeofExpr, "undefined", canonicalPath);
        } else {
          bridge.recordAssumption("value", exprPath, undefined, canonicalPath);
        }
        return undefined;
      }
      if (isTopLevel) {
        // Guard against ReferenceError at runtime if global is undeclared!
        bridge.recordAssumption("typeof", typeofExpr, v === null ? "object" : typeof v, canonicalPath);
      }
      bridge.recordAssumption("value", exprPath, v, canonicalPath);
      return v;
    }

    if (assertNode.mode === "jsonValue") {
      const rawJson = OrigJSON.stringify(assertNode.value);
      const realmVal = cloneJsonIntoRealm(assertNode.value);
      bridge.recordAssumption("typeof", typeofExpr, "object", canonicalPath);
      bridge.recordAssumption("value", exprPath + " !== null", true, canonicalPath);
      return makeClosedJsonProxy(exprPath, rawJson, realmVal);
    }

    if (assertNode.mode === "partial") {
      const effSpec = profileSubSpec || { type: "object" };
      const effType = effSpec.type || "object";
      bridge.recordAssumption("typeof", typeofExpr, effType, canonicalPath);
      if (effType === "object") {
        bridge.recordAssumption("value", exprPath + " !== null", true, canonicalPath);
      }
      return getOrCreateStandIn(canonicalPath, exprPath, effSpec, assertNode);
    }

    return undefined;
  }

  // 6. Install global prototype interceptor between gProto and Object.prototype
  const protoHolder = Obj.create(origGProtoParent);
  const wellKnownSymbolNames = [
    "iterator",
    "asyncIterator",
    "match",
    "matchAll",
    "replace",
    "search",
    "split",
    "hasInstance",
    "isConcatSpreadable",
    "unscopables",
    "species",
    "toPrimitive",
    "dispose",
    "asyncDispose",
  ];
  const wellKnownSymbols = new OrigMap();
  for (let i = 0; i < wellKnownSymbolNames.length; i++) {
    const sName = wellKnownSymbolNames[i];
    if (typeof Sym[sName] === "symbol") {
      wellKnownSymbols.set(Sym[sName], "Symbol." + sName);
    }
  }

  const globalInterceptor = new OrigProxy(protoHolder, {
    has(t, prop) {
      if (OrigReflect.has(t, prop)) return true;
      if (typeof prop === "symbol") {
        if (prop === Sym.toStringTag && bridge.globalToStringTag !== undefined) {
          bridge.recordAssumption(
            "value",
            "globalThis[Symbol.toStringTag]",
            bridge.globalToStringTag,
            "globalThis[Symbol.toStringTag]"
          );
          return true;
        }
        return false;
      }

      const key = String(prop);
      if (bridge.isEsGlobal(key)) return false;

      const inExpr = JSON.stringify(key) + " in globalThis";
      const assertNode = bridge.getRootAssertion(key);
      if (assertNode) {
        const present =
          !(assertNode.mode === "typeof" && assertNode.typeofStr === "undefined") &&
          !(assertNode.mode === "primitive" && assertNode.value === undefined);
        bridge.recordAssumption("value", inExpr, present, key);
        return present;
      }

      if (bridge.isGlobalAlias(key)) {
        bridge.recordAssumption("value", inExpr, true, key);
        return true;
      }

      const spec = bridge.getProfileGlobal(key);
      if (spec) {
        bridge.recordAssumption("value", inExpr, true, key);
        return true;
      }

      bridge.recordAssumption("value", inExpr, false, key);
      return false;
    },

    get(t, prop, receiver) {
      if (OrigReflect.has(t, prop)) return OrigReflect.get(t, prop, receiver);

      if (typeof prop === "symbol") {
        if (prop === Sym.toStringTag) {
          if (bridge.globalToStringTag !== undefined) {
            bridge.recordAssumption(
              "value",
              "globalThis[Symbol.toStringTag]",
              bridge.globalToStringTag,
              "globalThis[Symbol.toStringTag]"
            );
            return bridge.globalToStringTag;
          }
          return undefined;
        }
        const regKey = Sym.keyFor(prop);
        if (regKey !== undefined) {
          const expr = "globalThis[Symbol.for(" + OrigJSON.stringify(regKey) + ")]";
          bridge.recordAssumption("value", expr, undefined, expr);
          return undefined;
        }
        if (wellKnownSymbols.has(prop)) {
          return undefined;
        }
        return undefined;
      }

      const key = String(prop);
      const exprPath = bridge.formatGlobalAccess(key);
      const typeofExpr = bridge.formatTypeofGlobal(key);

      // 1. User explicit assertion wins over profile defaults
      const assertNode = bridge.getRootAssertion(key);
      if (assertNode) {
        return resolveAssertionValue(key, exprPath, assertNode, bridge.getProfileGlobal(key));
      }

      // 2. Profile global alias (e.g. window === globalThis, self === globalThis, global === globalThis)
      if (bridge.isGlobalAlias(key)) {
        bridge.recordAssumption("typeof", typeofExpr, "object", key);
        bridge.recordAssumption("value", exprPath + " === globalThis", true, key);
        return g;
      }

      // 3. Profile existing global with unknown/host value
      const spec = bridge.getProfileGlobal(key);
      if (spec) {
        if (spec.primitiveUnknown) {
          triggerBailout(
            'unknown environment value "' + key + '" read during initialization; pass --assume ' + key + "=...",
            "env",
            key
          );
          return undefined;
        }
        const expectedType = spec.type || "object";
        bridge.recordAssumption("typeof", typeofExpr, expectedType, key);
        if (expectedType === "object") {
          bridge.recordAssumption("value", exprPath + " !== null", true, key);
        }
        return getOrCreateStandIn(key, exprPath, spec, null);
      }

      // 4. Absent non-ES global => observed as undefined and recorded as assumption
      bridge.recordAssumption("typeof", typeofExpr, "undefined", key);
      return undefined;
    },
  });

  Obj.setPrototypeOf(gProto, globalInterceptor);
  restoreTasks.push(function() {
    if (Obj.getPrototypeOf(gProto) === globalInterceptor) {
      Obj.setPrototypeOf(gProto, origGProtoParent);
    }
  });

  return function restoreInsideVm() {
    if (restored) return;
    restored = true;
    for (let i = restoreTasks.length - 1; i >= 0; i--) {
      restoreTasks[i]();
    }
    const curFnTs = Obj.getOwnPropertyDescriptor(fnProto, "toString");
    if (curFnTs && curFnTs.value === wrappedFnToString) {
      Obj.defineProperty(fnProto, "toString", {
        value: origFnToString,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  };
}

const VM_SETUP_SOURCE = `(${setupHybridEnvironment.toString()})`;

function installEnvironment(ctx, profile, assumptions, opts) {
  if (!ctx || typeof ctx !== "object") {
    throw new TypeError("installEnvironment(ctx, profile, assumptions): ctx must be a VM context object");
  }
  if (!vm.isContext(ctx)) {
    vm.createContext(ctx);
  }

  const profileSpec = resolveProfile(profile);
  const config = normalizeAssumptionsAndOpts(assumptions, opts, profileSpec);
  const aliasSet = new Set(profileSpec.aliases || []);

  // Optional timezone pinning via process.env.TZ during run (restored on recorder.restore())
  const hadPrevTz = Object.prototype.hasOwnProperty.call(process.env, "TZ");
  const prevTz = process.env.TZ;
  let tzRestored = false;
  if (config.tz) {
    process.env.TZ = String(config.tz);
  }

  const recordedAssumptions = [];
  const assumptionKeySet = new Set();
  const bailouts = [];
  const bakedVolatiles = [];
  const reads = [];
  const diagnostics = [];

  function recordAssumption(kind, expr, observed, readName) {
    const dedupKey = `${kind}\0${expr}\0${formatDedupObserved(observed)}`;
    if (!assumptionKeySet.has(dedupKey)) {
      assumptionKeySet.add(dedupKey);
      recordedAssumptions.push({ kind, expr, observed });
    }
    if (readName) {
      reads.push({
        op: kind === "tz" ? "tz" : "get",
        name: readName,
        outcome: "assumed",
        observed,
        where: captureCallSite(),
      });
    }
  }

  function recordBailout(reason, kind, name) {
    const where = captureCallSite();
    const entry = {
      reason,
      where,
      kind: kind || "env",
      name: name || "",
    };
    bailouts.push(entry);
    reads.push({
      op: kind === "volatile" ? "volatile" : "get",
      name: name || reason,
      outcome: "bailout",
      where,
    });
    diagnostics.push({
      severity: "error",
      code: kind === "volatile" ? "HYB_VOLATILE_BAILOUT" : "HYB_ENV_BAILOUT",
      message: reason,
      where,
    });
    return entry;
  }

  function recordBakedVolatile(api, value) {
    const where = captureCallSite();
    bakedVolatiles.push({ api, value, where });
    reads.push({
      op: "volatile",
      name: api,
      outcome: "baked",
      observed: value,
      where,
    });
    diagnostics.push({
      severity: "warning",
      code: "HYB_VOLATILE_BAKED",
      message: `Baked volatile call ${api} during initialization`,
      where,
    });
  }

  function recordTimezoneAssumption(opName) {
    const zone = String(config.tz);
    if (zone === "UTC" || zone === "Etc/UTC" || zone === "GMT") {
      recordAssumption("tz", "new Date(0).getTimezoneOffset() === 0", "UTC", opName);
    } else {
      recordAssumption("tz", "Intl.DateTimeFormat().resolvedOptions().timeZone", zone, opName);
    }
  }

  const bridge = {
    tz: config.tz ? String(config.tz) : null,
    globalToStringTag: profileSpec.globalToStringTag,
    throwOnBailout: config.throwOnBailout,
    isEsGlobal(name) {
      return ES_GLOBALS.has(name);
    },
    isGlobalAlias(name) {
      return aliasSet.has(name);
    },
    getProfileGlobal(name) {
      return (profileSpec.globals && profileSpec.globals[name]) || null;
    },
    getRootAssertion(name) {
      return config.assertionMap.get(name) || null;
    },
    isVolatileAllowed(apiName) {
      return isVolatileAllowed(config.allowVolatile, apiName);
    },
    isTimezoneDependentDateString,
    recordTimezoneAssumption,
    recordAssumption,
    recordBailout,
    recordBakedVolatile,
    formatGlobalAccess,
    formatTypeofGlobal,
    formatPropertyAccess,
    registerIntrinsic(obj, canonicalPath) {
      registerInIntrinsicsMap(config.intrinsicsMap, obj, canonicalPath);
    },
    hostPerformanceNow() {
      return performance.now();
    },
    hostRandomBytes(n) {
      return nodeCrypto.randomBytes(n);
    },
    hostRandomUUID() {
      return nodeCrypto.randomUUID();
    },
  };

  const setupFn = new vm.Script(VM_SETUP_SOURCE, { filename: INTERNAL_SETUP_FILENAME }).runInContext(ctx);
  const restoreInsideVm = setupFn(bridge);

  function restore() {
    restoreInsideVm();
    if (!tzRestored && config.tz) {
      tzRestored = true;
      if (hadPrevTz) {
        process.env.TZ = prevTz;
      } else {
        delete process.env.TZ;
      }
    }
  }

  const recorder = {
    profile: profileSpec.name,
    assumptions: recordedAssumptions,
    bailouts,
    bakedVolatiles,
    reads,
    diagnostics,
    hasBailout() {
      return bailouts.length > 0;
    },
    restore,
    teardown: restore,
    cleanup: restore,
    toCaptureGraphFields() {
      return {
        assumptions: recordedAssumptions.slice(),
        bailouts: bailouts.map(b => ({ reason: b.reason, where: b.where })),
      };
    },
  };

  return recorder;
}

function formatDedupObserved(v) {
  if (typeof v === "number" && Object.is(v, -0)) return "-0";
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (typeof v === "symbol") return String(v);
  return `${typeof v}:${String(v)}`;
}

// Plugs directly into Track H1's `beforeRun(ctx, intrinsicsMap, meta)` hook!
function createBeforeRunHook(profile, assumptions, opts) {
  let activeRecorder = null;
  let activeMeta = null;
  let syncedToMeta = false;

  function syncRecorderToMeta(meta) {
    const targetMeta = meta || activeMeta;
    if (!activeRecorder || !targetMeta || syncedToMeta) return;
    syncedToMeta = true;
    if (typeof targetMeta.addAssumption === "function") {
      for (const a of activeRecorder.assumptions) {
        targetMeta.addAssumption(a);
      }
    }
    if (typeof targetMeta.addBailout === "function") {
      for (const b of activeRecorder.bailouts) {
        targetMeta.addBailout({
          code: b.kind === "volatile" ? "HYB_VOLATILE_BAILOUT" : "HYB_ENV_BAILOUT",
          kind: b.kind,
          name: b.name,
          reason: b.reason,
          where: b.where,
        });
      }
    }
    targetMeta.bakedVolatiles = activeRecorder.bakedVolatiles.slice();
    targetMeta.envDiagnostics = activeRecorder.diagnostics.slice();
    targetMeta.envReads = activeRecorder.reads.slice();
  }

  function beforeRun(ctx, intrinsicsMap, meta) {
    activeMeta = meta || null;
    syncedToMeta = false;
    const mergedOpts = Object.assign({}, opts || null);
    if (intrinsicsMap !== undefined) {
      mergedOpts.intrinsicsMap = intrinsicsMap;
    }
    activeRecorder = installEnvironment(ctx, profile, assumptions, mergedOpts);
    function cleanup() {
      if (activeRecorder) {
        activeRecorder.restore();
        syncRecorderToMeta(activeMeta);
      }
    }
    cleanup.recorder = activeRecorder;
    return cleanup;
  }

  beforeRun.afterRun = function afterRun(_ctx, _intrinsicsMap, meta) {
    if (activeRecorder) {
      activeRecorder.restore();
      syncRecorderToMeta(meta);
    }
  };

  beforeRun.getRecorder = function getRecorder() {
    return activeRecorder;
  };

  return {
    beforeRun,
    afterRun: beforeRun.afterRun,
    getRecorder: beforeRun.getRecorder,
  };
}

module.exports = {
  EnvironmentBailoutError,
  ES_GLOBALS,
  PROFILES,
  resolveProfile,
  isTimezoneDependentDateString,
  isValidIdentifier,
  escapeScriptSafeJsonString,
  parseAssumeValue,
  parseAssumeEntry,
  parseEnvFlags,
  installEnvironment,
  createBeforeRunHook,
  emitGuard,
  measureGuardOverhead,
};
