# Prepack vs Hybrid vs Original — Benchmark & Verification Comparison

- **Generated**: `2026-11-05T19:39:22.765Z`
- **Environment**: Node `v26.7.0` (V8 `14.6.202.34-node.28`) on `linux/x64`
- **Prepack (revive)**: `/tmp/opencode/pp-work/lib/prepack-node.js` (v`0.2.55-alpha.0`, runs=30)
- **Hybrid**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (v`0.0.1-hybrid`, runs=30)

## Summary

| Metric | Prepack (revive) | Hybrid | Notes |
|---|---:|---:|---|
| **Workloads evaluated** | 22 | 22 | Corpus in `bench/libs/dist/*.js` |
| **Smoke OK (default options)** | 15/22 | 21/22 | Fresh `vm` + fresh `node` smoke digest |
| **Smoke OK (best profile)** | 18/22 | 21/22 | Includes profile flag unlocks |
| **Silent miscompile (WRONG)** | 0 | 0 | Must always be **0** in Hybrid |
| **Heap Isomorphism Oracle** | — | 11 strict + 8 seeded | Full heap + `[[Scopes]]` + V8 `Context` sharing bijection |

## 1. Per-Library Master Table (Original vs Prepack vs Hybrid)

| Library | Correctness (PP / Hybrid / Oracle) | Size Raw (Orig / PP / Hyb) | Size Terser (Orig / PP / Hyb) | Size Gzip (Orig / PP / Hyb) | Cold Node Net ms (Orig / PP / Hyb) | Code-Cache ms (Orig / PP / Hyb) | Exec-Only ms (Orig / PP / Hyb) |
|---|---|---|---|---|---|---|---|
| **`lodash`** | OK* (browser-opt; def:FAIL) / OK / ISO-SEEDED | 533.1 KB / 538.5 KB / 906.4 KB | 69.0 KB / 73.2 KB / 240.7 KB | 24.5 KB / 23.9 KB / 76.4 KB | 17.82 ms / 17.43 ms / 30.77 ms | 4.26 ms / 4.39 ms / 3.20 ms | 3.32 ms / 3.45 ms / 2.58 ms |
| **`underscore`** | OK / OK / ISO-OK | 67.3 KB / 68.6 KB / 99.1 KB | 18.9 KB / 33.6 KB / 45.6 KB | 7.2 KB / 8.1 KB / 14.0 KB | 2.76 ms / 1.54 ms / 4.92 ms | 0.87 ms / 0.63 ms / 0.89 ms | 0.80 ms / 0.59 ms / 0.83 ms |
| **`ramda`** | OK / OK / ISO-OK | 342.9 KB / 137.4 KB / 232.9 KB | 52.6 KB / 65.7 KB / 121.4 KB | 14.1 KB / 15.6 KB / 32.0 KB | 5.08 ms / 4.03 ms / 8.04 ms | 0.84 ms / 0.47 ms / 0.55 ms | 0.85 ms / 0.56 ms / 0.54 ms |
| **`immutable`** | OK / OK / ISO-SEEDED | 175.4 KB / 144.6 KB / 290.8 KB | 64.9 KB / 63.2 KB / 131.7 KB | 18.0 KB / 17.9 KB / 36.9 KB | 5.70 ms / 6.34 ms / 11.33 ms | 1.60 ms / 1.33 ms / 1.72 ms | 1.34 ms / 1.16 ms / 1.43 ms |
| **`moment`** | OK / OK / ISO-OK | 637.8 KB / 669.3 KB / 1056.8 KB | 292.3 KB / 338.7 KB / 675.0 KB | 74.3 KB / 98.4 KB / 167.4 KB | 26.71 ms / 25.20 ms / 39.45 ms | 11.65 ms / 2.48 ms / 4.01 ms | 12.84 ms / 2.47 ms / 4.32 ms |
| **`chroma-js`** | OK / OK / ISO-OK | 109.2 KB / 85.4 KB / 173.0 KB | 42.5 KB / 40.6 KB / 88.3 KB | 15.4 KB / 14.5 KB / 30.1 KB | 4.87 ms / 4.34 ms / 7.64 ms | 0.86 ms / 0.97 ms / 0.80 ms | 0.86 ms / 0.89 ms / 0.78 ms |
| **`acorn`** | OK / OK / ISO-OK | 240.9 KB / 252.0 KB / 429.1 KB | 115.6 KB / 152.8 KB / 280.9 KB | 33.9 KB / 36.5 KB / 72.6 KB | 10.01 ms / 9.06 ms / 17.38 ms | 1.64 ms / 1.60 ms / 1.57 ms | 1.59 ms / 1.42 ms / 1.55 ms |
| **`crc-32`** | OK / OK / ISO-OK | 3.6 KB / 105.0 KB / 6.7 KB | 2.0 KB / 93.7 KB / 4.5 KB | 0.8 KB / 44.0 KB / 1.2 KB | 3.43 ms / 1.40 ms / 2.64 ms | 0.46 ms / 0.25 ms / 0.46 ms | 0.63 ms / 0.23 ms / 0.41 ms |
| **`marked`** | OK / OK / ISO-OK | 49.4 KB / 74.2 KB / 113.3 KB | 48.9 KB / 48.8 KB / 106.6 KB | 14.5 KB / 14.4 KB / 27.8 KB | 35.22 ms / 35.42 ms / 40.59 ms | 1.32 ms / 1.30 ms / 1.18 ms | 1.28 ms / 1.22 ms / 1.14 ms |
| **`d3-scale`** | OK / OK / ISO-SEEDED | 148.9 KB / 184.1 KB / 363.9 KB | 71.1 KB / 89.8 KB / 182.7 KB | 23.0 KB / 28.8 KB / 53.3 KB | 6.07 ms / 6.17 ms / 13.84 ms | 1.19 ms / 0.76 ms / 0.92 ms | 1.07 ms / 0.56 ms / 0.84 ms |
| **`redux`** | OK / OK / ISO-SEEDED | 18.1 KB / 14.4 KB / 30.2 KB | 8.8 KB / 7.5 KB / 16.6 KB | 3.3 KB / 2.9 KB / 4.2 KB | 0.88 ms / 0.11 ms / 0.00 ms | 0.32 ms / 0.32 ms / 0.26 ms | 0.31 ms / 0.25 ms / 0.24 ms |
| **`handlebars-app`** | OK* (browser-opt; def:FAIL) / OK / ISO-SEEDED | 211.9 KB / 202.1 KB / 346.4 KB | 86.4 KB / 95.2 KB / 184.5 KB | 26.3 KB / 26.7 KB / 52.7 KB | 18.49 ms / 5.62 ms / 10.81 ms | 3.70 ms / 1.11 ms / 1.14 ms | 3.50 ms / 1.11 ms / 1.17 ms |
| **`preact-ssr-app`** | OK / OK / ISO-OK | 22.0 KB / 35.9 KB / 46.2 KB | 21.2 KB / 22.1 KB / 43.2 KB | 8.6 KB / 8.8 KB / 12.8 KB | 1.83 ms / 1.30 ms / 1.31 ms | 0.47 ms / 0.34 ms / 0.47 ms | 0.41 ms / 0.34 ms / 0.47 ms |
| **`react-ssr-app`** | OK / OK / ISO-SEEDED | 47.0 KB / 94.9 KB / 132.1 KB | 45.1 KB / 56.6 KB / 118.0 KB | 15.2 KB / 17.8 KB / 31.6 KB | 6.17 ms / 5.41 ms / 9.28 ms | 0.97 ms / 0.68 ms / 0.82 ms | 0.92 ms / 0.61 ms / 0.79 ms |
| **`yaml-router-app`** | OK / OK / ISO-OK | 157.1 KB / 124.9 KB / 249.7 KB | 51.8 KB / 57.7 KB / 110.8 KB | 17.2 KB / 17.6 KB / 33.4 KB | 10.67 ms / 3.75 ms / 6.91 ms | 2.79 ms / 0.83 ms / 0.84 ms | 2.40 ms / 0.67 ms / 0.79 ms |
| **`moment-timezone`** | OK* (browser-opt; def:FAIL) / OK / ISO-OK | 913.3 KB / 1001.2 KB / 1824.0 KB | 778.7 KB / 857.3 KB / 1632.4 KB | 55.0 KB / 73.8 KB / 127.9 KB | 38.05 ms / 21.84 ms / 41.64 ms | 10.97 ms / 6.41 ms / 9.05 ms | 9.61 ms / 5.64 ms / 7.75 ms |
| **`prettier`** | FAIL (PP0001) / FAIL (HYB_BAILOUT) / BAIL | 1065.6 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`highlight-js`** | OK / OK / ISO-OK | 1834.5 KB / 2577.1 KB / 4133.1 KB | 957.2 KB / 1924.1 KB / 2990.4 KB | 299.3 KB / 595.5 KB / 757.8 KB | 94.17 ms / 83.40 ms / 112.04 ms | 16.25 ms / 12.73 ms / 16.10 ms | 17.32 ms / 13.06 ms / 14.10 ms |
| **`three`** | OK / OK / ISO-SEEDED | 1914.4 KB / 1479.4 KB / 3241.1 KB | 742.9 KB / 840.7 KB / 1681.3 KB | 183.2 KB / 206.4 KB / 399.8 KB | 38.24 ms / 36.77 ms / 61.17 ms | 4.83 ms / 4.82 ms / 6.13 ms | 4.61 ms / 5.04 ms / 5.75 ms |
| **`mathjs`** | FAIL (PP0001) / OK / UNVERIFIED | 2117.9 KB / — / 19225.0 KB | 839.6 KB / — / 8917.2 KB | 212.5 KB / — / 1238.8 KB | 291.59 ms / — / 905.48 ms | 211.12 ms / — / 115.22 ms | 164.77 ms / — / 95.15 ms |
| **`babel-standalone`** | FAIL (PP0001) / OK / ISO-SEEDED | 5248.9 KB / — / 10286.9 KB | 2951.7 KB / — / 6564.6 KB | 644.3 KB / — / 1402.2 KB | 199.28 ms / — / 325.35 ms | 71.06 ms / — / 54.80 ms | 69.76 ms / — / 54.84 ms |
| **`typescript`** | FAIL (PP0001) / OK / UNVERIFIED | 8899.1 KB / — / 18441.0 KB | 3430.8 KB / — / 8421.2 KB | 944.8 KB / — / 2120.6 KB | 197.20 ms / — / 403.06 ms | 22.88 ms / — / 35.06 ms | 21.58 ms / — / 32.56 ms |

