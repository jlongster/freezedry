# Prepack vs Hybrid vs Original — Benchmark & Verification Comparison

- **Generated**: `2026-11-05T19:39:07.865Z`
- **Environment**: Node `v26.7.0` (V8 `14.6.202.34-node.28`) on `linux/x64`
- **Prepack (revive)**: `/tmp/opencode/pp-work/lib/prepack-node.js` (v`0.2.55-alpha.0`, runs=30)
- **Hybrid**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (v`0.0.1-hybrid`, runs=30)

## Summary

| Metric | Prepack (revive) | Hybrid | Notes |
|---|---:|---:|---|
| **Workloads evaluated** | 22 | 22 | Corpus in `bench/libs/dist/*.js` |
| **Smoke OK (default options)** | 15/22 | 11/22 | Fresh `vm` + fresh `node` smoke digest |
| **Smoke OK (best profile)** | 18/22 | 11/22 | Includes profile flag unlocks |
| **Silent miscompile (WRONG)** | 0 | 0 | Must always be **0** in Hybrid |
| **Heap Isomorphism Oracle** | — | 11 strict + 0 seeded | Full heap + `[[Scopes]]` + V8 `Context` sharing bijection |

## 1. Per-Library Master Table (Original vs Prepack vs Hybrid)

| Library | Correctness (PP / Hybrid / Oracle) | Size Raw (Orig / PP / Hyb) | Size Terser (Orig / PP / Hyb) | Size Gzip (Orig / PP / Hyb) | Cold Node Net ms (Orig / PP / Hyb) | Code-Cache ms (Orig / PP / Hyb) | Exec-Only ms (Orig / PP / Hyb) |
|---|---|---|---|---|---|---|---|
| **`lodash`** | OK* (browser-opt; def:FAIL) / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 533.1 KB / 538.5 KB / — | 69.0 KB / 73.2 KB / — | 24.5 KB / 23.9 KB / — | 16.56 ms / 17.43 ms / — | 3.50 ms / 4.39 ms / — | 3.48 ms / 3.45 ms / — |
| **`underscore`** | OK / OK / ISO-OK | 67.3 KB / 68.6 KB / 99.1 KB | 18.9 KB / 33.6 KB / 45.6 KB | 7.2 KB / 8.1 KB / 14.0 KB | 2.92 ms / 1.54 ms / 3.44 ms | 0.57 ms / 0.63 ms / 0.58 ms | 0.55 ms / 0.59 ms / 0.55 ms |
| **`ramda`** | OK / OK / ISO-OK | 342.9 KB / 137.4 KB / 232.9 KB | 52.6 KB / 65.7 KB / 121.4 KB | 14.1 KB / 15.6 KB / 32.0 KB | 4.83 ms / 4.03 ms / 8.47 ms | 0.75 ms / 0.47 ms / 0.50 ms | 0.74 ms / 0.56 ms / 0.47 ms |
| **`immutable`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 175.4 KB / 144.6 KB / — | 64.9 KB / 63.2 KB / — | 18.0 KB / 17.9 KB / — | 5.74 ms / 6.34 ms / — | 1.50 ms / 1.33 ms / — | 1.31 ms / 1.16 ms / — |
| **`moment`** | OK / OK / ISO-OK | 637.8 KB / 669.3 KB / 1056.6 KB | 292.3 KB / 338.7 KB / 675.0 KB | 74.3 KB / 98.4 KB / 167.5 KB | 26.20 ms / 25.20 ms / 38.29 ms | 11.92 ms / 2.48 ms / 4.11 ms | 11.38 ms / 2.47 ms / 4.00 ms |
| **`chroma-js`** | OK / OK / ISO-OK | 109.2 KB / 85.4 KB / 173.0 KB | 42.5 KB / 40.6 KB / 88.3 KB | 15.4 KB / 14.5 KB / 30.1 KB | 4.95 ms / 4.34 ms / 6.96 ms | 0.86 ms / 0.97 ms / 0.80 ms | 0.80 ms / 0.89 ms / 0.76 ms |
| **`acorn`** | OK / OK / ISO-OK | 240.9 KB / 252.0 KB / 429.1 KB | 115.6 KB / 152.8 KB / 280.9 KB | 33.9 KB / 36.5 KB / 72.5 KB | 7.17 ms / 9.06 ms / 10.66 ms | 1.75 ms / 1.60 ms / 1.63 ms | 1.75 ms / 1.42 ms / 1.61 ms |
| **`crc-32`** | OK / OK / ISO-OK | 3.6 KB / 105.0 KB / 6.7 KB | 2.0 KB / 93.7 KB / 4.5 KB | 0.8 KB / 44.0 KB / 1.2 KB | 0.05 ms / 1.40 ms / 0.20 ms | 0.34 ms / 0.25 ms / 0.35 ms | 0.32 ms / 0.23 ms / 0.33 ms |
| **`marked`** | OK / OK / ISO-OK | 49.4 KB / 74.2 KB / 113.3 KB | 48.9 KB / 48.8 KB / 106.6 KB | 14.5 KB / 14.4 KB / 27.8 KB | 32.77 ms / 35.42 ms / 37.57 ms | 1.47 ms / 1.30 ms / 1.28 ms | 1.23 ms / 1.22 ms / 1.11 ms |
| **`d3-scale`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 148.9 KB / 184.1 KB / — | 71.1 KB / 89.8 KB / — | 23.0 KB / 28.8 KB / — | 3.64 ms / 6.17 ms / — | 1.23 ms / 0.76 ms / — | 0.96 ms / 0.56 ms / — |
| **`redux`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 18.1 KB / 14.4 KB / — | 8.8 KB / 7.5 KB / — | 3.3 KB / 2.9 KB / — | 0.54 ms / 0.11 ms / — | 0.40 ms / 0.32 ms / — | 0.30 ms / 0.25 ms / — |
| **`handlebars-app`** | OK* (browser-opt; def:FAIL) / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 211.9 KB / 202.1 KB / — | 86.4 KB / 95.2 KB / — | 26.3 KB / 26.7 KB / — | 17.04 ms / 5.62 ms / — | 3.37 ms / 1.11 ms / — | 3.58 ms / 1.11 ms / — |
| **`preact-ssr-app`** | OK / OK / ISO-OK | 22.0 KB / 35.9 KB / 46.2 KB | 21.2 KB / 22.1 KB / 43.2 KB | 8.6 KB / 8.8 KB / 12.8 KB | 1.86 ms / 1.30 ms / 2.23 ms | 0.43 ms / 0.34 ms / 0.38 ms | 0.43 ms / 0.34 ms / 0.39 ms |
| **`react-ssr-app`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 47.0 KB / 94.9 KB / — | 45.1 KB / 56.6 KB / — | 15.2 KB / 17.8 KB / — | 4.83 ms / 5.41 ms / — | 1.03 ms / 0.68 ms / — | 0.93 ms / 0.61 ms / — |
| **`yaml-router-app`** | OK / OK / ISO-OK | 157.1 KB / 124.9 KB / 249.7 KB | 51.8 KB / 57.7 KB / 110.8 KB | 17.2 KB / 17.6 KB / 33.4 KB | 5.91 ms / 3.75 ms / 5.03 ms | 1.75 ms / 0.83 ms / 0.72 ms | 1.62 ms / 0.67 ms / 0.71 ms |
| **`moment-timezone`** | OK* (browser-opt; def:FAIL) / OK / ISO-OK | 913.3 KB / 1001.2 KB / 1824.0 KB | 778.7 KB / 857.3 KB / 1632.4 KB | 55.0 KB / 73.8 KB / 128.0 KB | 24.17 ms / 21.84 ms / 31.02 ms | 8.25 ms / 6.41 ms / 6.50 ms | 8.13 ms / 5.64 ms / 6.42 ms |
| **`prettier`** | FAIL (PP0001) / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 1065.6 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`highlight-js`** | OK / OK / ISO-OK | 1834.5 KB / 2577.1 KB / 4133.1 KB | 957.2 KB / 1924.1 KB / 2990.4 KB | 299.3 KB / 595.5 KB / 757.8 KB | 92.52 ms / 83.40 ms / 106.50 ms | 19.12 ms / 12.73 ms / 13.99 ms | 15.96 ms / 13.06 ms / 13.85 ms |
| **`three`** | OK / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 1914.4 KB / 1479.4 KB / — | 742.9 KB / 840.7 KB / — | 183.2 KB / 206.4 KB / — | 36.48 ms / 36.77 ms / — | 4.68 ms / 4.82 ms / — | 4.64 ms / 5.04 ms / — |
| **`mathjs`** | FAIL (PP0001) / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 2117.9 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`babel-standalone`** | FAIL (PP0001) / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 5248.9 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`typescript`** | FAIL (PP0001) / FAIL (HYB_VOLATILE_BAILOUT) / BAIL | 8899.1 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |

