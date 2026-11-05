"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { SPECS } = require("../../bench/libs/specs");
const { runInVm, runInFreshNode } = require("../../bench/harness");
const {
  makeDiff,
  createInspectorController,
  compareEnvironments,
} = require("./verify");

const SPEC_MAP = new Map(SPECS.map((s) => [s.id, s]));

function resolveSmokeCode(opts = {}) {
  if (opts.smokeCode) return opts.smokeCode;
  if (opts.specId) {
    const spec = SPEC_MAP.get(opts.specId);
    if (!spec) {
      throw new Error(`Unknown benchmark specId: ${opts.specId}`);
    }
    return spec.smokeCode;
  }
  return null;
}

// Run bench smoke test comparison on originalSrc vs outputSrc (in VM, plus fresh Node when checkFreshNode=true).
function runSmokeComparison(originalSrc, outputSrc, opts = {}) {
  const smokeCode = resolveSmokeCode(opts);
  if (!smokeCode) {
    throw new Error("runSmokeComparison requires opts.smokeCode or opts.specId");
  }

  const timeoutMs = opts.timeout || 15000;
  const vmOrig = runInVm(originalSrc, smokeCode, timeoutMs);
  const vmOut = runInVm(outputSrc, smokeCode, timeoutMs);

  if (!vmOrig.ok || !vmOut.ok) {
    return {
      ok: false,
      firstDiff: makeDiff(
        "<smoke:vm>",
        "smoke-exception",
        vmOrig.ok ? `digest:${vmOrig.digest.slice(0, 12)}` : vmOrig.error,
        vmOut.ok ? `digest:${vmOut.digest.slice(0, 12)}` : vmOut.error,
        "VM smoke test threw"
      ),
      origDigest: vmOrig.digest || null,
      outDigest: vmOut.digest || null,
      origJson: vmOrig.json || null,
      outJson: vmOut.json || null,
    };
  }

  if (vmOrig.digest !== vmOut.digest) {
    return {
      ok: false,
      firstDiff: makeDiff(
        "<smoke:vm>",
        "smoke-digest",
        vmOrig.json,
        vmOut.json,
        `VM smoke digest mismatch (${vmOrig.digest.slice(0, 12)} vs ${vmOut.digest.slice(0, 12)})`
      ),
      origDigest: vmOrig.digest,
      outDigest: vmOut.digest,
      origJson: vmOrig.json,
      outJson: vmOut.json,
    };
  }

  if (opts.checkFreshNode) {
    const tmpBase = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir();
    const tmpDir = fs.mkdtempSync(path.join(tmpBase, "hyb-smoke-"));
    try {
      const nodeOrig = runInFreshNode(originalSrc, smokeCode, tmpDir, "orig", timeoutMs);
      const nodeOut = runInFreshNode(outputSrc, smokeCode, tmpDir, "out", timeoutMs);
      if (!nodeOrig.ok || !nodeOut.ok) {
        return {
          ok: false,
          firstDiff: makeDiff(
            "<smoke:node>",
            "smoke-exception",
            nodeOrig.ok ? `digest:${nodeOrig.digest.slice(0, 12)}` : nodeOrig.error,
            nodeOut.ok ? `digest:${nodeOut.digest.slice(0, 12)}` : nodeOut.error,
            "Fresh Node smoke test threw"
          ),
          origDigest: nodeOrig.digest || null,
          outDigest: nodeOut.digest || null,
          origJson: nodeOrig.json || null,
          outJson: nodeOut.json || null,
        };
      }
      if (nodeOrig.digest !== nodeOut.digest) {
        return {
          ok: false,
          firstDiff: makeDiff(
            "<smoke:node>",
            "smoke-digest",
            nodeOrig.json,
            nodeOut.json,
            `Fresh Node smoke digest mismatch (${nodeOrig.digest.slice(0, 12)} vs ${nodeOut.digest.slice(0, 12)})`
          ),
          origDigest: nodeOrig.digest,
          outDigest: nodeOut.digest,
          origJson: nodeOrig.json,
          outJson: nodeOut.json,
        };
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return {
    ok: true,
    firstDiff: null,
    origDigest: vmOrig.digest,
    outDigest: vmOut.digest,
    origJson: vmOrig.json,
    outJson: vmOut.json,
  };
}

// Discover callable exported root functions and shallow namespace methods in deterministic order.
function discoverExportedCallExpressions(env, maxDepth = 2, maxFns = 32) {
  const baseGlobalSnap = env.baselineSnapshots.get("<globalThis>");
  const baseKeys = new Set(baseGlobalSnap ? baseGlobalSnap.keys : []);
  const calls = [];
  const visited = new Set();

  function walkObj(obj, exprPath, depth) {
    if (calls.length >= maxFns) return;
    if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return;
    if (visited.has(obj)) return;
    visited.add(obj);

    for (const key of Reflect.ownKeys(obj)) {
      if (calls.length >= maxFns) break;
      if (typeof key !== "string") continue;
      if (obj === env.globalObj && baseKeys.has(key)) {
        const curDesc = Object.getOwnPropertyDescriptor(obj, key);
        const baseDesc = baseGlobalSnap.descs.get(key);
        if (curDesc && baseDesc && Object.is(curDesc.value, baseDesc.value)) continue;
      }
      if (key === "prototype" || key === "constructor" || key === "__proto__") continue;

      const desc = Object.getOwnPropertyDescriptor(obj, key);
      if (!desc) continue;
      let val;
      if ("value" in desc) {
        val = desc.value;
      } else if (desc.get && obj !== env.globalObj) {
        try {
          val = obj[key];
        } catch {
          continue;
        }
      } else {
        continue;
      }
      const propExpr = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? exprPath === "globalThis"
          ? `globalThis.${key}`
          : `${exprPath}.${key}`
        : `${exprPath}[${JSON.stringify(key)}]`;

      if (typeof val === "function" && !env.intrinsicToPath.has(val)) {
        const src = Function.prototype.toString.call(val).trimStart();
        const isClass = /^class(?:\s|\{|$)/.test(src);
        if (!isClass) {
          calls.push({ expr: `${propExpr}()`, label: `${propExpr}()` });
          if (val.length >= 1 && calls.length < maxFns) {
            calls.push({ expr: `${propExpr}(1)`, label: `${propExpr}(1)` });
          }
        }
        // Functions like `_` or `chroma` also carry static methods (`_.uniqueId`, `_.chunk`, etc.)
        if (depth < maxDepth) {
          walkObj(val, propExpr, depth + 1);
        }
      } else if (val && typeof val === "object" && !env.intrinsicToPath.has(val) && depth < maxDepth) {
        walkObj(val, propExpr, depth + 1);
      }
    }
  }

  walkObj(env.globalObj, "globalThis", 0);
  return calls;
}

const INSTALL_DETERMINISTIC_CLOCK_AND_RNG = `
(function() {
  var __origRandom = Math.random;
  var __origDateNow = Date.now;
  var __seed = 0x12345678;
  var __now = 1767225600000;
  Math.random = function() {
    __seed ^= __seed << 13;
    __seed ^= __seed >>> 17;
    __seed ^= __seed << 5;
    return (__seed >>> 0) / 4294967296;
  };
  Date.now = function() {
    __now += 1;
    return __now;
  };
  return function restore() {
    Math.random = __origRandom;
    Date.now = __origDateNow;
  };
})()
`;

// Run post-init mutation probes on two already-loaded environments `envA` and `envB`,
// comparing every call's return/throw outcome AND re-verifying full heap isomorphism afterwards.
function runMutationProbeOnEnvs(controller, envA, envB, opts = {}) {
  const probeOpts = typeof opts.mutationProbe === "object" && opts.mutationProbe !== null ? opts.mutationProbe : opts;
  const explicitProbes = Array.isArray(opts.probes)
    ? opts.probes
    : Array.isArray(probeOpts.probes)
      ? probeOpts.probes
      : typeof opts.probes === "string"
        ? [opts.probes]
        : typeof probeOpts.probeCode === "string"
          ? [probeOpts.probeCode]
          : null;

  const callList = explicitProbes
    ? explicitProbes.map((expr, idx) =>
        typeof expr === "string"
          ? { expr, label: `probe[${idx}] (${expr.slice(0, 48)})` }
          : { expr: expr.expr, label: expr.label || `probe[${idx}]` }
      )
    : discoverExportedCallExpressions(envA, probeOpts.maxDepth ?? 2, probeOpts.maxCalls ?? 48);

  const restoreA = envA.runScript(INSTALL_DETERMINISTIC_CLOCK_AND_RNG, "probe-rng-a.js");
  const restoreB = envB.runScript(INSTALL_DETERMINISTIC_CLOCK_AND_RNG, "probe-rng-b.js");

  const resultsA = envA.runScript("[]", "probe-arr-a.js");
  const resultsB = envB.runScript("[]", "probe-arr-b.js");
  let callsRun = 0;

  try {
    for (const item of callList) {
      callsRun++;
      let outA, errA = null;
      let outB, errB = null;
      try {
        outA = envA.runScript(item.expr, "probe-call-a.js", probeOpts.callTimeout || 5000);
      } catch (e) {
        errA = e;
      }
      try {
        outB = envB.runScript(item.expr, "probe-call-b.js", probeOpts.callTimeout || 5000);
      } catch (e) {
        errB = e;
      }

      if (Boolean(errA) !== Boolean(errB)) {
        return {
          ok: false,
          callsRun,
          firstDiff: makeDiff(
            `<mutation-probe: ${item.label}>`,
            "mutation-probe-throw",
            errA ? `threw ${errA.name || "Error"}: ${errA.message || errA}` : `returned ${String(outA)}`,
            errB ? `threw ${errB.name || "Error"}: ${errB.message || errB}` : `returned ${String(outB)}`,
            "post-init call throw behavior differed"
          ),
        };
      }

      if (errA && errB) {
        const nameA = errA && errA.name ? String(errA.name) : "Error";
        const nameB = errB && errB.name ? String(errB.name) : "Error";
        const msgA = errA && errA.message ? String(errA.message) : String(errA);
        const msgB = errB && errB.message ? String(errB.message) : String(errB);
        if (nameA !== nameB || msgA !== msgB) {
          return {
            ok: false,
            callsRun,
            firstDiff: makeDiff(
              `<mutation-probe: ${item.label}>`,
              "mutation-probe-error",
              `${nameA}: ${msgA}`,
              `${nameB}: ${msgB}`,
              "post-init call thrown error differed"
            ),
          };
        }
        resultsA.push(null);
        resultsB.push(null);
      } else {
        resultsA.push(outA);
        resultsB.push(outB);
      }
    }
  } finally {
    restoreA();
    restoreB();
  }

  // Attach return value arrays temporarily so `compareEnvironments` checks BOTH return values
  // AND the entire post-mutation heap in one unified bijection!
  const RESULTS_KEY = "__verify_probe_results__";
  envA.globalObj[RESULTS_KEY] = resultsA;
  envB.globalObj[RESULTS_KEY] = resultsB;

  let postIso;
  try {
    postIso = compareEnvironments(controller, envA, envB, opts);
  } finally {
    delete envA.globalObj[RESULTS_KEY];
    delete envB.globalObj[RESULTS_KEY];
  }

  if (!postIso.ok) {
    const rawDiff = postIso.firstDiff;
    // Rewrite `__verify_probe_results__[i]` paths to the exact call expression that produced them
    const m = rawDiff.path.match(/^__verify_probe_results__\[(\d+)\](.*)$/);
    if (m) {
      const idx = Number(m[1]);
      const suffix = m[2] || "";
      const callLabel = callList[idx] ? callList[idx].label : `call #${idx}`;
      const friendlyPath = `<mutation-probe: ${callLabel}>${suffix}`;
      return {
        ok: false,
        callsRun,
        firstDiff: makeDiff(
          friendlyPath,
          "mutation-probe-return",
          rawDiff.expected,
          rawDiff.actual,
          `post-init call result differed`
        ),
      };
    }
    return {
      ok: false,
      callsRun,
      firstDiff: makeDiff(
        `${rawDiff.path} (after mutation probe)`,
        rawDiff.kind,
        rawDiff.expected,
        rawDiff.actual,
        `post-init heap diverged (${rawDiff.kind})`
      ),
    };
  }

  return {
    ok: true,
    callsRun,
    firstDiff: null,
    stats: postIso.stats,
  };
}

// Standalone entry point for post-init mutation probing on two source strings
function runMutationProbe(originalSrc, outputSrc, opts = {}) {
  const controller = createInspectorController();
  try {
    const envA = controller.createEnv("original", opts);
    const envB = controller.createEnv("output", opts);
    envA.runScript(originalSrc, "original.js", opts.timeout || 30000);
    envB.runScript(outputSrc, "output.js", opts.timeout || 30000);
    return runMutationProbeOnEnvs(controller, envA, envB, opts);
  } finally {
    controller.close();
  }
}

module.exports = {
  resolveSmokeCode,
  runSmokeComparison,
  discoverExportedCallExpressions,
  runMutationProbeOnEnvs,
  runMutationProbe,
};