## 2. Startup Timings & Speedups vs Original (incl. V8 `--build-snapshot` Reference)

| Library | Orig Cold Net | PP Cold Net (Speedup) | Hybrid Cold Net (Speedup) | V8 Snapshot Net | Orig Code-Cache | PP Code-Cache (Speedup) | Hybrid Code-Cache (Speedup) | Orig Exec-Only | PP Exec-Only (Speedup) | Hybrid Exec-Only (Speedup) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 17.82 ms | 17.43 ms (0.95x) | 30.77 ms (0.58x) | 15.54 ms | 4.26 ms | 4.39 ms (0.80x) | 3.20 ms (1.33x) | 3.32 ms | 3.45 ms (1.01x) | 2.58 ms (1.29x) |
| **`underscore`** | 2.76 ms | 1.54 ms (0.53x) | 4.92 ms (0.56x) | 7.36 ms | 0.87 ms | 0.63 ms (1.02x) | 0.89 ms (0.97x) | 0.80 ms | 0.59 ms (1.00x) | 0.83 ms (0.96x) |
| **`ramda`** | 5.08 ms | 4.03 ms (0.98x) | 8.04 ms (0.63x) | 6.78 ms | 0.84 ms | 0.47 ms (1.76x) | 0.55 ms (1.54x) | 0.85 ms | 0.56 ms (1.78x) | 0.54 ms (1.57x) |
| **`immutable`** | 5.70 ms | 6.34 ms (0.91x) | 11.33 ms (0.50x) | 10.75 ms | 1.60 ms | 1.33 ms (1.12x) | 1.72 ms (0.93x) | 1.34 ms | 1.16 ms (1.13x) | 1.43 ms (0.94x) |
| **`moment`** | 26.71 ms | 25.20 ms (1.01x) | 39.45 ms (0.68x) | 15.47 ms | 11.65 ms | 2.48 ms (4.56x) | 4.01 ms (2.91x) | 12.84 ms | 2.47 ms (4.49x) | 4.32 ms (2.97x) |
| **`chroma-js`** | 4.87 ms | 4.34 ms (0.47x) | 7.64 ms (0.64x) | 11.69 ms | 0.86 ms | 0.97 ms (1.09x) | 0.80 ms (1.06x) | 0.86 ms | 0.89 ms (1.11x) | 0.78 ms (1.11x) |
| **`acorn`** | 10.01 ms | 9.06 ms (0.98x) | 17.38 ms (0.58x) | 14.55 ms | 1.64 ms | 1.60 ms (1.21x) | 1.57 ms (1.05x) | 1.59 ms | 1.42 ms (1.21x) | 1.55 ms (1.02x) |
| **`crc-32`** | 3.43 ms | 1.40 ms (1.68x) | 2.64 ms (1.30x) | 5.82 ms | 0.46 ms | 0.25 ms (1.31x) | 0.46 ms (1.00x) | 0.63 ms | 0.23 ms (1.49x) | 0.41 ms (1.55x) |
| **`marked`** | 35.22 ms | 35.42 ms (1.05x) | 40.59 ms (0.87x) | 33.76 ms | 1.32 ms | 1.30 ms (1.02x) | 1.18 ms (1.12x) | 1.28 ms | 1.22 ms (0.99x) | 1.14 ms (1.12x) |
| **`d3-scale`** | 6.07 ms | 6.17 ms (0.59x) | 13.84 ms (0.44x) | 14.15 ms | 1.19 ms | 0.76 ms (1.62x) | 0.92 ms (1.30x) | 1.07 ms | 0.56 ms (1.71x) | 0.84 ms (1.28x) |
| **`redux`** | 0.88 ms | 0.11 ms (4.97x) | 0.00 ms (—) | 7.04 ms | 0.32 ms | 0.32 ms (1.26x) | 0.26 ms (1.24x) | 0.31 ms | 0.25 ms (1.22x) | 0.24 ms (1.28x) |
| **`handlebars-app`** | 18.49 ms | 5.62 ms (3.03x) | 10.81 ms (1.71x) | — | 3.70 ms | 1.11 ms (3.04x) | 1.14 ms (3.25x) | 3.50 ms | 1.11 ms (3.21x) | 1.17 ms (3.01x) |
| **`preact-ssr-app`** | 1.83 ms | 1.30 ms (1.58x) | 1.31 ms (1.40x) | 6.69 ms | 0.47 ms | 0.34 ms (1.20x) | 0.47 ms (0.99x) | 0.41 ms | 0.34 ms (1.21x) | 0.47 ms (0.87x) |
| **`react-ssr-app`** | 6.17 ms | 5.41 ms (0.89x) | 9.28 ms (0.67x) | 7.58 ms | 0.97 ms | 0.68 ms (1.52x) | 0.82 ms (1.18x) | 0.92 ms | 0.61 ms (1.51x) | 0.79 ms (1.17x) |
| **`yaml-router-app`** | 10.67 ms | 3.75 ms (2.58x) | 6.91 ms (1.55x) | 12.03 ms | 2.79 ms | 0.83 ms (2.82x) | 0.84 ms (3.31x) | 2.40 ms | 0.67 ms (2.62x) | 0.79 ms (3.05x) |
| **`moment-timezone`** | 38.05 ms | 21.84 ms (1.10x) | 41.64 ms (0.91x) | 23.08 ms | 10.97 ms | 6.41 ms (1.52x) | 9.05 ms (1.21x) | 9.61 ms | 5.64 ms (1.38x) | 7.75 ms (1.24x) |
| **`prettier`** | — | — | — | — | — | — | — | — | — | — |
| **`highlight-js`** | 94.17 ms | 83.40 ms (1.07x) | 112.04 ms (0.84x) | — | 16.25 ms | 12.73 ms (1.24x) | 16.10 ms (1.01x) | 17.32 ms | 13.06 ms (1.29x) | 14.10 ms (1.23x) |
| **`three`** | 38.24 ms | 36.77 ms (0.99x) | 61.17 ms (0.63x) | 27.40 ms | 4.83 ms | 4.82 ms (0.97x) | 6.13 ms (0.79x) | 4.61 ms | 5.04 ms (0.92x) | 5.75 ms (0.80x) |
| **`mathjs`** | 291.59 ms | — | 905.48 ms (0.32x) | — | 211.12 ms | — | 115.22 ms (1.83x) | 164.77 ms | — | 95.15 ms (1.73x) |
| **`babel-standalone`** | 199.28 ms | — | 325.35 ms (0.61x) | — | 71.06 ms | — | 54.80 ms (1.30x) | 69.76 ms | — | 54.84 ms (1.27x) |
| **`typescript`** | 197.20 ms | — | 403.06 ms (0.49x) | 86.79 ms | 22.88 ms | — | 35.06 ms (0.65x) | 21.58 ms | — | 32.56 ms (0.66x) |

