"use strict";

// freezedry/react: trace-based template specialization of ReactDOMServer.renderToString with guards.
// Implementation module for react-bench: { name, prepare(appSource, opts) -> renderFn(data) }.
// See README.md for the design.

const path = require("path");
const vm = require("vm");

// Loads CommonJS source as a module. With `cache` ({ data?: Buffer }), compiles through vm.Script so
// that a V8 code cache can be consumed (cache.data) and produced later (cache.script).
function loadModule(source, filename, req, extraNames, extraValues, cache) {
  const mod = { exports: {} };
  const params = ["exports", "require", "module", "__filename", "__dirname", ...extraNames];
  let fn;
  if (cache) {
    const script = new vm.Script(`(function (${params.join(", ")}) {${source}\n})`, {
      filename,
      cachedData: cache.data || undefined,
    });
    cache.script = script;
    cache.rejected = !!cache.data && script.cachedDataRejected;
    fn = script.runInThisContext();
  } else {
    fn = vm.compileFunction(source, params, { filename });
  }
  fn(mod.exports, req, mod, filename, path.dirname(filename), ...extraValues);
  return mod.exports;
}

function defaultTrainingInputs(opts) {
  if (Array.isArray(opts.trainingInputs)) return opts.trainingInputs;
  const small = opts.trainSmall !== undefined ? opts.trainSmall : 60;
  const large = opts.trainLarge !== undefined ? opts.trainLarge : 10;
  if (typeof opts.trainingInputs === "function") {
    return opts.trainingInputs(small, "small").concat(opts.trainingInputs(large, "large"));
  }
  if (opts.reactBenchDir) {
    try {
      const data = require(path.join(opts.reactBenchDir, "data.js"));
      if (typeof data.getTrainingCorpus === "function") {
        return data.getTrainingCorpus(small, "small").concat(data.getTrainingCorpus(large, "large"));
      }
    } catch (_e) {
      // fall through
    }
  }
  if (typeof opts.generateSampleInput === "function") {
    const out = [];
    for (let i = 0; i < small; i++) out.push(opts.generateSampleInput(0x7a11 + i * 7, "small"));
    for (let i = 0; i < large; i++) out.push(opts.generateSampleInput(0x7a11 + i * 13 + 1, "large"));
    return out;
  }
  throw new Error("freezedry-react: no training inputs (pass opts.trainingInputs)");
}

