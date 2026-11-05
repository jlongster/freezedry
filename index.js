"use strict";

// Public API, compatible with Prepack's synchronous prepackSources so bench/run.js can drive it.
// Pipeline: run (with H3 env membrane) -> capture -> emit -> guard -> (verify). See DESIGN.md.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const v8 = require("node:v8");

const { run } = require("./lib/run");
const { capture, captureFromRun } = require("./lib/capture");
const { emit, BailoutError } = require("./lib/emit");
const {
  PROFILES,
  resolveProfile,
  installEnvironment,
  createBeforeRunHook,
  emitGuard,
  measureGuardOverhead,
  parseEnvFlags,
  parseAssumeEntry,
  parseAssumeValue,
} = require("./lib/env");
const { verify, verifySmoke, verifyMutationProbe } = require("./lib/verify");
const {
  getHybridVersion,
  getCorpusOptInForLibrary,
  adaptPrepackOptions,
  normalizeSources,
  emitDiagnostic,
  handleBailoutList,
  finalizePipelineOutput,
  validateUnsupportedPrepackFlags,
  createPrepackSources,
} = require("./lib/bench-adapter");

async function runAndCaptureInProcess(normSources, captureOpts) {
  const envHook = createBeforeRunHook(captureOpts.profile, captureOpts.assume, {
    allowVolatile: captureOpts.allowVolatile,
    tz: captureOpts.tz,
  });
  const runResult = await run(normSources, {
    env: "ecmascript",
    beforeRun: envHook.beforeRun,
    afterRun: envHook.afterRun,
    timeout: captureOpts.timeout || 30000,
  });
  const graph = await captureFromRun(runResult);
  return {
    graph,
    bakedVolatiles: runResult.bakedVolatiles || [],
    envDiagnostics: runResult.envDiagnostics || [],
  };
}

function finishFromCapturePayload(payload, combinedCode, primaryPath, adapted, diagnostics) {
  const { graph, bakedVolatiles = [], envDiagnostics = [] } = payload;

  if (Array.isArray(graph.bailouts) && graph.bailouts.length > 0) {
    return handleBailoutList(graph.bailouts, combinedCode, adapted, diagnostics);
  }

  const emitted = emit(graph, {
    originalCode: combinedCode,
    throwOnBailout: false,
  });

  if (Array.isArray(emitted.bailouts) && emitted.bailouts.length > 0) {
    return handleBailoutList(emitted.bailouts, combinedCode, adapted, diagnostics);
  }

  return finalizePipelineOutput({
    graph,
    emitted,
    bakedVolatiles,
    envDiagnostics,
    combinedCode,
    primaryPath,
    adapted,
    diagnostics,
  });
}

async function prepackSourcesAsync(sources, options = {}) {
  if (options && options.captureGraph) {
    const { combinedCode, primaryPath } = normalizeSources(sources || "");
    const adapted = adaptPrepackOptions(options, primaryPath);
    const diagnostics = [];
    if (!validateUnsupportedPrepackFlags(adapted, diagnostics)) {
      return {
        code: adapted.fallbackOnBailout ? combinedCode : null,
        map: null,
        stats: { bailedOut: true },
        diagnostics,
        bailouts: [],
        isStandIn: false,
        verifyResult: null,
      };
    }
    return finishFromCapturePayload({ graph: options.captureGraph }, combinedCode, primaryPath, adapted, diagnostics);
  }

  const { normSources, combinedCode, primaryPath } = normalizeSources(sources);
  const adapted = adaptPrepackOptions(options, primaryPath);
  const diagnostics = [];

  if (!validateUnsupportedPrepackFlags(adapted, diagnostics)) {
    return {
      code: adapted.fallbackOnBailout ? combinedCode : null,
      map: null,
      stats: { bailedOut: true },
      diagnostics,
      bailouts: [],
      isStandIn: false,
      verifyResult: null,
    };
  }

  if (adapted.standIn === "identity") {
    emitDiagnostic(
      {
        severity: "Information",
        errorCode: "HYB_STANDIN",
        message: "Using stand-in identity transform",
      },
      adapted,
      diagnostics
    );
    return {
      code: combinedCode,
      map: null,
      stats: { standIn: "identity", inputBytes: Buffer.byteLength(combinedCode, "utf8") },
      diagnostics,
      bailouts: [],
      isStandIn: true,
      verifyResult: null,
    };
  }

  const payload = await runAndCaptureInProcess(normSources, {
    profile: adapted.profile,
    assume: adapted.assume,
    allowVolatile: adapted.allowVolatile,
    tz: adapted.tz,
    timeout: adapted.timeout,
  });

  return finishFromCapturePayload(payload, combinedCode, primaryPath, adapted, diagnostics);
}

