# Prepack vs Hybrid vs Original — Benchmark & Verification Comparison

- **Generated**: `2026-11-05T11:04:59.537Z`
- **Environment**: Node `v26.7.0` (V8 `14.6.202.34-node.28`) on `linux/x64`
- **Prepack (revive)**: `/tmp/opencode/pp-work/lib/prepack-node.js` (v`0.2.55-alpha.0`, runs=30)
- **Hybrid**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (v`0.0.1-hybrid`, runs=30)

## Summary

| Metric | Prepack (revive) | Hybrid | Notes |
|---|---:|---:|---|
| **Workloads evaluated** | 15 | 15 | Corpus in `bench/libs/dist/*.js` |
| **Smoke OK (default options)** | 9/15 | 8/15 | Fresh `vm` + fresh `node` smoke digest |
| **Smoke OK (best profile)** | 11/15 | 8/15 | Includes profile flag unlocks |
| **Silent miscompile (WRONG)** | 1 | 0 | Must always be **0** in Hybrid |
| **Heap Isomorphism Oracle** | — | 8 strict + 0 seeded | Full heap + `[[Scopes]]` + V8 `Context` sharing bijection |

## 1. Per-Library Master Table (Original vs Prepack vs Hybrid)

| Library | Correctness (PP / Hybrid / Oracle) | Size Raw (Orig / PP / Hyb) | Size Terser (Orig / PP / Hyb) | Size Gzip (Orig / PP / Hyb) | Cold Node Net ms (Orig / PP / Hyb) | Code-Cache ms (Orig / PP / Hyb) | Exec-Only ms (Orig / PP / Hyb) |
|---|---|---|---|---|---|---|---|
| **`lodash`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / DIFF | 533.1 KB / 536.1 KB / — | 69.0 KB / 72.3 KB / — | 24.5 KB / 23.7 KB / — | 13.97 ms / 14.33 ms / — | 3.04 ms / 3.75 ms / — | 2.96 ms / 2.88 ms / — |
| **`underscore`** | OK* (jsc; def:FAIL) / OK / ISO-OK | 67.3 KB / 67.6 KB / 235.9 KB | 18.9 KB / 32.7 KB / 82.1 KB | 7.2 KB / 7.9 KB / 25.2 KB | 2.27 ms / 1.19 ms / 6.71 ms | 0.47 ms / 0.44 ms / 0.78 ms | 0.50 ms / 0.38 ms / 0.82 ms |
| **`ramda`** | OK / OK / ISO-OK | 342.9 KB / 135.3 KB / 545.0 KB | 52.6 KB / 64.8 KB / 150.2 KB | 14.1 KB / 15.2 KB / 40.2 KB | 4.08 ms / 3.69 ms / 10.13 ms | 0.64 ms / 0.29 ms / 0.80 ms | 0.74 ms / 0.26 ms / 0.88 ms |
| **`immutable`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / DIFF | 175.4 KB / 143.8 KB / — | 64.9 KB / 62.9 KB / — | 18.0 KB / 17.9 KB / — | 5.69 ms / 5.61 ms / — | 1.15 ms / 1.02 ms / — | 1.10 ms / 0.98 ms / — |
| **`moment`** | OK / OK / ISO-OK | 637.8 KB / 632.6 KB / 1442.8 KB | 292.3 KB / 347.4 KB / 741.6 KB | 74.3 KB / 99.1 KB / 181.9 KB | 42.40 ms / 23.72 ms / 90.88 ms | 12.22 ms / 2.37 ms / 4.69 ms | 13.38 ms / 2.51 ms / 4.75 ms |
| **`chroma-js`** | OK / OK / ISO-OK | 109.2 KB / 84.0 KB / 236.2 KB | 42.5 KB / 40.0 KB / 100.3 KB | 15.4 KB / 14.3 KB / 32.0 KB | 10.59 ms / 4.82 ms / 11.94 ms | 0.71 ms / 0.66 ms / 1.16 ms | 0.65 ms / 0.65 ms / 0.77 ms |
| **`acorn`** | OK / OK / ISO-OK | 240.9 KB / 266.8 KB / 556.6 KB | 115.6 KB / 163.1 KB / 314.0 KB | 33.9 KB / 38.7 KB / 77.6 KB | 9.40 ms / 8.93 ms / 15.34 ms | 1.47 ms / 1.25 ms / 1.56 ms | 1.43 ms / 1.24 ms / 1.54 ms |
| **`crc-32`** | FAIL (PP0037) / OK / ISO-OK | 3.6 KB / — / 30.0 KB | 2.0 KB / — / 27.0 KB | 0.8 KB / — / 18.2 KB | 2.82 ms / — / 2.04 ms | 0.40 ms / — / 0.12 ms | 0.20 ms / — / 0.09 ms |
| **`marked`** | FAIL (PP1004) / FAIL (HYB_BAILOUT) / DIFF | 49.4 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`d3-scale`** | FAIL (INVARIANT) / FAIL (HYB_VOLATILE_BAILOUT) / DIFF | 148.9 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`redux`** | OK* (browser-seed; def:FAIL) / FAIL (HYB_VOLATILE_BAILOUT) / DIFF | 18.1 KB / 14.6 KB / — | 8.8 KB / 7.7 KB / — | 3.3 KB / 3.0 KB / — | 0.82 ms / 0.00 ms / — | 0.23 ms / 0.16 ms / — | 0.22 ms / 0.15 ms / — |
| **`handlebars-app`** | WRONG (PP0023) / FAIL (HYB_VOLATILE_BAILOUT) / DIFF | 211.9 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`preact-ssr-app`** | OK / OK / ISO-OK | 22.0 KB / 34.7 KB / 52.2 KB | 21.2 KB / 21.7 KB / 45.8 KB | 8.6 KB / 8.7 KB / 13.3 KB | 1.42 ms / 2.21 ms / 2.44 ms | 0.27 ms / 0.25 ms / 0.27 ms | 0.24 ms / 0.18 ms / 0.23 ms |
| **`react-ssr-app`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / DIFF | 47.0 KB / 118.8 KB / — | 45.1 KB / 76.6 KB / — | 15.2 KB / 21.0 KB / — | 7.56 ms / 4.04 ms / — | 0.73 ms / 0.45 ms / — | 0.73 ms / 0.44 ms / — |
| **`yaml-router-app`** | OK / OK / ISO-OK | 157.1 KB / 126.2 KB / 458.2 KB | 51.8 KB / 58.6 KB / 160.4 KB | 17.2 KB / 18.0 KB / 49.8 KB | 9.22 ms / 4.05 ms / 6.54 ms | 1.80 ms / 0.51 ms / 0.88 ms | 1.71 ms / 0.47 ms / 0.81 ms |

