# Prepack vs Hybrid vs Original — Benchmark & Verification Comparison

- **Generated**: `2026-11-05T11:06:03.420Z`
- **Environment**: Node `v26.7.0` (V8 `14.6.202.34-node.28`) on `linux/x64`
- **Prepack (revive)**: `/tmp/opencode/pp-work/lib/prepack-node.js` (v`0.2.55-alpha.0`, runs=30)
- **Hybrid**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (v`0.0.1-hybrid`, runs=30)

## Summary

| Metric | Prepack (revive) | Hybrid | Notes |
|---|---:|---:|---|
| **Workloads evaluated** | 15 | 15 | Corpus in `bench/libs/dist/*.js` |
| **Smoke OK (default options)** | 9/15 | 14/15 | Fresh `vm` + fresh `node` smoke digest |
| **Smoke OK (best profile)** | 11/15 | 14/15 | Includes profile flag unlocks |
| **Silent miscompile (WRONG)** | 1 | 0 | Must always be **0** in Hybrid |
| **Heap Isomorphism Oracle** | — | 9 strict + 5 seeded | Full heap + `[[Scopes]]` + V8 `Context` sharing bijection |

## 1. Per-Library Master Table (Original vs Prepack vs Hybrid)

| Library | Correctness (PP / Hybrid / Oracle) | Size Raw (Orig / PP / Hyb) | Size Terser (Orig / PP / Hyb) | Size Gzip (Orig / PP / Hyb) | Cold Node Net ms (Orig / PP / Hyb) | Code-Cache ms (Orig / PP / Hyb) | Exec-Only ms (Orig / PP / Hyb) |
|---|---|---|---|---|---|---|---|
| **`lodash`** | OK / OK / ISO-SEEDED | 533.1 KB / 536.1 KB / 1430.0 KB | 69.0 KB / 72.3 KB / 300.5 KB | 24.5 KB / 23.7 KB / 90.9 KB | 16.50 ms / 14.33 ms / 29.30 ms | 3.85 ms / 3.75 ms / 2.15 ms | 2.99 ms / 2.88 ms / 1.83 ms |
| **`underscore`** | OK* (jsc; def:FAIL) / OK / ISO-OK | 67.3 KB / 67.6 KB / 235.9 KB | 18.9 KB / 32.7 KB / 82.1 KB | 7.2 KB / 7.9 KB / 25.1 KB | 4.28 ms / 1.19 ms / 7.90 ms | 0.44 ms / 0.44 ms / 0.71 ms | 0.43 ms / 0.38 ms / 0.71 ms |
| **`ramda`** | OK / OK / ISO-OK | 342.9 KB / 135.3 KB / 545.1 KB | 52.6 KB / 64.8 KB / 150.2 KB | 14.1 KB / 15.2 KB / 40.1 KB | 2.23 ms / 3.69 ms / 10.65 ms | 0.69 ms / 0.29 ms / 0.81 ms | 0.73 ms / 0.26 ms / 0.88 ms |
| **`immutable`** | OK / OK / ISO-SEEDED | 175.4 KB / 143.8 KB / 384.2 KB | 64.9 KB / 62.9 KB / 149.9 KB | 18.0 KB / 17.9 KB / 42.1 KB | 7.00 ms / 5.61 ms / 12.46 ms | 1.14 ms / 1.02 ms / 1.48 ms | 1.24 ms / 0.98 ms / 1.65 ms |
| **`moment`** | OK / OK / ISO-OK | 637.8 KB / 632.6 KB / 1443.0 KB | 292.3 KB / 347.4 KB / 741.8 KB | 74.3 KB / 99.1 KB / 181.8 KB | 24.13 ms / 23.72 ms / 41.56 ms | 11.55 ms / 2.37 ms / 4.84 ms | 11.16 ms / 2.51 ms / 4.92 ms |
| **`chroma-js`** | OK / OK / ISO-OK | 109.2 KB / 84.0 KB / 236.1 KB | 42.5 KB / 40.0 KB / 100.2 KB | 15.4 KB / 14.3 KB / 32.0 KB | 2.23 ms / 4.82 ms / 6.39 ms | 0.69 ms / 0.66 ms / 0.82 ms | 0.67 ms / 0.65 ms / 0.78 ms |
| **`acorn`** | OK / OK / ISO-OK | 240.9 KB / 266.8 KB / 556.5 KB | 115.6 KB / 163.1 KB / 313.9 KB | 33.9 KB / 38.7 KB / 77.9 KB | 8.56 ms / 8.93 ms / 13.04 ms | 1.43 ms / 1.25 ms / 1.51 ms | 1.40 ms / 1.24 ms / 1.49 ms |
| **`crc-32`** | FAIL (PP0037) / OK / ISO-OK | 3.6 KB / — / 30.0 KB | 2.0 KB / — / 27.0 KB | 0.8 KB / — / 18.2 KB | 0.29 ms / — / 0.00 ms | 0.19 ms / — / 0.08 ms | 0.18 ms / — / 0.07 ms |
| **`marked`** | FAIL (PP1004) / FAIL (HYB_BAILOUT) / DIFF | 49.4 KB / — / — | — / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| **`d3-scale`** | FAIL (INVARIANT) / OK / ISO-SEEDED | 148.9 KB / — / 439.9 KB | 71.1 KB / — / 202.2 KB | 23.0 KB / — / 60.2 KB | 6.32 ms / — / 14.11 ms | 0.83 ms / — / 0.88 ms | 0.80 ms / — / 0.83 ms |
| **`redux`** | OK* (browser-seed; def:FAIL) / OK / ISO-SEEDED | 18.1 KB / 14.6 KB / 40.5 KB | 8.8 KB / 7.7 KB / 19.7 KB | 3.3 KB / 3.0 KB / 4.9 KB | 0.47 ms / 0.00 ms / 1.02 ms | 0.19 ms / 0.16 ms / 0.15 ms | 0.17 ms / 0.15 ms / 0.14 ms |
| **`handlebars-app`** | WRONG (PP0023) / OK / ISO-OK | 211.9 KB / — / 461.7 KB | 86.4 KB / — / 202.5 KB | 26.3 KB / — / 58.6 KB | 17.61 ms / — / 10.49 ms | 3.64 ms / — / 1.36 ms | 3.35 ms / — / 1.29 ms |
| **`preact-ssr-app`** | OK / OK / ISO-OK | 22.0 KB / 34.7 KB / 52.2 KB | 21.2 KB / 21.7 KB / 45.8 KB | 8.6 KB / 8.7 KB / 13.3 KB | 0.00 ms / 2.21 ms / 1.62 ms | 0.28 ms / 0.25 ms / 0.27 ms | 0.26 ms / 0.18 ms / 0.26 ms |
| **`react-ssr-app`** | OK / OK / ISO-SEEDED | 47.0 KB / 118.8 KB / 150.4 KB | 45.1 KB / 76.6 KB / 127.5 KB | 15.2 KB / 21.0 KB / 34.8 KB | 3.30 ms / 4.04 ms / 5.57 ms | 0.78 ms / 0.45 ms / 0.77 ms | 0.78 ms / 0.44 ms / 0.77 ms |
| **`yaml-router-app`** | OK / OK / ISO-OK | 157.1 KB / 126.2 KB / 458.2 KB | 51.8 KB / 58.6 KB / 160.4 KB | 17.2 KB / 18.0 KB / 49.8 KB | 8.83 ms / 4.05 ms / 9.97 ms | 1.54 ms / 0.51 ms / 0.70 ms | 1.49 ms / 0.47 ms / 0.68 ms |

