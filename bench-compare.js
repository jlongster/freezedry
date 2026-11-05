#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { prepackSources, verify } = require("./index");

const HYBRID_DIR = __dirname;
const REPO_ROOT = path.resolve(HYBRID_DIR, "..");
const BENCH_DIR = path.join(REPO_ROOT, "bench");
const BENCH_RESULTS_DIR = path.join(BENCH_DIR, "results");
const HYBRID_RESULTS_DIR = path.join(HYBRID_DIR, "results");
const MANIFEST_PATH = path.join(BENCH_DIR, "libs", "manifest.json");

function parseArgs(argv) {
  const args = {
    prepackJson: null,
    hybridJson: null,
    runPrepack: false,
    runHybrid: false,
    prepackBin: "/tmp/opencode/pp-wt/bench/lib/prepack-node.js",
    hybridEntry: path.join(HYBRID_DIR, "index.js"),
    only: null,
    runs: 15,
    warmup: 3,
    jobs: 4,
    enableSnapshot: true,
    enableVerify: true,
    outMd: path.join(HYBRID_RESULTS_DIR, "comparison.md"),
    outJson: path.join(HYBRID_RESULTS_DIR, "comparison.json"),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prepack-json") args.prepackJson = path.resolve(argv[++i]);
    else if (a === "--hybrid-json") args.hybridJson = path.resolve(argv[++i]);
    else if (a === "--run-prepack") args.runPrepack = true;
    else if (a === "--run-hybrid") args.runHybrid = true;
    else if (a === "--prepack-bin") args.prepackBin = path.resolve(argv[++i]);
    else if (a === "--hybrid-entry") args.hybridEntry = path.resolve(argv[++i]);
    else if (a === "--only") args.only = argv[++i];
    else if (a === "--runs") args.runs = parseInt(argv[++i], 10);
    else if (a === "--warmup") args.warmup = parseInt(argv[++i], 10);
    else if (a === "--jobs") args.jobs = parseInt(argv[++i], 10);
    else if (a === "--no-snapshot") args.enableSnapshot = false;
    else if (a === "--no-verify") args.enableVerify = false;
    else if (a === "--verify") args.enableVerify = true;
    else if (a === "--out-md") args.outMd = path.resolve(argv[++i]);
    else if (a === "--out-json") args.outJson = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: node hybrid/bench-compare.js [options]",
          "  --prepack-json <path>   Existing Prepack bench JSON (default: latest in bench/results/)",
          "  --hybrid-json <path>    Existing Hybrid bench JSON (default: hybrid/results/hybrid-latest.json or run live)",
          "  --run-hybrid            Run bench/run.js --prepack hybrid/index.js before generating comparison",
          "  --run-prepack           Run bench/run.js against --prepack-bin before generating comparison",
          "  --prepack-bin <path>    Path to Prepack lib/prepack-node.js when --run-prepack is set",
          "  --only <ids>            Comma-separated workload IDs",
          "  --runs <N>              Benchmark iterations when running bench/run.js (default: 15)",
          "  --warmup <N>            Warmup iterations when running bench/run.js (default: 3)",
          "  --no-snapshot           Skip Node --build-snapshot reference when running bench/run.js",
          "  --no-verify             Skip Heap Isomorphism Oracle check on Hybrid outputs",
          "  --out-md <path>         Output Markdown path (default: hybrid/results/comparison.md)",
          "  --out-json <path>       Output JSON path (default: hybrid/results/comparison.json)",
        ].join("\n")
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function findLatestJsonInDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".json") && !f.startsWith("comparison"))
    .sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

function runBenchSuite(prepackTarget, outJsonPath, outMdPath, opts) {
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  const cliArgs = [
    path.join(BENCH_DIR, "run.js"),
    "--prepack",
    prepackTarget,
    "--runs",
    String(opts.runs),
    "--warmup",
    String(opts.warmup),
    "--jobs",
    String(opts.jobs),
    "--out-json",
    outJsonPath,
    "--out-md",
    outMdPath,
  ];
  if (opts.only) {
    cliArgs.push("--only", opts.only);
  }
  if (!opts.enableSnapshot) {
    cliArgs.push("--no-snapshot");
  }

  const r = childProcess.spawnSync(process.execPath, cliArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: Object.assign({}, process.env, { TZ: "UTC", LANG: "C", LC_ALL: "C" }),
  });
  if (r.status !== 0) {
    throw new Error(`bench/run.js exited with code ${r.status} for ${prepackTarget}`);
  }
}

