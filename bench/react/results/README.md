# react-bench results

## Correctness (`check.js`, 500 inputs, corpus fingerprint `4fafe7d601e3561d`)

| impl | result | code that runs at render time |
|---|---|---|
| baseline (`renderToString`) | 500/500 | app.js 31,446 B (8,027 gzip), plus React runtime: react 6.9 KB and react-dom-server-legacy 38.8 KB minified (2.7 + 12.8 KB gzip) |
| handwritten | 500/500 | 25,078 B unminified with comments (7,930 gzip); no React |

Details are in `check-*.json`.

## Performance (`perf.js --impl handwritten`, defaults: 1.5 s warm-up, 3 s timed, 3 interleaved rounds, 7 cold runs)

Full table: `perf-baseline-vs-handwritten.md` / `.json`. Measured 2026-11-05 on node v26.7.0,
4 vCPU AMD EPYC 9554P.

**Caveat:** this machine was shared with other jobs during the run (load average about 11 on
4 CPUs). Absolute numbers swing by ±30% between rounds, so treat the speedup ratios as the
result. They are medians of same-round ratios. Per-round ratios are listed in brackets.

| engine | page | baseline renders/s (ms) | handwritten renders/s (ms) | speedup [rounds] | alloc/render base → hand |
|---|---|---:|---:|---:|---|
| JIT | small (~106 elements) | 6,369 (0.157) | 49,831 (0.020) | **9.0x** [5.9, 9.0, 10.1] | 137 KB → 13 KB |
| JIT | large (~4,500 elements) | 164 (6.1) | 824 (1.21) | **5.6x** [3.9, 5.6, 6.5] | 6.4 MB → 0.6 MB |
| jitless | small | 985 (1.02) | 14,092 (0.071) | **15.2x** [15.2, 17.8, 9.9] | 155 KB → 14 KB |
| jitless | large | 17 (58) | 323 (3.1) | **18.1x** [15.5, 18.1, 22.8] | 7.2 MB → 0.65 MB |

p50 latencies, which suffer less from preemption than the means:

| | baseline | handwritten |
|---|---:|---:|
| JIT small | 0.068 ms | 0.009 ms |
| JIT large | 6.3 ms | 0.49 ms |
| jitless small | 0.53 ms | 0.028 ms |
| jitless large | 55 ms | 1.34 ms |

Cold start (fresh process, small page, median of 7):

| engine | impl | load | prepare | 1st render | first HTML |
|---|---|---:|---:|---:|---:|
| JIT | baseline | 20.7 ms | 0.8 ms | 9.9 ms | **32 ms** |
| JIT | handwritten | 0.9 ms | 0.1 ms | 0.9 ms | **1.9 ms** |
| jitless | baseline | 22.1 ms | 0.8 ms | 13.9 ms | **38 ms** |
| jitless | handwritten | 0.8 ms | 0.1 ms | 0.8 ms | **2.7 ms** |

These numbers exclude Node's own bootstrap (60–75 ms here).

## Reading the numbers

- Full specialization of this app is worth about **6–9x warm under the JIT**, **15–18x without a JIT**,
  and **about 15x on cold first HTML** (most of that comes from not loading or initializing React). It
  also cuts allocation per render by about 10x.
- The large page gains less under the JIT (5.6x) than the small page (9x). The handwritten
  renderer's time there is dominated by building a 285 KB string (escaping and string
  concatenation, plus flattening the rope), which no specializer can avoid. The large-page
  handwritten p50 to mean gap (0.49 vs 1.2 ms) is GC: about 600 KB of garbage per render.
- Without a JIT, React's generic per-element work (prop loops, `switch` on prop names,
  `hasOwnProperty`, the hooks dispatcher, the task/segment machinery) is interpreted, so removing
  it pays off much more. This is the argument for an iOS / JSC-without-JIT target.
- The 2018 Prepack SSR hackathon number (13 ms → 0.25 ms, about 50x) came from a tiny tree on React 16's
  much slower string renderer. On React 18 with a realistic page, the hand-written ceiling is about 6–9x
  warm with a JIT.
