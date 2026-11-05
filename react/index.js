"use strict";

// React-Hybrid: trace-based template specialization of ReactDOMServer.renderToString with guards.
// Implementation module for react-bench: { name, prepare(appSource, opts) -> renderFn(data) }.
// See README.md for the design.

const path = require("path");
const vm = require("vm");
const { instrument } = require("./instrument");
const { createTracer } = require("./trace");
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
    learner.learnFrames(tracer.st.records);
  }
  const t2 = process.hrtime.bigint();
  stats.traceMs = ms(t1, t2);

  const gen = generate({ tries: learner.tries, fns: inst.fns, ctxNames: tracer.ctxNames, rootFid: rootInfo.fid });
  const runtimeSource = `${appSource}\n;__hyOut.t = ${gen.code};\n`;
  const out = {};
  let rtApp;
  try {
    rtApp = loadModule(runtimeSource, filename, req, ["__hyOut"], [out]);
  } catch (err) {
    return disable(`generated code failed to load: ${err.message}`);
  }
  const tpl = out.t;
  // Context defaults, read through the real React.
  let defaults = [];
  RDS.renderToString(
    React.createElement(function ReadDefaults() {
      defaults = tpl.contexts.map((c) => React.useContext(c));
      return null;
    })
  );
  tpl.setDefaults(defaults);

  const fallback = (data) => RDS.renderToString(React.createElement(rtApp, { [rootProp]: data }));
  const render = (data) => {
    stats.renders++;
    try {
      return tpl.render(data);
    } catch (e) {
      stats.fallbacks++;
      let reason;
      if (tpl.isFallback(e)) {
        const site = tpl.lastFallbackSite();
        reason = site >= 0 ? gen.sites[site] : "fallback";
      } else {
        stats.errors++;
        reason = `error: ${e && e.message}`;
      }
      stats.fallbackReasons[reason] = (stats.fallbackReasons[reason] || 0) + 1;
      return fallback(data);
    }
  };

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
  render.code = runtimeSource;
  render.stats = stats;
  result.render = render;
  result.code = runtimeSource;
  return result;
}

module.exports = {
  name: "react-hybrid (traced templates + guards)",
  build,
  prepare(appSource, opts = {}) {
    const r = build(appSource, opts);
    if (opts.verbose || process.env.REACT_HYBRID_VERBOSE) {
      process.stderr.write(`[react-hybrid] ${JSON.stringify(r.stats)}\n`);
    }
    return r.render;
  },
};
