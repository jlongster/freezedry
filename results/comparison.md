# Prepack vs Hybrid vs Original — Benchmark & Verification Comparison

- **Generated**: `2026-11-05T07:52:06.922Z`
- **Environment**: Node `v26.7.0` (V8 `14.6.202.34-node.28`) on `linux/x64`
- **Prepack (revive)**: `/tmp/opencode/pp-wt/bench/lib/prepack-node.js` (v`0.2.55-alpha.0`, runs=30)
- **Hybrid**: `/tmp/opencode/pp-wt/hybrid-verify/hybrid/index.js` (v`0.0.1-hybrid`, runs=10 — **stand-in identity transform**)

## Summary

| Metric | Prepack (revive) | Hybrid | Notes |
|---|---:|---:|---|
| **Workloads evaluated** | 15 | 15 | Corpus in `bench/libs/dist/*.js` |
| **Smoke OK (default options)** | 9/15 | 15/15 | Fresh `vm` + fresh `node` smoke digest |
| **Smoke OK (best profile)** | 11/15 | 15/15 | Includes profile flag unlocks |
| **Silent miscompile (WRONG)** | 1 | 0 | Must always be **0** in Hybrid |
| **Heap Isomorphism Oracle** | — | 10 strict + 5 seeded | Full heap + `[[Scopes]]` + V8 `Context` sharing bijection |

## 1. Per-Library Master Table (Original vs Prepack vs Hybrid)

