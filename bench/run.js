#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { SPECS } = require("./libs/specs");
const { buildCorpus } = require("./setup");
const { runInVm, runInFreshNode } = require("./harness");
const { OPTION_PROFILES, runProfileInChild } = require("./worker");
const {
  LARGE_BYTES_THRESHOLD,
  GIANT_BYTES_THRESHOLD,
  adaptPerfRuns,
  measureNodeZeroBaseline,
  measureSizes,
  benchmarkTimingsOnly,
  benchmarkOriginalTimingsOnly,
  benchmarkSizesOnly,
} = require("./perf");

const BENCH_DIR = __dirname;
const REPO_ROOT = path.resolve(BENCH_DIR, "..");
const RESULTS_DIR = path.join(BENCH_DIR, "results");
const MANIFEST_PATH = path.join(BENCH_DIR, "libs", "manifest.json");

function parseArgs(argv) {
  const args = {
    compiler: path.join(REPO_ROOT, "index.js"),
    only: null,
    profiles: null,
    runs: 30,
    warmup: 5,
    adaptRuns: true,
    timeout: 300000,
    largeTimeout: 900000,
    timeoutExplicit: false,
    largeTimeoutExplicit: false,
    maxOldSpaceMb: 16384,
    jobs: Math.max(1, Math.min(4, os.cpus().length)),
    enableSnapshot: true,
    enablePerf: true,
    origOnly: false,
    outJson: null,
    outMd: path.join(RESULTS_DIR, "latest.md"),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--compiler" || a === "--prepack") args.compiler = argv[++i];
    else if (a === "--only") args.only = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--profiles") args.profiles = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--runs") args.runs = parseInt(argv[++i], 10);
    else if (a === "--warmup") args.warmup = parseInt(argv[++i], 10);
    else if (a === "--no-adapt-runs") args.adaptRuns = false;
    else if (a === "--timeout") {
      args.timeout = parseInt(argv[++i], 10);
      args.timeoutExplicit = true;
    } else if (a === "--large-timeout") {
      args.largeTimeout = parseInt(argv[++i], 10);
      args.largeTimeoutExplicit = true;
    } else if (a === "--max-old-space-size") args.maxOldSpaceMb = parseInt(argv[++i], 10);
    else if (a === "--jobs") args.jobs = parseInt(argv[++i], 10);
    else if (a === "--no-snapshot") args.enableSnapshot = false;
    else if (a === "--no-perf") args.enablePerf = false;
    else if (a === "--orig-only") args.origOnly = true;
    else if (a === "--out-json") args.outJson = argv[++i];
    else if (a === "--out-md") args.outMd = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: node bench/run.js [options]",
          "  --compiler <path>           Module exposing prepackSources(), or a dir containing one (default: freezedry's index.js).",
          "                              Pass Prepack's lib/prepack-node.js to benchmark Prepack (alias: --prepack)",
          "  --only <id1,id2,...>        Run only selected corpus IDs",
          "  --profiles <p1,p2,...>      Run only selected option profiles (default: the compiler's benchProfiles, else all 6)",
          "  --runs <N>                  Benchmark iterations per metric (default: 30; auto-adapted >=10 for large inputs)",
          "  --warmup <N>                Warmup iterations per metric (default: 5)",
          "  --no-adapt-runs             Do not reduce perf run counts on multi-MB workloads",
          "  --timeout <ms>              Per-lib compile timeout in ms (default: 300000; 900000 for large inputs)",
          "  --large-timeout <ms>        Per-lib compile timeout for large (>=750KB) inputs (default: 900000)",
          "  --max-old-space-size <MB>   Worker V8 heap cap in MB (default: 16384)",
          "  --jobs <N>                  Parallel compilation workers (default: min(4, cpus))",
          "  --orig-only                 Skip compilation and measure Original baselines only",
          "  --no-snapshot               Skip Node --build-snapshot reference benchmark",
          "  --no-perf                   Run compile + digest checks only (skip timing harness)",
          "  --out-json <path>           Override timestamped JSON output path",
          "  --out-md <path>             Override Markdown report path (default: bench/results/latest.md)",
        ].join("\n")
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!args.origOnly) {
    let resolved = path.resolve(args.compiler);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      const candidates = [
        path.join(resolved, "lib", "prepack-node.js"),
        path.join(resolved, "index.js"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          resolved = c;
          break;
        }
      }
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`Compiler entrypoint not found at ${resolved}`);
    }
    args.compiler = resolved;
  }
  return args;
}