// Builds the specialized renderer. Returns { render, code, stats, ... }.
function build(appSource, opts = {}) {
  // Build-time machinery is loaded lazily: the cached-artifact path never needs it.
  const { instrument } = require("./instrument");
  const { createTracer, NATIVES } = require("./trace");
  const { Learner } = require("./learn");
  const { generate, verifyRuntimeModel } = require("./codegen");
  const t0 = process.hrtime.bigint();
  const req = opts.require || require;
  const React = opts.React || req("react");
  const RDS = opts.ReactDOMServer || req("react-dom/server");
  const filename = opts.appPath || "app.js";
  const rootProp = opts.rootProp || "data";
  const ms = (a, b) => Number(b - a) / 1e6;

  const baselineApp = loadModule(appSource, filename, req, [], []);
  const baseline = (data) => RDS.renderToString(React.createElement(baselineApp, { [rootProp]: data }));
  const stats = {
    renders: 0,
    fallbacks: 0,
    errors: 0,
    buildMs: 0,
    traceMs: 0,
    disabled: null,
    fallbackReasons: {},
  };
  const result = { render: null, code: appSource, stats, learner: null };

  const disable = (reason) => {
    stats.disabled = reason;
    const render = (data) => {
      stats.renders++;
      stats.fallbacks++;
      return baseline(data);
    };
    render.code = appSource;
    render.stats = stats;
    result.render = render;
    return result;
  };

  if (rootProp !== "data") return disable("root prop other than `data` not supported");
  const modelError = verifyRuntimeModel(React, RDS);
  if (modelError) return disable(`runtime model does not match this React: ${modelError}`);

  let inst;
  try {
    inst = instrument(appSource);
  } catch (err) {
    return disable(`instrumentation: ${err.message}`);
  }

  const tracer = createTracer({ React, fns: inst.fns });
  const traced = loadModule(inst.code, filename, req, ["__h"], [tracer.h]);
  const rootInfo = tracer.fnInfo.get(traced);
  if (!rootInfo) return disable("module.exports is not an instrumented function component");
  const learner = new Learner({ tracer, React, RDS, fns: inst.fns });
  result.learner = learner;

  const inputs = defaultTrainingInputs(opts);
  const t1 = process.hrtime.bigint();
  let traceFailures = 0;
  const allFrames = [];
  for (const data of inputs) {
    tracer.reset();
    let html;
    try {
      html = RDS.renderToString(tracer.createRoot(traced, { [rootProp]: data }));
    } catch (_err) {
      traceFailures++;
      continue;
    }
    if (html !== baseline(data)) {
      // Instrumentation must never change behaviour.
      return disable("instrumented app rendered differently from the original");
    }
    for (const f of tracer.st.records) allFrames.push(f);
  }
  tracer.poisonSharedReaders(allFrames);
  learner.learnFrames(allFrames);
  const t2 = process.hrtime.bigint();
  stats.traceMs = ms(t1, t2);

  // Evaluates a helper-call node with the traced module's own functions (in concrete mode), given
  // values for its boolean leaves; used to tabulate pure helpers over finite domains.
  const evalCall = (node, leaf) => {
    const val = (x) => {
      const b = leaf(x);
      if (b !== undefined) return b;
      if (x.k === "lit") return x.d;
      if (x.k === "obj") return Object.fromEntries(x.d.map((k, i) => [k, val(x.kids[i])]));
      if (x.k === "arr") return x.kids.map(val);
      throw new Error("not evaluable");
    };
    const fn = tracer.modValues.get(node.kids[0].d);
    if (typeof fn !== "function" || !tracer.fnInfo.has(fn) || !inst.fns[tracer.fnInfo.get(fn).fid].pure) {
      throw new Error("not a pure app helper");
    }
    tracer.st.cm++;
    try {
      return fn(...node.kids.slice(1).map(val));
    } finally {
      tracer.st.cm--;
    }
  };
  // Calls a pure function by reference name on constant arguments (build-time folding).
  const nativeByName = new Map([...NATIVES.statics].map(([fn, name]) => [name, fn]));
  const callConst = (name, args) => {
    if (nativeByName.has(name)) return nativeByName.get(name)(...args);
    const fn = tracer.modValues.get(name);
    if (typeof fn !== "function" || !tracer.fnInfo.has(fn) || !inst.fns[tracer.fnInfo.get(fn).fid].pure) {
      throw new Error("not a pure app helper");
    }
    tracer.st.cm++;
    try {
      return fn(...args);
    } finally {
      tracer.st.cm--;
    }
  };
  const gen = generate({
    tries: learner.tries,
    fns: inst.fns,
    ctxNames: tracer.ctxNames,
    rootFid: rootInfo.fid,
    evalCall,
    callConst,
  });
  const runtimeSource = `${appSource}\n;__hyOut.t = ${gen.code};\n`;
  let rt;
  try {
    rt = makeRenderer({ runtimeSource, sites: gen.sites, filename, req, rootProp, stats, React, RDS, checkPlain: !!opts.checkPlainData, collect: opts.collectFallbacks || 0 });
  } catch (err) {
    return disable(`generated code failed to load: ${err.message}`);
  }
  const tpl = rt.tpl;
  const render = rt.render;
  // Context defaults are read from React (the runtime path reads `_currentValue`, which must agree).
  let defaults = [];
  RDS.renderToString(
    React.createElement(function ReadDefaults() {
      defaults = tpl.contexts.map((c) => React.useContext(c));
      return null;
    })
  );
  if (!tpl.contexts.every((c, i) => Object.is(c._currentValue, defaults[i]))) {
    return disable("context defaults are not observable outside a render");
  }
  result.sites = gen.sites;
  result.script = rt.script;

  // Self-check on the training inputs: any mismatch means a modeling bug, never accepted.
  let mismatches = 0;
  let firstMismatch = null;
  for (const data of inputs) {
    let got;
    try {
      got = tpl.render(data);
    } catch (e) {
      if (tpl.isFallback(e)) continue;
      got = `<<error ${e && e.message}>>`;
    }
    const want = baseline(data);
    if (got !== want) {
      mismatches++;
      if (!firstMismatch) firstMismatch = { data, got, want };
    }
  }
  stats.buildMs = ms(t0, process.hrtime.bigint());
  Object.assign(stats, {
    trainingInputs: inputs.length,
    traceFailures,
    frames: learner.stats.frames,
    framesLearned: learner.stats.learned,
    poisoned: Object.fromEntries(learner.stats.poisoned),
    unsupported: Object.fromEntries(learner.stats.unsupported),
    conflicts: Object.fromEntries(learner.conflicts),
    templates: gen.stats.templates,
    leaves: gen.stats.leaves,
    decisions: gen.stats.decisions,
    templateBytes: Buffer.byteLength(gen.code),
    selfCheckMismatches: mismatches,
  });
  result.templateCode = gen.code;
  result.firstMismatch = firstMismatch;
  stats.stubReact = mismatches === 0 && stubModeWorks({ runtimeSource, filename, req, rootProp, inputs, baseline, defaults });
  if (mismatches > 0 && !opts.allowMismatch) {
    disable(`self-check failed on ${mismatches} training inputs`);
    result.templateCode = gen.code;
    return result;
  }
  result.render = render;
  result.code = runtimeSource;
  return result;
}