## 2. Startup Timings & Speedups vs Original (incl. V8 `--build-snapshot` Reference)

| Library | Orig Cold Net | PP Cold Net (Speedup) | Hybrid Cold Net (Speedup) | V8 Snapshot Net | Orig Code-Cache | PP Code-Cache (Speedup) | Hybrid Code-Cache (Speedup) | Orig Exec-Only | PP Exec-Only (Speedup) | Hybrid Exec-Only (Speedup) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 16.50 ms | 14.33 ms (0.97x) | 29.30 ms (0.56x) | 10.48 ms | 3.85 ms | 3.75 ms (0.81x) | 2.15 ms (1.79x) | 2.99 ms | 2.88 ms (1.03x) | 1.83 ms (1.64x) |
| **`underscore`** | 4.28 ms | 1.19 ms (0.90x) | 7.90 ms (0.54x) | 7.49 ms | 0.44 ms | 0.44 ms (1.01x) | 0.71 ms (0.63x) | 0.43 ms | 0.38 ms (1.01x) | 0.71 ms (0.61x) |
| **`ramda`** | 2.23 ms | 3.69 ms (1.14x) | 10.65 ms (0.21x) | 5.80 ms | 0.69 ms | 0.29 ms (2.23x) | 0.81 ms (0.85x) | 0.73 ms | 0.26 ms (2.28x) | 0.88 ms (0.83x) |
| **`immutable`** | 7.00 ms | 5.61 ms (1.01x) | 12.46 ms (0.56x) | 8.73 ms | 1.14 ms | 1.02 ms (1.12x) | 1.48 ms (0.77x) | 1.24 ms | 0.98 ms (1.12x) | 1.65 ms (0.75x) |
| **`moment`** | 24.13 ms | 23.72 ms (1.05x) | 41.56 ms (0.58x) | 14.59 ms | 11.55 ms | 2.37 ms (4.58x) | 4.84 ms (2.39x) | 11.16 ms | 2.51 ms (4.43x) | 4.92 ms (2.27x) |
| **`chroma-js`** | 2.23 ms | 4.82 ms (0.98x) | 6.39 ms (0.35x) | 7.83 ms | 0.69 ms | 0.66 ms (1.08x) | 0.82 ms (0.84x) | 0.67 ms | 0.65 ms (1.08x) | 0.78 ms (0.85x) |
| **`acorn`** | 8.56 ms | 8.93 ms (0.92x) | 13.04 ms (0.66x) | 10.97 ms | 1.43 ms | 1.25 ms (1.17x) | 1.51 ms (0.95x) | 1.40 ms | 1.24 ms (1.21x) | 1.49 ms (0.94x) |
| **`crc-32`** | 0.29 ms | — | 0.00 ms (—) | 5.14 ms | 0.19 ms | — | 0.08 ms (2.33x) | 0.18 ms | — | 0.07 ms (2.53x) |
| **`marked`** | — | — | — | — | — | — | — | — | — | — |
| **`d3-scale`** | 6.32 ms | — | 14.11 ms (0.45x) | 7.48 ms | 0.83 ms | — | 0.88 ms (0.95x) | 0.80 ms | — | 0.83 ms (0.95x) |
| **`redux`** | 0.47 ms | 0.00 ms (—) | 1.02 ms (0.47x) | 4.96 ms | 0.19 ms | 0.16 ms (1.44x) | 0.15 ms (1.25x) | 0.17 ms | 0.15 ms (1.47x) | 0.14 ms (1.25x) |
| **`handlebars-app`** | 17.61 ms | — | 10.49 ms (1.68x) | — | 3.64 ms | — | 1.36 ms (2.67x) | 3.35 ms | — | 1.29 ms (2.60x) |
| **`preact-ssr-app`** | 0.00 ms | 2.21 ms (1.06x) | 1.62 ms (—) | 5.28 ms | 0.28 ms | 0.25 ms (1.32x) | 0.27 ms (1.03x) | 0.26 ms | 0.18 ms (1.34x) | 0.26 ms (1.02x) |
| **`react-ssr-app`** | 3.30 ms | 4.04 ms (1.87x) | 5.57 ms (0.59x) | 6.11 ms | 0.78 ms | 0.45 ms (1.63x) | 0.77 ms (1.01x) | 0.78 ms | 0.44 ms (1.66x) | 0.77 ms (1.01x) |
| **`yaml-router-app`** | 8.83 ms | 4.05 ms (2.00x) | 9.97 ms (0.89x) | 6.74 ms | 1.54 ms | 0.51 ms (3.08x) | 0.70 ms (2.21x) | 1.49 ms | 0.47 ms (3.17x) | 0.68 ms (2.20x) |