function runOracleAudit(onlyIds = null) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const allow = onlyIds
    ? new Set(
        onlyIds
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      )
    : null;
  const results = new Map();

  for (const entry of manifest.libraries) {
    if (allow && !allow.has(entry.id)) continue;
    const origCode = fs.readFileSync(path.join(BENCH_DIR, entry.file), "utf8");
    let compiled;
    try {
      compiled = prepackSources([{ filePath: `${entry.id}.js`, fileContents: origCode }], {
        compatibility: "browser",
      });
    } catch (e) {
      results.set(entry.id, {
        compiledOk: false,
        bailedOut: true,
        error: e.message,
      });
      continue;
    }

    // 1. Strict unseeded oracle check (catches unguarded Date.now / new Date() / Math.random)
    const strictIso = verify(origCode, compiled.code, {
      profile: "bench",
      specId: entry.id,
    });

    if (strictIso.ok) {
      results.set(entry.id, {
        compiledOk: true,
        isStandIn: Boolean(compiled.isStandIn),
        strictIsoOk: true,
        seededIsoOk: true,
        volatileReason: null,
        stats: strictIso.stats,
      });
      continue;
    }

    // 2. Seeded clock + PRNG oracle check (verifies heap isomorphism when volatile sources are pinned via --assume)
    const seededIso = verify(origCode, compiled.code, {
      profile: "bench",
      mathRandomSeed: "0",
      fixedTime: 1700000000000,
      specId: entry.id,
    });

    results.set(entry.id, {
      compiledOk: true,
      isStandIn: Boolean(compiled.isStandIn),
      strictIsoOk: false,
      seededIsoOk: seededIso.ok,
      volatileReason: seededIso.ok && strictIso.firstDiff ? strictIso.firstDiff.path : null,
      firstDiff: seededIso.ok ? null : seededIso.firstDiff ? seededIso.firstDiff.message : strictIso.firstDiff.message,
      stats: seededIso.stats,
    });
  }

  return results;
}

