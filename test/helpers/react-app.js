"use strict";

// Helpers for freezedry-react tests: React 18 (production build) from bench/node_modules, and a
// builder that specializes a small app source and checks it against renderToString.

const path = require("node:path");
const Module = require("node:module");
const vm = require("node:vm");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "production";

const NM = path.join(__dirname, "..", "..", "bench", "node_modules");
const reactRequire = Module.createRequire(path.join(NM, "index.js"));
const React = reactRequire("react");
const RDS = reactRequire("react-dom/server");

const impl = require("../../react/index.js");

function loadApp(source) {
  const mod = { exports: {} };
  vm.compileFunction(source, ["exports", "require", "module"])(mod.exports, reactRequire, mod);
  return mod.exports;
}

function build(source, trainingInputs, extra = {}) {
  return impl.build(source, Object.assign({ require: reactRequire, React, ReactDOMServer: RDS, trainingInputs, noCache: true }, extra));
}

// Renders every input with the specialized renderer and with an independent copy of the app under
// renderToString; outputs (or thrown messages) must agree. Returns the number of fallbacks.
function assertSame(result, inputs) {
  const App = loadApp(result.appSource || result.sourceForCheck);
  const before = result.stats.fallbacks;
  for (const data of inputs) {
    let want;
    let wantErr = null;
    try {
      want = RDS.renderToString(React.createElement(App, { data }));
    } catch (e) {
      wantErr = e;
    }
    let got;
    let gotErr = null;
    try {
      got = result.render(data);
    } catch (e) {
      gotErr = e;
    }
    if (wantErr || gotErr) {
      assert.ok(wantErr && gotErr, `one side threw: ${wantErr && wantErr.message} / ${gotErr && gotErr.message}`);
      assert.equal(gotErr.message, wantErr.message);
    } else {
      assert.equal(got, want, `mismatch for ${JSON.stringify(data)}`);
    }
  }
  return result.stats.fallbacks - before;
}

function specialize(source, trainingInputs, extra) {
  const r = build(source, trainingInputs, extra);
  r.sourceForCheck = source;
  return r;
}

module.exports = { React, RDS, reactRequire, build, specialize, assertSame, loadApp };
