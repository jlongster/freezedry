"use strict";

const vm = require("vm");

const ENV_PRESETS = {
  ecma: {
    globalThis: true,
    global: false,
    self: false,
    window: false,
    console: false,
    webAssembly: false,
  },
  browser: {
    globalThis: true,
    global: false,
    self: true,
    window: true,
    console: false,
    webAssembly: false,
  },
  worker: {
    globalThis: true,
    global: false,
    self: true,
    window: false,
    console: false,
    webAssembly: false,
  },
  node: {
    globalThis: true,
    global: true,
    self: false,
    window: false,
    console: false,
    webAssembly: false,
  },
  universal: {
    globalThis: true,
    global: true,
    self: true,
    window: true,
    console: false,
    webAssembly: false,
  },
};

function resolveEnvConfig(envOpt) {
  if (!envOpt) return { ...ENV_PRESETS.ecma };
  if (typeof envOpt === "string") {
    const preset = ENV_PRESETS[envOpt];
    if (!preset) {
      throw new Error(
        `Unknown target environment "${envOpt}". Valid presets: ${Object.keys(ENV_PRESETS).join(", ")}`
      );
    }
    return { ...preset };
  }
  if (typeof envOpt === "object") {
    const baseName = envOpt.preset || "ecma";
    const base = ENV_PRESETS[baseName];
    if (!base) {
      throw new Error(`Unknown target environment preset "${baseName}"`);
    }
    return { ...base, ...envOpt };
  }
  throw new Error(`Invalid env option: ${String(envOpt)}`);
}

