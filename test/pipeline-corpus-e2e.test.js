"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const childProcess = require("node:child_process");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { SPECS } = require("../../bench/libs/specs");
const { prepackSources, prepackSourcesAsync, BailoutError } = require("../index");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(REPO_ROOT, "bench/libs/dist");
const CLI_PATH = path.join(REPO_ROOT, "hybrid/bin/hybrid.js");

const ZERO_CONFIG_OK_IDS = new Set([
  "acorn",
  "chroma-js",
  "crc-32",
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

      try {
        const res = await prepackSourcesAsync(sources, {
          useCorpusOptIns: true,
          fallbackOnBailout: false,
          verify: true,
          verifySmokeSpecId: spec.id,
        });
        assert.equal(res.stats.verified, true, `${spec.id} must pass H4 heap isomorphism`);
      } catch (err) {
        // Prior to Phase C #private class support, only `marked` may bail on `#private`
        assert.equal(spec.id, "marked", `Unexpected failure on ${spec.id}: ${err.message}`);
        assert.match(err.message, /private/i);
      }
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
});
