"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { SPECS } = require("../../bench/libs/specs.js");
const { installEnvironment, emitGuard, measureGuardOverhead } = require("../lib/env.js");

const DIST_DIR = path.resolve(__dirname, "../../bench/libs/dist");

function readDistLib(id) {
  return fs.readFileSync(path.join(DIST_DIR, `${id}.js`), "utf8");
}

function runWithEnv(id, profile, assumptions, opts) {
  const src = readDistLib(id);
  const ctx = vm.createContext({});
  const initialKeys = new Set(vm.runInContext("Reflect.ownKeys(globalThis)", ctx));
  const recorder = installEnvironment(ctx, profile, assumptions, opts);
  let error = null;
  try {
    new vm.Script(src, { filename: `${id}.js` }).runInContext(ctx, { timeout: 10000 });
  } catch (err) {
    error = err;
  } finally {
    recorder.restore();
  }
  const addedRoots = Array.from(vm.runInContext("Reflect.ownKeys(globalThis)", ctx)).filter(k => !initialKeys.has(k));
  return { src, ctx, recorder, error, addedRoots };
}

function toHostPlain(val) {
  if (val === null || typeof val !== "object") return val;
  return JSON.parse(JSON.stringify(val));
}

describe("Real-World Corpus Environment Probes & Volatile Detection (bench/libs/dist)", () => {
  it("passes pure UMD libraries (moment, ramda, acorn, chroma-js, crc-32, marked, preact-ssr-app, yaml-router-app) in browser profile with zero bailouts", () => {
    const zeroFlagBrowserLibs = [
      ["moment", ["moment"]],
      ["ramda", ["R"]],
      ["acorn", ["acorn"]],
      ["chroma-js", ["chroma"]],
      ["crc-32", ["CRC32"]],
      ["marked", ["marked"]],
      ["preact-ssr-app", ["preact", "preactRenderToString", "PreactSSRApp"]],
      ["yaml-router-app", ["jsyaml", "Mustache", "YamlRouterApp"]],
    ];

    for (const [id, expectedRoots] of zeroFlagBrowserLibs) {
      const res = runWithEnv(id, "browser");
      assert.equal(res.error, null, `${id} threw unexpected error: ${res.error}`);
      assert.equal(res.recorder.hasBailout(), false, `${id} unexpectedly bailed out`);
      assert.deepEqual(res.addedRoots, expectedRoots, `${id} roots mismatch`);

      const spec = SPECS.find(s => s.id === id);
      const smokeOut = vm.runInContext(`(${spec.smokeCode})(globalThis)`, res.ctx);
      assert.equal(typeof smokeOut, "string");
      assert.ok(JSON.parse(smokeOut), `${id} smoke output must be valid JSON`);
    }
  });

  it("detects exact volatile & unknown-DOM bailouts on lodash, underscore, redux, immutable, d3-scale, handlebars-app, and react-ssr-app", () => {
    // 1. lodash calls Date.now() inside shortOut() during method installation
    const lodashRes = runWithEnv("lodash", "browser");
    assert.equal(lodashRes.recorder.hasBailout(), true);
    assert.equal(lodashRes.recorder.bailouts[0].name, "Date.now");
    assert.match(lodashRes.recorder.bailouts[0].where, /^lodash\.js:\d+:\d+$/);

    // 2. underscore reads root.document.childNodes in browser profile (passes cleanly in worker/ecmascript!)
    const underscoreBrowser = runWithEnv("underscore", "browser");
    assert.equal(underscoreBrowser.recorder.hasBailout(), true);
    assert.equal(underscoreBrowser.recorder.bailouts[0].name, "document.childNodes");
    assert.match(underscoreBrowser.recorder.bailouts[0].where, /^underscore\.js:139:/);

    const underscoreWorker = runWithEnv("underscore", "worker");
    assert.equal(underscoreWorker.recorder.hasBailout(), false);
    assert.deepEqual(underscoreWorker.addedRoots, ["_"]);

    // 3. redux calls Math.random() inside ActionTypes / assertReducerShape (even inside combineReducers' try/catch!)
    const reduxRes = runWithEnv("redux", "browser");
    assert.equal(reduxRes.recorder.hasBailout(), true);
    assert.equal(reduxRes.recorder.bailouts[0].name, "Math.random");
    assert.match(reduxRes.recorder.bailouts[0].where, /^redux\.js:\d+:\d+$/);

    // 4. immutable calls Math.random() for HASH_SMI seed
    const immRes = runWithEnv("immutable", "browser");
    assert.equal(immRes.recorder.hasBailout(), true);
    assert.equal(immRes.recorder.bailouts[0].name, "Math.random");

    // 5. d3-scale calls `new Date` (0 args) at module init in d3-time
    const d3Res = runWithEnv("d3-scale", "browser");
    assert.equal(d3Res.recorder.hasBailout(), true);
    assert.equal(d3Res.recorder.bailouts[0].name, "new Date()");

    // 6. handlebars-app calls Math.random() in its embedded core-js Symbol uid generator
    const hbRes = runWithEnv("handlebars-app", "browser");
    assert.equal(hbRes.recorder.hasBailout(), true);
    assert.equal(hbRes.recorder.bailouts[0].name, "Math.random");

    // 7. react-ssr-app probes navigator.scheduling in browser profile
    const reactRes = runWithEnv("react-ssr-app", "browser");
    assert.equal(reactRes.recorder.hasBailout(), true);
    assert.equal(reactRes.recorder.bailouts[0].name, "navigator.scheduling");
  });

  it("unlocks all 15 corpus workloads when explicit --assume / --allow-volatile flags are supplied and passes every smoke test", () => {
    const configs = {
      lodash: { opts: { allowVolatile: ["Date.now"] } },
      underscore: { assumptions: { "typeof:document.childNodes": "object" } },
      redux: { opts: { allowVolatile: ["Math.random"] } },
      immutable: { opts: { allowVolatile: ["Math.random"] } },
      "d3-scale": { opts: { allowVolatile: ["new Date"], tz: "UTC" } },
      "handlebars-app": { opts: { allowVolatile: ["Math.random"] } },
      "react-ssr-app": { assumptions: { "navigator.scheduling": undefined, MessageChannel: undefined } },
    };

    for (const spec of SPECS) {
      const cfg = configs[spec.id] || {};
      const res = runWithEnv(spec.id, "browser", cfg.assumptions || {}, cfg.opts || {});
      assert.equal(res.error, null, `${spec.id} error: ${res.error}`);
      assert.equal(res.recorder.hasBailout(), false, `${spec.id} bailed: ${JSON.stringify(res.recorder.bailouts)}`);

      // Verify baseline vs env-instrumented smoke digest matches 100%!
      const envDigest = vm.runInContext(`(${spec.smokeCode})(globalThis)`, res.ctx);

      const refCtx = vm.createContext({});
      vm.runInContext("globalThis.window = globalThis; globalThis.self = globalThis;", refCtx);
      new vm.Script(res.src, { filename: `${spec.id}.js` }).runInContext(refCtx, { timeout: 10000 });
      const refDigest = vm.runInContext(`(${spec.smokeCode})(globalThis)`, refCtx);

      assert.equal(envDigest, refDigest, `${spec.id} smoke output differed from reference!`);
    }
  });

  it("verifies UMD guard + fallback semantics on moment, ramda, and underscore (AMD define, CJS module.exports, and noConflict)", () => {
    // 1. Moment UMD: compiled for browser, then run in (a) browser, (b) AMD with define.amd, (c) CJS with function fallback
    const momentRun = runWithEnv("moment", "browser");
    const momentGuardEval = emitGuard(momentRun.recorder.assumptions, momentRun.src, { fallback: "eval" });
    const momentOutEval = momentGuardEval.wrap(`globalThis.moment = { __rebuiltHeapStub: true, version: "2.31.0" };`);

    // (a) Browser context -> fast path!
    const browserCtx = vm.createContext({});
    new vm.Script(momentOutEval).runInContext(browserCtx);
    assert.equal(browserCtx.moment.__rebuiltHeapStub, true);

    // (b) AMD context (`typeof define === "function" && define.amd`) -> guard fails, fallback calls define(factory)!
    const amdCtx = vm.createContext({});
    let amdFactoryResult = null;
    const amdDefine = function(factory) {
      amdFactoryResult = factory();
    };
    amdDefine.amd = true;
    amdCtx.define = amdDefine;
    new vm.Script(momentOutEval).runInContext(amdCtx);
    assert.equal(amdCtx.moment, undefined);
    assert.equal(amdFactoryResult.version, "2.31.0");

    // (c) CommonJS context with `fallback: "function"` -> guard fails, fallback exports real moment to module.exports!
    const momentGuardFn = emitGuard(momentRun.recorder.assumptions, momentRun.src, { fallback: "function" });
    const momentOutFn = momentGuardFn.wrap(`globalThis.moment = { __rebuiltHeapStub: true };`);
    const cjsCtx = vm.createContext({});
    const cjsMod = { exports: {} };
    vm.runInContext(`(function(exports, module) {\n${momentOutFn}\n})`, cjsCtx).call(
      cjsMod.exports,
      cjsMod.exports,
      cjsMod
    );
    assert.equal(cjsMod.exports.version, "2.31.0");
    assert.equal(cjsCtx.moment, undefined);

    // 2. Underscore `noConflict()` safety!
    // Underscore reads `var current = global._` BEFORE setting `global._ = factory()`.
    // Our recorder captures `typeof _ === "undefined"`. If `globalThis._` already existed at runtime,
    // the guard fails and falls back to original Underscore so `_.noConflict()` restores the prior `_`!
    const usRun = runWithEnv("underscore", "worker");
    assert.ok(usRun.recorder.assumptions.some(a => a.expr === "typeof _" && a.observed === "undefined"));
    const usGuard = emitGuard(usRun.recorder.assumptions, usRun.src, { fallback: "eval" });
    const usOut = usGuard.wrap(`globalThis._ = { __rebuiltStub: true };`);

    // When prior `_` exists at runtime -> fallback preserves `_.noConflict()`!
    const priorCtx = vm.createContext({});
    vm.runInContext(`globalThis.self = globalThis; globalThis._ = { sentinel: "existing-underscore" };`, priorCtx);
    new vm.Script(usOut).runInContext(priorCtx);
    assert.equal(priorCtx._.__rebuiltStub, undefined);
    assert.equal(priorCtx._.VERSION, "1.13.8");
    const restoredUnderscore = vm.runInContext(`_.noConflict()`, priorCtx);
    assert.equal(restoredUnderscore.VERSION, "1.13.8");
    assert.deepEqual(toHostPlain(priorCtx._), { sentinel: "existing-underscore" });

    // Measure guard overhead on Ramda
    const ramdaRun = runWithEnv("ramda", "browser");
    const overhead = measureGuardOverhead(ramdaRun.recorder.assumptions, ramdaRun.src, ramdaRun.src);
    assert.ok(overhead.strategies.throw.rawDeltaBytes < 250);
    assert.ok(overhead.strategies.throw.gzipDeltaBytes < 100);
    assert.ok(overhead.strategies.external.rawDeltaBytes < 400);
  });

  it("verifies Lodash UMD guard + fallback (browser fast-path vs AMD define vs pre-existing _ noConflict)", () => {
    const lodashRun = runWithEnv("lodash", "browser", {}, { allowVolatile: ["Date.now"] });
    assert.equal(lodashRun.recorder.hasBailout(), false);
    assert.ok(lodashRun.recorder.bakedVolatiles.length > 0);

    const guard = emitGuard(lodashRun.recorder.assumptions, lodashRun.src, { fallback: "eval" });
    const wrapped = guard.wrap(`globalThis._ = { __rebuiltLodashStub: true, VERSION: "4.18.1" };`);

    // 1. Browser runtime -> fast path!
    const bCtx = vm.createContext({ setTimeout() {}, clearTimeout() {} });
    vm.runInContext("globalThis.self = globalThis;", bCtx);
    new vm.Script(wrapped).runInContext(bCtx);
    assert.equal(bCtx._.__rebuiltLodashStub, true);

    // 2. Browser with pre-existing `globalThis._` -> guard fails on `typeof _ === "undefined"`,
    // runs real Lodash so `_.noConflict()` restores prior `_`!
    const priorCtx = vm.createContext({ setTimeout() {}, clearTimeout() {} });
    vm.runInContext('globalThis.self = globalThis; globalThis._ = { priorLib: "u" };', priorCtx);
    new vm.Script(wrapped).runInContext(priorCtx);
    assert.equal(priorCtx._.__rebuiltLodashStub, undefined);
    assert.equal(priorCtx._.VERSION, "4.18.1");
    const lodashInstance = vm.runInContext("_.noConflict()", priorCtx);
    assert.equal(lodashInstance.VERSION, "4.18.1");
    assert.deepEqual(toHostPlain(priorCtx._), { priorLib: "u" });
  });
});
