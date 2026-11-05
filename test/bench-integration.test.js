"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { prepackSources, prepackVersion, createPrepackSources } = require("../index");
const { generateComparisonData, renderComparisonMarkdown } = require("../bench-compare");

const REPO_ROOT = path.resolve(__dirname, "../..");

describe("benchmark adapter, CLI, and comparison report generator", () => {
  it("exposes prepackSources and prepackVersion compatible with bench/prepack-worker.js", () => {
    assert.equal(typeof prepackVersion, "string");
    assert.match(prepackVersion, /hybrid/);

    const diagnostics = [];
    const res = prepackSources([{ filePath: "sample.js", fileContents: "globalThis.ans = 40 + 2;" }], {
      serialize: true,
      compatibility: "browser",
      verify: true,
      errorHandler(diag) {
        diagnostics.push(diag);
        return diag.severity === "FatalError" ? "Fail" : "Recover";
      },
    });
    assert.equal(typeof res.code, "string");
    assert.equal(res.stats.verified, true);
    assert.equal(diagnostics.some(d => d.severity === "FatalError"), false);
  });

  it("rejects miscompiled pipeline output when verify=true and surfaces HYB_VERIFY_FAILED to errorHandler", () => {
    const buggyPrepack = createPrepackSources(() => ({
      code: "globalThis.ans = -0;",
      stats: {},
    }));
    const diags = [];
    assert.throws(() => {
      buggyPrepack([{ filePath: "in.js", fileContents: "globalThis.ans = 0;" }], {
        verify: true,
        errorHandler(d) {
          diags.push(d);
          return "Fail";
        },
      });
    }, /Hybrid verification failed/);
    assert.equal(diags[0].errorCode, "HYB_VERIFY_FAILED");
  });

  it("handles pipeline bailouts cleanly (falls back on standalone call; reports FatalError to bench worker)", () => {
    const bailingPrepack = createPrepackSources(() => ({
      code: null,
      bailouts: [{ code: "HYB_PENDING_PROMISE", reason: "pending promise", where: "globalThis.p" }],
    }));

    // Standalone call without errorHandler falls back to original source per DESIGN.md
    const fallback = bailingPrepack([{ filePath: "in.js", fileContents: "globalThis.ok = 1;" }], {});
    assert.equal(fallback.code, "globalThis.ok = 1;");
    assert.equal(fallback.stats.bailedOut, true);

    // Bench worker call with errorHandler fails cleanly with HYB_PENDING_PROMISE
    const diags = [];
    assert.throws(() => {
      bailingPrepack([{ filePath: "in.js", fileContents: "globalThis.ok = 1;" }], {
        errorHandler(d) {
          diags.push(d);
          return "Fail";
        },
      });
    }, /Hybrid bailout/);
    assert.equal(diags[0].errorCode, "HYB_PENDING_PROMISE");
  });

  it("runs CLI hybrid/bin/hybrid.js with --out, --assume, and --verify", () => {
    const tmpBase = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir();
    const dir = fs.mkdtempSync(path.join(tmpBase, "hyb-cli-"));
    try {
      const inFile = path.join(dir, "in.js");
      const outFile = path.join(dir, "out.js");
      fs.writeFileSync(inFile, "globalThis.mode = typeof CUSTOM_ENV === 'string' ? CUSTOM_ENV : 'none';\n", "utf8");
      const r = childProcess.spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, "hybrid/bin/hybrid.js"),
          inFile,
          "--out",
          outFile,
          "--assume",
          'CUSTOM_ENV="edge"',
          "--verify",
        ],
        { encoding: "utf8" }
      );
      assert.equal(r.status, 0, `CLI stderr: ${r.stderr}`);
      assert.equal(fs.existsSync(outFile), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drives bench/run.js --prepack hybrid/index.js end-to-end without modifying bench/", () => {
    const tmpBase = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir();
    const dir = fs.mkdtempSync(path.join(tmpBase, "hyb-bench-e2e-"));
    try {
      const outJson = path.join(dir, "res.json");
      const outMd = path.join(dir, "res.md");
      const r = childProcess.spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, "bench/run.js"),
          "--prepack",
          path.join(REPO_ROOT, "hybrid/index.js"),
          "--only",
          "crc-32",
          "--no-perf",
          "--out-json",
          outJson,
          "--out-md",
          outMd,
        ],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 45000 }
      );
      assert.equal(r.status, 0, `bench/run.js failed: ${r.stderr || r.stdout}`);
      const parsed = JSON.parse(fs.readFileSync(outJson, "utf8"));
      assert.equal(parsed.summary.total, 1);
      assert.equal(parsed.summary.bestOk, 1);
      assert.equal(parsed.libraries[0].id, "crc-32");
      assert.equal(parsed.libraries[0].status, "OK");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("generates side-by-side Prepack vs Hybrid vs Original markdown report", () => {
    const ppJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "bench/results/20261105T060250Z.json"), "utf8"));
    const hybJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "hybrid/results/hybrid-latest.json"), "utf8"));
    const oracleMap = new Map([
      ["lodash", { compiledOk: true, strictIsoOk: false, seededIsoOk: true, volatileReason: "lastCalled", stats: {} }],
      [
        "crc-32",
        {
          compiledOk: true,
          strictIsoOk: true,
          seededIsoOk: true,
          stats: { objectsCompared: 25, functionsCompared: 3 },
        },
      ],
    ]);
    const data = generateComparisonData(ppJson, hybJson, oracleMap);
    const md = renderComparisonMarkdown(data);
    assert.match(md, /Prepack vs Hybrid vs Original/);
    assert.match(md, /\*\*`lodash`\*\*/);
    assert.match(md, /\*\*`crc-32`\*\*/);
    assert.match(md, /ISO-OK \(25 obj \/ 3 fn\)/);
  });
});