| Library | Correctness (PP / Hybrid / Oracle) | Size Raw (Orig / PP / Hyb) | Size Terser (Orig / PP / Hyb) | Size Gzip (Orig / PP / Hyb) | Cold Node Net ms (Orig / PP / Hyb) | Code-Cache ms (Orig / PP / Hyb) | Exec-Only ms (Orig / PP / Hyb) |
|---|---|---|---|---|---|---|---|
| **`lodash`** | OK / OK [stand-in] / ISO-SEEDED | 533.1 KB / 872.3 KB / 533.1 KB | 69.0 KB / 218.1 KB / 69.0 KB | 24.5 KB / 50.7 KB / 24.5 KB | 31.33 ms / 33.21 ms / 26.74 ms | 3.85 ms / 2.60 ms / 4.33 ms | 3.09 ms / 2.08 ms / 3.04 ms |
| **`underscore`** | OK* (jsc; def:FAIL) / OK [stand-in] / ISO-OK | 67.3 KB / 78.2 KB / 67.3 KB | 18.9 KB / 34.8 KB / 18.9 KB | 7.2 KB / 8.0 KB / 7.2 KB | 6.85 ms / 7.80 ms / 7.72 ms | 0.52 ms / 0.46 ms / 0.56 ms | 0.54 ms / 0.40 ms / 0.53 ms |
| **`ramda`** | OK / OK [stand-in] / ISO-OK | 342.9 KB / 260.0 KB / 342.9 KB | 52.6 KB / 133.8 KB / 52.6 KB | 14.1 KB / 22.9 KB / 14.1 KB | 9.31 ms / 4.70 ms / 13.25 ms | 0.70 ms / 0.86 ms / 0.86 ms | 0.67 ms / 0.48 ms / 0.60 ms |
| **`immutable`** | OK / OK [stand-in] / ISO-SEEDED | 175.4 KB / 144.6 KB / 175.4 KB | 64.9 KB / 62.8 KB / 64.9 KB | 18.0 KB / 17.9 KB / 18.0 KB | 19.01 ms / 8.01 ms / 19.51 ms | 2.41 ms / 1.09 ms / 1.25 ms | 1.30 ms / 0.99 ms / 1.14 ms |
| **`moment`** | OK / OK [stand-in] / ISO-OK | 637.8 KB / 642.6 KB / 637.8 KB | 292.3 KB / 352.3 KB / 292.3 KB | 74.3 KB / 99.2 KB / 74.3 KB | 43.98 ms / 33.03 ms / 46.49 ms | 17.89 ms / 4.03 ms / 16.83 ms | 17.67 ms / 3.92 ms / 18.49 ms |
| **`chroma-js`** | OK / OK [stand-in] / ISO-OK | 109.2 KB / 87.2 KB / 109.2 KB | 42.5 KB / 42.2 KB / 42.5 KB | 15.4 KB / 14.7 KB / 15.4 KB | 8.77 ms / 5.67 ms / 5.37 ms | 0.77 ms / 0.62 ms / 0.77 ms | 0.72 ms / 0.60 ms / 0.75 ms |
| **`acorn`** | OK / OK [stand-in] / ISO-OK | 240.9 KB / 271.4 KB / 240.9 KB | 115.6 KB / 164.8 KB / 115.6 KB | 33.9 KB / 38.8 KB / 33.9 KB | 13.44 ms / 10.54 ms / 19.53 ms | 2.09 ms / 1.71 ms / 4.58 ms | 1.53 ms / 1.65 ms / 3.65 ms |
| **`crc-32`** | FAIL (PP0037) / OK [stand-in] / ISO-OK | 3.6 KB / — / 3.6 KB | 2.0 KB / — / 2.0 KB | 0.8 KB / — / 0.8 KB | 4.35 ms / — / 0.00 ms | 0.21 ms / — / 0.23 ms | 0.20 ms / — / 0.19 ms |
| **`marked`** | FAIL (PP1004) / OK [stand-in] / ISO-OK | 49.4 KB / — / 49.4 KB | 48.9 KB / — / 48.9 KB | 14.5 KB / — / 14.5 KB | 81.19 ms / — / 81.26 ms | 1.37 ms / — / 1.38 ms | 5.17 ms / — / 1.54 ms |
| **`d3-scale`** | FAIL (UNDIAGNOSED_FATAL) / OK [stand-in] / ISO-SEEDED | 148.9 KB / — / 148.9 KB | 71.1 KB / — / 71.1 KB | 23.0 KB / — / 23.0 KB | 15.67 ms / — / 0.23 ms | 0.95 ms / — / 0.92 ms | 0.91 ms / — / 0.91 ms |
| **`redux`** | OK* (browser-seed; def:FAIL) / OK [stand-in] / ISO-SEEDED | 18.1 KB / 14.6 KB / 18.1 KB | 8.8 KB / 7.7 KB / 8.8 KB | 3.3 KB / 3.0 KB / 3.3 KB | 0.04 ms / 0.27 ms / 13.15 ms | 0.20 ms / 0.14 ms / 0.21 ms | 0.20 ms / 0.13 ms / 0.20 ms |
| **`handlebars-app`** | WRONG (PP0023) / OK [stand-in] / ISO-OK | 211.9 KB / — / 211.9 KB | 86.4 KB / — / 86.4 KB | 26.3 KB / — / 26.3 KB | 22.15 ms / — / 12.26 ms | 9.64 ms / — / 9.61 ms | 3.03 ms / — / 3.05 ms |
| **`preact-ssr-app`** | OK / OK [stand-in] / ISO-OK | 22.0 KB / 35.1 KB / 22.0 KB | 21.2 KB / 22.0 KB / 21.2 KB | 8.6 KB / 8.8 KB / 8.6 KB | 0.00 ms / 0.00 ms / 2.28 ms | 0.25 ms / 0.25 ms / 0.25 ms | 0.31 ms / 0.24 ms / 0.30 ms |
| **`react-ssr-app`** | OK / OK [stand-in] / ISO-SEEDED | 47.0 KB / 125.2 KB / 47.0 KB | 45.1 KB / 79.4 KB / 45.1 KB | 15.2 KB / 21.0 KB / 15.2 KB | 1.21 ms / 5.38 ms / 0.00 ms | 1.55 ms / 1.29 ms / 2.44 ms | 1.63 ms / 1.34 ms / 1.74 ms |
| **`yaml-router-app`** | OK / OK [stand-in] / ISO-OK | 157.1 KB / 127.5 KB / 157.1 KB | 51.8 KB / 59.4 KB / 51.8 KB | 17.2 KB / 18.1 KB / 17.2 KB | 20.27 ms / 4.39 ms / 28.02 ms | 3.23 ms / 0.57 ms / 2.30 ms | 4.23 ms / 0.57 ms / 2.13 ms |

