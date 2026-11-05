"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  PROFILES,
  installEnvironment,
  createBeforeRunHook,
  emitGuard,
  measureGuardOverhead,
  parseEnvFlags,
} = require("../lib/env.js");

// Helper: simulates the freezedry pipeline on small scripts whose root state is JSON/primitive globals,
// then verifies originalSource vs guardedOutput in fresh VM contexts (both when assumptions hold
// and when assumptions are violated!).
function compileSimpleGlobalScript(originalSource, profile, assumptions, opts, emitOpts) {
  const ctx = vm.createContext({});
  const initialKeys = new Set(vm.runInContext("Reflect.ownKeys(globalThis)", ctx));
  const recorder = installEnvironment(ctx, profile, assumptions, opts);

  let runError = null;
  try {
    new vm.Script(originalSource, { filename: "input.js" }).runInContext(ctx, { timeout: 5000 });
  } catch (err) {
    runError = err;
  } finally {
    recorder.restore();
  }

  if (recorder.hasBailout() || runError) {
    return { ok: false, recorder, runError, code: null, guard: null };
  }

  const finalKeys = vm.runInContext("Reflect.ownKeys(globalThis)", ctx);
  const addedKeys = finalKeys.filter(k => !initialKeys.has(k));
  const lines = ["globalThis.__fastPathTaken = true;"];
  for (let i = 0; i < addedKeys.length; i++) {
    const k = addedKeys[i];
    const val = ctx[k];
    lines.push(`globalThis[${JSON.stringify(k)}] = ${serializeTestValue(val)};`);
  }
  const rebuiltHeapCode = lines.join("\n");
  const guard = emitGuard(recorder.assumptions, originalSource, emitOpts);
  const code = guard.wrap(rebuiltHeapCode);

  return { ok: true, recorder, runError: null, code, guard, rebuiltHeapCode };
}

function serializeTestValue(val) {
  if (val === undefined) return "void 0";
  if (val === null) return "null";
  if (typeof val === "bigint") return `${val.toString()}n`;
  if (typeof val === "number") {
    if (Number.isNaN(val)) return "NaN";
    if (Object.is(val, -0)) return "-0";
    if (!Number.isFinite(val)) return val > 0 ? "1/0" : "-1/0";
    return String(val);
  }
  if (typeof val === "function") return val.toString();
  if (val instanceof Date) return `new Date(${val.getTime()})`;
  if (Array.isArray(val) || Object.prototype.toString.call(val) === "[object Array]") {
    return `[${Array.from(val, serializeTestValue).join(", ")}]`;
  }
  return JSON.stringify(val);
}

function toHostPlain(val) {
  if (val === null || typeof val !== "object") return val;
  return JSON.parse(JSON.stringify(val));
}

function runInFreshContext(code, sandboxInit) {
  const sandbox = Object.assign({}, sandboxInit || null);
  const ctx = vm.createContext(sandbox);
  if (sandboxInit) {
    for (const k of Object.keys(sandboxInit)) {
      if (sandboxInit[k] === "__SELF__") {
        vm.runInContext(`globalThis[${JSON.stringify(k)}] = globalThis;`, ctx);
      }
    }
  }
  new vm.Script(code, { filename: "runtime.js" }).runInContext(ctx, { timeout: 5000 });
  return ctx;
}