function ensureCorpusReady() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return buildCorpus();
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    if (!manifest || !Array.isArray(manifest.libraries) || manifest.libraries.length !== SPECS.length) {
      return buildCorpus();
    }
    const byId = new Map(manifest.libraries.map(e => [e.id, e]));
    for (const spec of SPECS) {
      const entry = byId.get(spec.id);
      if (!entry || !fs.existsSync(path.join(BENCH_DIR, entry.file))) {
        return buildCorpus();
      }
    }
    return manifest;
  } catch (_e) {
    return buildCorpus();
  }
}

async function runWeightedPool(items, capacity, getWeight, fn) {
  const maxCap = Math.max(1, capacity);
  const results = new Array(items.length);
  let nextIdx = 0;
  let inUse = 0;
  let completed = 0;

  return new Promise((resolve, reject) => {
    let failed = false;
    const schedule = () => {
      if (failed) return;
      if (completed === items.length) {
        resolve(results);
        return;
      }
      while (nextIdx < items.length) {
        const w = Math.min(maxCap, Math.max(1, getWeight(items[nextIdx])));
        if (inUse > 0 && inUse + w > maxCap) break;
        const myIdx = nextIdx++;
        inUse += w;
        Promise.resolve()
          .then(() => fn(items[myIdx], myIdx))
          .then(
            res => {
              results[myIdx] = res;
              inUse -= w;
              completed++;
              schedule();
            },
            err => {
              if (!failed) {
                failed = true;
                reject(err);
              }
            }
          );
      }
    };
    schedule();
  });
}

function isLargeEntry(entry) {
  return entry.tier === "large" || entry.bytes >= LARGE_BYTES_THRESHOLD;
}

function getTimeoutForEntry(entry, args) {
  if (isLargeEntry(entry)) {
    if (args.largeTimeoutExplicit) return args.largeTimeout;
    if (args.timeoutExplicit) return args.timeout;
    return args.largeTimeout;
  }
  return args.timeout;
}

function chooseBestOutcome(profileResults) {
  const byName = new Map(profileResults.map(r => [r.profile, r]));
  const def = byName.get("default");
  const eligibleOk = profileResults.filter(r => r.eligibleForNodePerf && r.status === "OK");
  const anyWrong = profileResults.filter(r => r.status === "WRONG");

  // Critical rule: if default is WRONG, surface WRONG unconditionally.
  if (def && def.status === "WRONG") {
    return {
      status: "WRONG",
      defaultStatus: "WRONG",
      bestProfile: null,
      primaryBlocker: def,
    };
  }

  if (eligibleOk.length > 0) {
    // Deterministic preference order: keep modern ES6+ intrinsics when default/browser-opt succeed;
    // only use seeded/node-react/legacy-jsc profiles when required to unlock compilation.
    const preference = ["default", "browser-opt", "browser-seed", "node-react", "jsc"];
    let chosen = eligibleOk[0];
    for (const name of preference) {
      const candidate = byName.get(name);
      if (candidate && candidate.eligibleForNodePerf && candidate.status === "OK") {
        chosen = candidate;
        break;
      }
    }
    // Between default and browser-opt (--delayInitializations --inlineExpressions), pick browser-opt if smaller.
    const opt = byName.get("browser-opt");
    if (
      chosen.profile === "default" &&
      opt &&
      opt.status === "OK" &&
      opt.outBytes < chosen.outBytes
    ) {
      chosen = opt;
    }
    return {
      status: "OK",
      defaultStatus: def ? def.status : "OK",
      bestProfile: chosen,
      primaryBlocker: def && def.status !== "OK" ? def : null,
    };
  }

  if (anyWrong.length > 0 && (!def || def.status !== "FAIL")) {
    return {
      status: "WRONG",
      defaultStatus: def ? def.status : "WRONG",
      bestProfile: null,
      primaryBlocker: anyWrong[0],
    };
  }

  const allTimeout = profileResults.length > 0 && profileResults.every(r => r.status === "TIMEOUT");
  return {
    status: allTimeout ? "TIMEOUT" : "FAIL",
    defaultStatus: def ? def.status : "FAIL",
    bestProfile: null,
    primaryBlocker: def || profileResults[0] || null,
  };
}

