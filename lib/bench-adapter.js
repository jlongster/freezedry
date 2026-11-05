"use strict";

const fs = require("fs");
const path = require("path");
const { verify } = require("./verify");

function getHybridVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    return `${pkg.version}-hybrid`;
  } catch {
    return "0.0.1-hybrid";
  }
}

// Map Prepack's prepackSources options (from bench/prepack-worker.js or CLI) to Hybrid options.
function adaptPrepackOptions(options = {}) {
  const compat = options.compatibility || "browser";
  let profile = options.profile || "bare";
  if (!options.profile) {
    if (compat === "node-react" || compat === "node-cli") profile = "node";
    else if (compat === "browser" || compat.startsWith("jsc")) profile = "bench";
  }

  return {
    compatibility: compat,
    profile,
    mathRandomSeed: options.mathRandomSeed,
    fixedTime: options.fixedTime,
    assume: options.assume || null,
    verify: Boolean(options.verify || process.env.HYBRID_VERIFY === "1"),
    standIn: options.standIn || process.env.HYBRID_STANDIN || null,
    fallbackOnBailout:
      options.fallbackOnBailout !== undefined
        ? Boolean(options.fallbackOnBailout)
        : typeof options.errorHandler !== "function",
    lazyObjectsRuntime: options.lazyObjectsRuntime || null,
    errorHandler: typeof options.errorHandler === "function" ? options.errorHandler : null,
  };
}

function emitDiagnostic(diag, adapted, collected) {
  const normalized = {
    severity: diag.severity || "FatalError",
    errorCode: diag.errorCode || "HYB0001",
    message: diag.message || "Hybrid diagnostic",
    location: diag.location || null,
  };
  collected.push(normalized);
  if (adapted.errorHandler) {
    return adapted.errorHandler(normalized);
  }
  return normalized.severity === "FatalError" ? "Fail" : "Recover";
}

// Try loading H1/H2/H3 pipeline modules if merged into `hybrid/lib/`; returns null while tracks work in parallel.
function tryLoadRealPipeline() {
  const capturePath = path.join(__dirname, "capture.js");
  const emitPath = path.join(__dirname, "emit.js");
  if (!fs.existsSync(capturePath) || !fs.existsSync(emitPath)) {
    return null;
  }
  const captureMod = require(capturePath);
  const emitMod = require(emitPath);
  const guardPath = path.join(__dirname, "guard.js");
  const guardMod = fs.existsSync(guardPath) ? require(guardPath) : null;
  return { captureMod, emitMod, guardMod };
}

function normalizeSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("prepackSources expects a non-empty array of { filePath, fileContents } objects");
  }
  const combinedCode = sources.map(s => s.fileContents || "").join("\n;\n");
  const primaryPath = sources[0].filePath || "input.js";
  return { combinedCode, primaryPath };
}

function createPrepackSources(customPipeline = null) {
  return function prepackSources(sources, options = {}) {
    const { combinedCode, primaryPath } = normalizeSources(sources);
    const adapted = adaptPrepackOptions(options);
    const diagnostics = [];

    if (adapted.lazyObjectsRuntime) {
      const action = emitDiagnostic(
        {
          severity: "FatalError",
          errorCode: "HYB_UNSUPPORTED_LAZY",
          message: `Hybrid does not support Prepack lazyObjectsRuntime (${adapted.lazyObjectsRuntime})`,
        },
        adapted,
        diagnostics
      );
      if (action === "Fail") {
        const err = new Error("Hybrid unsupported lazyObjectsRuntime");
        err.diagnostics = diagnostics;
        throw err;
      }
    }

    const pipeline = adapted.standIn === "identity" ? null : customPipeline || tryLoadRealPipeline();
    let outCode;
    let stats = {};
    let bailouts = [];
    let isStandIn = false;

    if (!pipeline) {
      // Trivial stand-in transform used to validate benchmark + verification plumbing until H1/H2 merge
      isStandIn = true;
      outCode = combinedCode;
      stats = { standIn: "identity", inputBytes: Buffer.byteLength(combinedCode, "utf8") };
      emitDiagnostic(
        {
          severity: "Information",
          errorCode: "HYB_STANDIN",
          message: "Using stand-in identity transform (H1 capture / H2 emit not present)",
        },
        adapted,
        diagnostics
      );
    } else if (typeof pipeline === "function") {
      const res = pipeline(sources, adapted, options);
      outCode = res.code;
      stats = res.stats || {};
      bailouts = res.bailouts || [];
      if (Array.isArray(res.diagnostics)) {
        for (const d of res.diagnostics) emitDiagnostic(d, adapted, diagnostics);
      }
    } else {
      const captureFn = pipeline.captureMod.capture || pipeline.captureMod;
      const emitFn = pipeline.emitMod.emit || pipeline.emitMod;
      const graph = captureFn(combinedCode, adapted);
      bailouts = Array.isArray(graph.bailouts) ? graph.bailouts : [];
      if (bailouts.length === 0) {
        const emitted = emitFn(graph, { originalSrc: combinedCode, ...adapted });
        outCode = typeof emitted === "string" ? emitted : emitted.code;
        if (pipeline.guardMod && typeof pipeline.guardMod.wrapWithGuard === "function") {
          outCode = pipeline.guardMod.wrapWithGuard(outCode, combinedCode, graph.assumptions || [], adapted);
        }
        stats = {
          nodes: graph.nodes ? Object.keys(graph.nodes).length : 0,
          roots: graph.roots ? graph.roots.length : 0,
          assumptions: graph.assumptions ? graph.assumptions.length : 0,
        };
      }
    }

    if (bailouts.length > 0) {
      for (const b of bailouts) {
        emitDiagnostic(
          {
            severity: adapted.fallbackOnBailout ? "Warning" : "FatalError",
            errorCode: b.code || "HYB_BAILOUT",
            message: `${b.reason}${b.where ? ` (${b.where})` : ""}`,
            location: b.location || null,
          },
          adapted,
          diagnostics
        );
      }
      if (!adapted.fallbackOnBailout) {
        const err = new Error(`Hybrid bailout: ${bailouts[0].reason}`);
        err.bailouts = bailouts;
        err.diagnostics = diagnostics;
        throw err;
      }
      outCode = combinedCode;
      stats.bailedOut = true;
    }

    let verifyResult = null;
    if (adapted.verify && typeof outCode === "string") {
      verifyResult = verify(combinedCode, outCode, {
        profile: adapted.profile,
        mathRandomSeed: adapted.mathRandomSeed,
        fixedTime: adapted.fixedTime,
        assume: adapted.assume,
        originalFilename: primaryPath,
        outputFilename: `${primaryPath}.hybrid.js`,
      });
      stats.verified = verifyResult.ok;
      stats.verifyStats = verifyResult.stats;
      if (!verifyResult.ok) {
        emitDiagnostic(
          {
            severity: "FatalError",
            errorCode: "HYB_VERIFY_FAILED",
            message: verifyResult.firstDiff ? verifyResult.firstDiff.message : "Heap isomorphism verification failed",
          },
          adapted,
          diagnostics
        );
        const err = new Error(
          `Hybrid verification failed: ${verifyResult.firstDiff ? verifyResult.firstDiff.message : "unknown diff"}`
        );
        err.verifyResult = verifyResult;
        err.diagnostics = diagnostics;
        throw err;
      }
    }

    return {
      code: outCode,
      map: null,
      stats,
      diagnostics,
      bailouts,
      isStandIn,
      verifyResult,
    };
  };
}

module.exports = {
  getHybridVersion,
  adaptPrepackOptions,
  createPrepackSources,
  tryLoadRealPipeline,
};
