"use strict";

// Throughput + cold-start harness.
//
//   node react-bench/perf.js --impl <module> [--impl <module2> ...]
//        [--variants small,large] [--engines jit,jitless] [--time 3] [--warmup 1.5]
//        [--cold-runs 7] [--no-cold] [--quick] [--out results/foo.json]
//
// Baseline (impl/baseline.js) is always measured too, so every row has a speedup ratio.
// Every measurement runs in its own fresh child process (no JIT/IC pollution between impls):
//   - throughput: prepare once, warm up for --warmup s, then render for --time s cycling through
//     the corpus (500 small inputs / 100 large inputs; new data object every iteration);
//     reports renders/s, mean/p50/p90/p99 ms per render, and bytes allocated per render
//     (v8 total_allocated_bytes delta; includes garbage).
//   - engines: "jit" = plain node; "jitless" = node --jitless (interpreter only, approximates
//     iOS JavaScriptCore without JIT / other no-JIT environments).
//   - cold: a fresh process loads the impl module, prepare()s, and renders one small input;
//     reports load / prepare / first render / second render ms. The first cold run is
//     discarded (lets implementations populate an on-disk compile cache), the median of the
//     remaining --cold-runs is reported.

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const REACT_BENCH_DIR = __dirname;

function parseArgs(argv) {
  const args = {
    impls: [],
    variants: ["small", "large"],
    engines: ["jit", "jitless"],
    time: 3,
    warmup: 1.5,
    coldRuns: 7,
    rounds: 3,
    cold: true,
    out: null,
    child: null,
    variant: null,
    engine: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--impl") args.impls.push(argv[++i]);
    else if (a === "--variants") args.variants = argv[++i].split(",");
    else if (a === "--engines") args.engines = argv[++i].split(",");
    else if (a === "--time") args.time = Number(argv[++i]);
    else if (a === "--warmup") args.warmup = Number(argv[++i]);
    else if (a === "--cold-runs") args.coldRuns = Number(argv[++i]);
    else if (a === "--no-cold") args.cold = false;
    else if (a === "--rounds") args.rounds = Number(argv[++i]);
    else if (a === "--quick") {
      args.time = 1;
      args.warmup = 0.5;
      args.coldRuns = 3;
      args.rounds = 1;
    } else if (a === "--out") args.out = argv[++i];
    else if (a === "--child") args.child = argv[++i];
    else if (a === "--variant") args.variant = argv[++i];
    else if (a === "--engine") args.engine = argv[++i];
    else if (a === "--cold-child") args.coldChild = true;
    else if (a === "-h" || a === "--help") {
      console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(2, 21).join("\n"));
      process.exit(0);
    } else if (!a.startsWith("--")) args.impls.push(a);
    else throw new Error("unknown argument: " + a);
  }
  return args;
}

// ---------------------------------------------------------------- child: throughput
function childThroughput(args) {
  const v8 = require("v8");
  const { getSmallCorpus, getLargeCorpus } = require("./data");
  const { APP_JS_PATH, loadImpl, makePrepareOpts, unwrapPrepared } = require("./harness-util");
  const inputs = args.variant === "large" ? getLargeCorpus(100) : getSmallCorpus();
  const impl = loadImpl(args.child);
  const appSource = fs.readFileSync(APP_JS_PATH, "utf8");
  const t0 = process.hrtime.bigint();
  const render = unwrapPrepared(impl.prepare(appSource, makePrepareOpts())).renderFn;
  const prepareMs = Number(process.hrtime.bigint() - t0) / 1e6;

  let sink = 0;
  let idx = 0;
  const n = inputs.length;
  // warm-up
  const warmEnd = process.hrtime.bigint() + BigInt(Math.round(args.warmup * 1e9));
  let warmCount = 0;
  while (process.hrtime.bigint() < warmEnd || warmCount < n) {
    sink += render(inputs[idx]).length;
    idx = idx + 1 === n ? 0 : idx + 1;
    warmCount++;
  }
  if (typeof global.gc === "function") global.gc();

  // timed, per-render samples
  const budgetNs = BigInt(Math.round(args.time * 1e9));
  let samples = new Float64Array(1 << 16);
  let count = 0;
  const alloc0 = v8.getHeapStatistics().total_allocated_bytes;
  const start = process.hrtime.bigint();
  const end = start + budgetNs;
  let now = start;
  while (now < end) {
    const s = now;
    sink += render(inputs[idx]).length;
    idx = idx + 1 === n ? 0 : idx + 1;
    now = process.hrtime.bigint();
    if (count === samples.length) {
      const bigger = new Float64Array(samples.length * 2);
      bigger.set(samples);
      samples = bigger;
    }
    samples[count++] = Number(now - s) / 1e6;
  }
  const elapsedMs = Number(now - start) / 1e6;
  const alloc1 = v8.getHeapStatistics().total_allocated_bytes;

  const sorted = Array.from(samples.subarray(0, count)).sort((a, b) => a - b);
  const pct = p => sorted[Math.min(count - 1, Math.max(0, Math.ceil(p * count) - 1))];
  return {
    impl: impl.name,
    variant: args.variant,
    engine: args.engine,
    prepareMs,
    warmupRenders: warmCount,
    renders: count,
    elapsedMs,
    rendersPerSec: (count / elapsedMs) * 1000,
    meanMs: elapsedMs / count,
    p50Ms: pct(0.5),
    p90Ms: pct(0.9),
    p99Ms: pct(0.99),
    allocBytesPerRender: typeof alloc0 === "number" ? (alloc1 - alloc0) / count : null,
    avgHtmlBytes: Math.round(sink / (warmCount + count)),
  };
}