function fmtKb(bytes) {
  if (bytes == null) return "—";
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtMs(val) {
  if (val == null) return "—";
  return `${val.toFixed(2)} ms`;
}

function fmtPaired(ms, pairedSpeedup) {
  if (ms == null) return "—";
  const sp = pairedSpeedup != null && pairedSpeedup > 0 ? `${pairedSpeedup.toFixed(2)}x` : "—";
  return `${fmtMs(ms)} (${sp})`;
}

function fmtRatio(origBytes, targetBytes) {
  if (origBytes == null || targetBytes == null || origBytes <= 0) return "—";
  return `${(targetBytes / origBytes).toFixed(2)}x`;
}

function detectHybridStandIn(hybLib) {
  if (!hybLib || !Array.isArray(hybLib.profiles)) return false;
  return hybLib.profiles.some(p => Array.isArray(p.infoCodes) && p.infoCodes.includes("HYB_STANDIN"));
}

function generateComparisonData(prepackReport, hybridReport, oracleMap = new Map()) {
  const ppById = new Map((prepackReport.libraries || []).map(l => [l.id, l]));
  const hybById = new Map((hybridReport.libraries || []).map(l => [l.id, l]));
  const allIds = [];
  for (const l of hybridReport.libraries || []) allIds.push(l.id);
  for (const l of prepackReport.libraries || []) {
    if (!hybById.has(l.id)) allIds.push(l.id);
  }

  const anyStandIn = (hybridReport.libraries || []).some(detectHybridStandIn);
  const rows = [];

  for (const id of allIds) {
    const pp = ppById.get(id) || null;
    const hyb = hybById.get(id) || null;
    const base = hyb || pp;
    const oracle = oracleMap.get(id) || null;

    // Prefer Original measurements from Hybrid run (same machine/session), fallback to Prepack report
    const origSizes = (hyb && hyb.perf && hyb.perf.sizes && hyb.perf.sizes.orig) ||
      (pp && pp.perf && pp.perf.sizes && pp.perf.sizes.orig) || {
        raw: base.bytes,
        terser: null,
        gzip: null,
      };
    const ppSizes = pp && pp.perf && pp.perf.sizes ? pp.perf.sizes.prepacked : null;
    const hybSizes = hyb && hyb.perf && hyb.perf.sizes ? hyb.perf.sizes.prepacked : null;

    const origCold =
      (hyb && hyb.perf && hyb.perf.coldProcess && hyb.perf.coldProcess.orig.net.median) ??
      (pp && pp.perf && pp.perf.coldProcess && pp.perf.coldProcess.orig.net.median) ??
      null;
    const ppCold = pp && pp.perf && pp.perf.coldProcess ? pp.perf.coldProcess.prepacked.net.median : null;
    const hybCold = hyb && hyb.perf && hyb.perf.coldProcess ? hyb.perf.coldProcess.prepacked.net.median : null;
    const snapCold =
      (hyb && hyb.perf && hyb.perf.nodeSnapshot && hyb.perf.nodeSnapshot.supported
        ? hyb.perf.nodeSnapshot.net.median
        : null) ??
      (pp && pp.perf && pp.perf.nodeSnapshot && pp.perf.nodeSnapshot.supported
        ? pp.perf.nodeSnapshot.net.median
        : null);

    const origCc =
      (hyb && hyb.perf && hyb.perf.vmCodeCache && hyb.perf.vmCodeCache.orig.median) ??
      (pp && pp.perf && pp.perf.vmCodeCache && pp.perf.vmCodeCache.orig.median) ??
      null;
    const ppCc = pp && pp.perf && pp.perf.vmCodeCache ? pp.perf.vmCodeCache.prepacked.median : null;
    const hybCc = hyb && hyb.perf && hyb.perf.vmCodeCache ? hyb.perf.vmCodeCache.prepacked.median : null;

    const origExec =
      (hyb && hyb.perf && hyb.perf.vmExecOnly && hyb.perf.vmExecOnly.orig.median) ??
      (pp && pp.perf && pp.perf.vmExecOnly && pp.perf.vmExecOnly.orig.median) ??
      null;
    const ppExec = pp && pp.perf && pp.perf.vmExecOnly ? pp.perf.vmExecOnly.prepacked.median : null;
    const hybExec = hyb && hyb.perf && hyb.perf.vmExecOnly ? hyb.perf.vmExecOnly.prepacked.median : null;

    const isStandIn = detectHybridStandIn(hyb);
    rows.push({
      id,
      name: base.name,
      kind: base.kind,
      rawInputBytes: base.bytes,
      prepack: pp
        ? {
            defaultStatus: pp.defaultStatus,
            status: pp.status,
            bestProfile: pp.bestProfile ? pp.bestProfile.profile : null,
            compileMs: pp.bestProfile
              ? pp.bestProfile.compileMs
              : pp.primaryBlocker
              ? pp.primaryBlocker.compileMs
              : null,
            blocker: pp.primaryBlocker
              ? `${pp.primaryBlocker.errorCode}: ${String(pp.primaryBlocker.message || "").slice(0, 80)}`
              : null,
          }
        : null,
      hybrid: hyb
        ? {
            defaultStatus: hyb.defaultStatus,
            status: hyb.status,
            isStandIn,
            compileMs: hyb.bestProfile
              ? hyb.bestProfile.compileMs
              : hyb.primaryBlocker
              ? hyb.primaryBlocker.compileMs
              : null,
            blocker: hyb.primaryBlocker
              ? `${hyb.primaryBlocker.errorCode}: ${String(hyb.primaryBlocker.message || "").slice(0, 80)}`
              : null,
          }
        : null,
      oracle,
      sizes: {
        orig: origSizes,
        prepack: ppSizes,
        hybrid: hybSizes,
      },
      timings: {
        coldNetMs: {
          orig: origCold,
          prepack: ppCold,
          prepackSpeedup: pp && pp.perf && pp.perf.coldProcess ? pp.perf.coldProcess.speedupNet : null,
          hybrid: hybCold,
          hybridSpeedup: hyb && hyb.perf && hyb.perf.coldProcess ? hyb.perf.coldProcess.speedupNet : null,
          v8Snapshot: snapCold,
        },
        codeCacheMs: {
          orig: origCc,
          prepack: ppCc,
          prepackSpeedup: pp && pp.perf && pp.perf.vmCodeCache ? pp.perf.vmCodeCache.speedup : null,
          hybrid: hybCc,
          hybridSpeedup: hyb && hyb.perf && hyb.perf.vmCodeCache ? hyb.perf.vmCodeCache.speedup : null,
        },
        execOnlyMs: {
          orig: origExec,
          prepack: ppExec,
          prepackSpeedup: pp && pp.perf && pp.perf.vmExecOnly ? pp.perf.vmExecOnly.speedup : null,
          hybrid: hybExec,
          hybridSpeedup: hyb && hyb.perf && hyb.perf.vmExecOnly ? hyb.perf.vmExecOnly.speedup : null,
        },
      },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    environment: hybridReport.environment || prepackReport.environment,
    prepackMeta: prepackReport.prepack,
    hybridMeta: Object.assign({}, hybridReport.prepack, { standInMode: anyStandIn }),
    prepackConfig: prepackReport.config,
    hybridConfig: hybridReport.config,
    rows,
  };
}

function formatPpStatus(pp) {
  if (!pp) return "—";
  if (pp.status === "OK" && pp.defaultStatus !== "OK") {
    return `OK* (${pp.bestProfile}; def:${pp.defaultStatus})`;
  }
  if (pp.status !== "OK" && pp.blocker) {
    const code = pp.blocker.split(":")[0];
    return `${pp.status} (${code})`;
  }
  return pp.status;
}

function formatHybStatus(hyb) {
  if (!hyb) return "—";
  const tag = hyb.isStandIn ? `${hyb.status} [stand-in]` : hyb.status;
  if (hyb.status !== "OK" && hyb.blocker) {
    const code = hyb.blocker.split(":")[0];
    return `${hyb.status} (${code})`;
  }
  return tag;
}

function formatOracleCell(oracle) {
  if (!oracle) return "—";
  if (!oracle.compiledOk) return `BAIL (${oracle.error || "error"})`;
  if (oracle.strictIsoOk) {
    return `ISO-OK (${oracle.stats.objectsCompared} obj / ${oracle.stats.functionsCompared} fn)`;
  }
  if (oracle.seededIsoOk) {
    return `ISO-SEEDED (init reads volatile @ \`${oracle.volatileReason}\`)`;
  }
  return `DIFF (${oracle.firstDiff || "mismatch"})`;
}

function renderComparisonMarkdown(data) {
  const lines = [];
  lines.push("# Prepack vs Hybrid vs Original — Benchmark & Verification Comparison");
  lines.push("");
  lines.push(`- **Generated**: \`${data.generatedAt}\``);
  if (data.environment) {
    lines.push(
      `- **Environment**: Node \`${data.environment.node}\` (V8 \`${data.environment.v8}\`) on \`${
        data.environment.platform
      }/${data.environment.arch}\``
    );
  }
  lines.push(
    `- **Prepack (revive)**: \`${data.prepackMeta ? data.prepackMeta.path : "n/a"}\` (v\`${
      data.prepackMeta ? data.prepackMeta.version : "?"
    }\`, runs=${data.prepackConfig ? data.prepackConfig.runs : "?"})`
  );
  lines.push(
    `- **Hybrid**: \`${data.hybridMeta ? data.hybridMeta.path : "n/a"}\` (v\`${
      data.hybridMeta ? data.hybridMeta.version : "?"
    }\`, runs=${data.hybridConfig ? data.hybridConfig.runs : "?"}${
      data.hybridMeta && data.hybridMeta.standInMode ? " — **stand-in identity transform**" : ""
    })`
  );
  lines.push("");

  const total = data.rows.length;
  const ppDefaultOk = data.rows.filter(r => r.prepack && r.prepack.defaultStatus === "OK").length;
  const ppBestOk = data.rows.filter(r => r.prepack && r.prepack.status === "OK").length;
  const ppWrong = data.rows.filter(r => r.prepack && r.prepack.status === "WRONG").length;
  const hybOk = data.rows.filter(r => r.hybrid && r.hybrid.status === "OK").length;
  const hybWrong = data.rows.filter(r => r.hybrid && r.hybrid.status === "WRONG").length;
  const oracleStrict = data.rows.filter(r => r.oracle && r.oracle.strictIsoOk).length;
  const oracleSeeded = data.rows.filter(r => r.oracle && !r.oracle.strictIsoOk && r.oracle.seededIsoOk).length;

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Prepack (revive) | Hybrid | Notes |");
  lines.push("|---|---:|---:|---|");
  lines.push(`| **Workloads evaluated** | ${total} | ${total} | Corpus in \`bench/libs/dist/*.js\` |`);
  lines.push(
    `| **Smoke OK (default options)** | ${ppDefaultOk}/${total} | ${hybOk}/${total} | Fresh \`vm\` + fresh \`node\` smoke digest |`
  );
  lines.push(
    `| **Smoke OK (best profile)** | ${ppBestOk}/${total} | ${hybOk}/${total} | Includes profile flag unlocks |`
  );
  lines.push(`| **Silent miscompile (WRONG)** | ${ppWrong} | ${hybWrong} | Must always be **0** in Hybrid |`);
  if (data.rows.some(r => r.oracle)) {
    lines.push(
      `| **Heap Isomorphism Oracle** | — | ${oracleStrict} strict + ${oracleSeeded} seeded | Full heap + \`[[Scopes]]\` + V8 \`Context\` sharing bijection |`
    );
  }
  lines.push("");

  // 1. Unified Master Per-Library Table (all requested columns side-by-side)
  lines.push("## 1. Per-Library Master Table (Original vs Prepack vs Hybrid)");
  lines.push("");
  lines.push(
    "| Library | Correctness (PP / Hybrid / Oracle) | Size Raw (Orig / PP / Hyb) | Size Terser (Orig / PP / Hyb) | Size Gzip (Orig / PP / Hyb) | Cold Node Net ms (Orig / PP / Hyb) | Code-Cache ms (Orig / PP / Hyb) | Exec-Only ms (Orig / PP / Hyb) |"
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of data.rows) {
    const corr = `${formatPpStatus(r.prepack)} / ${formatHybStatus(r.hybrid)}${
      r.oracle ? ` / ${r.oracle.strictIsoOk ? "ISO-OK" : r.oracle.seededIsoOk ? "ISO-SEEDED" : "DIFF"}` : ""
    }`;
    const sOrig = r.sizes.orig || {};
    const sPp = r.sizes.prepack || {};
    const sHyb = r.sizes.hybrid || {};
    const rawCell = `${fmtKb(sOrig.raw)} / ${fmtKb(sPp.raw)} / ${fmtKb(sHyb.raw)}`;
    const terserCell = `${fmtKb(sOrig.terser)} / ${fmtKb(sPp.terser)} / ${fmtKb(sHyb.terser)}`;
    const gzipCell = `${fmtKb(sOrig.gzip)} / ${fmtKb(sPp.gzip)} / ${fmtKb(sHyb.gzip)}`;

    const c = r.timings.coldNetMs;
    const cc = r.timings.codeCacheMs;
    const ex = r.timings.execOnlyMs;
    const coldCell = `${fmtMs(c.orig)} / ${fmtMs(c.prepack)} / ${fmtMs(c.hybrid)}`;
    const ccCell = `${fmtMs(cc.orig)} / ${fmtMs(cc.prepack)} / ${fmtMs(cc.hybrid)}`;
    const exCell = `${fmtMs(ex.orig)} / ${fmtMs(ex.prepack)} / ${fmtMs(ex.hybrid)}`;

    lines.push(
      `| **\`${r.id}\`** | ${corr} | ${rawCell} | ${terserCell} | ${gzipCell} | ${coldCell} | ${ccCell} | ${exCell} |`
    );
  }
  lines.push("");

  // 2. Startup Speedups & V8 Snapshot Reference
  lines.push("## 2. Startup Timings & Speedups vs Original (incl. V8 `--build-snapshot` Reference)");
  lines.push("");
  lines.push(
    "| Library | Orig Cold Net | PP Cold Net (Speedup) | Hybrid Cold Net (Speedup) | V8 Snapshot Net | Orig Code-Cache | PP Code-Cache (Speedup) | Hybrid Code-Cache (Speedup) | Orig Exec-Only | PP Exec-Only (Speedup) | Hybrid Exec-Only (Speedup) |"
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of data.rows) {
    const c = r.timings.coldNetMs;
    const cc = r.timings.codeCacheMs;
    const ex = r.timings.execOnlyMs;
    lines.push(
      `| **\`${r.id}\`** | ${fmtMs(c.orig)} | ${fmtPaired(c.prepack, c.prepackSpeedup)} | ${fmtPaired(
        c.hybrid,
        c.hybridSpeedup
      )} | ${fmtMs(c.v8Snapshot)} | ${fmtMs(cc.orig)} | ${fmtPaired(cc.prepack, cc.prepackSpeedup)} | ${fmtPaired(
        cc.hybrid,
        cc.hybridSpeedup
      )} | ${fmtMs(ex.orig)} | ${fmtPaired(ex.prepack, ex.prepackSpeedup)} | ${fmtPaired(
        ex.hybrid,
        ex.hybridSpeedup
      )} |`
    );
  }
  lines.push("");

  // 3. Size Ratios & Correctness / Oracle Details
  lines.push("## 3. Size Ratios & Heap Isomorphism Oracle Audit");
  lines.push("");
  lines.push(
    "| Library | PP Gzip Ratio | Hybrid Gzip Ratio | Prepack Blocker / Notes | Hybrid Heap Isomorphism Oracle (`verify`) |"
  );
  lines.push("|---|---:|---:|---|---|");
  for (const r of data.rows) {
    const sOrig = r.sizes.orig || {};
    const sPp = r.sizes.prepack || {};
    const sHyb = r.sizes.hybrid || {};
    const ppNote = r.prepack && r.prepack.blocker ? `\`${r.prepack.blocker.replace(/\|/g, "\\|")}\`` : "—";
    lines.push(
      `| **\`${r.id}\`** | ${fmtRatio(sOrig.gzip, sPp.gzip)} | ${fmtRatio(
        sOrig.gzip,
        sHyb.gzip
      )} | ${ppNote} | ${formatOracleCell(r.oracle)} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(HYBRID_RESULTS_DIR, { recursive: true });

  let prepackJsonPath = args.prepackJson;
  if (args.runPrepack) {
    prepackJsonPath = path.join(HYBRID_RESULTS_DIR, "prepack-latest.json");
    const prepackMdPath = path.join(HYBRID_RESULTS_DIR, "prepack-latest.md");
    runBenchSuite(args.prepackBin, prepackJsonPath, prepackMdPath, args);
  } else if (!prepackJsonPath) {
    prepackJsonPath = findLatestJsonInDir(BENCH_RESULTS_DIR);
  }
  if (!prepackJsonPath || !fs.existsSync(prepackJsonPath)) {
    throw new Error(
      `Prepack benchmark JSON not found (looked in ${BENCH_RESULTS_DIR}; pass --prepack-json or --run-prepack)`
    );
  }

  let hybridJsonPath = args.hybridJson || path.join(HYBRID_RESULTS_DIR, "hybrid-latest.json");
  if (args.runHybrid || !fs.existsSync(hybridJsonPath)) {
    const hybridMdPath = path.join(HYBRID_RESULTS_DIR, "hybrid-latest.md");
    runBenchSuite(args.hybridEntry, hybridJsonPath, hybridMdPath, args);
  }

  const prepackReport = JSON.parse(fs.readFileSync(prepackJsonPath, "utf8"));
  const hybridReport = JSON.parse(fs.readFileSync(hybridJsonPath, "utf8"));

  let oracleMap = new Map();
  if (args.enableVerify) {
    console.log("Running Heap Isomorphism Oracle audit across selected workloads...");
    oracleMap = runOracleAudit(args.only);
  }

  const comparison = generateComparisonData(prepackReport, hybridReport, oracleMap);
  const md = renderComparisonMarkdown(comparison);

  fs.mkdirSync(path.dirname(args.outJson), { recursive: true });
  fs.mkdirSync(path.dirname(args.outMd), { recursive: true });
  fs.writeFileSync(args.outJson, JSON.stringify(comparison, null, 2) + "\n", "utf8");
  fs.writeFileSync(args.outMd, md + "\n", "utf8");

  console.log(`Wrote comparison JSON -> ${path.relative(REPO_ROOT, args.outJson)}`);
  console.log(`Wrote comparison MD   -> ${path.relative(REPO_ROOT, args.outMd)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  generateComparisonData,
  renderComparisonMarkdown,
  runOracleAudit,
};
