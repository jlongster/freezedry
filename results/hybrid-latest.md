# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T11:03:32.414Z`
- **Prepack**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (version `0.0.1-hybrid`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30`, `warmup=5`, `timeout=300000ms`
- **`node -e 0` Cold Process Baseline**: median **31.44 ms** (p90 39.81 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **15** | 10 libraries + 5 init-heavy app workloads |
| **OK (default options)** | **14** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **14** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **0** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **1** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded 300s per-lib cap |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **OK** | **OK** | `default` | 4635 ms | — |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **OK** | **OK** | `default` | 2224 ms | — |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `browser-opt` | 2941 ms | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `browser-opt` | 2338 ms | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 4823 ms | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `browser-opt` | 1926 ms | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `browser-opt` | 1368 ms | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **OK** | **OK** | `default` | 538 ms | — |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **FAIL** | **FAIL** | — | 762 ms | `HYB_BAILOUT` (handleBailoutList (lib/bench-adapter.js:249:11)): class or function with private fields (#x) (a) (global.marked.Hooks.get.[[Scope:s20]].O) |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **OK** | **OK** | `default` | 3349 ms | — |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **OK** | **OK** | `default` | 796 ms | — |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **OK** | **OK** | `default` | 1563 ms | — |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 657 ms | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **OK** | **OK** | `default` | 1225 ms | — |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 1010 ms | — |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | OK (1430.0 KB) | OK (1430.6 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `underscore` | OK (235.9 KB) | OK (235.9 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `ramda` | OK (545.1 KB) | OK (545.1 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `immutable` | OK (384.2 KB) | OK (384.2 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `moment` | OK (1443.0 KB) | OK (1443.2 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `chroma-js` | OK (236.1 KB) | OK (236.1 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `acorn` | OK (556.5 KB) | OK (556.5 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `crc-32` | OK (30.0 KB) | OK (30.0 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `marked` | FAIL (`HYB_BAILOUT`) | FAIL (`HYB_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `d3-scale` | OK (439.9 KB) | OK (439.9 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `redux` | OK (40.5 KB) | OK (40.5 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `handlebars-app` | OK (461.7 KB) | OK (461.7 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `preact-ssr-app` | OK (52.2 KB) | OK (52.2 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `react-ssr-app` | OK (150.4 KB) | OK (150.4 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `yaml-router-app` | OK (458.2 KB) | OK (458.2 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |

## 2. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over `N=30` interleaved runs after `5` warmups. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---|---|---|---|---|---|---|
| **`lodash`** | 16.50 (27.99) -> 29.30 (39.33) ms | **0.56x** | 3.85 (8.02) -> 2.15 (2.80) ms | **1.79x** | 2.99 (14.24) -> 1.83 (4.17) ms | **1.64x** | 10.48 ms (7.2 MB) |
| **`underscore`** | 4.28 (21.76) -> 7.90 (41.42) ms | **0.54x** | 0.44 (0.48) -> 0.71 (0.79) ms | **0.63x** | 0.43 (0.51) -> 0.71 (0.97) ms | **0.61x** | 7.49 ms (6.2 MB) |
| **`ramda`** | 2.23 (26.11) -> 10.65 (19.06) ms | **0.21x** | 0.69 (1.05) -> 0.81 (0.91) ms | **0.85x** | 0.73 (1.03) -> 0.88 (1.33) ms | **0.83x** | 5.80 ms (6.7 MB) |
| **`immutable`** | 7.00 (9.17) -> 12.46 (15.48) ms | **0.56x** | 1.14 (1.19) -> 1.48 (1.55) ms | **0.77x** | 1.24 (1.36) -> 1.65 (1.92) ms | **0.75x** | 8.73 ms (6.4 MB) |
| **`moment`** | 24.13 (49.10) -> 41.56 (49.30) ms | **0.58x** | 11.55 (12.81) -> 4.84 (5.60) ms | **2.39x** | 11.16 (11.64) -> 4.92 (5.18) ms | **2.27x** | 14.59 ms (7.7 MB) |
| **`chroma-js`** | 2.23 (9.61) -> 6.39 (12.01) ms | **0.35x** | 0.69 (0.74) -> 0.82 (0.91) ms | **0.84x** | 0.67 (0.70) -> 0.78 (0.81) ms | **0.85x** | 7.83 ms (6.1 MB) |
| **`acorn`** | 8.56 (15.92) -> 13.04 (19.05) ms | **0.66x** | 1.43 (1.98) -> 1.51 (1.60) ms | **0.95x** | 1.40 (1.43) -> 1.49 (1.58) ms | **0.94x** | 10.97 ms (6.6 MB) |
| **`crc-32`** | 0.29 (6.08) -> 0.00 (2.77) ms | **—** | 0.19 (0.20) -> 0.08 (0.09) ms | **2.33x** | 0.18 (0.19) -> 0.07 (0.08) ms | **2.53x** | 5.14 ms (6.0 MB) |
| **`d3-scale`** | 6.32 (8.70) -> 14.11 (17.22) ms | **0.45x** | 0.83 (1.06) -> 0.88 (1.10) ms | **0.95x** | 0.80 (0.82) -> 0.83 (0.85) ms | **0.95x** | 7.48 ms (6.4 MB) |
| **`redux`** | 0.47 (2.76) -> 1.02 (3.17) ms | **0.47x** | 0.19 (0.30) -> 0.15 (0.20) ms | **1.25x** | 0.17 (0.19) -> 0.14 (0.14) ms | **1.25x** | 4.96 ms (6.0 MB) |
| **`handlebars-app`** | 17.61 (21.11) -> 10.49 (14.83) ms | **1.68x** | 3.64 (8.15) -> 1.36 (1.55) ms | **2.67x** | 3.35 (4.16) -> 1.29 (1.98) ms | **2.60x** | n/a |
| **`preact-ssr-app`** | 0.00 (3.60) -> 1.62 (5.59) ms | **0.00x** | 0.28 (0.32) -> 0.27 (0.36) ms | **1.03x** | 0.26 (0.28) -> 0.26 (0.28) ms | **1.02x** | 5.28 ms (6.0 MB) |
| **`react-ssr-app`** | 3.30 (7.20) -> 5.57 (11.91) ms | **0.59x** | 0.78 (0.87) -> 0.77 (0.83) ms | **1.01x** | 0.78 (0.89) -> 0.77 (0.82) ms | **1.01x** | 6.11 ms (6.2 MB) |
| **`yaml-router-app`** | 8.83 (12.64) -> 9.97 (12.22) ms | **0.89x** | 1.54 (1.78) -> 0.70 (0.91) ms | **2.21x** | 1.49 (1.56) -> 0.68 (0.70) ms | **2.20x** | 6.74 ms (6.4 MB) |

## 3. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 1430.0 KB (2.68x) | 69.0 KB -> 300.5 KB (4.35x) | 24.5 KB -> 90.9 KB (**3.71x**) | 23.6 KB -> 62.0 KB (**2.63x**) |
| **`underscore`** | 67.3 KB -> 235.9 KB (3.50x) | 18.9 KB -> 82.1 KB (4.34x) | 7.2 KB -> 25.1 KB (**3.49x**) | 7.0 KB -> 15.5 KB (**2.21x**) |
| **`ramda`** | 342.9 KB -> 545.1 KB (1.59x) | 52.6 KB -> 150.2 KB (2.85x) | 14.1 KB -> 40.1 KB (**2.84x**) | 13.6 KB -> 29.5 KB (**2.17x**) |
| **`immutable`** | 175.4 KB -> 384.2 KB (2.19x) | 64.9 KB -> 149.9 KB (2.31x) | 18.0 KB -> 42.1 KB (**2.33x**) | 17.3 KB -> 32.0 KB (**1.85x**) |
| **`moment`** | 637.8 KB -> 1443.0 KB (2.26x) | 292.3 KB -> 741.8 KB (2.54x) | 74.3 KB -> 181.8 KB (**2.45x**) | 62.6 KB -> 113.5 KB (**1.81x**) |
| **`chroma-js`** | 109.2 KB -> 236.1 KB (2.16x) | 42.5 KB -> 100.2 KB (2.36x) | 15.4 KB -> 32.0 KB (**2.08x**) | 14.7 KB -> 22.0 KB (**1.49x**) |
| **`acorn`** | 240.9 KB -> 556.5 KB (2.31x) | 115.6 KB -> 313.9 KB (2.71x) | 33.9 KB -> 77.9 KB (**2.30x**) | 31.7 KB -> 45.8 KB (**1.44x**) |
| **`crc-32`** | 3.6 KB -> 30.0 KB (8.30x) | 2.0 KB -> 27.0 KB (13.51x) | 0.8 KB -> 18.2 KB (**22.73x**) | 0.8 KB -> 17.8 KB (**23.16x**) |
| **`d3-scale`** | 148.9 KB -> 439.9 KB (2.95x) | 71.1 KB -> 202.2 KB (2.85x) | 23.0 KB -> 60.2 KB (**2.61x**) | 22.2 KB -> 41.5 KB (**1.87x**) |
| **`redux`** | 18.1 KB -> 40.5 KB (2.24x) | 8.8 KB -> 19.7 KB (2.23x) | 3.3 KB -> 4.9 KB (**1.47x**) | 3.2 KB -> 4.5 KB (**1.40x**) |
| **`handlebars-app`** | 211.9 KB -> 461.7 KB (2.18x) | 86.4 KB -> 202.5 KB (2.34x) | 26.3 KB -> 58.6 KB (**2.23x**) | 24.4 KB -> 36.7 KB (**1.50x**) |
| **`preact-ssr-app`** | 22.0 KB -> 52.2 KB (2.38x) | 21.2 KB -> 45.8 KB (2.16x) | 8.6 KB -> 13.3 KB (**1.54x**) | 8.5 KB -> 11.8 KB (**1.39x**) |
| **`react-ssr-app`** | 47.0 KB -> 150.4 KB (3.20x) | 45.1 KB -> 127.5 KB (2.83x) | 15.2 KB -> 34.8 KB (**2.29x**) | 14.4 KB -> 24.9 KB (**1.73x**) |
| **`yaml-router-app`** | 157.1 KB -> 458.2 KB (2.92x) | 51.8 KB -> 160.4 KB (3.10x) | 17.2 KB -> 49.8 KB (**2.90x**) | 16.6 KB -> 26.3 KB (**1.59x**) |

## 4. Diagnostics & Blockers Summary

### `marked` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_BAILOUT`
- **Message**: class or function with private fields (#x) (a) (global.marked.Hooks.get.[[Scope:s20]].O)
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