// Loads app + generated template as one module; render() runs the template and falls back to the
// real renderToString (react-dom/server is only loaded when first needed).
// With `stubReact`, the template's module instance is evaluated against a minimal stand-in for
// "react" that only supports createContext (verified at build time: templates never call React,
// they use the app's pure helpers and the contexts' default values). The real React and a second
// instance of the app are loaded only when the first fallback happens.
class StubMiss extends Error {}
function makeReactStub() {
  const api = {
    createContext(defaultValue) {
      return { _currentValue: defaultValue, $$freezedryStub: true };
    },
  };
  return new Proxy(api, {
    get(target, key) {
      if (key === "createContext") return target.createContext;
      throw new StubMiss(`react stub: ${String(key)}`);
    },
  });
}

function makeRenderer({ runtimeSource, sites, filename, req, rootProp, stats, React, RDS, checkPlain, codeCache, stubReact, collect }) {
  const collected = [];
  const out = {};
  const cache = { data: codeCache || null };
  const stub = stubReact ? makeReactStub() : null;
  const tplReq = stub ? (id) => (id === "react" ? stub : req(id)) : req;
  let rtApp = loadModule(runtimeSource, filename, tplReq, ["__hyOut"], [out], cache);
  if (stub) rtApp = null;
  const tpl = out.t;
  tpl.setDefaults(tpl.contexts.map((c) => c._currentValue));
  let React_ = React;
  let RDS_ = RDS;
  const fallback = (data) => {
    if (!React_) React_ = req("react");
    if (!RDS_) RDS_ = req("react-dom/server");
    if (!rtApp) rtApp = loadModule(runtimeSource, filename, req, ["__hyOut"], [{}]);
    return RDS_.renderToString(React_.createElement(rtApp, { [rootProp]: data }));
  };
  const render = (data) => {
    stats.renders++;
    try {
      if (checkPlain && !isPlainData(data)) tpl.fallbackNow();
      return tpl.render(data);
    } catch (e) {
      stats.fallbacks++;
      let reason;
      if (tpl.isFallback(e)) {
        const site = tpl.lastFallbackSite();
        reason = site >= 0 ? sites[site] : site === -2 ? "data is not plain data" : "fallback";
      } else {
        stats.errors++;
        reason = `error: ${e && e.message}`;
      }
      stats.fallbackReasons[reason] = (stats.fallbackReasons[reason] || 0) + 1;
      // Offline learning: keep (copies of) inputs that fell back, to retrain with later.
      if (collect && collected.length < collect) {
        try {
          collected.push(structuredClone(data));
        } catch (_e) {
          // not cloneable: skip
        }
      }
      return fallback(data);
    }
  };
  render.code = runtimeSource;
  render.stats = stats;
  render.collected = collected;
  return { render, tpl, script: cache.script, cacheRejected: cache.rejected };
}