## 2. Startup Timings & Speedups vs Original (incl. V8 `--build-snapshot` Reference)

| Library | Orig Cold Net | PP Cold Net (Speedup) | Hybrid Cold Net (Speedup) | V8 Snapshot Net | Orig Code-Cache | PP Code-Cache (Speedup) | Hybrid Code-Cache (Speedup) | Orig Exec-Only | PP Exec-Only (Speedup) | Hybrid Exec-Only (Speedup) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 16.56 ms | 17.43 ms (0.95x) | — | 12.88 ms | 3.50 ms | 4.39 ms (0.80x) | — | 3.48 ms | 3.45 ms (1.01x) | — |
| **`underscore`** | 2.92 ms | 1.54 ms (0.53x) | 3.44 ms (0.85x) | 7.78 ms | 0.57 ms | 0.63 ms (1.02x) | 0.58 ms (0.98x) | 0.55 ms | 0.59 ms (1.00x) | 0.55 ms (1.00x) |
| **`ramda`** | 4.83 ms | 4.03 ms (0.98x) | 8.47 ms (0.57x) | 8.85 ms | 0.75 ms | 0.47 ms (1.76x) | 0.50 ms (1.50x) | 0.74 ms | 0.56 ms (1.78x) | 0.47 ms (1.59x) |
| **`immutable`** | 5.74 ms | 6.34 ms (0.91x) | — | 10.90 ms | 1.50 ms | 1.33 ms (1.12x) | — | 1.31 ms | 1.16 ms (1.13x) | — |
| **`moment`** | 26.20 ms | 25.20 ms (1.01x) | 38.29 ms (0.68x) | 14.97 ms | 11.92 ms | 2.48 ms (4.56x) | 4.11 ms (2.90x) | 11.38 ms | 2.47 ms (4.49x) | 4.00 ms (2.85x) |
| **`chroma-js`** | 4.95 ms | 4.34 ms (0.47x) | 6.96 ms (0.71x) | 7.53 ms | 0.86 ms | 0.97 ms (1.09x) | 0.80 ms (1.07x) | 0.80 ms | 0.89 ms (1.11x) | 0.76 ms (1.06x) |
| **`acorn`** | 7.17 ms | 9.06 ms (0.98x) | 10.66 ms (0.67x) | 9.91 ms | 1.75 ms | 1.60 ms (1.21x) | 1.63 ms (1.08x) | 1.75 ms | 1.42 ms (1.21x) | 1.61 ms (1.09x) |
| **`crc-32`** | 0.05 ms | 1.40 ms (1.68x) | 0.20 ms (0.27x) | 6.45 ms | 0.34 ms | 0.25 ms (1.31x) | 0.35 ms (0.96x) | 0.32 ms | 0.23 ms (1.49x) | 0.33 ms (0.95x) |
| **`marked`** | 32.77 ms | 35.42 ms (1.05x) | 37.57 ms (0.87x) | 29.21 ms | 1.47 ms | 1.30 ms (1.02x) | 1.28 ms (1.15x) | 1.23 ms | 1.22 ms (0.99x) | 1.11 ms (1.11x) |
| **`d3-scale`** | 3.64 ms | 6.17 ms (0.59x) | — | 9.06 ms | 1.23 ms | 0.76 ms (1.62x) | — | 0.96 ms | 0.56 ms (1.71x) | — |
| **`redux`** | 0.54 ms | 0.11 ms (4.97x) | — | 6.83 ms | 0.40 ms | 0.32 ms (1.26x) | — | 0.30 ms | 0.25 ms (1.22x) | — |
| **`handlebars-app`** | 17.04 ms | 5.62 ms (3.03x) | — | — | 3.37 ms | 1.11 ms (3.04x) | — | 3.58 ms | 1.11 ms (3.21x) | — |
| **`preact-ssr-app`** | 1.86 ms | 1.30 ms (1.58x) | 2.23 ms (0.83x) | 6.08 ms | 0.43 ms | 0.34 ms (1.20x) | 0.38 ms (1.12x) | 0.43 ms | 0.34 ms (1.21x) | 0.39 ms (1.11x) |
| **`react-ssr-app`** | 4.83 ms | 5.41 ms (0.89x) | — | 7.44 ms | 1.03 ms | 0.68 ms (1.52x) | — | 0.93 ms | 0.61 ms (1.51x) | — |
| **`yaml-router-app`** | 5.91 ms | 3.75 ms (2.58x) | 5.03 ms (1.17x) | 8.76 ms | 1.75 ms | 0.83 ms (2.82x) | 0.72 ms (2.41x) | 1.62 ms | 0.67 ms (2.62x) | 0.71 ms (2.28x) |
| **`moment-timezone`** | 24.17 ms | 21.84 ms (1.10x) | 31.02 ms (0.78x) | 23.70 ms | 8.25 ms | 6.41 ms (1.52x) | 6.50 ms (1.27x) | 8.13 ms | 5.64 ms (1.38x) | 6.42 ms (1.27x) |
| **`prettier`** | — | — | — | — | — | — | — | — | — | — |
| **`highlight-js`** | 92.52 ms | 83.40 ms (1.07x) | 106.50 ms (0.87x) | — | 19.12 ms | 12.73 ms (1.24x) | 13.99 ms (1.37x) | 15.96 ms | 13.06 ms (1.29x) | 13.85 ms (1.15x) |
| **`three`** | 36.48 ms | 36.77 ms (0.99x) | — | 48.86 ms | 4.68 ms | 4.82 ms (0.97x) | — | 4.64 ms | 5.04 ms (0.92x) | — |
| **`mathjs`** | — | — | — | — | — | — | — | — | — | — |
| **`babel-standalone`** | — | — | — | — | — | — | — | — | — | — |
| **`typescript`** | — | — | — | — | — | — | — | — | — | — |