## 2. Startup Timings & Speedups vs Original (incl. V8 `--build-snapshot` Reference)

| Library | Orig Cold Net | PP Cold Net (Speedup) | Hybrid Cold Net (Speedup) | V8 Snapshot Net | Orig Code-Cache | PP Code-Cache (Speedup) | Hybrid Code-Cache (Speedup) | Orig Exec-Only | PP Exec-Only (Speedup) | Hybrid Exec-Only (Speedup) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 13.97 ms | 14.33 ms (0.97x) | — | 9.41 ms | 3.04 ms | 3.75 ms (0.81x) | — | 2.96 ms | 2.88 ms (1.03x) | — |
| **`underscore`** | 2.27 ms | 1.19 ms (0.90x) | 6.71 ms (0.34x) | 7.06 ms | 0.47 ms | 0.44 ms (1.01x) | 0.78 ms (0.60x) | 0.50 ms | 0.38 ms (1.01x) | 0.82 ms (0.61x) |
| **`ramda`** | 4.08 ms | 3.69 ms (1.14x) | 10.13 ms (0.40x) | 19.86 ms | 0.64 ms | 0.29 ms (2.23x) | 0.80 ms (0.81x) | 0.74 ms | 0.26 ms (2.28x) | 0.88 ms (0.83x) |
| **`immutable`** | 5.69 ms | 5.61 ms (1.01x) | — | 9.05 ms | 1.15 ms | 1.02 ms (1.12x) | — | 1.10 ms | 0.98 ms (1.12x) | — |
| **`moment`** | 42.40 ms | 23.72 ms (1.05x) | 90.88 ms (0.47x) | 30.15 ms | 12.22 ms | 2.37 ms (4.58x) | 4.69 ms (2.61x) | 13.38 ms | 2.51 ms (4.43x) | 4.75 ms (2.82x) |
| **`chroma-js`** | 10.59 ms | 4.82 ms (0.98x) | 11.94 ms (0.89x) | 6.90 ms | 0.71 ms | 0.66 ms (1.08x) | 1.16 ms (0.61x) | 0.65 ms | 0.65 ms (1.08x) | 0.77 ms (0.84x) |
| **`acorn`** | 9.40 ms | 8.93 ms (0.92x) | 15.34 ms (0.61x) | 17.80 ms | 1.47 ms | 1.25 ms (1.17x) | 1.56 ms (0.94x) | 1.43 ms | 1.24 ms (1.21x) | 1.54 ms (0.93x) |
| **`crc-32`** | 2.82 ms | — | 2.04 ms (1.39x) | 5.69 ms | 0.40 ms | — | 0.12 ms (3.31x) | 0.20 ms | — | 0.09 ms (2.34x) |
| **`marked`** | — | — | — | — | — | — | — | — | — | — |
| **`d3-scale`** | — | — | — | — | — | — | — | — | — | — |
| **`redux`** | 0.82 ms | 0.00 ms (—) | — | 4.66 ms | 0.23 ms | 0.16 ms (1.44x) | — | 0.22 ms | 0.15 ms (1.47x) | — |
| **`handlebars-app`** | — | — | — | — | — | — | — | — | — | — |
| **`preact-ssr-app`** | 1.42 ms | 2.21 ms (1.06x) | 2.44 ms (0.58x) | 4.70 ms | 0.27 ms | 0.25 ms (1.32x) | 0.27 ms (1.01x) | 0.24 ms | 0.18 ms (1.34x) | 0.23 ms (1.05x) |
| **`react-ssr-app`** | 7.56 ms | 4.04 ms (1.87x) | — | 11.05 ms | 0.73 ms | 0.45 ms (1.63x) | — | 0.73 ms | 0.44 ms (1.66x) | — |
| **`yaml-router-app`** | 9.22 ms | 4.05 ms (2.00x) | 6.54 ms (1.41x) | 7.87 ms | 1.80 ms | 0.51 ms (3.08x) | 0.88 ms (2.05x) | 1.71 ms | 0.47 ms (3.17x) | 0.81 ms (2.09x) |

