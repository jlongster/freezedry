#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const BENCH_DIR = __dirname;
const REPO_ROOT = path.resolve(BENCH_DIR, "..");
const RESULTS_DIR = path.join(BENCH_DIR, "results");
const MANIFEST_PATH = path.join(BENCH_DIR, "libs", "manifest.json");

function parseArgs(argv) {
  const args = {
    freezedryJson: null,
    comparePrepack: null,
    run: false,
    useOptIns: false,
    entry: path.join(REPO_ROOT, "index.js"),
    only: null,
    runs: 15,
    warmup: 3,
    jobs: 4,
    enableSnapshot: true,
    enableVerify: true,
    outMd: path.join(RESULTS_DIR, "comparison.md"),
    outJson: path.join(RESULTS_DIR, "comparison.json"),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--freezedry-json") args.freezedryJson = path.resolve(argv[++i]);
    else if (a === "--compare-prepack") args.comparePrepack = path.resolve(argv[++i]);
    else if (a === "--run") args.run = true;
    else if (a === "--opt-ins" || a === "--use-opt-ins") args.useOptIns = true;
    else if (a === "--entry") args.entry = path.resolve(argv[++i]);
    else if (a === "--only") args.only = argv[++i];
    else if (a === "--runs") args.runs = parseInt(argv[++i], 10);
    else if (a === "--warmup") args.warmup = parseInt(argv[++i], 10);
    else if (a === "--jobs") args.jobs = parseInt(argv[++i], 10);
    else if (a === "--no-snapshot") args.enableSnapshot = false;
    else if (a === "--no-verify") args.enableVerify = false;
    else if (a === "--oracle-jsonl") args.oracleJsonl = path.resolve(argv[++i]);
    else if (a === "--rerun-oracle") args.rerunOracle = true;
    else if (a === "--verify") args.enableVerify = true;
    else if (a === "--out-md") args.outMd = path.resolve(argv[++i]);
    else if (a === "--out-json") args.outJson = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: node bench/compare.js [options]",
          "  --freezedry-json <path>   Existing freezedry bench JSON (default: bench/results/freezedry-latest.json, or run live)",
          "  --run                     Run bench/run.js against freezedry before generating the comparison",
          "  --opt-ins                 Use the documented per-workload opt-ins (FREEZEDRY_OPTINS=corpus)",
          "  --entry <path>            freezedry entrypoint to benchmark (default: ./index.js)",
          "  --compare-prepack <path>  Add a Prepack column: either an existing Prepack bench JSON, or Prepack's",
          "                            lib/prepack-node.js (runs bench/run.js against it). Omit to skip Prepack.",
          "  --only <ids>              Comma-separated workload IDs",
          "  --runs <N>                Benchmark iterations when running bench/run.js (default: 15)",
          "  --warmup <N>              Warmup iterations when running bench/run.js (default: 3)",
          "  --no-snapshot             Skip Node --build-snapshot reference when running bench/run.js",
          "  --no-verify               Skip the heap-isomorphism oracle on freezedry outputs",
          "  --oracle-jsonl <path>     Oracle records file (default: bench/results/oracle-{optins,zeroconfig}.jsonl)",
          "  --rerun-oracle            Re-run the oracle even for workloads already in the records file",
          "  --out-md <path>           Output Markdown path (default: bench/results/comparison.md)",
          "  --out-json <path>         Output JSON path (default: bench/results/comparison.json)",
        ].join("\n")
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function runBenchSuite(compilerPath, outJsonPath, outMdPath, opts) {
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  const cliArgs = [
    path.join(BENCH_DIR, "run.js"),
    "--compiler",
    compilerPath,
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

  const env = Object.assign({}, process.env, { TZ: "UTC", LANG: "C", LC_ALL: "C" });
  if (opts.extraEnv) {
    Object.assign(env, opts.extraEnv);
  }
  const r = childProcess.spawnSync(process.execPath, cliArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env,
  });
  if (r.status !== 0) {
    throw new Error(`bench/run.js exited with code ${r.status} for ${compilerPath}`);
  }
}

function runOracleAudit(onlyIds = null, opts = {}) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const allow = onlyIds ? new Set(onlyIds.split(",").map(s => s.trim()).filter(Boolean)) : null;
  const jsonl = opts.oracleJsonl || path.join(RESULTS_DIR, `oracle-${opts.useOptIns ? "optins" : "zeroconfig"}.jsonl`);
  const records = new Map();
  if (fs.existsSync(jsonl)) {
    for (const line of fs.readFileSync(jsonl, "utf8").split("\n")) {
      if (line.trim()) {
        const r = JSON.parse(line);
        records.set(r.id, r);
      }
    }
  }
  // One process per workload: large bundles (mathjs, typescript) can OOM/SIGSEGV when run back to back.
  for (const entry of manifest.libraries) {
    if (allow && !allow.has(entry.id)) continue;
    if (records.has(entry.id) && !opts.rerunOracle) continue;
    const r = childProcess.spawnSync(
      process.execPath,
      ["--max-old-space-size=12288", path.join(REPO_ROOT, "tools", "oracle-one.js"), entry.id, jsonl].concat(
        opts.useOptIns ? [] : ["--zero-config"]
      ),
      { cwd: REPO_ROOT, stdio: "inherit", env: Object.assign({}, process.env, { TZ: "UTC" }) }
    );
    if (r.status !== 0) {
      fs.appendFileSync(jsonl, JSON.stringify({ id: entry.id, status: "CRASH", error: `exit ${r.status} ${r.signal || ""}` }) + "\n");
    }
  }
  for (const line of fs.readFileSync(jsonl, "utf8").split("\n")) {
    if (line.trim()) {
      const r = JSON.parse(line);
      records.set(r.id, r);
    }
  }

  const results = new Map();
  for (const [id, r] of records) {
    if (allow && !allow.has(id)) continue;
    const ok = r.status === "ISO-OK";
    results.set(id, {
      compiledOk: r.status === "ISO-OK" || r.status === "DIFF",
      bailedOut: r.status === "BAIL",
      unverified: r.status === "CRASH",
      strictIsoOk: ok && !r.bakedVolatiles,
      seededIsoOk: ok,
      volatileReason: ok && r.bakedVolatiles ? `${r.bakedVolatiles} baked volatile(s), replayed` : null,
      firstDiff: ok ? null : r.error,
      error: r.error,
      stats: r.verifyStats || {},
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

function detectStandIn(lib) {
  if (!lib || !Array.isArray(lib.profiles)) return false;
  return lib.profiles.some(p => Array.isArray(p.infoCodes) && p.infoCodes.includes("FZD_STANDIN"));
}

// Older reports (and Prepack-era ones) call the compiled output "prepacked" and the compiler "prepack".
const compiledOf = m => (m ? m.compiled || m.prepacked : null);
const compilerOf = report => (report ? report.compiler || report.prepack : null);

function libSummary(lib) {
  if (!lib) return null;
  return {
    defaultStatus: lib.defaultStatus,
    status: lib.status,
    bestProfile: lib.bestProfile ? lib.bestProfile.profile : null,
    compileMs: lib.bestProfile ? lib.bestProfile.compileMs : lib.primaryBlocker ? lib.primaryBlocker.compileMs : null,
    blocker: lib.primaryBlocker
      ? `${lib.primaryBlocker.errorCode}: ${String(lib.primaryBlocker.message || "").slice(0, 80)}`
      : null,
  };
}

function libTimings(lib) {
  const perf = lib && lib.perf;
  if (!perf) return {};
  return {
    sizes: perf.sizes ? compiledOf(perf.sizes) : null,
    cold: perf.coldProcess ? compiledOf(perf.coldProcess).net.median : null,
    coldSpeedup: perf.coldProcess ? perf.coldProcess.speedupNet : null,
    cc: perf.vmCodeCache ? compiledOf(perf.vmCodeCache).median : null,
    ccSpeedup: perf.vmCodeCache ? perf.vmCodeCache.speedup : null,
    exec: perf.vmExecOnly ? compiledOf(perf.vmExecOnly).median : null,
    execSpeedup: perf.vmExecOnly ? perf.vmExecOnly.speedup : null,
  };
}

// Builds per-workload rows: Original vs freezedry (+ Prepack when a Prepack report is given).
function generateComparisonData({ freezedry, prepack = null, oracle = new Map() }) {
  const fdById = new Map((freezedry.libraries || []).map(l => [l.id, l]));
  const ppById = new Map(((prepack && prepack.libraries) || []).map(l => [l.id, l]));
  const allIds = (freezedry.libraries || []).map(l => l.id);
  for (const id of ppById.keys()) if (!fdById.has(id)) allIds.push(id);

  const rows = allIds.map(id => {
    const fd = fdById.get(id) || null;
    const pp = ppById.get(id) || null;
    const base = fd || pp;
    // Prefer Original measurements from the freezedry run (same machine/session).
    const origPerf = (fd && fd.perf) || (pp && pp.perf) || {};
    const fdT = libTimings(fd);
    const ppT = libTimings(pp);
    const snap = [fd, pp].map(l => l && l.perf && l.perf.nodeSnapshot).find(s => s && s.supported);
    const row = {
      id,
      name: base.name,
      kind: base.kind,
      rawInputBytes: base.bytes,
      freezedry: fd ? Object.assign(libSummary(fd), { isStandIn: detectStandIn(fd) }) : null,
      prepack: libSummary(pp),
      oracle: oracle.get(id) || null,
      sizes: {
        orig: (origPerf.sizes && origPerf.sizes.orig) || { raw: base.bytes, terser: null, gzip: null },
        prepack: ppT.sizes || null,
        freezedry: fdT.sizes || null,
      },
      timings: {
        coldNetMs: {
          orig: origPerf.coldProcess ? origPerf.coldProcess.orig.net.median : null,
          prepack: ppT.cold ?? null,
          prepackSpeedup: ppT.coldSpeedup ?? null,
          freezedry: fdT.cold ?? null,
          freezedrySpeedup: fdT.coldSpeedup ?? null,
          v8Snapshot: snap ? snap.net.median : null,
        },
        codeCacheMs: {
          orig: origPerf.vmCodeCache ? origPerf.vmCodeCache.orig.median : null,
          prepack: ppT.cc ?? null,
          prepackSpeedup: ppT.ccSpeedup ?? null,
          freezedry: fdT.cc ?? null,
          freezedrySpeedup: fdT.ccSpeedup ?? null,
        },
        execOnlyMs: {
          orig: origPerf.vmExecOnly ? origPerf.vmExecOnly.orig.median : null,
          prepack: ppT.exec ?? null,
          prepackSpeedup: ppT.execSpeedup ?? null,
          freezedry: fdT.exec ?? null,
          freezedrySpeedup: fdT.execSpeedup ?? null,
        },
      },
    };
    return row;
  });

  return {
    generatedAt: new Date().toISOString(),
    environment: freezedry.environment || (prepack && prepack.environment),
    hasPrepack: Boolean(prepack),
    prepackMeta: compilerOf(prepack),
    prepackConfig: prepack ? prepack.config : null,
    freezedryMeta: Object.assign({}, compilerOf(freezedry), { standInMode: (freezedry.libraries || []).some(detectStandIn) }),
    freezedryConfig: freezedry.config,
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

function formatFdStatus(fd) {
  if (!fd) return "—";
  const tag = fd.isStandIn ? `${fd.status} [stand-in]` : fd.status;
  if (fd.status !== "OK" && fd.blocker) {
    const code = fd.blocker.split(":")[0];
    return `${fd.status} (${code})`;
  }
  return tag;
}

function formatOracleCell(oracle) {
  if (!oracle) return "—";
  if (oracle.unverified) return `UNVERIFIED (oracle ${oracle.error || "crashed"})`;
  if (!oracle.compiledOk) return `BAIL (${oracle.error || "error"})`;
  if (oracle.strictIsoOk) {
    return `ISO-OK (${oracle.stats.objectsCompared} obj / ${oracle.stats.functionsCompared} fn)`;
  }
  if (oracle.seededIsoOk) {
    return `ISO-SEEDED (${oracle.volatileReason})`;
  }
  return `DIFF (${oracle.firstDiff || "mismatch"})`;
}

function renderComparisonMarkdown(data) {
  const pp = data.hasPrepack;
  // Joins "Orig / [PP /] freezedry" cells, dropping the Prepack part when there is no Prepack report.
  const trio = (o, p, f) => (pp ? `${o} / ${p} / ${f}` : `${o} / ${f}`);
  const trioHead = label => (pp ? `${label} (Orig / PP / FD)` : `${label} (Orig / FD)`);
  const lines = [];
  lines.push(pp ? "# freezedry vs Prepack vs Original — Benchmark & Verification" : "# freezedry vs Original — Benchmark & Verification");
  lines.push("");
  lines.push(`- **Generated**: \`${data.generatedAt}\``);
  if (data.environment) {
    lines.push(
      `- **Environment**: Node \`${data.environment.node}\` (V8 \`${data.environment.v8}\`) on \`${
        data.environment.platform
      }/${data.environment.arch}\``
    );
  }
  if (pp) {
    lines.push(
      `- **Prepack**: \`${data.prepackMeta ? data.prepackMeta.path : "n/a"}\` (v\`${
        data.prepackMeta ? data.prepackMeta.version : "?"
      }\`, runs=${data.prepackConfig ? data.prepackConfig.runs : "?"})`
    );
  }
  lines.push(
    `- **freezedry**: \`${data.freezedryMeta ? data.freezedryMeta.path : "n/a"}\` (v\`${
      data.freezedryMeta ? data.freezedryMeta.version : "?"
    }\`, runs=${data.freezedryConfig ? data.freezedryConfig.runs : "?"}${
      data.freezedryMeta && data.freezedryMeta.standInMode ? " — **stand-in identity transform**" : ""
    })`
  );
  lines.push("");

  const total = data.rows.length;
  const count = f => data.rows.filter(f).length;
  const ppDefaultOk = count(r => r.prepack && r.prepack.defaultStatus === "OK");
  const ppBestOk = count(r => r.prepack && r.prepack.status === "OK");
  const ppWrong = count(r => r.prepack && r.prepack.status === "WRONG");
  const fdOk = count(r => r.freezedry && r.freezedry.status === "OK");
  const fdWrong = count(r => r.freezedry && r.freezedry.status === "WRONG");
  const oracleStrict = count(r => r.oracle && r.oracle.strictIsoOk);
  const oracleSeeded = count(r => r.oracle && !r.oracle.strictIsoOk && r.oracle.seededIsoOk);
  const metric = (name, p, f, note) => lines.push(pp ? `| ${name} | ${p} | ${f} | ${note} |` : `| ${name} | ${f} | ${note} |`);

  lines.push("## Summary");
  lines.push("");
  lines.push(pp ? "| Metric | Prepack | freezedry | Notes |" : "| Metric | freezedry | Notes |");
  lines.push(pp ? "|---|---:|---:|---|" : "|---|---:|---|");
  metric("**Workloads evaluated**", total, total, "Corpus in `bench/libs/dist/*.js`");
  metric("**Smoke OK (default options)**", `${ppDefaultOk}/${total}`, `${fdOk}/${total}`, "Fresh `vm` + fresh `node` smoke digest");
  if (pp) metric("**Smoke OK (best profile)**", `${ppBestOk}/${total}`, `${fdOk}/${total}`, "Includes profile flag unlocks");
  metric("**Silent miscompile (WRONG)**", ppWrong, fdWrong, "Must always be **0** for freezedry");
  if (data.rows.some(r => r.oracle)) {
    metric(
      "**Heap isomorphism oracle**",
      "—",
      `${oracleStrict} strict + ${oracleSeeded} seeded`,
      "Full heap + `[[Scopes]]` + V8 `Context` sharing bijection"
    );
  }
  lines.push("");

  lines.push(pp ? "## 1. Per-Workload Table (Original vs Prepack vs freezedry)" : "## 1. Per-Workload Table (Original vs freezedry)");
  lines.push("");
  lines.push(
    `| Workload | Correctness (${pp ? "PP / " : ""}FD / Oracle) | ${trioHead("Raw")} | ${trioHead("Terser")} | ${trioHead("Gzip")} | ${trioHead(
      "Cold node net ms"
    )} | ${trioHead("Code-cache ms")} | ${trioHead("Exec-only ms")} |`
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of data.rows) {
    const oracleTag = !r.oracle
      ? ""
      : ` / ${
          r.oracle.unverified
            ? "UNVERIFIED"
            : !r.oracle.compiledOk
            ? "BAIL"
            : r.oracle.strictIsoOk
            ? "ISO-OK"
            : r.oracle.seededIsoOk
            ? "ISO-SEEDED"
            : "DIFF"
        }`;
    const corr = `${pp ? `${formatPpStatus(r.prepack)} / ` : ""}${formatFdStatus(r.freezedry)}${oracleTag}`;
    const so = r.sizes.orig || {};
    const sp = r.sizes.prepack || {};
    const sf = r.sizes.freezedry || {};
    const c = r.timings.coldNetMs;
    const cc = r.timings.codeCacheMs;
    const ex = r.timings.execOnlyMs;
    lines.push(
      `| **\`${r.id}\`** | ${corr} | ${trio(fmtKb(so.raw), fmtKb(sp.raw), fmtKb(sf.raw))} | ${trio(
        fmtKb(so.terser),
        fmtKb(sp.terser),
        fmtKb(sf.terser)
      )} | ${trio(fmtKb(so.gzip), fmtKb(sp.gzip), fmtKb(sf.gzip))} | ${trio(fmtMs(c.orig), fmtMs(c.prepack), fmtMs(c.freezedry))} | ${trio(
        fmtMs(cc.orig),
        fmtMs(cc.prepack),
        fmtMs(cc.freezedry)
      )} | ${trio(fmtMs(ex.orig), fmtMs(ex.prepack), fmtMs(ex.freezedry))} |`
    );
  }
  lines.push("");

  lines.push("## 2. Startup Timings & Speedups vs Original (incl. V8 `--build-snapshot` Reference)");
  lines.push("");
  const timingCols = pp
    ? ["Orig Cold Net", "PP Cold Net (Speedup)", "FD Cold Net (Speedup)", "V8 Snapshot Net", "Orig Code-Cache", "PP Code-Cache (Speedup)", "FD Code-Cache (Speedup)", "Orig Exec-Only", "PP Exec-Only (Speedup)", "FD Exec-Only (Speedup)"]
    : ["Orig Cold Net", "FD Cold Net (Speedup)", "V8 Snapshot Net", "Orig Code-Cache", "FD Code-Cache (Speedup)", "Orig Exec-Only", "FD Exec-Only (Speedup)"];
  lines.push(`| Workload | ${timingCols.join(" | ")} |`);
  lines.push(`|---|${timingCols.map(() => "---:").join("|")}|`);
  for (const r of data.rows) {
    const c = r.timings.coldNetMs;
    const cc = r.timings.codeCacheMs;
    const ex = r.timings.execOnlyMs;
    const cells = [
      fmtMs(c.orig),
      ...(pp ? [fmtPaired(c.prepack, c.prepackSpeedup)] : []),
      fmtPaired(c.freezedry, c.freezedrySpeedup),
      fmtMs(c.v8Snapshot),
      fmtMs(cc.orig),
      ...(pp ? [fmtPaired(cc.prepack, cc.prepackSpeedup)] : []),
      fmtPaired(cc.freezedry, cc.freezedrySpeedup),
      fmtMs(ex.orig),
      ...(pp ? [fmtPaired(ex.prepack, ex.prepackSpeedup)] : []),
      fmtPaired(ex.freezedry, ex.freezedrySpeedup),
    ];
    lines.push(`| **\`${r.id}\`** | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## 3. Size Ratios & Heap Isomorphism Oracle");
  lines.push("");
  lines.push(
    pp
      ? "| Workload | PP Gzip Ratio | FD Gzip Ratio | Prepack Blocker / Notes | freezedry Oracle (`verify`) |"
      : "| Workload | FD Gzip Ratio | freezedry Oracle (`verify`) |"
  );
  lines.push(pp ? "|---|---:|---:|---|---|" : "|---|---:|---|");
  for (const r of data.rows) {
    const so = r.sizes.orig || {};
    const sp = r.sizes.prepack || {};
    const sf = r.sizes.freezedry || {};
    const ppNote = r.prepack && r.prepack.blocker ? `\`${r.prepack.blocker.replace(/\|/g, "\\|")}\`` : "—";
    lines.push(
      pp
        ? `| **\`${r.id}\`** | ${fmtRatio(so.gzip, sp.gzip)} | ${fmtRatio(so.gzip, sf.gzip)} | ${ppNote} | ${formatOracleCell(r.oracle)} |`
        : `| **\`${r.id}\`** | ${fmtRatio(so.gzip, sf.gzip)} | ${formatOracleCell(r.oracle)} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  let prepackReport = null;
  if (args.comparePrepack) {
    let prepackJsonPath = args.comparePrepack;
    if (!prepackJsonPath.endsWith(".json")) {
      prepackJsonPath = path.join(RESULTS_DIR, "prepack", "prepack-latest.json");
      runBenchSuite(args.comparePrepack, prepackJsonPath, prepackJsonPath.replace(/\.json$/, ".md"), args);
    }
    prepackReport = JSON.parse(fs.readFileSync(prepackJsonPath, "utf8"));
  }

  const freezedryJsonPath = args.freezedryJson || path.join(RESULTS_DIR, "freezedry-latest.json");
  if (args.run || !fs.existsSync(freezedryJsonPath)) {
    const runOpts = Object.assign({}, args, {
      extraEnv: args.useOptIns ? { FREEZEDRY_OPTINS: "corpus" } : undefined,
    });
    runBenchSuite(args.entry, freezedryJsonPath, freezedryJsonPath.replace(/\.json$/, ".md"), runOpts);
  }
  const freezedryReport = JSON.parse(fs.readFileSync(freezedryJsonPath, "utf8"));

  let oracle = new Map();
  if (args.enableVerify) {
    console.log("Running the heap-isomorphism oracle across selected workloads...");
    oracle = runOracleAudit(args.only, {
      useOptIns: args.useOptIns,
      oracleJsonl: args.oracleJsonl,
      rerunOracle: args.rerunOracle,
    });
  }

  const comparison = generateComparisonData({ freezedry: freezedryReport, prepack: prepackReport, oracle });
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