## 3. Size Ratios & Heap Isomorphism Oracle Audit

| Library | PP Gzip Ratio | Hybrid Gzip Ratio | Prepack Blocker / Notes | Hybrid Heap Isomorphism Oracle (`verify`) |
|---|---:|---:|---|---|
| **`lodash`** | 0.98x | — | `PP0012: member expression object abstract value   is unknown` | BAIL (Hybrid bailout: volatile API "Date.now()" called during initialization (lodash.js:6783:21)) |
| **`underscore`** | 1.12x | 1.94x | — | ISO-OK (653 obj / 317 fn) |
| **`ramda`** | 1.10x | 2.26x | — | ISO-OK (1554 obj / 753 fn) |
| **`immutable`** | 0.99x | — | — | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (immutable.js:893:12)) |
| **`moment`** | 1.32x | 2.25x | — | ISO-OK (4350 obj / 941 fn) |
| **`chroma-js`** | 0.94x | 1.95x | — | ISO-OK (402 obj / 167 fn) |
| **`acorn`** | 1.08x | 2.14x | — | ISO-OK (833 obj / 348 fn) |
| **`crc-32`** | 55.12x | 1.51x | — | ISO-OK (25 obj / 3 fn) |
| **`marked`** | 1.00x | 1.92x | — | ISO-OK (332 obj / 168 fn) |
| **`d3-scale`** | 1.25x | — | — | BAIL (Hybrid bailout: volatile API "new Date()" without arguments called during initialization (d3-scale.js:3086:12)) |
| **`redux`** | 0.87x | — | — | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (redux.js:366:33)) |
| **`handlebars-app`** | 1.02x | — | `INVARIANT: ` | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (handlebars-app.js:1302:16)) |
| **`preact-ssr-app`** | 1.02x | 1.49x | — | ISO-OK (145 obj / 62 fn) |
| **`react-ssr-app`** | 1.17x | — | — | BAIL (Hybrid bailout: volatile API "Date.now()" called during initialization (react-ssr-app.js:20:236)) |
| **`yaml-router-app`** | 1.02x | 1.94x | — | ISO-OK (587 obj / 192 fn) |
| **`moment-timezone`** | 1.34x | 2.33x | `PP0002: might be an object with an unknown valueOf or toString or Symbol.toPrimitive met` | ISO-OK (2176 obj / 561 fn) |
| **`prettier`** | — | — | `PP0001: This operation is not yet supported on abstract value global ` | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (prettier.js:1:5250)) |
| **`highlight-js`** | 1.99x | 2.53x | — | ISO-OK (9050 obj / 551 fn) |
| **`three`** | 1.13x | — | — | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (three.js:162:21)) |
| **`mathjs`** | — | — | `PP0001: This operation is not yet supported on abstract value  ` | BAIL (Hybrid bailout: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (mathjs.js:43555:22)) |
| **`babel-standalone`** | — | — | `PP0001: This operation is not yet supported on abstract value  ` | BAIL (Hybrid bailout: volatile API "new Date()" without arguments called during initialization (babel-standalone.js:603:19)) |
| **`typescript`** | — | — | `PP0001: This operation is not yet supported on abstract value  ` | BAIL (Hybrid bailout: volatile API "Date.now()" called during initialization (typescript.js:5174:18)) |

