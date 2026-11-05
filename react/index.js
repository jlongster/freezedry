"use strict";

// React-Hybrid: trace-based template specialization of ReactDOMServer.renderToString with guards.
// Implementation module for react-bench: { name, prepare(appSource, opts) -> renderFn(data) }.
// See README.md for the design.

const path = require("path");
const vm = require("vm");
const { instrument } = require("./instrument");
const { createTracer, NATIVES } = require("./trace");
const { Learner } = require("./learn");
const { generate } = require("./codegen");

function loadModule(source, filename, req, extraNames, extraValues) {
  const mod = { exports: {} };
  const fn = vm.compileFunction(source, ["exports", "require", "module", "__filename", "__dirname", ...extraNames], {
    filename,
  });
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
  throw new Error("react-hybrid: no training inputs (pass opts.trainingInputs)");
}

// Builds the specialized renderer. Returns { render, code, stats, ... }.
function build(appSource, opts = {}) {
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
    rt = makeRenderer({ runtimeSource, sites: gen.sites, filename, req, rootProp, stats, React, RDS, checkPlain: !!opts.checkPlainData });
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
function makeRenderer({ runtimeSource, sites, filename, req, rootProp, stats, React, RDS, checkPlain }) {
  const out = {};
  const rtApp = loadModule(runtimeSource, filename, req, ["__hyOut"], [out]);
  const tpl = out.t;
  tpl.setDefaults(tpl.contexts.map((c) => c._currentValue));
  let React_ = React;
  let RDS_ = RDS;
  const fallback = (data) => {
    if (!React_) React_ = req("react");
    if (!RDS_) RDS_ = req("react-dom/server");
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
      return fallback(data);
    }
  };
  render.code = runtimeSource;
  render.stats = stats;
  return { render, tpl };
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
  const base = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : require("os").tmpdir();
  return path.join(base, "react-hybrid-cache");
}

function cacheKey(appSource, opts) {
  const crypto = require("crypto");
  const fs = require("fs");
  const h = crypto.createHash("sha256");
  h.update(appSource);
  for (const f of IMPL_FILES) h.update(fs.readFileSync(path.join(__dirname, f)));
  h.update(JSON.stringify([opts.trainSmall, opts.trainLarge, opts.rootProp || "data", process.version]));
  if (Array.isArray(opts.trainingInputs)) h.update(JSON.stringify(opts.trainingInputs));
  return h.digest("hex").slice(0, 24);
}

module.exports = {
  name: "react-hybrid (traced templates + guards)",
  build,
  makeRenderer,
  isPlainData,
  // Builds (or loads from the on-disk cache, keyed by app source + implementation + training
  // config) the specialized renderer. Set opts.noCache / REACT_HYBRID_NO_CACHE to always build.
  prepare(appSource, opts = {}) {
    const fs = require("fs");
    const useCache = !opts.noCache && !process.env.REACT_HYBRID_NO_CACHE;
    const file = useCache ? path.join(cacheDir(opts), `${cacheKey(appSource, opts)}.json`) : null;
    if (file && fs.existsSync(file)) {
      try {
        const art = JSON.parse(fs.readFileSync(file, "utf8"));
        const stats = Object.assign(art.stats, { renders: 0, fallbacks: 0, errors: 0, fallbackReasons: {}, fromCache: true });
        return makeRenderer({
          runtimeSource: art.runtimeSource,
          sites: art.sites,
          filename: opts.appPath || "app.js",
          req: opts.require || require,
          rootProp: opts.rootProp || "data",
          stats,
          checkPlain: !!opts.checkPlainData,
        }).render;
      } catch (_e) {
        // rebuild below
      }
    }
    const r = build(appSource, opts);
    if (opts.verbose || process.env.REACT_HYBRID_VERBOSE) {
      process.stderr.write(`[react-hybrid] ${JSON.stringify(r.stats)}\n`);
    }
    if (file && !r.stats.disabled) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ runtimeSource: r.code, sites: r.sites, stats: r.stats }));
        fs.renameSync(tmp, file);
      } catch (_e) {
        // cache is best effort
      }
    }
    return r.render;
  },
};