function createEnvironment(envOpt) {
  const envConfig = resolveEnvConfig(envOpt);
  const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY, {
    microtaskMode: "afterEvaluate",
  });
  const globalObj = vm.runInContext("this", ctx);

  // Strip V8 non-ECMAScript default globals unless explicitly enabled.
  if (!envConfig.console) {
    delete globalObj.console;
  }
  if (!envConfig.webAssembly) {
    delete globalObj.WebAssembly;
  }
  if (envConfig.globalThis === false) {
    delete globalObj.globalThis;
  }

  for (const alias of ["global", "self", "window"]) {
    if (envConfig[alias]) {
      Object.defineProperty(globalObj, alias, {
        value: globalObj,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  }

  if (envConfig.globals && typeof envConfig.globals === "object") {
    for (const key of Reflect.ownKeys(envConfig.globals)) {
      const spec = envConfig.globals[key];
      if (
        spec &&
        typeof spec === "object" &&
        ("value" in spec || "get" in spec || "set" in spec) &&
        ("configurable" in spec || "enumerable" in spec || "writable" in spec)
      ) {
        Object.defineProperty(globalObj, key, spec);
      } else {
        Object.defineProperty(globalObj, key, {
          value: spec,
          writable: true,
          enumerable: false,
          configurable: true,
        });
      }
    }
  }

  return { ctx, globalObj, envConfig };
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function snapshotOwnDescriptors(obj) {
  const map = new Map();
  for (const key of Reflect.ownKeys(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (desc) map.set(key, desc);
  }
  return map;
}

function collectHostRealmObjects() {
  const set = new Set();
  for (const val of [
    Object.prototype,
    Function.prototype,
    Array.prototype,
    Error.prototype,
    Map.prototype,
    Set.prototype,
    Promise.prototype,
    RegExp.prototype,
    Date.prototype,
    Object,
    Function,
    Array,
    globalThis,
  ]) {
    if (val) set.add(val);
  }
  return set;
}

const HOST_REALM_OBJECTS = collectHostRealmObjects();

function snapshotIntrinsics(ctx, globalObj) {
  const intrinsicsMap = new Map();
  const pathToIntrinsic = new Map();
  const queue = [];

  const globalHiddenProto = Object.getPrototypeOf(globalObj);

  const register = (val, path) => {
    if (val === null || val === undefined) return false;
    const t = typeof val;
    if (t !== "object" && t !== "function" && t !== "symbol") return false;
    if (val === globalObj || val === globalHiddenProto) return false;
    if (intrinsicsMap.has(val)) return false;
    intrinsicsMap.set(val, path);
    if (!pathToIntrinsic.has(path)) pathToIntrinsic.set(path, val);
    if (t === "object" || t === "function") {
      queue.push([val, path]);
    }
    return true;
  };

  // 1. Register Symbol and well-known Symbol.* first so symbol property keys get clean paths.
  if (typeof globalObj.Symbol === "function") {
    register(globalObj.Symbol, "Symbol");
    for (const k of Reflect.ownKeys(globalObj.Symbol)) {
      if (typeof k === "string" && IDENT_RE.test(k)) {
        const d = Object.getOwnPropertyDescriptor(globalObj.Symbol, k);
        if (d && "value" in d && typeof d.value === "symbol") {
          register(d.value, `Symbol.${k}`);
        }
      }
    }
  }

  // 2. Seed all top-level own properties of globalObj.
  for (const k of Reflect.ownKeys(globalObj)) {
    if (typeof k !== "string" || !IDENT_RE.test(k)) continue;
    if (k === "globalThis" || k === "global" || k === "self" || k === "window") continue;
    const d = Object.getOwnPropertyDescriptor(globalObj, k);
    if (d && "value" in d) {
      register(d.value, k);
    }
  }

  // 3. Seed hidden ECMAScript intrinsics not directly attached to global constructors.
  const hiddenSeeds = vm.runInContext(
    `([
      [Object.getPrototypeOf(Uint8Array), "Object.getPrototypeOf(Uint8Array)"],
      [Object.getPrototypeOf(Uint8Array.prototype), "Object.getPrototypeOf(Uint8Array.prototype)"],
      [Object.getPrototypeOf(function*(){}), "Object.getPrototypeOf(function*(){})"],
      [Object.getPrototypeOf(function*(){}).prototype, "Object.getPrototypeOf(function*(){}).prototype"],
      [Object.getPrototypeOf((function*(){})()), "Object.getPrototypeOf(function*(){}).prototype.prototype"],
      [Object.getPrototypeOf(async function(){}), "Object.getPrototypeOf(async function(){})"],
      [Object.getPrototypeOf(async function(){}).prototype, "Object.getPrototypeOf(async function(){}).prototype"],
      [Object.getPrototypeOf(async function*(){}), "Object.getPrototypeOf(async function*(){})"],
      [Object.getPrototypeOf(async function*(){}).prototype, "Object.getPrototypeOf(async function*(){}).prototype"],
      [Object.getPrototypeOf((async function*(){})()), "Object.getPrototypeOf(async function*(){}).prototype.prototype"],
      [Object.getPrototypeOf([][Symbol.iterator]()), "Object.getPrototypeOf([][Symbol.iterator]())"],
      [Object.getPrototypeOf((new Map())[Symbol.iterator]()), "Object.getPrototypeOf((new Map())[Symbol.iterator]())"],
      [Object.getPrototypeOf((new Set())[Symbol.iterator]()), "Object.getPrototypeOf((new Set())[Symbol.iterator]())"],
      [Object.getPrototypeOf(""[Symbol.iterator]()), "Object.getPrototypeOf(\\"\\"[Symbol.iterator]())"],
      [Object.getPrototypeOf((/a/)[Symbol.matchAll]("")), "Object.getPrototypeOf((/a/)[Symbol.matchAll](\\"\\"))"]
    ])`,
    ctx
  );
  for (const [val, expr] of hiddenSeeds) {
    register(val, expr);
  }

  // 4. BFS over own properties (string keys first, then symbol keys) and [[Prototype]].
  let head = 0;
  while (head < queue.length) {
    const [obj, basePath] = queue[head++];
    const ownKeys = Reflect.ownKeys(obj);
    const strKeys = [];
    const symKeys = [];
    for (const k of ownKeys) {
      if (typeof k === "string") strKeys.push(k);
      else symKeys.push(k);
    }

    for (const k of [...strKeys, ...symKeys]) {
      // Avoid touching legacy Function.prototype.arguments/caller throwing accessors via value read;
      // Object.getOwnPropertyDescriptor is purely reflective and never invokes getters.
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (!d) continue;

      let propSuffix = null;
      let keyArgExpr = null;
      if (typeof k === "string") {
        propSuffix = IDENT_RE.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
        keyArgExpr = JSON.stringify(k);
      } else {
        const symPath = intrinsicsMap.get(k);
        if (symPath) {
          propSuffix = `[${symPath}]`;
          keyArgExpr = symPath;
        }
      }
      if (!propSuffix) continue;

      if ("value" in d) {
        register(d.value, `${basePath}${propSuffix}`);
      } else {
        if (d.get) {
          register(d.get, `Object.getOwnPropertyDescriptor(${basePath}, ${keyArgExpr}).get`);
        }
        if (d.set) {
          register(d.set, `Object.getOwnPropertyDescriptor(${basePath}, ${keyArgExpr}).set`);
        }
      }
    }

    const proto = Object.getPrototypeOf(obj);
    if (proto && proto !== globalObj && proto !== globalHiddenProto) {
      register(proto, `Object.getPrototypeOf(${basePath})`);
    }
  }

  // 5. Capture pristine realm helpers before user code can mutate any prototypes.
  const sampleErrDesc = Object.getOwnPropertyDescriptor(new globalObj.Error("x"), "stack");
  const slotBrandDetectors = [];
  const addMethodBrandDetector = (label, fn, arg) => {
    if (typeof fn !== "function") return;
    slotBrandDetectors.push((candidate) => {
      try {
        if (arg !== undefined) fn.call(candidate, arg);
        else fn.call(candidate);
        return label;
      } catch {
        return null;
      }
    });
  };

  if (globalObj.WeakRef && globalObj.WeakRef.prototype) {
    addMethodBrandDetector("WeakRef", globalObj.WeakRef.prototype.deref);
  }
  if (globalObj.FinalizationRegistry && globalObj.FinalizationRegistry.prototype) {
    const dummyToken = {};
    addMethodBrandDetector("FinalizationRegistry", globalObj.FinalizationRegistry.prototype.unregister, dummyToken);
  }
  if (globalObj.DisposableStack && globalObj.DisposableStack.prototype) {
    const d = Object.getOwnPropertyDescriptor(globalObj.DisposableStack.prototype, "disposed");
    addMethodBrandDetector("DisposableStack", d && d.get);
  }
  if (globalObj.AsyncDisposableStack && globalObj.AsyncDisposableStack.prototype) {
    const d = Object.getOwnPropertyDescriptor(globalObj.AsyncDisposableStack.prototype, "disposed");
    addMethodBrandDetector("AsyncDisposableStack", d && d.get);
  }
  if (globalObj.Intl) {
    for (const k of Reflect.ownKeys(globalObj.Intl)) {
      if (typeof k !== "string" || typeof globalObj.Intl[k] !== "function") continue;
      const proto = globalObj.Intl[k].prototype;
      if (!proto) continue;
      if (typeof proto.resolvedOptions === "function") {
        addMethodBrandDetector(`Intl.${k}`, proto.resolvedOptions);
      } else if (k === "Locale") {
        const d = Object.getOwnPropertyDescriptor(proto, "baseName");
        addMethodBrandDetector("Intl.Locale", d && d.get);
      }
    }
  }

  const iteratorProtoSet = new Set(
    [
      pathToIntrinsic.get("Object.getPrototypeOf([][Symbol.iterator]())"),
      pathToIntrinsic.get("Object.getPrototypeOf((new Map())[Symbol.iterator]())"),
      pathToIntrinsic.get("Object.getPrototypeOf((new Set())[Symbol.iterator]())"),
      pathToIntrinsic.get('Object.getPrototypeOf(""[Symbol.iterator]())'),
      pathToIntrinsic.get('Object.getPrototypeOf((/a/)[Symbol.matchAll](""))'),
      globalObj.Iterator &&
        globalObj.Iterator.from &&
        (() => {
          try {
            return Object.getPrototypeOf(globalObj.Iterator.from([]).map((x) => x));
          } catch {
            return null;
          }
        })(),
    ].filter((p) => p && typeof p === "object")
  );
  for (const p of iteratorProtoSet) {
    if (!intrinsicsMap.has(p)) {
      intrinsicsMap.set(p, "Object.getPrototypeOf(Iterator.from([]).map(x => x))");
    }
  }

  const helpers = {
    globalHiddenProto,
    hostRealmObjects: HOST_REALM_OBJECTS,
    origFnToString: globalObj.Function.prototype.toString,
    origObjToString: globalObj.Object.prototype.toString,
    origMapEntries: globalObj.Map.prototype.entries,
    origSetValues: globalObj.Set.prototype.values,
    origDateGetTime: globalObj.Date.prototype.getTime,
    origRegExpSourceGet: Object.getOwnPropertyDescriptor(globalObj.RegExp.prototype, "source").get,
    origRegExpFlagsGet: Object.getOwnPropertyDescriptor(globalObj.RegExp.prototype, "flags").get,
    origNumberValueOf: globalObj.Number.prototype.valueOf,
    origStringValueOf: globalObj.String.prototype.valueOf,
    origBooleanValueOf: globalObj.Boolean.prototype.valueOf,
    origBigIntValueOf: globalObj.BigInt.prototype.valueOf,
    origSymbolValueOf: globalObj.Symbol.prototype.valueOf,
    origErrorStackGet: sampleErrDesc ? sampleErrDesc.get : null,
    origErrorStackSet: sampleErrDesc ? sampleErrDesc.set : null,
    errorConstructors: [
      ["TypeError", globalObj.TypeError],
      ["RangeError", globalObj.RangeError],
      ["ReferenceError", globalObj.ReferenceError],
      ["SyntaxError", globalObj.SyntaxError],
      ["URIError", globalObj.URIError],
      ["EvalError", globalObj.EvalError],
      ["AggregateError", globalObj.AggregateError],
      ["SuppressedError", globalObj.SuppressedError],
      ["Error", globalObj.Error],
    ].filter(([, ctor]) => typeof ctor === "function"),
    typedArrayConstructors: [
      ["Uint8Array", globalObj.Uint8Array],
      ["Uint8ClampedArray", globalObj.Uint8ClampedArray],
      ["Int8Array", globalObj.Int8Array],
      ["Uint16Array", globalObj.Uint16Array],
      ["Int16Array", globalObj.Int16Array],
      ["Uint32Array", globalObj.Uint32Array],
      ["Int32Array", globalObj.Int32Array],
      ["Float16Array", globalObj.Float16Array],
      ["Float32Array", globalObj.Float32Array],
      ["Float64Array", globalObj.Float64Array],
      ["BigInt64Array", globalObj.BigInt64Array],
      ["BigUint64Array", globalObj.BigUint64Array],
    ].filter(([, ctor]) => typeof ctor === "function"),
    detectUnmodeledBuiltinSlot(candidate) {
      for (const detect of slotBrandDetectors) {
        const hit = detect(candidate);
        if (hit) return hit;
      }
      return null;
    },
    iteratorProtoSet,
  };

  // 6. Snapshot pristine descriptors of globalObj and all intrinsic objects/functions.
  const pristineGlobals = snapshotOwnDescriptors(globalObj);
  const pristineIntrinsics = new Map();
  const pristineIntrinsicProtos = new Map();
  for (const [intrVal] of intrinsicsMap) {
    if (typeof intrVal === "object" || typeof intrVal === "function") {
      pristineIntrinsics.set(intrVal, snapshotOwnDescriptors(intrVal));
      pristineIntrinsicProtos.set(intrVal, Object.getPrototypeOf(intrVal));
    }
  }

  return {
    intrinsicsMap,
    pathToIntrinsic,
    pristineGlobals,
    pristineIntrinsics,
    pristineIntrinsicProtos,
    helpers,
  };
}

function normalizeSources(src, defaultFilename = "input.js") {
  if (typeof src === "string") {
    return [{ filePath: defaultFilename, fileContents: src }];
  }
  if (Array.isArray(src)) {
    return src.map((item, idx) => {
      if (typeof item === "string") {
        return { filePath: `input-${idx}.js`, fileContents: item };
      }
      return {
        filePath: item.filePath || `input-${idx}.js`,
        fileContents: String(item.fileContents ?? ""),
      };
    });
  }
  throw new TypeError("Expected source string or array of { filePath, fileContents }");
}

async function drainMicrotasksAndMacrotask() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function run(src, opts = {}) {
  const sources = normalizeSources(src, opts.filename || "input.js");
  const envOpt = opts.env ?? opts.targetEnv ?? "ecma";
  const { ctx, globalObj, envConfig } = createEnvironment(envOpt);
  const pristine = snapshotIntrinsics(ctx, globalObj);

  const assumptions = Array.isArray(opts.assumptions) ? [...opts.assumptions] : [];
  const bailouts = Array.isArray(opts.bailouts) ? [...opts.bailouts] : [];
  const meta = {
    globalObj,
    envConfig,
    ...pristine,
    assumptions,
    bailouts,
    addAssumption(a) {
      assumptions.push(a);
    },
    addBailout(b) {
      bailouts.push(b);
    },
  };

  let beforeCleanup = null;
  if (typeof opts.beforeRun === "function") {
    beforeCleanup = await opts.beforeRun(ctx, pristine.intrinsicsMap, meta);
  }

  const unhandledRejections = [];
  const onUnhandledRejection = (reason, promise) => {
    unhandledRejections.push({ reason, promise });
  };
  process.on("unhandledRejection", onUnhandledRejection);

  let error = null;
  const timeout = opts.timeout ?? 15000;
  try {
    for (const s of sources) {
      const script = new vm.Script(s.fileContents, { filename: s.filePath });
      script.runInContext(ctx, { timeout });
    }
    await drainMicrotasksAndMacrotask();
  } catch (err) {
    error = err;
    await drainMicrotasksAndMacrotask();
    if (opts.throwOnError) {
      throw err;
    }
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    if (typeof beforeCleanup === "function") {
      await beforeCleanup();
    }
    if (typeof opts.afterRun === "function") {
      await opts.afterRun(ctx, pristine.intrinsicsMap, meta);
    }
  }

  return {
    ctx,
    globalObj,
    envConfig,
    sources,
    ...pristine,
    error,
    unhandledRejections,
    assumptions,
    bailouts,
  };
}

module.exports = {
  ENV_PRESETS,
  resolveEnvConfig,
  createEnvironment,
  snapshotIntrinsics,
  run,
};