function prepackSources(sources, options = {}) {
  if (options && options.captureGraph) {
    const { combinedCode, primaryPath } = normalizeSources(sources || "");
    const adapted = adaptPrepackOptions(options, primaryPath);
    const diagnostics = [];
    if (!validateUnsupportedPrepackFlags(adapted, diagnostics)) {
      return {
        code: adapted.fallbackOnBailout ? combinedCode : null,
        map: null,
        stats: { bailedOut: true },
        diagnostics,
        bailouts: [],
        isStandIn: false,
        verifyResult: null,
      };
    }
    return finishFromCapturePayload({ graph: options.captureGraph }, combinedCode, primaryPath, adapted, diagnostics);
  }

  const { normSources, combinedCode, primaryPath } = normalizeSources(sources);
  const adapted = adaptPrepackOptions(options, primaryPath);
  const diagnostics = [];

  if (!validateUnsupportedPrepackFlags(adapted, diagnostics)) {
    return {
      code: adapted.fallbackOnBailout ? combinedCode : null,
      map: null,
      stats: { bailedOut: true },
      diagnostics,
      bailouts: [],
      isStandIn: false,
      verifyResult: null,
    };
  }

  if (adapted.standIn === "identity") {
    emitDiagnostic(
      {
        severity: "Information",
        errorCode: "HYB_STANDIN",
        message: "Using stand-in identity transform",
      },
      adapted,
      diagnostics
    );
    return {
      code: combinedCode,
      map: null,
      stats: { standIn: "identity", inputBytes: Buffer.byteLength(combinedCode, "utf8") },
      diagnostics,
      bailouts: [],
      isStandIn: true,
      verifyResult: null,
    };
  }

  // Validate profile name upfront so invalid profile throws synchronously without subprocess overhead
  resolveProfile(adapted.profile);

  const baseTmp = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir();
  const reqFile = path.join(
    baseTmp,
    `hybrid-cap-in-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.v8`
  );
  const resFile = `${reqFile}.out`;

  fs.writeFileSync(
    reqFile,
    v8.serialize({
      sources: normSources,
      captureOpts: {
        profile: adapted.profile,
        assume: adapted.assume,
        allowVolatile: adapted.allowVolatile,
        tz: adapted.tz,
        timeout: adapted.timeout,
      },
    })
  );

  try {
    const timeoutMs = adapted.timeout + 15000;
    const proc = childProcess.spawnSync(process.execPath, [__filename, "--capture-worker", reqFile, resFile], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    if (proc.error) {
      throw proc.error;
    }
    if (proc.status !== 0 || !fs.existsSync(resFile)) {
      const detail = (proc.stderr || "")
        .trim()
        .split("\n")
        .slice(-3)
        .join(" | ");
      throw new Error(`hybrid capture worker failed (${proc.status}): ${detail}`);
    }
    const workerOut = v8.deserialize(fs.readFileSync(resFile));
    if (!workerOut.ok) {
      throw new Error(workerOut.error || "hybrid capture failed");
    }
    return finishFromCapturePayload(workerOut, combinedCode, primaryPath, adapted, diagnostics);
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
      const req = v8.deserialize(fs.readFileSync(reqFile));
      const out = await runAndCaptureInProcess(req.sources, req.captureOpts);
      fs.writeFileSync(
        resFile,
        v8.serialize({
          ok: true,
          graph: out.graph,
          bakedVolatiles: out.bakedVolatiles,
          envDiagnostics: out.envDiagnostics,
        })
      );
      process.exit(0);
    } catch (err) {
      fs.writeFileSync(
        resFile,
        v8.serialize({
          ok: false,
          error: err && err.message ? err.message : String(err),
        })
      );
      process.exit(0);
    }
  })();
}

const prepackVersion = getHybridVersion();

module.exports = {
  prepackSources,
  prepackSourcesAsync,
  prepackVersion,
  getHybridVersion,
  getCorpusOptInForLibrary,
  adaptPrepackOptions,
  createPrepackSources,
  BailoutError,
  run,
  capture,
  captureFromRun,
  emit,
  PROFILES,
  resolveProfile,
  installEnvironment,
  createBeforeRunHook,
  emitGuard,
  measureGuardOverhead,
  parseEnvFlags,
  parseAssumeEntry,
  parseAssumeValue,
  verify,
  verifySmoke,
  verifyMutationProbe,
};