## 3. Size Ratios & Heap Isomorphism Oracle Audit

| Library | PP Gzip Ratio | Hybrid Gzip Ratio | Prepack Blocker / Notes | Hybrid Heap Isomorphism Oracle (`verify`) |
|---|---:|---:|---|---|
| **`lodash`** | 0.97x | — | — | BAIL (Hybrid bailout: volatile API "Date.now()" called during initialization (lodash.js:6783:21)) |
| **`underscore`** | 1.10x | 3.50x | `PP0001: This operation is not yet supported on document at childNodes` | ISO-OK (653 obj / 317 fn) |
| **`ramda`** | 1.08x | 2.85x | — | ISO-OK (1554 obj / 753 fn) |
| **`immutable`** | 0.99x | — | — | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (immutable.js:893:12)) |
| **`moment`** | 1.33x | 2.45x | — | ISO-OK (4350 obj / 941 fn) |
| **`chroma-js`** | 0.93x | 2.08x | — | ISO-OK (402 obj / 167 fn) |
| **`acorn`** | 1.14x | 2.29x | — | ISO-OK (833 obj / 348 fn) |
| **`crc-32`** | — | 22.73x | `PP0037: failed to emit a residual loop: the loop calls an unknown or unsupported functio` | ISO-OK (25 obj / 3 fn) |
| **`marked`** | — | — | `PP1004: Syntax error: This experimental syntax requires enabling the parser plugin: 'opt` | BAIL (Hybrid bailout: class or function with private fields (#x) (a) (global.marked.Hooks.get.[[Scope:s20]].O)) |
| **`d3-scale`** | — | — | `INVARIANT: serialized 1339 of 1341` | BAIL (Hybrid bailout: volatile API "new Date()" without arguments called during initialization (d3-scale.js:3086:12)) |
| **`redux`** | 0.89x | — | `PP0031: property access on unknown object` | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (redux.js:366:33)) |
| **`handlebars-app`** | — | — | `PP0023: VM runtime threw: TypeError: not an object` | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (handlebars-app.js:1302:16)) |
| **`preact-ssr-app`** | 1.00x | 1.54x | — | ISO-OK (145 obj / 62 fn) |
| **`react-ssr-app`** | 1.38x | — | — | BAIL (Hybrid bailout: volatile API "Date.now()" called during initialization (react-ssr-app.js:20:236)) |
| **`yaml-router-app`** | 1.05x | 2.90x | — | ISO-OK (587 obj / 192 fn) |