## 2. Startup Timings & Speedups vs Original (incl. V8 `--build-snapshot` Reference)

| Library | Orig Cold Net | PP Cold Net (Speedup) | Hybrid Cold Net (Speedup) | V8 Snapshot Net | Orig Code-Cache | PP Code-Cache (Speedup) | Hybrid Code-Cache (Speedup) | Orig Exec-Only | PP Exec-Only (Speedup) | Hybrid Exec-Only (Speedup) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 31.33 ms | 33.21 ms (0.74x) | 26.74 ms (1.17x) | 24.28 ms | 3.85 ms | 2.60 ms (1.41x) | 4.33 ms (0.89x) | 3.09 ms | 2.08 ms (1.58x) | 3.04 ms (1.02x) |
| **`underscore`** | 6.85 ms | 7.80 ms (0.87x) | 7.72 ms (0.89x) | 14.22 ms | 0.52 ms | 0.46 ms (1.16x) | 0.56 ms (0.93x) | 0.54 ms | 0.40 ms (1.06x) | 0.53 ms (1.02x) |
| **`ramda`** | 9.31 ms | 4.70 ms (1.21x) | 13.25 ms (0.70x) | 0.00 ms | 0.70 ms | 0.86 ms (1.32x) | 0.86 ms (0.81x) | 0.67 ms | 0.48 ms (1.55x) | 0.60 ms (1.12x) |
| **`immutable`** | 19.01 ms | 8.01 ms (0.69x) | 19.51 ms (0.97x) | 38.86 ms | 2.41 ms | 1.09 ms (1.11x) | 1.25 ms (1.93x) | 1.30 ms | 0.99 ms (1.12x) | 1.14 ms (1.14x) |
| **`moment`** | 43.98 ms | 33.03 ms (0.89x) | 46.49 ms (0.95x) | 44.23 ms | 17.89 ms | 4.03 ms (3.49x) | 16.83 ms (1.06x) | 17.67 ms | 3.92 ms (3.38x) | 18.49 ms (0.96x) |
| **`chroma-js`** | 8.77 ms | 5.67 ms (1.05x) | 5.37 ms (1.63x) | 22.05 ms | 0.77 ms | 0.62 ms (1.07x) | 0.77 ms (1.00x) | 0.72 ms | 0.60 ms (1.08x) | 0.75 ms (0.96x) |
| **`acorn`** | 13.44 ms | 10.54 ms (1.03x) | 19.53 ms (0.69x) | 22.09 ms | 2.09 ms | 1.71 ms (0.86x) | 4.58 ms (0.46x) | 1.53 ms | 1.65 ms (0.86x) | 3.65 ms (0.42x) |
| **`crc-32`** | 4.35 ms | — | 0.00 ms (—) | 7.65 ms | 0.21 ms | — | 0.23 ms (0.93x) | 0.20 ms | — | 0.19 ms (1.03x) |
| **`marked`** | 81.19 ms | — | 81.26 ms (1.00x) | 48.08 ms | 1.37 ms | — | 1.38 ms (0.99x) | 5.17 ms | — | 1.54 ms (3.35x) |
| **`d3-scale`** | 15.67 ms | — | 0.23 ms (69.03x) | 20.05 ms | 0.95 ms | — | 0.92 ms (1.04x) | 0.91 ms | — | 0.91 ms (0.99x) |
| **`redux`** | 0.04 ms | 0.27 ms (5.45x) | 13.15 ms (0.00x) | 14.23 ms | 0.20 ms | 0.14 ms (1.42x) | 0.21 ms (0.94x) | 0.20 ms | 0.13 ms (1.57x) | 0.20 ms (0.99x) |
| **`handlebars-app`** | 22.15 ms | — | 12.26 ms (1.81x) | — | 9.64 ms | — | 9.61 ms (1.00x) | 3.03 ms | — | 3.05 ms (0.99x) |
| **`preact-ssr-app`** | 0.00 ms | 0.00 ms (—) | 2.28 ms (—) | 11.65 ms | 0.25 ms | 0.25 ms (1.24x) | 0.25 ms (0.98x) | 0.31 ms | 0.24 ms (1.28x) | 0.30 ms (1.01x) |
| **`react-ssr-app`** | 1.21 ms | 5.38 ms (0.98x) | 0.00 ms (—) | 32.76 ms | 1.55 ms | 1.29 ms (0.73x) | 2.44 ms (0.64x) | 1.63 ms | 1.34 ms (0.72x) | 1.74 ms (0.94x) |
| **`yaml-router-app`** | 20.27 ms | 4.39 ms (1.56x) | 28.02 ms (0.72x) | 23.08 ms | 3.23 ms | 0.57 ms (2.61x) | 2.30 ms (1.41x) | 4.23 ms | 0.57 ms (2.51x) | 2.13 ms (1.99x) |

