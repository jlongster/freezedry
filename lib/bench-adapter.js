"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BailoutError } = require("./emit");
const { emitGuard, parseAssumeEntry, resolveProfile } = require("./env");
const { verify } = require("./verify");

function getHybridVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    return `${pkg.version}-hybrid`;
  } catch {
    return "0.0.1-hybrid";
  }
}

// Documented per-library opt-ins from hybrid/docs/env.md (enabled ONLY when explicitly requested
// via options.useCorpusOptIns or HYBRID_OPTINS=corpus, never in zero-config mode).
function getCorpusOptInForLibrary(libId, resolvedProfileName) {
  switch (libId) {
    case "lodash":
      return { allowVolatile: ["Date.now"] };
    case "underscore":
      return resolvedProfileName === "browser" ? { assume: { "typeof:document.childNodes": "object" } } : null;
    case "redux":
    case "immutable":
    case "handlebars-app":
      return { allowVolatile: ["Math.random"] };
    case "d3-scale":
      return { allowVolatile: ["new Date"], tz: "UTC" };
    case "react-ssr-app":
      return resolvedProfileName === "browser"
        ? { assume: { "navigator.scheduling": undefined, MessageChannel: undefined } }
        : { allowVolatile: ["Date.now"] };
    case "prettier":
    case "three":
      return { allowVolatile: ["Math.random"] };
    case "mathjs":
      return { allowVolatile: ["Math.random", "Date.now"], tz: "UTC" };
    case "babel-standalone":
      return {
        allowVolatile: ["new Date", "Date.now", "Math.random"],
        tz: "UTC",
        assume: { "console.firebug": undefined, "console.exception": undefined },
      };
    case "typescript":
      return { allowVolatile: ["Date.now"] };
    default:
      return null;
  }
}

function mergeAssume(base, extra) {
  if (!base && !extra) return null;
  const out = {};
  const apply = src => {
    if (!src) return;
    if (Array.isArray(src)) {
      for (const item of src) {
        const parsed = parseAssumeEntry(item);
        out[parsed.key] = parsed.value;
      }
      return;
    }
    if (typeof src === "object") {
      for (const k of Object.keys(src)) {
        out[k] = src[k];
      }
    }
  };
  apply(base);
  apply(extra);
  return Object.keys(out).length > 0 ? out : null;
}

function mergeAllowVolatile(a, b) {
  const list = [];
  const push = v => {
    if (!v) return;
    if (typeof v === "string") {
      for (const item of v.split(",")) {
        const t = item.trim();
        if (t) list.push(t);
      }
    } else if (Array.isArray(v) || v instanceof Set) {
      for (const item of v) push(item);
    }
  };
  push(a);
  push(b);
  return list.length > 0 ? [...new Set(list)] : [];
}