function stubModeWorks({ runtimeSource, filename, req, rootProp, inputs, baseline, defaults }) {
  const { isDeepStrictEqual } = require("util");
  let rt;
  try {
    rt = makeRenderer({ runtimeSource, sites: [], filename, req, rootProp, stats: { renders: 0, fallbacks: 0, errors: 0, fallbackReasons: {} }, stubReact: true });
  } catch (err) {
    if (err instanceof StubMiss) return false;
    throw err;
  }
  if (!rt.tpl.contexts.every((c, i) => isDeepStrictEqual(c._currentValue, defaults[i]))) return false;
  for (const data of inputs) {
    let got;
    try {
      got = rt.tpl.render(data);
    } catch (e) {
      if (rt.tpl.isFallback(e)) continue;
      return false;
    }
    if (got !== baseline(data)) return false;
  }
  return true;
}

// Precondition of the templates (see README): request data is plain data, i.e. property reads are
// side-effect free and stable. Opt-in check (opts.checkPlainData): every reachable object is a
// plain object or array without accessors, symbols or Proxies; otherwise render with React.
const { isProxy } = require("util").types;
function isPlainData(root) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== "object") {
      if (typeof v === "function") return false;
      continue;
    }
    if (seen.has(v)) continue;
    seen.add(v);
    if (isProxy(v)) return false;
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return false;
    if (Object.getOwnPropertySymbols(v).length) return false;
    const descs = Object.getOwnPropertyDescriptors(v);
    for (const k in descs) {
      const d = descs[k];
      if (!("value" in d)) return false;
      stack.push(d.value);
    }
  }
  return true;
}

const IMPL_FILES = ["index.js", "instrument.js", "trace.js", "learn.js", "codegen.js", "expr.js"];

function cacheDir(opts) {
  if (opts.cacheDir) return opts.cacheDir;
  const fs = require("fs");
  const base = require("os").tmpdir();
  return path.join(base, "freezedry-react-cache");
}