## 3. Size Ratios & Heap Isomorphism Oracle Audit

| Library | PP Gzip Ratio | Hybrid Gzip Ratio | Prepack Blocker / Notes | Hybrid Heap Isomorphism Oracle (`verify`) |
|---|---:|---:|---|---|
| **`lodash`** | 2.07x | 1.00x | — | ISO-SEEDED (init reads volatile @ `_.cond (scope var "baseRest") (scope var "setToString") (scope var "lastCalled")`) |
| **`underscore`** | 1.11x | 1.00x | `PP0001: This operation is not yet supported on document at childNodes` | ISO-OK (653 obj / 317 fn) |
| **`ramda`** | 1.62x | 1.00x | — | ISO-OK (1554 obj / 753 fn) |
| **`immutable`** | 1.00x | 1.00x | — | ISO-SEEDED (init reads volatile @ `Immutable.Map.prototype.set (scope var "updateMap") (scope var "updateNode") (scope var "ValueNode").prototype.update (scope var "mergeIntoNode") (scope var "HashCollisionNode").prototype._positionOf (scope var "hashCollisionKey") (scope var "COLLISION_HASH_BASE")`) |
| **`moment`** | 1.34x | 1.00x | — | ISO-OK (4350 obj / 941 fn) |
| **`chroma-js`** | 0.96x | 1.00x | — | ISO-OK (402 obj / 167 fn) |
| **`acorn`** | 1.14x | 1.00x | — | ISO-OK (833 obj / 348 fn) |
| **`crc-32`** | — | 1.00x | `PP0037: failed to emit a residual loop: the loop calls an unknown or unsupported functio` | ISO-OK (25 obj / 3 fn) |
| **`marked`** | — | 1.00x | `PP1004: Syntax error: This experimental syntax requires enabling the parser plugin: 'opt` | ISO-OK (332 obj / 168 fn) |
| **`d3-scale`** | — | 1.00x | `UNDIAGNOSED_FATAL: TODO: do not know how to deal with non-Identifier parameters` | ISO-SEEDED (init reads volatile @ `d3.timeInterval (scope var "t0")`) |
| **`redux`** | 0.89x | 1.00x | `PP0031: property access on unknown object` | ISO-SEEDED (init reads volatile @ `ReduxBench.runScenario (scope var "createStore") (scope var "actionTypes_default").INIT`) |
| **`handlebars-app`** | — | 1.00x | `PP0023: VM runtime threw: TypeError: not an object` | ISO-OK (2072 obj / 335 fn) |
| **`preact-ssr-app`** | 1.02x | 1.00x | — | ISO-OK (145 obj / 62 fn) |
| **`react-ssr-app`** | 1.38x | 1.00x | — | ISO-SEEDED (init reads volatile @ `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.Scheduler.unstable_scheduleCallback (scope var "v") (scope var "Ca")`) |
| **`yaml-router-app`** | 1.05x | 1.00x | — | ISO-OK (587 obj / 192 fn) |

