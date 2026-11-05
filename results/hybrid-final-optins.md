# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T19:38:04.541Z`
- **Prepack**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (version `0.0.1-hybrid`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30` (adaptRuns=`true`), `warmup=5`, `timeout=300000ms` (large=`900000ms`), `maxOldSpace=12288MB`
- **`node -e 0` Cold Process Baseline**: median **33.51 ms** (p90 40.32 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **22** | 15 standard + 7 large (17 libraries + 5 app workloads) |
| **OK (default options)** | **21** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **21** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **0** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **1** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded per-workload timeout (300s standard / 900s large) |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile (RSS) | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **OK** | **OK** | `default` | 1891 ms (189 MB) | — |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **OK** | **OK** | `default` | 848 ms (90 MB) | — |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `default` | 1651 ms (104 MB) | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `default` | 1163 ms (96 MB) | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 2567 ms (156 MB) | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `default` | 924 ms (89 MB) | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `default` | 1220 ms (102 MB) | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **OK** | **OK** | `default` | 588 ms (80 MB) | — |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **OK** | **OK** | `default` | 1005 ms (103 MB) | — |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **OK** | **OK** | `default` | 3158 ms (138 MB) | — |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **OK** | **OK** | `default` | 607 ms (80 MB) | — |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **OK** | **OK** | `default` | 1545 ms (105 MB) | — |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 668 ms (80 MB) | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **OK** | **OK** | `default` | 826 ms (91 MB) | — |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 986 ms (89 MB) | — |
| **`moment-timezone`** | moment@2.31.0 + moment-timezone@0.6.6 (MIT) | lib (large) | 913.3 KB | **OK** | **OK** | `default` | 2038 ms (138 MB) | — |
| **`prettier`** | prettier@2.8.8 (MIT) | lib (large) | 1065.6 KB | **FAIL** | **FAIL** | — | 4571 ms (83 MB) | `HYB_BAILOUT` (handleBailoutList (lib/bench-adapter.js:262:11)): WeakMap with contents (1 entries) (global["__core-js_shared__"].state) |
| **`highlight-js`** | highlight.js@11.12.0 (BSD-3-Clause) | lib (large) | 1834.5 KB | **OK** | **OK** | `default` | 4067 ms (269 MB) | — |
| **`three`** | three@0.187.0 (MIT) | lib (large) | 1914.4 KB | **OK** | **OK** | `default` | 61732 ms (314 MB) | — |
| **`mathjs`** | mathjs@15.2.0 (Apache-2.0) | lib (large) | 2117.9 KB | **OK** | **OK** | `default` | 115477 ms (2154 MB) | — |
| **`babel-standalone`** | @babel/standalone@7.29.13 (MIT) | lib (large) | 5248.9 KB | **OK** | **OK** | `default` | 18351 ms (863 MB) | — |
| **`typescript`** | typescript@5.9.3 (Apache-2.0) | lib (large) | 8899.1 KB | **OK** | **OK** | `default` | 128595 ms (967 MB) | — |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | OK (906.4 KB) | — | — | — | — | — |
| `underscore` | OK (99.1 KB) | — | — | — | — | — |
| `ramda` | OK (232.9 KB) | — | — | — | — | — |
| `immutable` | OK (290.8 KB) | — | — | — | — | — |
| `moment` | OK (1056.8 KB) | — | — | — | — | — |
| `chroma-js` | OK (173.0 KB) | — | — | — | — | — |
| `acorn` | OK (429.1 KB) | — | — | — | — | — |
| `crc-32` | OK (6.7 KB) | — | — | — | — | — |
| `marked` | OK (113.3 KB) | — | — | — | — | — |
| `d3-scale` | OK (363.9 KB) | — | — | — | — | — |
| `redux` | OK (30.2 KB) | — | — | — | — | — |
| `handlebars-app` | OK (346.4 KB) | — | — | — | — | — |
| `preact-ssr-app` | OK (46.2 KB) | — | — | — | — | — |
| `react-ssr-app` | OK (132.1 KB) | — | — | — | — | — |
| `yaml-router-app` | OK (249.7 KB) | — | — | — | — | — |
| `moment-timezone` | OK (1824.0 KB) | — | — | — | — | — |
| `prettier` | FAIL (`HYB_BAILOUT`) | — | — | — | — | — |
| `highlight-js` | OK (4133.1 KB) | — | — | — | — | — |
| `three` | OK (3241.1 KB) | — | — | — | — | — |
| `mathjs` | OK (19225.0 KB) | — | — | — | — | — |
| `babel-standalone` | OK (10286.9 KB) | — | — | — | — | — |
| `typescript` | OK (18441.0 KB) | — | — | — | — | — |

## 2. Original Baseline Measurements (All Workloads)

Baseline timings and compressed sizes for every unmodified workload (including workloads where Prepack fails), covering **library load + deterministic smoke test**.

| Workload | N | Raw | Terser | Gzip | Brotli | Cold `node` Net Med (p90) | V8 `cachedData` Med (p90) | VM Exec-Only Med (p90) | V8 `--snapshot-blob` Net Med |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 30 | 533.1 KB | 69.0 KB | 24.5 KB | 23.6 KB | 17.82 (26.75) ms | 4.26 (10.67) ms | 3.32 (12.83) ms | 15.54 ms (7.2 MB) |
| **`underscore`** | 30 | 67.3 KB | 18.9 KB | 7.2 KB | 7.0 KB | 2.76 (7.42) ms | 0.87 (0.97) ms | 0.80 (2.60) ms | 7.36 ms (6.2 MB) |
| **`ramda`** | 30 | 342.9 KB | 52.6 KB | 14.1 KB | 13.6 KB | 5.08 (11.85) ms | 0.84 (1.30) ms | 0.85 (2.66) ms | 6.78 ms (6.7 MB) |
| **`immutable`** | 30 | 175.4 KB | 64.9 KB | 18.0 KB | 17.3 KB | 5.70 (18.38) ms | 1.60 (3.45) ms | 1.34 (1.51) ms | 10.75 ms (6.4 MB) |
| **`moment`** | 30 | 637.8 KB | 292.3 KB | 74.3 KB | 62.6 KB | 26.71 (36.71) ms | 11.65 (16.35) ms | 12.84 (18.31) ms | 15.47 ms (7.7 MB) |
| **`chroma-js`** | 30 | 109.2 KB | 42.5 KB | 15.4 KB | 14.7 KB | 4.87 (15.21) ms | 0.86 (1.01) ms | 0.86 (1.87) ms | 11.69 ms (6.1 MB) |
| **`acorn`** | 30 | 240.9 KB | 115.6 KB | 33.9 KB | 31.7 KB | 10.01 (18.94) ms | 1.64 (3.00) ms | 1.59 (2.90) ms | 14.55 ms (6.6 MB) |
| **`crc-32`** | 30 | 3.6 KB | 2.0 KB | 0.8 KB | 0.8 KB | 3.43 (8.97) ms | 0.46 (0.64) ms | 0.63 (0.72) ms | 5.82 ms (6.0 MB) |
| **`marked`** | 30 | 49.4 KB | 48.9 KB | 14.5 KB | 14.0 KB | 35.22 (45.35) ms | 1.32 (1.63) ms | 1.28 (1.37) ms | 33.76 ms (6.1 MB) |
| **`d3-scale`** | 30 | 148.9 KB | 71.1 KB | 23.0 KB | 22.2 KB | 6.07 (9.78) ms | 1.19 (1.89) ms | 1.07 (1.56) ms | 14.15 ms (6.4 MB) |
| **`redux`** | 30 | 18.1 KB | 8.8 KB | 3.3 KB | 3.2 KB | 0.88 (6.48) ms | 0.32 (0.38) ms | 0.31 (0.58) ms | 7.04 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 211.9 KB | 86.4 KB | 26.3 KB | 24.4 KB | 18.49 (25.90) ms | 3.70 (4.99) ms | 3.50 (3.96) ms | unsupported |
| **`preact-ssr-app`** | 30 | 22.0 KB | 21.2 KB | 8.6 KB | 8.5 KB | 1.83 (6.09) ms | 0.47 (1.40) ms | 0.41 (1.62) ms | 6.69 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 47.0 KB | 45.1 KB | 15.2 KB | 14.4 KB | 6.17 (15.15) ms | 0.97 (2.56) ms | 0.92 (1.03) ms | 7.58 ms (6.2 MB) |
| **`yaml-router-app`** | 30 | 157.1 KB | 51.8 KB | 17.2 KB | 16.6 KB | 10.67 (16.96) ms | 2.79 (4.77) ms | 2.40 (3.29) ms | 12.03 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 913.3 KB | 778.7 KB | 55.0 KB | 46.5 KB | 38.05 (48.88) ms | 10.97 (22.37) ms | 9.61 (19.23) ms | 23.08 ms (8.7 MB) |
| **`prettier`** | 15 | 1065.6 KB | 1029.4 KB | 290.4 KB | 229.1 KB | 136.22 (168.52) ms | 17.36 (27.81) ms | 17.88 (29.21) ms | 87.29 ms (8.0 MB) |
| **`highlight-js`** | 15 | 1834.5 KB | 957.2 KB | 299.3 KB | 257.2 KB | 94.17 (107.07) ms | 16.25 (32.18) ms | 17.32 (35.91) ms | unsupported |
| **`three`** | 15 | 1914.4 KB | 742.9 KB | 183.2 KB | 163.5 KB | 38.24 (46.62) ms | 4.83 (6.16) ms | 4.61 (5.05) ms | 27.40 ms (10.4 MB) |
| **`mathjs`** | 15 | 2117.9 KB | 839.6 KB | 212.5 KB | 187.9 KB | 291.59 (353.47) ms | 211.12 (250.99) ms | 164.77 (174.13) ms | unsupported |
| **`babel-standalone`** | 12 | 5248.9 KB | 2951.7 KB | 644.3 KB | 466.6 KB | 199.28 (212.02) ms | 71.06 (85.67) ms | 69.76 (80.35) ms | unsupported |
| **`typescript`** | 12 | 8899.1 KB | 3430.8 KB | 944.8 KB | 785.6 KB | 197.20 (218.32) ms | 22.88 (33.08) ms | 21.58 (34.41) ms | 86.79 ms (18.8 MB) |

## 3. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over interleaved runs. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | N | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---:|---|---|---|---|---|---|---|
| **`lodash`** | 30 | 17.82 (26.75) -> 30.77 (38.60) ms | **0.58x** | 4.26 (10.67) -> 3.20 (5.61) ms | **1.33x** | 3.32 (12.83) -> 2.58 (4.42) ms | **1.29x** | 15.54 ms (7.2 MB) |
| **`underscore`** | 30 | 2.76 (7.42) -> 4.92 (16.17) ms | **0.56x** | 0.87 (0.97) -> 0.89 (1.12) ms | **0.97x** | 0.80 (2.60) -> 0.83 (4.63) ms | **0.96x** | 7.36 ms (6.2 MB) |
| **`ramda`** | 30 | 5.08 (11.85) -> 8.04 (18.94) ms | **0.63x** | 0.84 (1.30) -> 0.55 (0.69) ms | **1.54x** | 0.85 (2.66) -> 0.54 (1.01) ms | **1.57x** | 6.78 ms (6.7 MB) |
| **`immutable`** | 30 | 5.70 (18.38) -> 11.33 (22.05) ms | **0.50x** | 1.60 (3.45) -> 1.72 (2.89) ms | **0.93x** | 1.34 (1.51) -> 1.43 (1.64) ms | **0.94x** | 10.75 ms (6.4 MB) |
| **`moment`** | 30 | 26.71 (36.71) -> 39.45 (53.79) ms | **0.68x** | 11.65 (16.35) -> 4.01 (5.91) ms | **2.91x** | 12.84 (18.31) -> 4.32 (7.41) ms | **2.97x** | 15.47 ms (7.7 MB) |
| **`chroma-js`** | 30 | 4.87 (15.21) -> 7.64 (14.28) ms | **0.64x** | 0.86 (1.01) -> 0.80 (1.26) ms | **1.06x** | 0.86 (1.87) -> 0.78 (1.46) ms | **1.11x** | 11.69 ms (6.1 MB) |
| **`acorn`** | 30 | 10.01 (18.94) -> 17.38 (21.02) ms | **0.58x** | 1.64 (3.00) -> 1.57 (3.04) ms | **1.05x** | 1.59 (2.90) -> 1.55 (2.65) ms | **1.02x** | 14.55 ms (6.6 MB) |
| **`crc-32`** | 30 | 3.43 (8.97) -> 2.64 (7.37) ms | **1.30x** | 0.46 (0.64) -> 0.46 (0.63) ms | **1.00x** | 0.63 (0.72) -> 0.41 (0.72) ms | **1.55x** | 5.82 ms (6.0 MB) |
| **`marked`** | 30 | 35.22 (45.35) -> 40.59 (45.23) ms | **0.87x** | 1.32 (1.63) -> 1.18 (1.44) ms | **1.12x** | 1.28 (1.37) -> 1.14 (1.22) ms | **1.12x** | 33.76 ms (6.1 MB) |
| **`d3-scale`** | 30 | 6.07 (9.78) -> 13.84 (20.65) ms | **0.44x** | 1.19 (1.89) -> 0.92 (1.45) ms | **1.30x** | 1.07 (1.56) -> 0.84 (1.76) ms | **1.28x** | 14.15 ms (6.4 MB) |
| **`redux`** | 30 | 0.88 (6.48) -> 0.00 (5.66) ms | **—** | 0.32 (0.38) -> 0.26 (0.31) ms | **1.24x** | 0.31 (0.58) -> 0.24 (0.25) ms | **1.28x** | 7.04 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 18.49 (25.90) -> 10.81 (19.70) ms | **1.71x** | 3.70 (4.99) -> 1.14 (1.70) ms | **3.25x** | 3.50 (3.96) -> 1.17 (1.42) ms | **3.01x** | n/a |
| **`preact-ssr-app`** | 30 | 1.83 (6.09) -> 1.31 (7.09) ms | **1.40x** | 0.47 (1.40) -> 0.47 (3.16) ms | **0.99x** | 0.41 (1.62) -> 0.47 (1.61) ms | **0.87x** | 6.69 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 6.17 (15.15) -> 9.28 (15.99) ms | **0.67x** | 0.97 (2.56) -> 0.82 (1.00) ms | **1.18x** | 0.92 (1.03) -> 0.79 (2.24) ms | **1.17x** | 7.58 ms (6.2 MB) |
| **`yaml-router-app`** | 30 | 10.67 (16.96) -> 6.91 (13.59) ms | **1.55x** | 2.79 (4.77) -> 0.84 (2.03) ms | **3.31x** | 2.40 (3.29) -> 0.79 (1.50) ms | **3.05x** | 12.03 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 38.05 (48.88) -> 41.64 (58.95) ms | **0.91x** | 10.97 (22.37) -> 9.05 (12.66) ms | **1.21x** | 9.61 (19.23) -> 7.75 (13.89) ms | **1.24x** | 23.08 ms (8.7 MB) |
| **`highlight-js`** | 15 | 94.17 (107.07) -> 112.04 (131.58) ms | **0.84x** | 16.25 (32.18) -> 16.10 (26.93) ms | **1.01x** | 17.32 (35.91) -> 14.10 (16.63) ms | **1.23x** | n/a |
| **`three`** | 15 | 38.24 (46.62) -> 61.17 (76.08) ms | **0.63x** | 4.83 (6.16) -> 6.13 (12.94) ms | **0.79x** | 4.61 (5.05) -> 5.75 (7.35) ms | **0.80x** | 27.40 ms (10.4 MB) |
| **`mathjs`** | 15 | 291.59 (353.47) -> 905.48 (1022.96) ms | **0.32x** | 211.12 (250.99) -> 115.22 (126.25) ms | **1.83x** | 164.77 (174.13) -> 95.15 (98.44) ms | **1.73x** | n/a |
| **`babel-standalone`** | 12 | 199.28 (212.02) -> 325.35 (336.00) ms | **0.61x** | 71.06 (85.67) -> 54.80 (63.52) ms | **1.30x** | 69.76 (80.35) -> 54.84 (66.32) ms | **1.27x** | n/a |
| **`typescript`** | 12 | 197.20 (218.32) -> 403.06 (418.98) ms | **0.49x** | 22.88 (33.08) -> 35.06 (40.11) ms | **0.65x** | 21.58 (34.41) -> 32.56 (42.20) ms | **0.66x** | 86.79 ms (18.8 MB) |

## 4. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 906.4 KB (1.70x) | 69.0 KB -> 240.7 KB (3.49x) | 24.5 KB -> 76.4 KB (**3.12x**) | 23.6 KB -> 53.3 KB (**2.26x**) |
| **`underscore`** | 67.3 KB -> 99.1 KB (1.47x) | 18.9 KB -> 45.6 KB (2.41x) | 7.2 KB -> 14.0 KB (**1.94x**) | 7.0 KB -> 12.8 KB (**1.81x**) |
| **`ramda`** | 342.9 KB -> 232.9 KB (0.68x) | 52.6 KB -> 121.4 KB (2.31x) | 14.1 KB -> 32.0 KB (**2.26x**) | 13.6 KB -> 24.7 KB (**1.82x**) |
| **`immutable`** | 175.4 KB -> 290.8 KB (1.66x) | 64.9 KB -> 131.7 KB (2.03x) | 18.0 KB -> 36.9 KB (**2.05x**) | 17.3 KB -> 27.9 KB (**1.62x**) |
| **`moment`** | 637.8 KB -> 1056.8 KB (1.66x) | 292.3 KB -> 675.0 KB (2.31x) | 74.3 KB -> 167.4 KB (**2.25x**) | 62.6 KB -> 104.9 KB (**1.68x**) |
| **`chroma-js`** | 109.2 KB -> 173.0 KB (1.58x) | 42.5 KB -> 88.3 KB (2.08x) | 15.4 KB -> 30.1 KB (**1.95x**) | 14.7 KB -> 20.1 KB (**1.37x**) |
| **`acorn`** | 240.9 KB -> 429.1 KB (1.78x) | 115.6 KB -> 280.9 KB (2.43x) | 33.9 KB -> 72.6 KB (**2.14x**) | 31.7 KB -> 42.5 KB (**1.34x**) |
| **`crc-32`** | 3.6 KB -> 6.7 KB (1.84x) | 2.0 KB -> 4.5 KB (2.25x) | 0.8 KB -> 1.2 KB (**1.51x**) | 0.8 KB -> 1.1 KB (**1.46x**) |
| **`marked`** | 49.4 KB -> 113.3 KB (2.29x) | 48.9 KB -> 106.6 KB (2.18x) | 14.5 KB -> 27.8 KB (**1.92x**) | 14.0 KB -> 17.6 KB (**1.26x**) |
| **`d3-scale`** | 148.9 KB -> 363.9 KB (2.44x) | 71.1 KB -> 182.7 KB (2.57x) | 23.0 KB -> 53.3 KB (**2.31x**) | 22.2 KB -> 36.7 KB (**1.66x**) |
| **`redux`** | 18.1 KB -> 30.2 KB (1.67x) | 8.8 KB -> 16.6 KB (1.87x) | 3.3 KB -> 4.2 KB (**1.25x**) | 3.2 KB -> 3.8 KB (**1.21x**) |
| **`handlebars-app`** | 211.9 KB -> 346.4 KB (1.64x) | 86.4 KB -> 184.5 KB (2.13x) | 26.3 KB -> 52.7 KB (**2.01x**) | 24.4 KB -> 32.8 KB (**1.34x**) |
| **`preact-ssr-app`** | 22.0 KB -> 46.2 KB (2.10x) | 21.2 KB -> 43.2 KB (2.04x) | 8.6 KB -> 12.8 KB (**1.49x**) | 8.5 KB -> 11.4 KB (**1.35x**) |
| **`react-ssr-app`** | 47.0 KB -> 132.1 KB (2.81x) | 45.1 KB -> 118.0 KB (2.62x) | 15.2 KB -> 31.6 KB (**2.08x**) | 14.4 KB -> 23.1 KB (**1.61x**) |
| **`yaml-router-app`** | 157.1 KB -> 249.7 KB (1.59x) | 51.8 KB -> 110.8 KB (2.14x) | 17.2 KB -> 33.4 KB (**1.94x**) | 16.6 KB -> 22.8 KB (**1.38x**) |
| **`moment-timezone`** | 913.3 KB -> 1824.0 KB (2.00x) | 778.7 KB -> 1632.4 KB (2.10x) | 55.0 KB -> 127.9 KB (**2.33x**) | 46.5 KB -> 75.1 KB (**1.61x**) |
| **`highlight-js`** | 1834.5 KB -> 4133.1 KB (2.25x) | 957.2 KB -> 2990.4 KB (3.12x) | 299.3 KB -> 757.8 KB (**2.53x**) | 257.2 KB -> 310.4 KB (**1.21x**) |
| **`three`** | 1914.4 KB -> 3241.1 KB (1.69x) | 742.9 KB -> 1681.3 KB (2.26x) | 183.2 KB -> 399.8 KB (**2.18x**) | 163.5 KB -> 208.6 KB (**1.27x**) |
| **`mathjs`** | 2117.9 KB -> 19225.0 KB (9.08x) | 839.6 KB -> 8917.2 KB (10.62x) | 212.5 KB -> 1238.8 KB (**5.83x**) | 187.9 KB -> 918.0 KB (**4.89x**) |
| **`babel-standalone`** | 5248.9 KB -> 10286.9 KB (1.96x) | 2951.7 KB -> 6564.6 KB (2.22x) | 644.3 KB -> 1402.2 KB (**2.18x**) | 466.6 KB -> 743.8 KB (**1.59x**) |
| **`typescript`** | 8899.1 KB -> 18441.0 KB (2.07x) | 3430.8 KB -> 8421.2 KB (2.46x) | 944.8 KB -> 2120.6 KB (**2.24x**) | 785.6 KB -> 1305.7 KB (**1.66x**) |

## 5. Diagnostics & Blockers Summary

### `prettier` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_BAILOUT`
- **Message**: WeakMap with contents (1 entries) (global["__core-js_shared__"].state)
- **Compile resources**: 4571 ms, peak RSS 82.5 MB
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