// Cache key: FNV-1a over the app source, the implementation files' size+mtime, and the options that
// affect the build (stat-based staleness, like make; avoids loading crypto on the hot path).
function fnv(h, str) {
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function cacheKey(appSource, opts) {
  const fs = require("fs");
  let meta = JSON.stringify([opts.trainSmall, opts.trainLarge, opts.rootProp || "data", process.version, appSource.length]);
  for (const f of IMPL_FILES) {
    const st = fs.statSync(path.join(__dirname, f));
    meta += `|${f}:${st.size}:${st.mtimeMs}`;
  }
  if (Array.isArray(opts.trainingInputs)) meta += JSON.stringify(opts.trainingInputs);
  const a = fnv(0x811c9dc5, appSource);
  const b = fnv(0x811c9dc5 ^ 0x5bd1e995, meta);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0") + fnv(a, meta).toString(16).padStart(8, "0");
}

// V8 code caches are only accepted under the same flags: one cache file per flag set.
function codeCacheFile(file) {
  const flags = process.execArgv.filter((a) => a.startsWith("--") && !a.startsWith("--cpu-prof")).join(" ");
  return `${file}.${fnv(0x811c9dc5, flags).toString(16)}.v8cache`;
}

module.exports = {
  name: "freezedry-react (traced templates + guards)",
  build,
  makeRenderer,
  isPlainData,
  // Builds (or loads from the on-disk cache, keyed by app source + implementation + training
  // config) the specialized renderer. Set opts.noCache / REACT_FREEZEDRY_NO_CACHE to always build.
  prepare(appSource, opts = {}) {
    const fs = require("fs");
    const tm = [];
    let tt = process.hrtime.bigint();
    const mark = (n) => {
      const x = process.hrtime.bigint();
      tm.push(`${n}=${(Number(x - tt) / 1e6).toFixed(2)}`);
      tt = x;
    };
    const useCache = !opts.noCache && !process.env.REACT_FREEZEDRY_NO_CACHE;
    const file = useCache ? path.join(cacheDir(opts), `${cacheKey(appSource, opts)}.json`) : null;
    mark("key");
    if (file && fs.existsSync(file)) {
      try {
        const art = JSON.parse(fs.readFileSync(file, "utf8"));
        mark("json");
        const stats = Object.assign(art.stats, { renders: 0, fallbacks: 0, errors: 0, fallbackReasons: {}, fromCache: true });
        let codeCache = null;
        const ccFile = codeCacheFile(file);
        try {
          codeCache = fs.readFileSync(ccFile);
        } catch (_e) {
          // no code cache for these flags: compile from source, write one after the first render
        }
        mark("readcache");
        const rr = makeRenderer({
          codeCache,
          stubReact: !!art.stats.stubReact,
          runtimeSource: art.runtimeSource,
          sites: art.sites,
          filename: opts.appPath || "app.js",
          // Resolved on first use: opts.require may be a getter that loads React eagerly.
          req: (id) => (opts.require || require)(id),
          rootProp: opts.rootProp || "data",
          stats,
          checkPlain: !!opts.checkPlainData,
          collect: opts.collectFallbacks || 0,
        });
        mark("load");
        stats.codeCacheRejected = !!rr.cacheRejected;
        stats.prepareTimings = tm.join(" ");
        if (process.env.REACT_FREEZEDRY_TIMING) process.stderr.write(`[freezedry-react] ${stats.prepareTimings} codeCacheRejected=${stats.codeCacheRejected}\n`);
        if (!codeCache || rr.cacheRejected) {
          const render0 = rr.render;
          let pending = true;
          const wrapped = (data) => {
            const html = render0(data);
            if (pending) {
              pending = false;
              try {
                const tmp = `${ccFile}.${process.pid}.tmp`;
                fs.writeFileSync(tmp, rr.script.createCachedData());
                fs.renameSync(tmp, ccFile);
              } catch (_e) {
                // best effort
              }
            }
            return html;
          };
          wrapped.code = render0.code;
          wrapped.stats = render0.stats;
          return wrapped;
        }
        return rr.render;
      } catch (_e) {
        // rebuild below
      }
    }
    const r = build(appSource, opts);
    if (opts.verbose || process.env.REACT_FREEZEDRY_VERBOSE) {
      process.stderr.write(`[freezedry-react] ${JSON.stringify(r.stats)}\n`);
    }
    if (file && !r.stats.disabled) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ runtimeSource: r.code, sites: r.sites, stats: r.stats }));
        fs.renameSync(tmp, file);
        // The build's script has rendered every training input, so its code cache includes the
        // compiled templates (not only the eagerly compiled top level).
        if (r.script) {
          fs.writeFileSync(tmp, r.script.createCachedData());
          fs.renameSync(tmp, codeCacheFile(file));
        }
      } catch (_e) {
        // cache is best effort
      }
    }
    return r.render;
  },
};