## 3. Size Ratios & Heap Isomorphism Oracle Audit

| Library | PP Gzip Ratio | Hybrid Gzip Ratio | Prepack Blocker / Notes | Hybrid Heap Isomorphism Oracle (`verify`) |
|---|---:|---:|---|---|
| **`lodash`** | 0.98x | 3.12x | `PP0012: member expression object abstract value   is unknown` | ISO-SEEDED (50 baked volatile(s), replayed) |
| **`underscore`** | 1.12x | 1.94x | — | ISO-OK (653 obj / 317 fn) |
| **`ramda`** | 1.10x | 2.26x | — | ISO-OK (1554 obj / 753 fn) |
| **`immutable`** | 0.99x | 2.05x | — | ISO-SEEDED (1 baked volatile(s), replayed) |
| **`moment`** | 1.32x | 2.25x | — | ISO-OK (4350 obj / 941 fn) |
| **`chroma-js`** | 0.94x | 1.95x | — | ISO-OK (402 obj / 167 fn) |
| **`acorn`** | 1.08x | 2.14x | — | ISO-OK (833 obj / 348 fn) |
| **`crc-32`** | 55.12x | 1.51x | — | ISO-OK (25 obj / 3 fn) |
| **`marked`** | 1.00x | 1.92x | — | ISO-OK (332 obj / 168 fn) |
| **`d3-scale`** | 1.25x | 2.31x | — | ISO-SEEDED (2 baked volatile(s), replayed) |
| **`redux`** | 0.87x | 1.25x | — | ISO-SEEDED (4 baked volatile(s), replayed) |
| **`handlebars-app`** | 1.02x | 2.01x | `INVARIANT: ` | ISO-SEEDED (1 baked volatile(s), replayed) |
| **`preact-ssr-app`** | 1.02x | 1.49x | — | ISO-OK (145 obj / 62 fn) |
| **`react-ssr-app`** | 1.17x | 2.08x | — | ISO-SEEDED (1 baked volatile(s), replayed) |
| **`yaml-router-app`** | 1.02x | 1.94x | — | ISO-OK (587 obj / 192 fn) |
| **`moment-timezone`** | 1.34x | 2.33x | `PP0002: might be an object with an unknown valueOf or toString or Symbol.toPrimitive met` | ISO-OK (2176 obj / 561 fn) |
| **`prettier`** | — | — | `PP0001: This operation is not yet supported on abstract value global ` | BAIL (Hybrid bailout: WeakMap with contents (1 entries) (global["__core-js_shared__"].state)) |
| **`highlight-js`** | 1.99x | 2.53x | — | ISO-OK (9050 obj / 551 fn) |
| **`three`** | 1.13x | 2.18x | — | ISO-SEEDED (80 baked volatile(s), replayed) |
| **`mathjs`** | — | 5.83x | `PP0001: This operation is not yet supported on abstract value  ` | UNVERIFIED (oracle killed (OOM)) |
| **`babel-standalone`** | — | 2.18x | `PP0001: This operation is not yet supported on abstract value  ` | ISO-SEEDED (33 baked volatile(s), replayed) |
| **`typescript`** | — | 2.24x | `PP0001: This operation is not yet supported on abstract value  ` | UNVERIFIED (oracle killed (OOM)) |