// ---------------------------------------------------------------- child: cold start
function childCold(args) {
  const { performance } = require("perf_hooks");
  const bootMs = performance.now(); // node bootstrap until this script runs
  const { generateRequest } = require("./data");
  const input1 = generateRequest(0xc01d, "small");
  const input2 = generateRequest(0xc01e, "small");
  const harnessUtil = require("./harness-util");
  const appSource = fs.readFileSync(harnessUtil.APP_JS_PATH, "utf8");
  const opts = harnessUtil.makePrepareOpts();

  const t0 = performance.now();
  const impl = harnessUtil.loadImpl(args.child);
  const t1 = performance.now();
  const render = harnessUtil.unwrapPrepared(impl.prepare(appSource, opts)).renderFn;
  const t2 = performance.now();
  const html1 = render(input1);
  const t3 = performance.now();
  const html2 = render(input2);
  const t4 = performance.now();
  return {
    impl: impl.name,
    engine: args.engine,
    bootMs,
    loadMs: t1 - t0,
    prepareMs: t2 - t1,
    firstRenderMs: t3 - t2,
    secondRenderMs: t4 - t3,
    firstHtmlMs: t3 - t0,
    htmlBytes: html1.length + html2.length,
  };
}

// ---------------------------------------------------------------- parent
function runChild(mode, implSpec, variant, engine, args) {
  const nodeArgs = [];
  if (engine === "jitless") nodeArgs.push("--jitless");
  nodeArgs.push("--expose-gc", __filename, "--child", implSpec, "--engine", engine, "--time", String(args.time), "--warmup", String(args.warmup));
  if (variant) nodeArgs.push("--variant", variant);
  if (mode === "cold") nodeArgs.push("--cold-child");
  const r = childProcess.spawnSync(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, { NODE_ENV: "production", TZ: "UTC" }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = (r.stdout || "").split("\n").find(l => l.startsWith("@@RESULT "));
  if (r.status !== 0 || !line) {
    throw new Error(`child failed (${mode} ${implSpec} ${variant || ""} ${engine}):\n${r.stderr}\n${r.stdout}`);
  }
  return JSON.parse(line.slice("@@RESULT ".length));
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sanityCheck(implSpec) {
  // Refuse to benchmark an implementation that is wrong on the first inputs of each variant.
  const { React, ReactDOMServer } = require("./react-deps");
  const { getSmallCorpus, getLargeCorpus } = require("./data");
  const { APP_JS_PATH, loadImpl, makePrepareOpts, unwrapPrepared, formatFirstDiff } = require("./harness-util");
  const App = require(APP_JS_PATH);
  const impl = loadImpl(implSpec);
  const render = unwrapPrepared(impl.prepare(fs.readFileSync(APP_JS_PATH, "utf8"), makePrepareOpts())).renderFn;
  const inputs = getSmallCorpus().slice(0, 20).concat(getLargeCorpus(2));
  for (const d of inputs) {
    const expected = ReactDOMServer.renderToString(React.createElement(App, { data: structuredClone(d) }));
    const actual = render(structuredClone(d));
    if (actual !== expected) {
      const diff = typeof actual === "string" ? formatFirstDiff(expected, actual) : { actual: typeof actual };
      throw new Error(`${impl.name}: wrong output for ${d.requestId}; run check.js first.\n${JSON.stringify(diff, null, 2)}`);
    }
  }
  return impl.name;
}

function fmt(n, d = 3) {
  if (n == null || !Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("en-US");
  return n.toFixed(d);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child) {
    const result = args.coldChild ? childCold(args) : childThroughput(args);
    process.stdout.write("@@RESULT " + JSON.stringify(result) + "\n");
    return;
  }

  const implSpecs = ["baseline"].concat(args.impls.filter(s => s !== "baseline" && !/impl[\\/]baseline(\.js)?$/.test(s)));
  // Resolve relative paths against the caller's cwd now; children run with the same cwd.
  const names = {};
  for (const spec of implSpecs) {
    names[spec] = sanityCheck(spec);
    console.error(`sanity ok: ${names[spec]}`);
  }

  const results = { meta: meta(args), throughput: [], cold: [] };
  results.meta.loadavgBefore = require("os").loadavg();
  // Rounds are interleaved (round r runs every impl before round r+1) so that background load
  // affects all impls alike; per-round ratios against baseline are the robust "speedup" number.
  for (const engine of args.engines) {
    for (const variant of args.variants) {
      const rounds = {};
      for (let r = 0; r < args.rounds; r++) {
        for (const spec of implSpecs) {
          console.error(`throughput: ${names[spec]} / ${variant} / ${engine} / round ${r + 1}/${args.rounds} ...`);
          (rounds[spec] = rounds[spec] || []).push(runChild("throughput", spec, variant, engine, args));
        }
      }
      for (const spec of implSpecs) {
        const rs = rounds[spec];
        const med = median(rs.map(x => x.rendersPerSec));
        const pick = rs.reduce((a, b) => (Math.abs(b.rendersPerSec - med) < Math.abs(a.rendersPerSec - med) ? b : a));
        const ratios = rs.map((x, i) => x.rendersPerSec / rounds.baseline[i].rendersPerSec);
        results.throughput.push(
          Object.assign({ spec }, pick, {
            rendersPerSec: med,
            speedup: median(ratios),
            roundsRendersPerSec: rs.map(x => Math.round(x.rendersPerSec)),
            roundsSpeedup: ratios.map(x => Math.round(x * 100) / 100),
          })
        );
      }
    }
  }
  if (args.cold) {
    for (const engine of args.engines) {
      const runsBySpec = {};
      for (let i = 0; i <= args.coldRuns; i++) {
        for (const spec of implSpecs) {
          if (i === 0) console.error(`cold: ${names[spec]} / ${engine} x${args.coldRuns + 1} ...`);
          (runsBySpec[spec] = runsBySpec[spec] || []).push(runChild("cold", spec, null, engine, args));
        }
      }
      for (const spec of implSpecs) {
        const kept = runsBySpec[spec].slice(1); // first run primes caches
        const agg = { spec, impl: kept[0].impl, engine, runs: kept.length };
        for (const k of ["bootMs", "loadMs", "prepareMs", "firstRenderMs", "secondRenderMs", "firstHtmlMs"]) {
          agg[k] = median(kept.map(r => r[k]));
        }
        results.cold.push(agg);
      }
    }
  }
  results.meta.loadavgAfter = require("os").loadavg();

  const md = renderMarkdown(results);
  console.log(md);
  const outPath =
    args.out ||
    path.join(
      REACT_BENCH_DIR,
      "results",
      "perf-" + implSpecs.map(s => path.basename(s, ".js")).join("-vs-") + ".json"
    );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  fs.writeFileSync(outPath.replace(/\.json$/, "") + ".md", md + "\n");
  console.error(`wrote ${outPath} (+ .md)`);
}

function meta(args) {
  const os = require("os");
  return {
    date: new Date().toISOString(),
    node: process.version,
    cpu: os.cpus()[0] && os.cpus()[0].model,
    cpus: os.cpus().length,
    platform: `${os.platform()} ${os.release()}`,
    timeSec: args.time,
    warmupSec: args.warmup,
    coldRuns: args.coldRuns,
    rounds: args.rounds,
  };
}

function renderMarkdown(results) {
  const lines = [];
  const m = results.meta;
  lines.push(`# react-bench perf (${m.date})`);
  lines.push("");
  lines.push(
    `node ${m.node}, ${m.cpu} x${m.cpus}, ${m.platform}; ${m.warmupSec}s warm-up + ${m.timeSec}s timed per cell, ` +
      `${m.rounds} interleaved round(s). Load average before/after: ${m.loadavgBefore.map(x => x.toFixed(1)).join(" ")} / ` +
      `${m.loadavgAfter.map(x => x.toFixed(1)).join(" ")}.`
  );
  lines.push("");
  lines.push("## Throughput (warm, cycling through corpus)");
  lines.push("");
  lines.push("renders/s and speedup are medians over rounds (speedup = median of per-round impl/baseline ratios); latency columns come from the median round.");
  lines.push("");
  lines.push("| engine | page | impl | renders/s | speedup | mean ms | p50 ms | p90 ms | p99 ms | alloc KB/render | avg HTML KB |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of results.throughput) {
    lines.push(
      `| ${r.engine} | ${r.variant} | ${r.impl} | ${fmt(r.rendersPerSec, 0)} | ${fmt(r.speedup, 2)}x | ${fmt(r.meanMs)} | ${fmt(r.p50Ms)} | ${fmt(r.p90Ms)} | ${fmt(r.p99Ms)} | ${fmt(r.allocBytesPerRender / 1024, 1)} | ${fmt(r.avgHtmlBytes / 1024, 1)} |`
    );
  }
  if (results.cold.length) {
    lines.push("");
    lines.push("## Cold start (fresh process, median; small page)");
    lines.push("");
    lines.push("`load` = require impl module (incl. React if it needs it); `first HTML` = load + prepare + first render.");
    lines.push("");
    lines.push("| engine | impl | node boot ms | load ms | prepare ms | 1st render ms | 2nd render ms | first HTML ms |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
    for (const r of results.cold) {
      lines.push(
        `| ${r.engine} | ${r.impl} | ${fmt(r.bootMs, 1)} | ${fmt(r.loadMs, 2)} | ${fmt(r.prepareMs, 2)} | ${fmt(r.firstRenderMs, 2)} | ${fmt(r.secondRenderMs, 2)} | ${fmt(r.firstHtmlMs, 2)} |`
      );
    }
  }
  return lines.join("\n");
}

main();