describe("Target Environment Profiles & Assumption Recording", () => {
  it("exposes all six target profiles (ecmascript, browser, node, worker, bun, hermes)", () => {
    for (const name of ["ecmascript", "browser", "node", "worker", "bun", "hermes"]) {
      assert.ok(PROFILES[name], `missing profile ${name}`);
      assert.equal(PROFILES[name].name, name);
    }
    assert.throws(
      () => installEnvironment(vm.createContext({}), "unknown-target"),
      /Unknown target environment profile/
    );
  });

  it("records typeof window branches in browser vs node vs ecmascript and matches original on mismatch", () => {
    const src = `
      globalThis.envKind =
        typeof window === "object" ? "browser-like" :
        typeof process === "object" ? "node-like" :
        "bare-es";
    `;

    // Compile for browser profile
    const compiled = compileSimpleGlobalScript(src, "browser");
    assert.equal(compiled.ok, true);
    assert.deepEqual(compiled.recorder.assumptions, [
      { kind: "typeof", expr: "typeof window", observed: "object" },
      { kind: "value", expr: "window === globalThis", observed: true },
    ]);

    // 1. Run in matching browser-like context -> fast path taken, matches original!
    const origBrowser = runInFreshContext(src, { window: "__SELF__" });
    const outBrowser = runInFreshContext(compiled.code, { window: "__SELF__" });
    assert.equal(outBrowser.__fastPathTaken, true);
    assert.equal(outBrowser.envKind, "browser-like");
    assert.equal(outBrowser.envKind, origBrowser.envKind);

    // 2. Run in mismatched node-like context -> guard fails, fallback runs original!
    const origNode = runInFreshContext(src, { process: { version: "v26" } });
    const outNode = runInFreshContext(compiled.code, { process: { version: "v26" } });
    assert.equal(outNode.__fastPathTaken, undefined);
    assert.equal(outNode.envKind, "node-like");
    assert.equal(outNode.envKind, origNode.envKind);

    // 3. Run in bare ES context -> guard fails without ReferenceError, fallback runs original!
    const origBare = runInFreshContext(src);
    const outBare = runInFreshContext(compiled.code);
    assert.equal(outBare.__fastPathTaken, undefined);
    assert.equal(outBare.envKind, "bare-es");
    assert.equal(outBare.envKind, origBare.envKind);
  });

  it("records 'in globalThis' checks accurately across profiles", () => {
    const src = `
      globalThis.hasProcess = "process" in globalThis;
      globalThis.hasFetch = "fetch" in globalThis;
    `;

    const browserBuild = compileSimpleGlobalScript(src, "browser");
    assert.equal(browserBuild.ok, true);
    assert.equal(browserBuild.guard.condition, '!("process" in globalThis) && "fetch" in globalThis');

    const matchCtx = runInFreshContext(browserBuild.code, { fetch: function() {} });
    assert.equal(matchCtx.__fastPathTaken, true);
    assert.equal(matchCtx.hasProcess, false);
    assert.equal(matchCtx.hasFetch, true);

    const mismatchCtx = runInFreshContext(browserBuild.code, { process: {}, fetch: function() {} });
    assert.equal(mismatchCtx.__fastPathTaken, undefined);
    assert.equal(mismatchCtx.hasProcess, true);
    assert.equal(mismatchCtx.hasFetch, true);
  });

  it("hides V8 host-injected console and WebAssembly in pure ecmascript and hermes profiles", () => {
    const src = `
      globalThis.types = {
        console: typeof console,
        wasm: typeof WebAssembly,
      };
    `;

    const esBuild = compileSimpleGlobalScript(src, "ecmascript");
    assert.equal(esBuild.ok, true);
    const esOut = runInFreshContext("delete globalThis.console; delete globalThis.WebAssembly;\n" + esBuild.code);
    assert.equal(esOut.__fastPathTaken, true);
    assert.deepEqual(toHostPlain(esOut.types), { console: "undefined", wasm: "undefined" });

    const hermesBuild = compileSimpleGlobalScript(src, "hermes");
    assert.equal(hermesBuild.ok, true);
    assert.ok(hermesBuild.guard.condition.includes('typeof console === "object"'));
    assert.ok(hermesBuild.guard.condition.includes('typeof WebAssembly === "undefined"'));
  });

  it("handles hyphenated / non-identifier global names safely without invalid typeof syntax", () => {
    const src = `
      globalThis.hasShared = typeof globalThis["__core-js_shared__"] !== "undefined";
    `;
    const built = compileSimpleGlobalScript(src, "browser");
    assert.equal(built.ok, true);
    assert.equal(built.guard.condition, 'typeof globalThis["__core-js_shared__"] === "undefined"');

    const okCtx = runInFreshContext(built.code);
    assert.equal(okCtx.__fastPathTaken, true);
    assert.equal(okCtx.hasShared, false);

    const fallbackCtx = runInFreshContext(built.code, { "__core-js_shared__": {} });
    assert.equal(fallbackCtx.__fastPathTaken, undefined);
    assert.equal(fallbackCtx.hasShared, true);
  });

  it("bails out with exact name and stack location when reading unasserted properties of target globals", () => {
    const src = [
      "const ok = typeof window === 'object';",
      "const ua = navigator.userAgent;",
      "globalThis.ua = ua;",
    ].join("\n");

    const res = compileSimpleGlobalScript(src, "browser");
    assert.equal(res.ok, false);
    assert.equal(res.recorder.hasBailout(), true);
    assert.equal(res.recorder.bailouts[0].name, "navigator.userAgent");
    assert.match(res.recorder.bailouts[0].where, /input\.js:2:/);
    assert.match(res.recorder.bailouts[0].reason, /navigator\.userAgent/);
  });

  it("handles process.env.NODE_ENV branches in node profile (bailout by default, folded + guarded when assumed)", () => {
    const reactLikeEntry = `
      if (process.env.NODE_ENV === "production") {
        globalThis.ReactMode = { mode: "prod", devChecks: false };
      } else {
        globalThis.ReactMode = { mode: "dev", devChecks: true };
      }
    `;

    // 1. Default node profile without --assume -> bails out on process.env.NODE_ENV!
    const unasserted = compileSimpleGlobalScript(reactLikeEntry, "node");
    assert.equal(unasserted.ok, false);
    assert.equal(unasserted.recorder.bailouts[0].name, "process.env.NODE_ENV");
    assert.match(unasserted.recorder.bailouts[0].where, /input\.js:2:/);

    // 2. With --assume process.env.NODE_ENV="production" -> folds prod branch and guards!
    const prodBuild = compileSimpleGlobalScript(reactLikeEntry, "node", {
      "process.env.NODE_ENV": "production",
    });
    assert.equal(prodBuild.ok, true);
    assert.equal(
      prodBuild.guard.condition,
      'typeof process === "object" && process !== null && typeof process.env === "object" && process.env !== null && process.env.NODE_ENV === "production"'
    );

    // Runtime with NODE_ENV="production" -> fast path!
    const prodRuntime = runInFreshContext(prodBuild.code, {
      process: { env: { NODE_ENV: "production", EXTRA: "ignored" } },
    });
    assert.equal(prodRuntime.__fastPathTaken, true);
    assert.deepEqual(toHostPlain(prodRuntime.ReactMode), { mode: "prod", devChecks: false });

    // Runtime with NODE_ENV="development" -> guard fails, fallback runs original dev branch!
    const devRuntime = runInFreshContext(prodBuild.code, {
      process: { env: { NODE_ENV: "development" } },
    });
    assert.equal(devRuntime.__fastPathTaken, undefined);
    assert.deepEqual(toHostPlain(devRuntime.ReactMode), { mode: "dev", devChecks: true });

    // Runtime where process is null (`typeof null === "object"` trap!) -> guard safely fails without TypeError!
    const nullProcessGuard = emitGuard(prodBuild.recorder.assumptions, reactLikeEntry, { fallback: "throw" });
    assert.throws(
      () => runInFreshContext(nullProcessGuard.wrap("globalThis.ok = 1;"), { process: null }),
      /Prepack environment assumption failed/
    );

    // 3. Unasserted sibling `process.env.SECRET` or `process.platform` still bails out!
    const siblingSrc = `
      const env = process.env.NODE_ENV;
      const plat = process.platform;
      globalThis.info = env + ":" + plat;
    `;
    const siblingRes = compileSimpleGlobalScript(siblingSrc, "node", {
      "process.env.NODE_ENV": "production",
    });
    assert.equal(siblingRes.ok, false);
    assert.equal(siblingRes.recorder.bailouts[0].name, "process.platform");
  });

  it("supports structured JSON --assume values with both granular and Object.keys JSON guards", () => {
    const granularSrc = `
      globalThis.endpoint = APP_CFG.api + "/v" + APP_CFG.version;
    `;
    const gBuild = compileSimpleGlobalScript(granularSrc, "ecmascript", {
      APP_CFG: { api: "https://api.example.com", version: 2, unused: true },
    });
    assert.equal(gBuild.ok, true);
    assert.equal(
      gBuild.guard.condition,
      'typeof APP_CFG === "object" && APP_CFG !== null && APP_CFG.api === "https://api.example.com" && APP_CFG.version === 2'
    );

    const enumSrc = `
      globalThis.cfgKeys = Object.keys(APP_CFG).join(",");
    `;
    const eBuild = compileSimpleGlobalScript(enumSrc, "ecmascript", {
      APP_CFG: { a: 1, b: 2 },
    });
    assert.equal(eBuild.ok, true);
    assert.ok(eBuild.guard.condition.includes('JSON.stringify(APP_CFG) === "{\\"a\\":1,\\"b\\":2}"'));

    const matchOut = runInFreshContext(eBuild.code, { APP_CFG: { a: 1, b: 2 } });
    assert.equal(matchOut.__fastPathTaken, true);
    assert.equal(matchOut.cfgKeys, "a,b");

    const extraKeyOut = runInFreshContext(eBuild.code, { APP_CFG: { a: 1, b: 2, c: 3 } });
    assert.equal(extraKeyOut.__fastPathTaken, undefined);
    assert.equal(extraKeyOut.cfgKeys, "a,b,c");
  });
});

