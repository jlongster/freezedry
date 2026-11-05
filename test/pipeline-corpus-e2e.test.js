"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const childProcess = require("node:child_process");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const SPECS = require("../../bench/libs/specs").SPECS.filter((s) => s.tier !== "large");
const { prepackSources, prepackSourcesAsync, BailoutError } = require("../index");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(REPO_ROOT, "bench/libs/dist");
const CLI_PATH = path.join(REPO_ROOT, "hybrid/bin/hybrid.js");

const ZERO_CONFIG_OK_IDS = new Set([
  "acorn",
  "chroma-js",
  "crc-32",
  "marked",
  "moment",
  "preact-ssr-app",
  "ramda",
  "underscore",
  "yaml-router-app",
]);

const VOLATILE_BAILOUT_IDS = new Set([
  "lodash",
  "immutable",
  "d3-scale",
  "redux",
  "handlebars-app",
  "react-ssr-app",
]);

describe("End-to-End Integrated Pipeline over bench/libs/dist (run -> capture -> emit -> guard -> verify)", () => {
  it("compiles, guards, and verifies zero-config deterministic bundles and bails cleanly on volatile init", async () => {
    for (const spec of SPECS) {
      const src = fs.readFileSync(path.join(DIST_DIR, `${spec.id}.js`), "utf8");
      const sources = [{ filePath: `${spec.id}.js`, fileContents: src }];

      if (ZERO_CONFIG_OK_IDS.has(spec.id)) {
        const res = await prepackSourcesAsync(sources, {
          fallbackOnBailout: false,
          verify: true,
          verifySmokeSpecId: spec.id,
        });
        assert.equal(typeof res.code, "string", `${spec.id} must produce code`);
        assert.equal(res.bailouts.length, 0, `${spec.id} must have zero bailouts`);
        assert.equal(res.stats.verified, true, `${spec.id} must pass H4 heap isomorphism + smoke`);
        assert.ok(res.stats.assumptions > 0, `${spec.id} should record UMD/global assumptions`);
        continue;
      }

      if (VOLATILE_BAILOUT_IDS.has(spec.id)) {
        const diags = [];
        await assert.rejects(
          () =>
            prepackSourcesAsync(sources, {
              errorHandler(d) {
                diags.push(d);
                return "Fail";
              },
            }),
          BailoutError,
          `${spec.id} must bail out in zero-config mode`
        );
        assert.equal(diags[0].errorCode, "HYB_VOLATILE_BAILOUT", `${spec.id} should report HYB_VOLATILE_BAILOUT`);

        // Standalone fallback-on-bailout returns original source cleanly
        const fallbackRes = await prepackSourcesAsync(sources, {});
        assert.equal(fallbackRes.fellBack, true);
        assert.equal(fallbackRes.code, src);
      }
    }
  });

  it("unlocks volatile & browser-specific bundles with explicit opt-ins and passes full H4 heap isomorphism", async () => {
    for (const spec of SPECS) {
      if (ZERO_CONFIG_OK_IDS.has(spec.id)) continue;
      const src = fs.readFileSync(path.join(DIST_DIR, `${spec.id}.js`), "utf8");
      const sources = [{ filePath: `${spec.id}.js`, fileContents: src }];

      const res = await prepackSourcesAsync(sources, {
        useCorpusOptIns: true,
        fallbackOnBailout: false,
        verify: true,
        verifySmokeSpecId: spec.id,
      });
      assert.equal(res.stats.verified, true, `${spec.id} must pass H4 heap isomorphism`);
    }

    // Also verify strict `browser` profile with documented browser assumptions on underscore & react-ssr-app
    const usSrc = fs.readFileSync(path.join(DIST_DIR, "underscore.js"), "utf8");
    const usBrowser = await prepackSourcesAsync([{ filePath: "underscore.js", fileContents: usSrc }], {
      profile: "browser",
      assume: { "typeof:document.childNodes": "object" },
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(usBrowser.stats.verified, true);

    const reactSrc = fs.readFileSync(path.join(DIST_DIR, "react-ssr-app.js"), "utf8");
    const reactBrowser = await prepackSourcesAsync([{ filePath: "react-ssr-app.js", fileContents: reactSrc }], {
      profile: "browser",
      assume: { "navigator.scheduling": undefined, MessageChannel: undefined },
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(reactBrowser.stats.verified, true);
  });

  it("executes guard fallback to original code when runtime environment mismatches compiled assumptions", () => {
    const crcSrc = fs.readFileSync(path.join(DIST_DIR, "crc-32.js"), "utf8");
    const res = prepackSources([{ filePath: "crc-32.js", fileContents: crcSrc }], {
      profile: "browser",
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(res.stats.verified, true);

    // Run browser-compiled crc-32 inside CommonJS (typeof exports === "object") -> guard mismatches & falls back!
    const cjsCtx = vm.createContext({});
    const mod = { exports: {} };
    vm.runInContext(`(function(exports, module) {\n${res.code}\n})`, cjsCtx).call(mod.exports, mod.exports, mod);
    assert.equal(typeof mod.exports.str, "function");
    assert.equal(mod.exports.str("123456789"), -873187034);
  });

  it("supports all CLI flags (--profile, --assume, --allow-volatile, --assume-tz, --verify, --fallback)", () => {
    const tmpBase = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir();
    const dir = fs.mkdtempSync(path.join(tmpBase, "hyb-cli-all-"));
    try {
      const inFile = path.join(dir, "app.js");
      const outFile = path.join(dir, "app.out.js");
      fs.writeFileSync(
        inFile,
        [
          'const envMode = typeof APP_ENV === "string" ? APP_ENV : "dev";',
          "const stamp = Date.now();",
          "const localOff = new Date(2026, 0, 15, 12, 0, 0).getTimezoneOffset();",
          "globalThis.AppBoot = { envMode, hasStamp: typeof stamp === 'number', localOff, isWin: typeof window === 'object' };",
        ].join("\n"),
        "utf8"
      );

      const okRun = childProcess.spawnSync(
        process.execPath,
        [
          CLI_PATH,
          inFile,
          "--out",
          outFile,
          "--profile",
          "browser",
          "--assume",
          'APP_ENV="prod"',
          "--allow-volatile",
          "Date.now",
          "--assume-tz",
          "UTC",
          "--fallback",
          "throw",
          "--verify",
        ],
        { encoding: "utf8" }
      );
      assert.equal(okRun.status, 0, `CLI failed: ${okRun.stderr}`);
      const outCode = fs.readFileSync(outFile, "utf8");
      assert.match(outCode, /Prepack environment assumption failed/);

      const matchCtx = vm.createContext({});
      vm.runInContext('globalThis.window = globalThis; globalThis.APP_ENV = "prod";', matchCtx);
      const prevTz = process.env.TZ;
      process.env.TZ = "UTC";
      try {
        vm.runInContext(outCode, matchCtx);
      } finally {
        if (prevTz === undefined) delete process.env.TZ;
        else process.env.TZ = prevTz;
      }
      assert.equal(matchCtx.AppBoot.envMode, "prod");
      assert.equal(matchCtx.AppBoot.hasStamp, true);
      assert.equal(matchCtx.AppBoot.localOff, 0);
      assert.equal(matchCtx.AppBoot.isWin, true);

      // Verify --seed / --mathRandomSeed is rejected on CLI
      const seedRun = childProcess.spawnSync(process.execPath, [CLI_PATH, inFile, "--seed", "123"], {
        encoding: "utf8",
      });
      assert.notEqual(seedRun.status, 0);
      assert.match(seedRun.stderr, /Seeding Math\.random/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures, emits, and verifies arrow functions capturing lexical this (objects, cycles, primitives, top-level)", async () => {
    const src = `
      globalThis.topArrow = () => this === globalThis;
      (function() {
        "use strict";
        class Controller {
          constructor(label) {
            this.label = label;
            this.selfGetter = () => this;
          }
        }
        const ctrl = new Controller("main");
        const sharedThis = { base: 100 };
        const pair = (function(step) {
          let calls = 0;
          return {
            inc: () => { calls += 1; return this.base + calls * step; },
            nested: (() => () => [this.base, calls])(),
          };
        }).call(sharedThis, 5);
        const primNegZero = (function() { return () => this; }).call(-0);
        const primUndef = (function() { return () => this; })();
        const primNum = (function() { return () => this; }).call(42);
        const primStr = (function() { return () => this; }).call("hello");
        globalThis.ArrowSuite = { ctrl, pair, primNegZero, primUndef, primNum, primStr };
      })();
    `;

    const res = await prepackSourcesAsync([{ filePath: "arrows.js", fileContents: src }], {
      profile: "ecmascript",
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(res.stats.verified, true);

    const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    vm.runInContext("delete globalThis.console; delete globalThis.WebAssembly;", ctx);
    vm.runInContext(res.code, ctx);
    assert.equal(vm.runInContext("topArrow()", ctx), true);
    assert.equal(vm.runInContext("ArrowSuite.ctrl.selfGetter() === ArrowSuite.ctrl", ctx), true);
    assert.equal(vm.runInContext("ArrowSuite.pair.inc()", ctx), 105);
    assert.deepEqual(Array.from(vm.runInContext("ArrowSuite.pair.nested()", ctx)), [100, 1]);
    assert.equal(vm.runInContext("Object.is(ArrowSuite.primNegZero(), -0)", ctx), true);
    assert.equal(vm.runInContext("ArrowSuite.primUndef() === undefined", ctx), true);
    assert.equal(vm.runInContext("ArrowSuite.primNum()", ctx), 42);
    assert.equal(vm.runInContext("ArrowSuite.primStr()", ctx), "hello");
  });

  it("captures, emits, and verifies zero-instance classes with #private fields and methods", async () => {
    const src = `
      (function() {
        "use strict";
        const SCALE = 3;
        class Vault {
          #secret;
          constructor(seed) {
            this.#secret = seed * SCALE;
          }
          #format(prefix) {
            return prefix + ":" + this.#secret;
          }
          reveal(prefix = "val") {
            return this.#format(prefix);
          }
          bump(delta) {
            this.#secret += delta;
            return this.#secret;
          }
        }
        // Exercise Vault during init without retaining any live instance!
        const initCheck = new Vault(4).reveal("boot");
        globalThis.VaultPkg = { Vault, initCheck };
      })();
    `;

    const res = await prepackSourcesAsync([{ filePath: "vault.js", fileContents: src }], {
      profile: "ecmascript",
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(res.stats.verified, true);

    const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    vm.runInContext("delete globalThis.console; delete globalThis.WebAssembly;", ctx);
    vm.runInContext(res.code, ctx);
    assert.equal(vm.runInContext("VaultPkg.initCheck", ctx), "boot:12");
    assert.equal(vm.runInContext("const v = new VaultPkg.Vault(10); v.bump(5) + '|' + v.reveal('ok')", ctx), "35|ok:35");
  });

  it("keeps the shared scope binding for `class X extends Name` when Name is also captured by closures (three)", async () => {
    const src = `(function(){ "use strict"; class Curve { c(){return 0} } class Path extends Curve { a(){return 1} } class Shape extends Path { b(){ return new Path(); } } globalThis.T = { get Path(){return Path}, get Shape(){return Shape} }; })();`;
    const res = await prepackSourcesAsync([{ filePath: "shapes.js", fileContents: src }], {
      profile: "ecmascript",
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(res.stats.verified, true);
  });

  it("keeps a hoisted FunctionDeclaration distinct from the function that later overwrites its binding (babel getModuleName)", async () => {
    const src = `(function(){ "use strict"; var originalGetModuleName = getModuleName; getModuleName = function getModuleName(a) { return originalGetModuleName(a) + "!"; }; function getModuleName(a) { return "m:" + a; } globalThis.M = { get: function(x) { return getModuleName(x); }, orig: function(x) { return originalGetModuleName(x); } }; })();`;
    const res = await prepackSourcesAsync([{ filePath: "gmn.js", fileContents: src }], {
      profile: "ecmascript",
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(res.stats.verified, true);
  });

  it("treats Error stack formatting during init as volatile; bakes and verifies it only with --allow-volatile=Error.stack", async () => {
    const src = `(function(){ var rootStack = ""; try { throw new Error(); } catch (e) { rootStack = e.stack.split("\\n").slice(1).join("\\n"); } globalThis.Traced = { get: function() { return rootStack; } }; })();`;
    const sources = [{ filePath: "traced.js", fileContents: src }];
    const diags = [];
    await assert.rejects(
      () =>
        prepackSourcesAsync(sources, {
          profile: "ecmascript",
          errorHandler(d) {
            diags.push(d);
            return "Fail";
          },
        }),
      BailoutError
    );
    assert.equal(diags[0].errorCode, "HYB_VOLATILE_BAILOUT");
    const res = await prepackSourcesAsync(sources, {
      profile: "ecmascript",
      allowVolatile: ["Error.stack"],
      fallbackOnBailout: false,
      verify: true,
    });
    assert.equal(res.stats.verified, true);
    assert.equal(res.stats.bakedVolatiles, 1);
  });

  it("recomputes pure deterministic TypedArray/ArrayBuffer tables instead of emitting multi-KB base64 (crc-32)", async () => {
    const crcSrc = fs.readFileSync(path.join(DIST_DIR, "crc-32.js"), "utf8");
    const res = await prepackSourcesAsync([{ filePath: "crc-32.js", fileContents: crcSrc }], {
      fallbackOnBailout: false,
      verify: true,
      verifySmokeSpecId: "crc-32",
    });
    assert.equal(res.stats.verified, true);
    assert.ok(res.code.length < 10000, `Expected compact recomputed crc-32 (< 10KB), got ${res.code.length} bytes`);
    assert.equal(res.code.includes("fromBase64"), false, "crc-32 should not need base64 buffer decoding");
  });
});
