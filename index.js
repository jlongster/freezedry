"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { emit, BailoutError } = require("./lib/emit");
const pkg = require("./package.json");

function tryRequire(modPath) {
  try {
    return require(modPath);
  } catch (e) {
    if (e && e.code === "MODULE_NOT_FOUND") return null;
    throw e;
  }
}

function normalizeSources(sources) {
  if (typeof sources === "string") {
    return [{ filePath: "input.js", fileContents: sources }];
  }
  if (!Array.isArray(sources)) {
    throw new TypeError("prepackSources: expected array of { filePath, fileContents }");
  }
  return sources.map((s, idx) => ({
    filePath: (s && s.filePath) || `input-${idx}.js`,
    fileContents: String((s && s.fileContents) ?? ""),
  }));
}

function finishFromCaptureGraph(graph, normSources, options = {}) {
  const originalCode = normSources.map((s) => s.fileContents).join("\n;\n");
  const diagnostics = [];

  const reportBailouts = (bailouts) => {
    for (const b of bailouts) {
      const diag = {
        severity: "FatalError",
        errorCode: "HYBRID_BAILOUT",
        message: b.where ? `${b.reason} (${b.where})` : b.reason,
        location: null,
      };
      diagnostics.push(diag);
      if (typeof options.errorHandler === "function") {
        const action = options.errorHandler(diag);
        if (action === "Fail" && !options.fallbackOnBailout) {
          throw new BailoutError(bailouts);
        }
      }
    }
    if (options.fallbackOnBailout) {
      return {
        code: originalCode,
        fellBack: true,
        bailouts,
        stats: { bailedOut: true },
        diagnostics,
      };
    }
    if (typeof options.errorHandler !== "function") {
      throw new BailoutError(bailouts);
    }
    return {
      code: null,
      bailouts,
      stats: { bailedOut: true },
      diagnostics,
    };
  };

  if (Array.isArray(graph.bailouts) && graph.bailouts.length > 0) {
    return reportBailouts(graph.bailouts);
  }

  const emitted = emit(graph, {
    originalCode,
    throwOnBailout: false,
  });

  if (emitted.bailouts && emitted.bailouts.length > 0) {
    return reportBailouts(emitted.bailouts);
  }

  let finalCode = emitted.code;

  // Optional Track H3 (guard) hook when merged
  const guardMod = tryRequire("./lib/guard");
  if (
    guardMod &&
    typeof guardMod.emitWithGuards === "function" &&
    Array.isArray(graph.assumptions) &&
    graph.assumptions.length > 0
  ) {
    finalCode = guardMod.emitWithGuards(finalCode, graph.assumptions, originalCode, options);
  }

  // Optional Track H4 (verify) hook when requested and merged
  if (options.verify) {
    const verifyMod = tryRequire("./lib/verify");
    if (verifyMod && typeof verifyMod.verifySync === "function") {
      verifyMod.verifySync(originalCode, finalCode, options);
    }
  }

  return {
    code: finalCode,
    stats: emitted.stats,
    diagnostics,
  };
}

function resolveCaptureOptions(options = {}) {
  const env =
    options.env ||
    (options.compatibility === "node-react" || options.compatibility === "node-cli"
      ? "node"
      : "universal");
  return {
    env,
    timeout: options.timeout || 30000,
    assume: options.assume || null,
  };
}

async function prepackSourcesAsync(sources, options = {}) {
  const normSources = normalizeSources(sources);
  const capModPath = options._captureModulePath || path.join(__dirname, "lib", "capture.js");
  const capMod = tryRequire(capModPath);
  if (!capMod || typeof capMod.capture !== "function") {
    throw new Error("hybrid: capture module (lib/capture.js) is not available yet");
  }
  const graph = await capMod.capture(normSources, resolveCaptureOptions(options));
  return finishFromCaptureGraph(graph, normSources, options);
}

// Public API, compatible with Prepack's synchronous prepackSources so bench/run.js can drive it.
// Pipeline: run -> capture -> emit -> guard -> (verify). See DESIGN.md.
function prepackSources(sources, options = {}) {
  if (options && options.captureGraph) {
    const normSources = normalizeSources(sources || "");
    return finishFromCaptureGraph(options.captureGraph, normSources, options);
  }

  const normSources = normalizeSources(sources);
  const capModPath = options._captureModulePath || path.join(__dirname, "lib", "capture.js");
  if (!fs.existsSync(capModPath)) {
    throw new Error("hybrid: capture module (lib/capture.js) is not available yet");
  }

  const baseTmp = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir();
  const reqFile = path.join(
    baseTmp,
    `hybrid-cap-in-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  const resFile = `${reqFile}.out.json`;

  fs.writeFileSync(
    reqFile,
    JSON.stringify({
      capModPath,
      sources: normSources,
      captureOpts: resolveCaptureOptions(options),
    }),
    "utf8"
  );

  try {
    const timeoutMs = (options && options.timeout ? options.timeout : 30000) + 10000;
    const proc = childProcess.spawnSync(
      process.execPath,
      [__filename, "--capture-worker", reqFile, resFile],
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      }
    );
    if (proc.error) {
      throw proc.error;
    }
    if (proc.status !== 0 || !fs.existsSync(resFile)) {
      const detail = (proc.stderr || "").trim().split("\n").slice(-3).join(" | ");
      throw new Error(`hybrid capture worker failed (${proc.status}): ${detail}`);
    }
    const payload = JSON.parse(fs.readFileSync(resFile, "utf8"));
    if (!payload.ok) {
      throw new Error(payload.error || "hybrid capture failed");
    }
    return finishFromCaptureGraph(payload.graph, normSources, options);
  } finally {
    try {
      fs.unlinkSync(reqFile);
    } catch (_e) {}
    try {
      fs.unlinkSync(resFile);
    } catch (_e) {}
  }
}

if (require.main === module && process.argv[2] === "--capture-worker") {
  const reqFile = process.argv[3];
  const resFile = process.argv[4];
  (async () => {
    try {
      const req = JSON.parse(fs.readFileSync(reqFile, "utf8"));
      const { capture } = require(req.capModPath);
      const graph = await capture(req.sources, req.captureOpts);
      fs.writeFileSync(resFile, JSON.stringify({ ok: true, graph }), "utf8");
      process.exit(0);
    } catch (err) {
      fs.writeFileSync(
        resFile,
        JSON.stringify({
          ok: false,
          error: err && err.message ? err.message : String(err),
        }),
        "utf8"
      );
      process.exit(0);
    }
  })();
}

module.exports = {
  BailoutError,
  emit,
  prepackSources,
  prepackSourcesAsync,
  prepackVersion: `hybrid-${pkg.version}`,
};