describe("Volatile APIs, Timezone Pinning, and Math.random Policy", () => {
  it("forbids --seed / mathRandomSeed and supports --allow-volatile=Math.random with documentation", () => {
    const ctx = vm.createContext({});
    assert.throws(() => installEnvironment(ctx, "ecmascript", { seed: 123 }), /not allowed/);
    assert.throws(() => installEnvironment(ctx, "ecmascript", {}, { mathRandomSeed: 0 }), /not allowed/);
    assert.throws(() => parseEnvFlags(["--seed=42"]), /not allowed/);
    assert.throws(() => parseEnvFlags(["--mathRandomSeed", "0"]), /not allowed/);

    // Default: Math.random() bails out EVEN when user code swallows exceptions in try/catch (like Redux)!
    const swallowedRandomSrc = `
      let token = "fallback";
      try {
        token = Math.random().toString(36).slice(2);
      } catch (_e) {}
      globalThis.token = token;
    `;
    const bailed = compileSimpleGlobalScript(swallowedRandomSrc, "ecmascript");
    assert.equal(bailed.ok, false);
    assert.equal(bailed.recorder.hasBailout(), true);
    assert.equal(bailed.recorder.bailouts[0].name, "Math.random");

    // Opt-in: --allow-volatile=Math.random bakes and documents the call in bakedVolatiles & diagnostics
    const allowed = compileSimpleGlobalScript(
      `globalThis.actionType = "@@redux/INIT" + Math.random().toString(36).slice(2, 8);`,
      "ecmascript",
      {},
      { allowVolatile: ["Math.random"] }
    );
    assert.equal(allowed.ok, true);
    assert.equal(allowed.recorder.bakedVolatiles.length, 1);
    assert.equal(allowed.recorder.bakedVolatiles[0].api, "Math.random");
    assert.equal(typeof allowed.recorder.bakedVolatiles[0].value, "number");
    assert.equal(allowed.recorder.diagnostics[0].code, "FZD_VOLATILE_BAKED");
  });

  it("wraps Date preserving Date.prototype identity, subclassing, and deterministic UTC operations", () => {
    const ctx = vm.createContext({});
    const rec = installEnvironment(ctx, "ecmascript");
    const check = vm.runInContext(
      `
      class CustomDate extends Date {}
      const d = new Date(0);
      const iso = new Date("2026-03-15T14:25:00.000Z");
      const dateOnly = new Date("2026-03-15");
      const sub = new CustomDate(1000);
      ({
        isDate: d instanceof Date,
        protoExact: Object.getPrototypeOf(d) === Date.prototype,
        ctorExact: d.constructor === Date,
        tag: Object.prototype.toString.call(d),
        nativeStr: Function.prototype.toString.call(Date).includes("[native code]"),
        utcHours: iso.getUTCHours(),
        isoStr: iso.toISOString(),
        dateOnlyMs: dateOnly.getTime(),
        utcStatic: Date.UTC(2026, 0, 1),
        parseUtc: Date.parse("2026-03-15T00:00:00Z"),
        subIsCustom: sub instanceof CustomDate,
        subIsDate: sub instanceof Date,
      });
    `,
      ctx
    );
    rec.restore();

    assert.equal(rec.hasBailout(), false);
    assert.equal(rec.assumptions.length, 0);
    assert.equal(check.isDate, true);
    assert.equal(check.protoExact, true);
    assert.equal(check.ctorExact, true);
    assert.equal(check.tag, "[object Date]");
    assert.equal(check.nativeStr, true);
    assert.equal(check.utcHours, 14);
    assert.equal(check.isoStr, "2026-03-15T14:25:00.000Z");
    assert.equal(check.subIsCustom, true);
    assert.equal(check.subIsDate, true);

    // After restore(), Date on globalThis is the original unwrapped constructor (not a Proxy)
    assert.equal(require("node:util").types.isProxy(vm.runInContext("Date", ctx)), false);
  });

  it("bails out on Date.now(), new Date(), and Date() by default, and allows opt-in", () => {
    for (const [expr, expectedName] of [
      ["Date.now()", "Date.now"],
      ["new Date()", "new Date()"],
      ["Date()", "Date()"],
    ]) {
      const res = compileSimpleGlobalScript(`globalThis.t = ${expr};`, "ecmascript");
      assert.equal(res.ok, false, `expected bailout for ${expr}`);
      assert.equal(res.recorder.bailouts[0].name, expectedName);
    }

    const optedIn = compileSimpleGlobalScript(
      `globalThis.hasStamp = typeof Date.now() === "number" && (new Date()) instanceof Date;`,
      "ecmascript",
      {},
      { allowVolatile: ["Date"] }
    );
    assert.equal(optedIn.ok, true);
    assert.equal(optedIn.recorder.bakedVolatiles.length, 2);
  });

  it("pins timezone with --assume-tz=UTC regardless of build host TZ, and falls back when runtime TZ differs", () => {
    const tzSrc = `
      const d = new Date(2026, 0, 15, 12, 0, 0);
      globalThis.tzSummary = {
        offset: d.getTimezoneOffset(),
        localHour: d.getHours(),
        utcHour: d.getUTCHours(),
      };
    `;

    // 1. Without --assume-tz -> bails out!
    const noTz = compileSimpleGlobalScript(tzSrc, "ecmascript");
    assert.equal(noTz.ok, false);
    assert.match(noTz.recorder.bailouts[0].reason, /--assume-tz=UTC/);

    // 2. Simulate build host in America/New_York while compiling with --assume-tz=UTC!
    const prevTZ = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const utcBuild = compileSimpleGlobalScript(tzSrc, "ecmascript", {}, { tz: "UTC" });
      // Verify host TZ was restored back to America/New_York immediately after compile!
      assert.equal(process.env.TZ, "America/New_York");

      assert.equal(utcBuild.ok, true);
      assert.equal(utcBuild.guard.condition, "new Date(0).getTimezoneOffset() === 0");

      // Run output in UTC -> fast path taken, matches original in UTC!
      process.env.TZ = "UTC";
      const origUtc = runInFreshContext(tzSrc);
      const outUtc = runInFreshContext(utcBuild.code);
      assert.equal(outUtc.__fastPathTaken, true);
      assert.deepEqual(toHostPlain(outUtc.tzSummary), { offset: 0, localHour: 12, utcHour: 12 });
      assert.deepEqual(toHostPlain(outUtc.tzSummary), toHostPlain(origUtc.tzSummary));

      // Run output in Tokyo (UTC+9, offset -540) -> guard fails, fallback runs original in Tokyo TZ!
      process.env.TZ = "Asia/Tokyo";
      const origTokyo = runInFreshContext(tzSrc);
      const outTokyo = runInFreshContext(utcBuild.code);
      assert.equal(outTokyo.__fastPathTaken, undefined);
      assert.deepEqual(toHostPlain(outTokyo.tzSummary), { offset: -540, localHour: 12, utcHour: 3 });
      assert.deepEqual(toHostPlain(outTokyo.tzSummary), toHostPlain(origTokyo.tzSummary));
    } finally {
      if (prevTZ === undefined) delete process.env.TZ;
      else process.env.TZ = prevTZ;
    }
  });

  it("handles performance.now, crypto.getRandomValues, timers, queueMicrotask, and Intl/locale methods", async () => {
    // Caching timer/performance references without calling them is allowed and recorded
    const cacheOnlySrc = `
      const hasPerf = typeof performance === "object" && typeof performance.now === "function";
      const hasTimer = typeof setTimeout === "function";
      globalThis.caps = { hasPerf, hasTimer };
    `;
    const cached = compileSimpleGlobalScript(cacheOnlySrc, "browser");
    assert.equal(cached.ok, true);
    assert.ok(cached.guard.condition.includes('typeof performance.now === "function"'));
    assert.ok(cached.guard.condition.includes('typeof setTimeout === "function"'));

    // Calling performance.now, crypto.getRandomValues, setTimeout, Intl, toLocaleString bails out by default
    for (const [snippet, expected] of [
      ["performance.now()", "performance.now"],
      ["crypto.getRandomValues(new Uint8Array(4))", "crypto.getRandomValues"],
      ["setTimeout(() => {}, 0)", "setTimeout"],
      ["setInterval(() => {}, 10)", "setInterval"],
      ["new Intl.NumberFormat('en-US')", "Intl.NumberFormat"],
      ["(12345.6).toLocaleString()", "Number.prototype.toLocaleString"],
      ["'a'.localeCompare('b')", "String.prototype.localeCompare"],
      ["new Uint8Array([1, 2]).toLocaleString()", "TypedArray.prototype.toLocaleString"],
      ["console.log('side effect')", "console.log"],
    ]) {
      const r = compileSimpleGlobalScript(`globalThis.x = ${snippet};`, "browser");
      assert.equal(r.ok, false, `expected bailout for ${snippet}`);
      assert.equal(r.recorder.bailouts[0].name, expected);
    }

    // Opt-in crypto.getRandomValues works cleanly across VM boundary
    const cryptoCtx = vm.createContext({});
    const cryptoRec = installEnvironment(cryptoCtx, "browser", {}, { allowVolatile: ["crypto.getRandomValues"] });
    const arrLen = vm.runInContext(`const u = new Uint8Array(16); crypto.getRandomValues(u); u.length;`, cryptoCtx);
    cryptoRec.restore();
    assert.equal(cryptoRec.hasBailout(), false);
    assert.equal(arrLen, 16);
    assert.equal(cryptoRec.bakedVolatiles[0].api, "crypto.getRandomValues");

    // queueMicrotask is allowed and executes microtasks in the VM context
    const microCtx = vm.createContext({});
    const microRec = installEnvironment(microCtx, "browser");
    vm.runInContext(
      `
      globalThis.order = ["sync"];
      queueMicrotask(() => { globalThis.order.push("microtask"); });
    `,
      microCtx
    );
    await new Promise(r => setImmediate(r));
    microRec.restore();
    assert.equal(microRec.hasBailout(), false);
    assert.deepEqual(Array.from(microCtx.order), ["sync", "microtask"]);
  });
});