function parseEnvAssume(raw) {
  if (!raw) return null;
  const out = {};
  for (const part of String(raw).split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const parsed = parseAssumeEntry(trimmed);
    out[parsed.key] = parsed.value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Map Prepack's prepackSources options (from bench/prepack-worker.js or CLI) to Hybrid options.
function adaptPrepackOptions(options = {}, primaryPath = "input.js") {
  const compat = options.compatibility || "browser";
  const explicitProfile = options.profile || options.env || process.env.HYBRID_PROFILE || null;
  let profile = explicitProfile;
  if (!profile) {
    if (compat === "node-react" || compat === "node-cli") profile = "node";
    else profile = "universal";
  }

  let resolvedProfileName = "universal";
  try {
    resolvedProfileName = resolveProfile(profile).name;
  } catch {
    // Surface invalid profile error during pipeline execution
    resolvedProfileName = String(profile);
  }

  const useCorpusOptIns = Boolean(options.useCorpusOptIns || process.env.HYBRID_OPTINS === "corpus");
  const libId = path.basename(String(primaryPath || "input.js"), ".js");
  const corpusOptIn = useCorpusOptIns ? getCorpusOptInForLibrary(libId, resolvedProfileName) : null;

  const envAssume = parseEnvAssume(process.env.HYBRID_ASSUME);
  const assume = mergeAssume(mergeAssume(corpusOptIn && corpusOptIn.assume, envAssume), options.assume);
  const allowVolatile = mergeAllowVolatile(
    mergeAllowVolatile(corpusOptIn && corpusOptIn.allowVolatile, process.env.HYBRID_ALLOW_VOLATILE),
    options.allowVolatile
  );
  const tz =
    options.tz ||
    options.assumeTz ||
    process.env.HYBRID_ASSUME_TZ ||
    (corpusOptIn && corpusOptIn.tz) ||
    null;

  // Default fallback mode: "function" — runs original code on guard mismatch, CSP-safe (no eval),
  // CommonJS-compatible, V8 lazy-preparsed, and Terser/gzip friendly via shared LZ77 dictionary.
  const fallback = options.fallback || process.env.HYBRID_FALLBACK || "function";
  const externalPath = options.externalPath || options.fallbackFile || process.env.HYBRID_FALLBACK_FILE || null;

  return {
    compatibility: compat,
    profile,
    resolvedProfileName,
    mathRandomSeed: options.mathRandomSeed !== undefined ? options.mathRandomSeed : options.seed,
    fixedTime: options.fixedTime,
    assume,
    allowVolatile,
    tz,
    fallback,
    externalPath,
    timeout: options.timeout || 30000,
    verify: Boolean(options.verify || process.env.HYBRID_VERIFY === "1"),
    verifySmokeSpecId: options.verifySmokeSpecId || null,
    verifyMutationProbe: Boolean(options.verifyMutationProbe),
    standIn: options.standIn || process.env.HYBRID_STANDIN || null,
    fallbackOnBailout:
      options.fallbackOnBailout !== undefined
        ? Boolean(options.fallbackOnBailout)
        : typeof options.errorHandler !== "function",
    lazyObjectsRuntime: options.lazyObjectsRuntime || null,
    errorHandler: typeof options.errorHandler === "function" ? options.errorHandler : null,
  };
}

function parseWhereLocation(where) {
  if (!where || typeof where !== "string") return null;
  const m = where.match(/:(\d+):(\d+)\)?$/);
  if (!m) return null;
  const line = parseInt(m[1], 10);
  const col = parseInt(m[2], 10);
  if (!Number.isFinite(line) || line < 1) return null;
  return {
    start: {
      line,
      column: Math.max(0, (Number.isFinite(col) ? col : 1) - 1),
    },
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

function normalizeSources(sources) {
  if (typeof sources === "string") {
    return {
      normSources: [{ filePath: "input.js", fileContents: sources }],
      combinedCode: sources,
      primaryPath: "input.js",
    };
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new TypeError("prepackSources: expected non-empty array of { filePath, fileContents }");
  }
  const normSources = sources.map((s, idx) => ({
    filePath: (s && s.filePath) || `input-${idx}.js`,
    fileContents: String((s && s.fileContents) ?? ""),
  }));
  return {
    normSources,
    combinedCode: normSources.map(s => s.fileContents).join("\n;\n"),
    primaryPath: normSources[0].filePath,
  };
}

function handleBailoutList(bailouts, combinedCode, adapted, diagnostics) {
  let shouldThrow = false;
  for (const b of bailouts) {
    const errorCode =
      b.code ||
      (b.kind === "volatile"
        ? "HYB_VOLATILE_BAILOUT"
        : b.kind === "env"
          ? "HYB_ENV_BAILOUT"
          : "HYB_BAILOUT");
    const action = emitDiagnostic(
      {
        severity: adapted.fallbackOnBailout ? "Warning" : "FatalError",
        errorCode,
        message: b.where ? `${b.reason} (${b.where})` : b.reason,
        location: b.location || parseWhereLocation(b.where),
      },
      adapted,
      diagnostics
    );
    if (action === "Fail" && !adapted.fallbackOnBailout) {
      shouldThrow = true;
    }
  }

  if (adapted.fallbackOnBailout) {
    return {
      code: combinedCode,
      fellBack: true,
      map: null,
      stats: { bailedOut: true },
      diagnostics,
      bailouts,
      isStandIn: false,
      verifyResult: null,
    };
  }

  if (shouldThrow || !adapted.errorHandler) {
    throw new BailoutError(bailouts, diagnostics);
  }

  return {
    code: null,
    fellBack: false,
    map: null,
    stats: { bailedOut: true },
    diagnostics,
    bailouts,
    isStandIn: false,
    verifyResult: null,
  };
}

function finalizePipelineOutput({
  graph,
  emitted,
  bakedVolatiles = [],
  envDiagnostics = [],
  combinedCode,
  primaryPath,
  adapted,
  diagnostics,
}) {
  for (const d of envDiagnostics) {
    if (d.code === "HYB_VOLATILE_BAKED") {
      emitDiagnostic(
        {
          severity: "Information",
          errorCode: d.code,
          message: d.where ? `${d.message} (${d.where})` : d.message,
          location: parseWhereLocation(d.where),
        },
        adapted,
        diagnostics
      );
    }
  }

  const assumptions = (graph && Array.isArray(graph.assumptions) && graph.assumptions) || [];
  let finalCode = emitted.code;
  let guardInfo = null;
  if (assumptions.length > 0) {
    guardInfo = emitGuard(assumptions, combinedCode, {
      fallback: adapted.fallback,
      externalPath: adapted.externalPath,
    });
    finalCode = guardInfo.wrap(finalCode);
  }

  const stats = Object.assign({}, emitted.stats || null, {
    assumptions: assumptions.length,
    bakedVolatiles: bakedVolatiles.length,
    fallbackMode: assumptions.length > 0 ? adapted.fallback : "none",
  });

  let verifyResult = null;
  if (adapted.verify && typeof finalCode === "string") {
    verifyResult = verify(combinedCode, finalCode, {
      profile: adapted.profile,
      fixedTime: adapted.fixedTime,
      assume: adapted.assume,
      tz: adapted.tz,
      bakedVolatiles,
      guardCondition: guardInfo ? guardInfo.condition : null,
      ignoreErrorStack: true,
      specId: adapted.verifySmokeSpecId || undefined,
      mutationProbe: adapted.verifyMutationProbe || undefined,
      originalFilename: primaryPath,
      outputFilename: `${primaryPath}.hybrid.js`,
      timeout: adapted.timeout,
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
    code: finalCode,
    map: null,
    stats,
    diagnostics,
    bailouts: [],
    isStandIn: false,
    verifyResult,
  };
}

function validateUnsupportedPrepackFlags(adapted, diagnostics) {
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
    return false;
  }

  if (adapted.mathRandomSeed !== undefined && adapted.mathRandomSeed !== null) {
    const action = emitDiagnostic(
      {
        severity: "FatalError",
        errorCode: "HYB_NO_RANDOM_SEED",
        message:
          "Seeding Math.random (--seed / mathRandomSeed) is not allowed in Hybrid; use --allow-volatile=Math.random to explicitly bake random values",
      },
      adapted,
      diagnostics
    );
    if (action === "Fail") {
      const err = new Error("Seeding Math.random (--seed / mathRandomSeed) is not allowed in Hybrid");
      err.diagnostics = diagnostics;
      throw err;
    }
    return false;
  }

  return true;
}

function createPrepackSources(customPipeline = null) {
  if (customPipeline === null) {
    return function defaultPrepackSources(sources, options = {}) {
      return require("../index").prepackSources(sources, options);
    };
  }
  if (typeof customPipeline !== "function") {
    throw new TypeError("createPrepackSources expects a pipeline function or null");
  }
  return function prepackSourcesWithCustomPipeline(sources, options = {}) {
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

    const res = customPipeline(normSources, adapted, options);
    if (Array.isArray(res.diagnostics)) {
      for (const d of res.diagnostics) emitDiagnostic(d, adapted, diagnostics);
    }
    const bailouts = Array.isArray(res.bailouts) ? res.bailouts : [];
    if (bailouts.length > 0) {
      return handleBailoutList(bailouts, combinedCode, adapted, diagnostics);
    }

    return finalizePipelineOutput({
      graph: res.graph || { assumptions: res.assumptions || [] },
      emitted: { code: res.code, stats: res.stats || {} },
      bakedVolatiles: res.bakedVolatiles || [],
      envDiagnostics: res.envDiagnostics || [],
      combinedCode,
      primaryPath,
      adapted,
      diagnostics,
    });
  };
}

module.exports = {
  getHybridVersion,
  getCorpusOptInForLibrary,
  adaptPrepackOptions,
  normalizeSources,
  emitDiagnostic,
  handleBailoutList,
  finalizePipelineOutput,
  validateUnsupportedPrepackFlags,
  createPrepackSources,
};