## 3. Size Ratios & Heap Isomorphism Oracle Audit

| Library | PP Gzip Ratio | Hybrid Gzip Ratio | Prepack Blocker / Notes | Hybrid Heap Isomorphism Oracle (`verify`) |
|---|---:|---:|---|---|
| **`lodash`** | 0.97x | 3.71x | — | ISO-SEEDED (init reads volatile @ `_.cond (scope var "baseRest") (scope var "setToString") (scope var "lastCalled")`) |
| **`underscore`** | 1.10x | 3.49x | `PP0001: This operation is not yet supported on document at childNodes` | ISO-OK (653 obj / 317 fn) |
| **`ramda`** | 1.08x | 2.84x | — | ISO-OK (1554 obj / 753 fn) |
| **`immutable`** | 0.99x | 2.33x | — | ISO-SEEDED (init reads volatile @ `Immutable.Map.prototype.set (scope var "updateMap") (scope var "updateNode") (scope var "ValueNode").prototype.update (scope var "mergeIntoNode") (scope var "HashCollisionNode").prototype._positionOf (scope var "hashCollisionKey") (scope var "COLLISION_HASH_BASE")`) |
| **`moment`** | 1.33x | 2.45x | — | ISO-OK (4350 obj / 941 fn) |
| **`chroma-js`** | 0.93x | 2.08x | — | ISO-OK (402 obj / 167 fn) |
| **`acorn`** | 1.14x | 2.30x | — | ISO-OK (833 obj / 348 fn) |
| **`crc-32`** | — | 22.73x | `PP0037: failed to emit a residual loop: the loop calls an unknown or unsupported functio` | ISO-OK (25 obj / 3 fn) |
| **`marked`** | — | — | `PP1004: Syntax error: This experimental syntax requires enabling the parser plugin: 'opt` | BAIL (Hybrid bailout: class or function with private fields (#x) (a) (global.marked.Hooks.get.[[Scope:s20]].O)) |
| **`d3-scale`** | — | 2.61x | `INVARIANT: serialized 1339 of 1341` | ISO-SEEDED (init reads volatile @ `d3.timeInterval (scope var "t0")`) |
| **`redux`** | 0.89x | 1.47x | `PP0031: property access on unknown object` | ISO-SEEDED (init reads volatile @ `ReduxBench.runScenario (scope var "createStore") (scope var "actionTypes_default").INIT`) |
| **`handlebars-app`** | — | 2.23x | `PP0023: VM runtime threw: TypeError: not an object` | ISO-OK (2072 obj / 335 fn) |
| **`preact-ssr-app`** | 1.00x | 1.54x | — | ISO-OK (145 obj / 62 fn) |
| **`react-ssr-app`** | 1.38x | 2.29x | — | ISO-SEEDED (init reads volatile @ `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.Scheduler.unstable_scheduleCallback (scope var "v") (scope var "Ca")`) |
| **`yaml-router-app`** | 1.05x | 2.90x | — | ISO-OK (587 obj / 192 fn) |