describe("Guard Emission Strategies & H1 beforeRun Hook Integration", () => {
  it("handles special primitive values (-0, NaN, Infinity, bigint, undefined, null) in guards", () => {
    const src = `
      globalThis.vals = [NEG_ZERO, NOT_NUM, INF_VAL, BIG_VAL, NULL_VAL, UNDEF_VAL];
    `;
    const res = compileSimpleGlobalScript(src, "ecmascript", {
      NEG_ZERO: -0,
      NOT_NUM: NaN,
      INF_VAL: Infinity,
      BIG_VAL: 42n,
      NULL_VAL: null,
      UNDEF_VAL: undefined,
    });
    assert.equal(res.ok, true);
    assert.ok(res.guard.condition.includes("Object.is(NEG_ZERO, -0)"));
    assert.ok(res.guard.condition.includes("Number.isNaN(NOT_NUM)"));
    assert.ok(res.guard.condition.includes("INF_VAL === 1 / 0"));
    assert.ok(res.guard.condition.includes("BIG_VAL === 42n"));

    // Positive +0 must NOT satisfy the -0 guard!
    const plusZeroGuard = emitGuard(res.recorder.assumptions, src, { fallback: "throw" });
    assert.throws(
      () =>
        runInFreshContext(plusZeroGuard.wrap("globalThis.ok = true;"), {
          NEG_ZERO: +0,
          NOT_NUM: NaN,
          INF_VAL: Infinity,
          BIG_VAL: 42n,
          NULL_VAL: null,
        }),
      /Prepack environment assumption failed/
    );

    const exactMatch = runInFreshContext(plusZeroGuard.wrap("globalThis.ok = true;"), {
      NEG_ZERO: -0,
      NOT_NUM: NaN,
      INF_VAL: Infinity,
      BIG_VAL: 42n,
      NULL_VAL: null,
    });
    assert.equal(exactMatch.ok, true);
  });

  it("supports eval, function (CSP-safe + CJS-compatible), throw, and external fallback strategies", () => {
    const umdSrc = `(function (root, factory) {
      if (typeof exports === "object" && typeof module !== "undefined") {
        module.exports = factory();
      } else {
        root.Widget = factory();
      }
    })(this, function () { return { ready: true }; });`;

    const assumptions = [
      { kind: "typeof", expr: "typeof exports", observed: "undefined" },
      { kind: "typeof", expr: "typeof module", observed: "undefined" },
    ];
    const rebuilt = `globalThis.Widget = { ready: true, fast: true };`;

    // 1. "eval" fallback preserves top-level var/function declarations on globalThis
    const varSrc = `var topLevelAnswer = 42; function topFn() { return topLevelAnswer; }`;
    const evalGuard = emitGuard([{ kind: "typeof", expr: "typeof window", observed: "object" }], varSrc, {
      fallback: "eval",
    });
    const evalCtx = runInFreshContext(evalGuard.wrap(`globalThis.topLevelAnswer = -1;`));
    assert.equal(evalCtx.topLevelAnswer, 42);
    assert.equal(vm.runInContext("topFn()", evalCtx), 42);

    // 2. "function" fallback runs without eval (CSP-safe) and populates CJS module.exports!
    const fnGuard = emitGuard(assumptions, umdSrc, { fallback: "function" });
    const cjsCtx = vm.createContext({});
    const mod = { exports: {} };
    const cjsWrapper = `(function(exports, module) {\n${fnGuard.wrap(rebuilt)}\n})`;
    vm.runInContext(cjsWrapper, cjsCtx).call(mod.exports, mod.exports, mod);
    assert.deepEqual(toHostPlain(mod.exports), { ready: true });
    assert.equal(cjsCtx.Widget, undefined);

    // 3. "throw" fallback throws clear diagnostic message
    const throwGuard = emitGuard(assumptions, null, { fallback: "throw" });
    assert.throws(
      () => runInFreshContext(throwGuard.wrap(rebuilt), { exports: {}, module: { exports: {} } }),
      /Prepack environment assumption failed \(typeof exports === "undefined"/
    );

    // 4. "external" fallback delegates to require(externalPath)
    const extGuard = emitGuard(assumptions, null, {
      fallback: "external",
      externalPath: "./widget.orig.js",
    });
    const extCtx = vm.createContext({});
    const extMod = { exports: {} };
    let requiredPath = null;
    const fakeRequire = p => {
      requiredPath = p;
      return { fromExternal: true };
    };
    const extWrapper = `(function(exports, require, module) {\n${extGuard.wrap(rebuilt)}\n})`;
    vm.runInContext(extWrapper, extCtx).call(extMod.exports, extMod.exports, fakeRequire, extMod);
    assert.equal(requiredPath, "./widget.orig.js");
    assert.deepEqual(extMod.exports, { fromExternal: true });

    // 5. Measure size overhead across all 4 strategies
    const overhead = measureGuardOverhead(assumptions, umdSrc, rebuilt);
    assert.ok(overhead.strategies.throw.rawBytes < overhead.strategies.eval.rawBytes);
    assert.ok(overhead.strategies.external.rawBytes < overhead.strategies.eval.rawBytes);
    assert.ok(overhead.strategies.function.rawBytes > 0);
  });

  it("plugs cleanly into H1's beforeRun(ctx, intrinsicsMap) hook and preserves user intrinsicPatches", () => {
    const ctx = vm.createContext({});
    const intrinsicsMap = new Map();
    intrinsicsMap.set(vm.runInContext("Object", ctx), "Object");

    const hook = createBeforeRunHook("browser");
    const cleanup = hook.beforeRun(ctx, intrinsicsMap);

    const capturedRefs = vm.runInContext(
      `
      // User polyfill on Array.prototype must survive restore()!
      Array.prototype.__myCustomHelper = function() { return 1; };
      ({
        st: setTimeout,
        perf: performance,
        perfNow: performance.now,
        dateCtor: Date,
        mathRand: Math.random,
      });
    `,
      ctx
    );

    // All stand-ins & volatile wrappers are registered in H1's intrinsicsMap!
    assert.equal(intrinsicsMap.get(capturedRefs.st), "setTimeout");
    assert.equal(intrinsicsMap.get(capturedRefs.perf), "performance");
    assert.equal(intrinsicsMap.get(capturedRefs.perfNow), "performance.now");
    assert.equal(intrinsicsMap.get(capturedRefs.dateCtor), "Date");
    assert.equal(intrinsicsMap.get(capturedRefs.mathRand), "Math.random");

    cleanup();

    // Prototype chain has zero Proxies after cleanup, and user's Array.prototype patch is preserved!
    const utilTypes = require("node:util").types;
    const gProto = vm.runInContext("Object.getPrototypeOf(globalThis)", ctx);
    const gProtoParent = vm.runInContext("Object.getPrototypeOf(Object.getPrototypeOf(globalThis))", ctx);
    assert.equal(utilTypes.isProxy(gProto), false);
    assert.equal(utilTypes.isProxy(gProtoParent), false);
    assert.equal(vm.runInContext("typeof Array.prototype.__myCustomHelper", ctx), "function");
  });

  it("supports reverse Map<string, object> and WeakMap<object, string> intrinsicsMap orientations", () => {
    // 1. Reverse Map<string, object>
    const ctx1 = vm.createContext({});
    const pathToObj = new Map([["Object", vm.runInContext("Object", ctx1)]]);
    const rec1 = installEnvironment(ctx1, "browser", {}, { intrinsicsMap: pathToObj });
    const refs1 = vm.runInContext("({ d: Date, st: setTimeout })", ctx1);
    assert.equal(pathToObj.get("Date"), refs1.d);
    assert.equal(pathToObj.get("setTimeout"), refs1.st);
    rec1.restore();

    // 2. WeakMap<object, string>
    const ctx2 = vm.createContext({});
    const weakMap = new WeakMap();
    const rec2 = installEnvironment(ctx2, "browser", {}, { intrinsicsMap: weakMap });
    const refs2 = vm.runInContext("({ d: Date, r: Math.random })", ctx2);
    assert.equal(weakMap.get(refs2.d), "Date");
    assert.equal(weakMap.get(refs2.r), "Math.random");
    rec2.restore();
  });

  it("emits zero guard overhead when no environment assumptions were recorded", () => {
    const src = `const xs = [1, 2, 3, 4]; globalThis.sum = xs.reduce((a, b) => a + b, 0);`;
    const res = compileSimpleGlobalScript(src, "ecmascript");
    assert.equal(res.ok, true);
    assert.equal(res.recorder.assumptions.length, 0);
    assert.equal(res.guard.prelude, "");
    assert.equal(res.guard.condition, null);
    assert.equal(res.code, res.rebuiltHeapCode);
  });

  it("escapes </script> and U+2028/U+2029 safely in eval fallback strings", () => {
    const trickySrc = 'globalThis.html = "</script>\\u2028\\u2029ok";';
    const g = emitGuard([{ kind: "typeof", expr: "typeof window", observed: "object" }], trickySrc, {
      fallback: "eval",
    });
    const wrapped = g.wrap("globalThis.html = 'fast';");
    assert.equal(wrapped.includes("</script>"), false);
    const ctx = runInFreshContext(wrapped);
    assert.equal(ctx.html, "</script>\u2028\u2029ok");
  });

  it("bails out on unknown host object mutations, calls, constructor calls, 'in' checks, Object.keys, and __dirname", () => {
    for (const [profile, snippet, expectedName] of [
      ["browser", 'document.title = "hi";', "document.title"],
      ["browser", '"hidden" in document;', "document.hidden"],
      ["browser", "Object.keys(navigator);", "navigator"],
      ["browser", 'fetch("/api");', "fetch"],
      ["browser", "new XMLHttpRequest();", "XMLHttpRequest"],
      ["node", "globalThis.dir = __dirname;", "__dirname"],
    ]) {
      const r = compileSimpleGlobalScript(snippet, profile);
      assert.equal(r.ok, false, `expected bailout for ${snippet}`);
      assert.equal(r.recorder.bailouts[0].name, expectedName);
    }

    // Asserting __dirname in node profile folds and guards it cleanly
    const dirBuild = compileSimpleGlobalScript(`globalThis.cfgPath = __dirname + "/app.json";`, "node", {
      __dirname: "/srv/www",
    });
    assert.equal(dirBuild.ok, true);
    assert.equal(dirBuild.guard.condition, 'typeof __dirname === "string" && __dirname === "/srv/www"');
    const match = runInFreshContext(dirBuild.code, { __dirname: "/srv/www" });
    assert.equal(match.__fastPathTaken, true);
    assert.equal(match.cfgPath, "/srv/www/app.json");
    const diff = runInFreshContext(dirBuild.code, { __dirname: "/var/other" });
    assert.equal(diff.__fastPathTaken, undefined);
    assert.equal(diff.cfgPath, "/var/other/app.json");
  });

  it("records Symbol.toStringTag checks (Object.prototype.toString.call(globalThis) and process)", () => {
    // core-js style Node detection: Object.prototype.toString.call(process) === "[object process]"
    const nodeDetectSrc = `
      globalThis.isRealNode =
        typeof process !== "undefined" &&
        Object.prototype.toString.call(process) === "[object process]";
    `;
    const nodeBuild = compileSimpleGlobalScript(nodeDetectSrc, "node");
    assert.equal(nodeBuild.ok, true);
    assert.ok(nodeBuild.guard.condition.includes('process[Symbol.toStringTag] === "process"'));

    const fakeProcCtx = runInFreshContext(nodeBuild.code, { process: {} });
    assert.equal(fakeProcCtx.__fastPathTaken, undefined);
    assert.equal(fakeProcCtx.isRealNode, false);

    const realTagProc = { [Symbol.toStringTag]: "process" };
    const realProcCtx = runInFreshContext(nodeBuild.code, { process: realTagProc });
    assert.equal(realProcCtx.__fastPathTaken, true);
    assert.equal(realProcCtx.isRealNode, true);
  });

  it("supports named IANA timezones via --assume-tz=America/New_York", () => {
    const prevTZ = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const nyBuild = compileSimpleGlobalScript(
        `globalThis.nyOffsetJan = new Date(2026, 0, 15, 12, 0, 0).getTimezoneOffset();`,
        "ecmascript",
        {},
        { tz: "America/New_York" }
      );
      assert.equal(nyBuild.ok, true);
      assert.ok(nyBuild.guard.condition.includes('"America/New_York"'));

      process.env.TZ = "America/New_York";
      const inNy = runInFreshContext(nyBuild.code);
      assert.equal(inNy.__fastPathTaken, true);
      assert.equal(inNy.nyOffsetJan, 300);

      process.env.TZ = "UTC";
      const inUtc = runInFreshContext(nyBuild.code);
      assert.equal(inUtc.__fastPathTaken, undefined);
      assert.equal(inUtc.nyOffsetJan, 0);
    } finally {
      if (prevTZ === undefined) delete process.env.TZ;
      else process.env.TZ = prevTZ;
    }
  });
});