function fmtKb(bytes) {
  if (bytes == null) return "—";
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtMs(val) {
  if (val == null) return "—";
  return `${val.toFixed(2)} ms`;
}

function fmtRatio(r) {
  if (r == null) return "—";
  return `${r.toFixed(2)}x`;
}

function formatLocation(loc) {
  if (!loc) return "—";
  return `L${loc.line}:${loc.column}`;
}

function fmtCompileCell(profileObj) {
  if (!profileObj || profileObj.compileMs == null) return "—";
  const mem = profileObj.peakRssMb != null ? ` (${profileObj.peakRssMb.toFixed(0)} MB)` : "";
  return `${profileObj.compileMs} ms${mem}`;
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# Real-World Benchmark & Triage Report");
  lines.push("");
  lines.push(`- **Generated**: \`${report.timestamp}\``);
  lines.push(`- **Compiler**: \`${report.compiler.path}\` (version \`${report.compiler.version}\`)`);
  lines.push(
    `- **Environment**: Node \`${report.environment.node}\` on \`${report.environment.platform}/${report.environment.arch}\` (${report.environment.cpus} CPUs, ${(report.environment.totalMemBytes / 1024 / 1024 / 1024).toFixed(1)} GB RAM)`
  );
  lines.push(
    `- **Parameters**: \`runs=${report.config.runs}\` (adaptRuns=\`${report.config.adaptRuns}\`), \`warmup=${report.config.warmup}\`, \`timeout=${report.config.timeout}ms\` (large=\`${report.config.largeTimeout}ms\`), \`maxOldSpace=${report.config.maxOldSpaceMb}MB\``
  );
  if (report.nodeZeroBaseline) {
    lines.push(
      `- **\`node -e 0\` Cold Process Baseline**: median **${report.nodeZeroBaseline.median.toFixed(2)} ms** (p90 ${report.nodeZeroBaseline.p90.toFixed(2)} ms)`
    );
  }
  lines.push("");

  const s = report.summary;
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `| Metric | Count | Notes |\n|---|---:|---|\n` +
      `| **Total workloads** | **${s.total}** | ${s.standardCount} standard + ${s.largeCount} large (${s.librariesCount} libraries + ${s.appsCount} app workloads) |\n` +
      `| **OK (default options)** | **${s.defaultOk}** | Digest-identical in fresh \`node\` and \`vm\` with zero flags |\n` +
      `| **OK (best option profile)** | **${s.bestOk}** | Includes libraries unlocked by \`--compatibility\` or \`--mathRandomSeed\` |\n` +
      `| **WRONG (silent miscompile)** | **${s.wrong}** | Compiler exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |\n` +
      `| **FAIL (compiler error)** | **${s.fail}** | Clean diagnostic or internal compiler error |\n` +
      `| **TIMEOUT** | **${s.timeout}** | Exceeded per-workload timeout (${Math.round(report.config.timeout / 1000)}s standard / ${Math.round(report.config.largeTimeout / 1000)}s large) |`
  );
  lines.push("");

  if (!report.config.origOnly) {
    lines.push("## 1. Per-Library Status & Option Sweep");
    lines.push("");
    lines.push(
      "| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile (RSS) | Top / Default Blocker |"
    );
    lines.push("|---|---|---|---:|---|---|---|---:|---|");
    for (const lib of report.libraries) {
      const pkgStr =
        lib.packages
          .slice(0, 2)
          .map(p => `${p.name}@${p.version}`)
          .join(" + ") + (lib.packages.length > 2 ? ` (+${lib.packages.length - 2})` : "");
      const licStr = [...new Set(lib.packages.map(p => p.license))].join(", ");
      const b = lib.primaryBlocker;
      let blockerCell = "—";
      if (b) {
        const loc = b.location ? ` @ ${formatLocation(b.location)}` : b.internalFrame ? ` (${b.internalFrame})` : "";
        const msg = String(b.message || "").replace(/\|/g, "\\|").slice(0, 95);
        blockerCell = `\`${b.errorCode}\`${loc}: ${msg}`;
        if (lib.status === "OK" && lib.defaultStatus !== "OK") {
          blockerCell = `*(default ${lib.defaultStatus})* ` + blockerCell;
        }
      }
      const kindLabel = `${lib.kind === "app-workload" ? "app" : "lib"}${lib.tier === "large" ? " (large)" : ""}`;
      lines.push(
        `| **\`${lib.id}\`** | ${pkgStr} (${licStr}) | ${kindLabel} | ${fmtKb(lib.bytes)} | **${lib.defaultStatus}** | **${lib.status}** | ${lib.bestProfile ? `\`${lib.bestProfile.profile}\`` : "—"} | ${fmtCompileCell(lib.bestProfile || b)} | ${blockerCell} |`
      );
    }
    lines.push("");

    lines.push("### Option Profile Matrix");
    lines.push("");
    const profNames = OPTION_PROFILES.map(p => p.name);
    lines.push(`| Workload | ${profNames.map(n => `\`${n}\``).join(" | ")} |`);
    lines.push(`|---|${profNames.map(() => "---").join("|")}|`);
    for (const lib of report.libraries) {
      const map = new Map(lib.profiles.map(p => [p.profile, p]));
      const cells = profNames.map(n => {
        const r = map.get(n);
        if (!r) return "—";
        if (r.status === "OK") return `OK (${fmtKb(r.outBytes)})`;
        return `${r.status} (\`${r.errorCode}\`)`;
      });
      lines.push(`| \`${lib.id}\` | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  const origPerfLibs = report.libraries.filter(l => l.origPerf);
  if (origPerfLibs.length > 0) {
    lines.push("## 2. Original Baseline Measurements (All Workloads)");
    lines.push("");
    lines.push(
      "Baseline timings and compressed sizes for every unmodified workload (including workloads where the compiler fails), covering **library load + deterministic smoke test**."
    );
    lines.push("");
    lines.push(
      "| Workload | N | Raw | Terser | Gzip | Brotli | Cold `node` Net Med (p90) | V8 `cachedData` Med (p90) | VM Exec-Only Med (p90) | V8 `--snapshot-blob` Net Med |"
    );
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const lib of origPerfLibs) {
      const op = lib.origPerf;
      const sz = op.sizes || {};
      const cold = op.coldProcess.orig.net;
      const cc = op.vmCodeCache;
      const ex = op.vmExecOnly;
      const snapStr =
        op.nodeSnapshot && op.nodeSnapshot.supported
          ? `${op.nodeSnapshot.net.median.toFixed(2)} ms (${(op.nodeSnapshot.blobBytes / 1024 / 1024).toFixed(1)} MB)`
          : op.nodeSnapshot && op.nodeSnapshot.error
            ? "unsupported"
            : "n/a";
      lines.push(
        `| **\`${lib.id}\`** | ${op.runs} | ${fmtKb(sz.raw)} | ${fmtKb(sz.terser)} | ${fmtKb(sz.gzip)} | ${fmtKb(sz.brotli)} | ` +
          `${cold.median.toFixed(2)} (${cold.p90.toFixed(2)}) ms | ` +
          `${cc.median.toFixed(2)} (${cc.p90.toFixed(2)}) ms | ` +
          `${ex.median.toFixed(2)} (${ex.p90.toFixed(2)}) ms | ` +
          `${snapStr} |`
      );
    }
    lines.push("");
  }

  const okPerfLibs = report.libraries.filter(l => l.status === "OK" && l.perf);
  if (okPerfLibs.length > 0) {
    lines.push("## 3. Runtime Performance (Original vs Compiled vs V8 Snapshot)");
    lines.push("");
    lines.push(
      "All timings cover **library load + deterministic smoke-test API suite**, measured over interleaved runs. " +
        "**Speedup > 1.00x means Compiled is faster than Original.**"
    );
    lines.push("");
    lines.push(
      "| Workload | N | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |"
    );
    lines.push("|---|---:|---|---|---|---|---|---|---|");
    for (const lib of okPerfLibs) {
      const p = lib.perf;
      const coldOrig = `${p.coldProcess.orig.net.median.toFixed(2)} (${p.coldProcess.orig.net.p90.toFixed(2)})`;
      const coldPp = `${p.coldProcess.compiled.net.median.toFixed(2)} (${p.coldProcess.compiled.net.p90.toFixed(2)})`;
      const ccOrig = `${p.vmCodeCache.orig.median.toFixed(2)} (${p.vmCodeCache.orig.p90.toFixed(2)})`;
      const ccPp = `${p.vmCodeCache.compiled.median.toFixed(2)} (${p.vmCodeCache.compiled.p90.toFixed(2)})`;
      const exOrig = `${p.vmExecOnly.orig.median.toFixed(2)} (${p.vmExecOnly.orig.p90.toFixed(2)})`;
      const exPp = `${p.vmExecOnly.compiled.median.toFixed(2)} (${p.vmExecOnly.compiled.p90.toFixed(2)})`;
      const snapStr =
        p.nodeSnapshot && p.nodeSnapshot.supported
          ? `${p.nodeSnapshot.net.median.toFixed(2)} ms (${(p.nodeSnapshot.blobBytes / 1024 / 1024).toFixed(1)} MB)`
          : "n/a";
      lines.push(
        `| **\`${lib.id}\`** | ${p.runs || report.config.runs} | ${coldOrig} -> ${coldPp} ms | **${fmtRatio(p.coldProcess.speedupNet)}** | ${ccOrig} -> ${ccPp} ms | **${fmtRatio(p.vmCodeCache.speedup)}** | ${exOrig} -> ${exPp} ms | **${fmtRatio(p.vmExecOnly.speedup)}** | ${snapStr} |`
      );
    }
    lines.push("");

    lines.push("## 4. Code Size Comparison");
    lines.push("");
    lines.push(
      "`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Compiled is smaller than Original."
    );
    lines.push("");
    lines.push(
      "| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |"
    );
    lines.push("|---|---|---|---|---|");
    for (const lib of okPerfLibs) {
      const sz = lib.perf.sizes;
      lines.push(
        `| **\`${lib.id}\`** | ${fmtKb(sz.orig.raw)} -> ${fmtKb(sz.compiled.raw)} (${sz.ratios.raw.toFixed(2)}x) | ` +
          `${fmtKb(sz.orig.terser)} -> ${fmtKb(sz.compiled.terser)} (${sz.ratios.terser != null ? sz.ratios.terser.toFixed(2) + "x" : "—"}) | ` +
          `${fmtKb(sz.orig.gzip)} -> ${fmtKb(sz.compiled.gzip)} (**${sz.ratios.gzip.toFixed(2)}x**) | ` +
          `${fmtKb(sz.orig.brotli)} -> ${fmtKb(sz.compiled.brotli)} (**${sz.ratios.brotli.toFixed(2)}x**) |`
      );
    }
    lines.push("");
  }

  if (!report.config.origOnly) {
    lines.push("## 5. Diagnostics & Blockers Summary");
    lines.push("");
    for (const lib of report.libraries) {
      if (lib.status === "OK" && lib.defaultStatus === "OK") continue;
      const b = lib.primaryBlocker;
      if (!b) continue;
      lines.push(`### \`${lib.id}\` — default \`${lib.defaultStatus}\`, overall \`${lib.status}\``);
      lines.push(`- **Code**: \`${b.errorCode}\``);
      lines.push(`- **Message**: ${b.message}`);
      if (b.compileMs != null) {
        lines.push(
          `- **Compile resources**: ${b.compileMs} ms${b.peakRssMb != null ? `, peak RSS ${b.peakRssMb} MB` : ""}`
        );
      }
      if (b.location) {
        lines.push(`- **Location**: line ${b.location.line}, column ${b.location.column}`);
        lines.push(`- **Excerpt**: \`${b.location.snippet}\``);
      }
      if (b.internalFrame) {
        lines.push(`- **Internal compiler frame**: \`${b.internalFrame}\``);
      }
      if (lib.bestProfile) {
        lines.push(`- **Workaround profile**: \`${lib.bestProfile.profile}\` (\`${lib.bestProfile.cliFlags}\`) -> **OK**`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = ensureCorpusReady();
  const specMap = new Map(SPECS.map(s => [s.id, s]));

  let selected = manifest.libraries;
  if (args.only) {
    const allow = new Set(args.only);
    selected = selected.filter(e => allow.has(e.id));
    if (selected.length === 0) {
      throw new Error(`No corpus entries matched --only=${args.only.join(",")}`);
    }
  }

  let compilerVersion = args.origOnly ? "orig-only" : "unknown";
  let compilerProfiles = null;
  if (!args.origOnly) {
    try {
      const mod = require(args.compiler);
      compilerVersion = mod.version || mod.prepackVersion || compilerVersion;
      // A compiler can declare which option profiles are meaningful for it (freezedry: only "default").
      compilerProfiles = Array.isArray(mod.benchProfiles) ? mod.benchProfiles : null;
    } catch (e) {
      throw new Error(`Failed to load compiler at ${args.compiler}: ${e.message}`);
    }
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "freezedry-bench-run-"));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const wantedProfiles = args.profiles || compilerProfiles;
  const activeProfiles = wantedProfiles
    ? OPTION_PROFILES.filter(p => wantedProfiles.includes(p.name))
    : OPTION_PROFILES;
  if (!args.origOnly && activeProfiles.length === 0) {
    throw new Error(`No option profiles matched --profiles=${args.profiles.join(",")}`);
  }

  console.log(`Real-World Benchmark`);
  console.log(`  compiler: ${args.origOnly ? "(skipped --orig-only)" : `${args.compiler} (v${compilerVersion})`}`);
  console.log(
    `  corpus:  ${selected.length} workloads${
      args.origOnly
        ? ""
        : `, ${activeProfiles.length} option profiles each (${args.jobs} workers, heap=${args.maxOldSpaceMb}MB)`
    }`
  );
  console.log(
    `  perf:    ${
      args.enablePerf
        ? `runs=${args.runs}${args.adaptRuns ? " (adaptive)" : ""}, warmup=${args.warmup}, snapshot=${args.enableSnapshot}`
        : "disabled (--no-perf)"
    }\n`
  );

  try {
    // Step 1: Verify plain original digests in VM + fresh Node
    const prepared = [];
    for (const entry of selected) {
      const spec = specMap.get(entry.id);
      const distPath = path.join(BENCH_DIR, entry.file);
      const code = fs.readFileSync(distPath, "utf8");
      const vmOrig = runInVm(code, spec.smokeCode, 60000);
      const nodeOrig = runInFreshNode(code, spec.smokeCode, tmpRoot, `orig-${entry.id}`, 60000);
      if (!vmOrig.ok || !nodeOrig.ok || vmOrig.digest !== nodeOrig.digest) {
        throw new Error(
          `Original smoke check failed for ${entry.id}: vm=${JSON.stringify(vmOrig)} node=${JSON.stringify(nodeOrig)}`
        );
      }
      prepared.push({
        entry,
        spec,
        distPath,
        code,
        expectedDigest: nodeOrig.digest,
        expectedJson: nodeOrig.json,
      });
    }

    // Step 2: Run all (lib x optionProfile) compilations across memory-weighted worker pool
    const outcomesByLib = new Map();
    if (!args.origOnly) {
      const compileTasks = [];
      for (const item of prepared) {
        for (const profile of activeProfiles) {
          const outCodeFile = path.join(tmpRoot, `pp-${item.entry.id}-${profile.name}.js`);
          compileTasks.push({ item, profile, outCodeFile });
        }
      }

      const taskWeight = t => {
        const bytes = t.item.entry.bytes;
        if (bytes >= GIANT_BYTES_THRESHOLD) return args.jobs;
        if (bytes >= LARGE_BYTES_THRESHOLD) return Math.max(1, Math.ceil(args.jobs / 2));
        return 1;
      };

      const flatOutcomes = await runWeightedPool(compileTasks, args.jobs, taskWeight, async t => {
        const timeoutMs = getTimeoutForEntry(t.item.entry, args);
        const res = await runProfileInChild(
          {
            id: t.item.entry.id,
            codeFile: t.item.distPath,
            smokeCode: t.item.spec.smokeCode,
            expectedDigest: t.item.expectedDigest,
            compilerPath: args.compiler,
            profile: t.profile,
            tmpDir: tmpRoot,
            outCodeFile: t.outCodeFile,
          },
          { timeoutMs, maxOldSpaceMb: args.maxOldSpaceMb }
        );
        return { id: t.item.entry.id, res };
      });

      for (const { id, res } of flatOutcomes) {
        if (!outcomesByLib.has(id)) outcomesByLib.set(id, []);
        outcomesByLib.get(id).push(res);
      }
    }

    const libReports = [];
    for (const item of prepared) {
      const profileResults = outcomesByLib.get(item.entry.id) || [];
      const chosen = args.origOnly
        ? { status: "SKIPPED", defaultStatus: "SKIPPED", bestProfile: null, primaryBlocker: null }
        : chooseBestOutcome(profileResults);
      if (!args.origOnly) {
        const blockerStr = chosen.primaryBlocker
          ? ` [${chosen.primaryBlocker.errorCode}: ${String(chosen.primaryBlocker.message).slice(0, 68)}]`
          : "";
        const resRef = chosen.bestProfile || chosen.primaryBlocker;
        const memInfo = resRef && resRef.peakRssMb != null ? `, ${resRef.peakRssMb}MB` : "";
        const statsInfo = chosen.bestProfile
          ? ` (${chosen.bestProfile.profile}, ${chosen.bestProfile.compileMs}ms${memInfo})`
          : resRef && resRef.compileMs != null
            ? ` (${resRef.compileMs}ms${memInfo})`
            : "";
        console.log(
          `[triage] ${item.entry.id.padEnd(18)} default=${chosen.defaultStatus.padEnd(5)} best=${chosen.status.padEnd(5)}` +
            statsInfo +
            blockerStr
        );
      }
      libReports.push({
        id: item.entry.id,
        name: item.entry.name,
        kind: item.entry.kind,
        tier: item.entry.tier || (isLargeEntry(item.entry) ? "large" : "standard"),
        buildType: item.entry.buildType,
        description: item.entry.description,
        bytes: item.entry.bytes,
        sha256: item.entry.sha256,
        packages: item.entry.packages,
        expectedDigest: item.expectedDigest,
        defaultStatus: chosen.defaultStatus,
        status: chosen.status,
        bestProfile: chosen.bestProfile
          ? {
              profile: chosen.bestProfile.profile,
              cliFlags: chosen.bestProfile.cliFlags,
              compileMs: chosen.bestProfile.compileMs,
              peakRssMb: chosen.bestProfile.peakRssMb ?? null,
              heapUsedMb: chosen.bestProfile.heapUsedMb ?? null,
              outBytes: chosen.bestProfile.outBytes,
            }
          : null,
        primaryBlocker: chosen.primaryBlocker || null,
        profiles: profileResults.map(r => {
          const copy = Object.assign({}, r);
          delete copy.outCodeFile;
          return copy;
        }),
        _bestOutCodeFile: chosen.bestProfile ? chosen.bestProfile.outCodeFile : null,
        _origCode: item.code,
        _smokeCode: item.spec.smokeCode,
        _expectedJson: item.expectedJson,
        origPerf: null,
        perf: null,
      });
    }

    // Step 3: Sequential performance harness (after workers exit so CPU is quiet)
    let nodeZeroBaseline = null;
    if (args.enablePerf) {
      console.log(`\nMeasuring 'node -e 0' baseline (runs=${args.runs}, warmup=${args.warmup}) ...`);
      nodeZeroBaseline = measureNodeZeroBaseline(args.runs, args.warmup);
      console.log(
        `  node -e 0: median=${nodeZeroBaseline.median.toFixed(2)}ms, p90=${nodeZeroBaseline.p90.toFixed(2)}ms\n`
      );

      // Phase 3a: Run all runtime timing benchmarks BEFORE loading Terser in-process, keeping parent heap small for spawnSync.
      for (const lib of libReports) {
        const adapted = adaptPerfRuns(lib.bytes, args.runs, args.warmup, args.adaptRuns);
        const timingOpts = {
          runs: adapted.runs,
          warmup: adapted.warmup,
          baselineMedian: nodeZeroBaseline.median,
          enableSnapshot: args.enableSnapshot,
        };

        if (!args.origOnly && lib.status === "OK" && lib._bestOutCodeFile) {
          const ppCode = fs.readFileSync(lib._bestOutCodeFile, "utf8");
          lib._ppCode = ppCode;
          lib.perf = await benchmarkTimingsOnly(
            lib.id,
            lib._origCode,
            ppCode,
            lib._smokeCode,
            lib._expectedJson,
            tmpRoot,
            timingOpts
          );
          lib.origPerf = {
            runs: adapted.runs,
            warmup: adapted.warmup,
            adaptedRuns: adapted.adapted,
            coldProcess: {
              baseline: lib.perf.coldProcess.baseline,
              orig: lib.perf.coldProcess.orig,
            },
            vmCodeCache: lib.perf.vmCodeCache.orig,
            vmExecOnly: lib.perf.vmExecOnly.orig,
            nodeSnapshot: lib.perf.nodeSnapshot,
            sizes: null,
          };
        } else {
          lib.origPerf = await benchmarkOriginalTimingsOnly(
            lib.id,
            lib._origCode,
            lib._smokeCode,
            lib._expectedJson,
            tmpRoot,
            timingOpts
          );
          lib.origPerf.adaptedRuns = adapted.adapted;
          lib.origPerf.sizes = null;
        }
      }

      // Phase 3b: Measure raw / Terser-minified / gzip / brotli sizes after all timings complete.
      for (const lib of libReports) {
        if (!args.origOnly && lib.status === "OK" && lib.perf) {
          lib.perf.sizes = await benchmarkSizesOnly(lib._origCode, lib._ppCode);
          lib.origPerf.sizes = lib.perf.sizes.orig;
          delete lib._ppCode;
          const perf = lib.perf;
          console.log(
            `[perf]   ${lib.id.padEnd(18)} (N=${perf.runs}) ` +
              `coldNet: ${perf.coldProcess.orig.net.median.toFixed(2)}->${perf.coldProcess.compiled.net.median.toFixed(2)}ms (${perf.coldProcess.speedupNet}x) | ` +
              `codeCache: ${perf.vmCodeCache.orig.median.toFixed(2)}->${perf.vmCodeCache.compiled.median.toFixed(2)}ms (${perf.vmCodeCache.speedup}x) | ` +
              `vmExec: ${perf.vmExecOnly.orig.median.toFixed(2)}->${perf.vmExecOnly.compiled.median.toFixed(2)}ms (${perf.vmExecOnly.speedup}x) | ` +
              `gzip: ${fmtKb(perf.sizes.orig.gzip)}->${fmtKb(perf.sizes.compiled.gzip)} (${perf.sizes.ratios.gzip}x)`
          );
        } else if (lib.origPerf) {
          lib.origPerf.sizes = await measureSizes(lib._origCode);
          const op = lib.origPerf;
          const snapStr =
            op.nodeSnapshot && op.nodeSnapshot.supported
              ? `${op.nodeSnapshot.net.median.toFixed(2)}ms`
              : "unsupported";
          console.log(
            `[orig]   ${lib.id.padEnd(18)} (N=${op.runs}) ` +
              `coldNet: ${op.coldProcess.orig.net.median.toFixed(2)}ms | ` +
              `codeCache: ${op.vmCodeCache.median.toFixed(2)}ms | ` +
              `vmExec: ${op.vmExecOnly.median.toFixed(2)}ms | ` +
              `snap: ${snapStr} | ` +
              `gzip: ${fmtKb(op.sizes.gzip)}`
          );
        }
      }
    }

    for (const lib of libReports) {
      delete lib._bestOutCodeFile;
      delete lib._origCode;
      delete lib._smokeCode;
      delete lib._expectedJson;
    }

    const now = new Date();
    const stamp = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const jsonPath = args.outJson ? path.resolve(args.outJson) : path.join(RESULTS_DIR, `${stamp}.json`);
    const mdPath = path.resolve(args.outMd);

    const summary = {
      total: libReports.length,
      standardCount: libReports.filter(l => l.tier !== "large").length,
      largeCount: libReports.filter(l => l.tier === "large").length,
      librariesCount: libReports.filter(l => l.kind === "library").length,
      appsCount: libReports.filter(l => l.kind === "app-workload").length,
      defaultOk: libReports.filter(l => l.defaultStatus === "OK").length,
      bestOk: libReports.filter(l => l.status === "OK").length,
      wrong: libReports.filter(l => l.status === "WRONG").length,
      fail: libReports.filter(l => l.status === "FAIL").length,
      timeout: libReports.filter(l => l.status === "TIMEOUT").length,
    };

    const report = {
      timestamp: now.toISOString(),
      compiler: {
        path: args.origOnly ? null : args.compiler,
        version: compilerVersion,
      },
      environment: {
        node: process.version,
        v8: process.versions.v8,
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0] ? os.cpus()[0].model : "unknown",
        totalMemBytes: os.totalmem(),
      },
      config: {
        runs: args.runs,
        warmup: args.warmup,
        adaptRuns: args.adaptRuns,
        timeout: args.timeout,
        largeTimeout: args.largeTimeout,
        maxOldSpaceMb: args.maxOldSpaceMb,
        enableSnapshot: args.enableSnapshot,
        origOnly: args.origOnly,
        only: args.only,
      },
      nodeZeroBaseline,
      summary,
      libraries: libReports,
    };

    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report) + "\n", "utf8");

    console.log(`\nWrote JSON results -> ${path.relative(REPO_ROOT, jsonPath)}`);
    console.log(`Wrote Markdown     -> ${path.relative(REPO_ROOT, mdPath)}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
