# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T19:22:28.590Z`
- **Prepack**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (version `0.0.1-hybrid`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30` (adaptRuns=`true`), `warmup=5`, `timeout=300000ms` (large=`900000ms`), `maxOldSpace=12288MB`
- **`node -e 0` Cold Process Baseline**: median **26.85 ms** (p90 33.84 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **22** | 15 standard + 7 large (17 libraries + 5 app workloads) |
| **OK (default options)** | **11** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **11** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **0** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **11** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded per-workload timeout (300s standard / 900s large) |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile (RSS) | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **FAIL** | **FAIL** | — | 84 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L6783:21: volatile API "Date.now()" called during initialization (lodash.js:6783:21) |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **OK** | **OK** | `default` | 831 ms (85 MB) | — |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `default` | 1166 ms (103 MB) | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **FAIL** | **FAIL** | — | 71 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L893:12: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 1965 ms (155 MB) | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `default` | 700 ms (82 MB) | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `default` | 845 ms (101 MB) | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **OK** | **OK** | `default` | 396 ms (80 MB) | — |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **OK** | **OK** | `default` | 834 ms (99 MB) | — |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **FAIL** | **FAIL** | — | 69 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L3086:12: volatile API "new Date()" without arguments called during initialization (d3-scale.js:3086:12) |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **FAIL** | **FAIL** | — | 74 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L366:33: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **FAIL** | **FAIL** | — | 70 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L1302:16: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 524 ms (80 MB) | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **FAIL** | **FAIL** | — | 72 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L20:236: volatile API "Date.now()" called during initialization (react-ssr-app.js:20:236) |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 749 ms (89 MB) | — |
| **`moment-timezone`** | moment@2.31.0 + moment-timezone@0.6.6 (MIT) | lib (large) | 913.3 KB | **OK** | **OK** | `default` | 1291 ms (131 MB) | — |
| **`prettier`** | prettier@2.8.8 (MIT) | lib (large) | 1065.6 KB | **FAIL** | **FAIL** | — | 99 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L1:5250: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`highlight-js`** | highlight.js@11.12.0 (BSD-3-Clause) | lib (large) | 1834.5 KB | **OK** | **OK** | `default` | 3751 ms (269 MB) | — |
| **`three`** | three@0.187.0 (MIT) | lib (large) | 1914.4 KB | **FAIL** | **FAIL** | — | 106 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L162:21: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`mathjs`** | mathjs@15.2.0 (Apache-2.0) | lib (large) | 2117.9 KB | **FAIL** | **FAIL** | — | 135 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L43555:22: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`babel-standalone`** | @babel/standalone@7.29.13 (MIT) | lib (large) | 5248.9 KB | **FAIL** | **FAIL** | — | 170 ms (80 MB) | `HYB_VOLATILE_BAILOUT` @ L603:19: volatile API "new Date()" without arguments called during initialization (babel-standalone.js:6 |
| **`typescript`** | typescript@5.9.3 (Apache-2.0) | lib (large) | 8899.1 KB | **FAIL** | **FAIL** | — | 248 ms (90 MB) | `HYB_VOLATILE_BAILOUT` @ L5174:18: volatile API "Date.now()" called during initialization (typescript.js:5174:18) |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `underscore` | OK (99.1 KB) | — | — | — | — | — |
| `ramda` | OK (232.9 KB) | — | — | — | — | — |
| `immutable` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `moment` | OK (1056.6 KB) | — | — | — | — | — |
| `chroma-js` | OK (173.0 KB) | — | — | — | — | — |
| `acorn` | OK (429.1 KB) | — | — | — | — | — |
| `crc-32` | OK (6.7 KB) | — | — | — | — | — |
| `marked` | OK (113.3 KB) | — | — | — | — | — |
| `d3-scale` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `redux` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `handlebars-app` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `preact-ssr-app` | OK (46.2 KB) | — | — | — | — | — |
| `react-ssr-app` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `yaml-router-app` | OK (249.7 KB) | — | — | — | — | — |
| `moment-timezone` | OK (1824.0 KB) | — | — | — | — | — |
| `prettier` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `highlight-js` | OK (4133.1 KB) | — | — | — | — | — |
| `three` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `mathjs` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `babel-standalone` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |
| `typescript` | FAIL (`HYB_VOLATILE_BAILOUT`) | — | — | — | — | — |

## 2. Original Baseline Measurements (All Workloads)

Baseline timings and compressed sizes for every unmodified workload (including workloads where Prepack fails), covering **library load + deterministic smoke test**.

| Workload | N | Raw | Terser | Gzip | Brotli | Cold `node` Net Med (p90) | V8 `cachedData` Med (p90) | VM Exec-Only Med (p90) | V8 `--snapshot-blob` Net Med |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 30 | 533.1 KB | 69.0 KB | 24.5 KB | 23.6 KB | 17.54 (19.86) ms | 3.29 (8.68) ms | 3.14 (4.33) ms | 11.23 ms (7.2 MB) |
| **`underscore`** | 30 | 67.3 KB | 18.9 KB | 7.2 KB | 7.0 KB | 2.92 (5.30) ms | 0.57 (0.96) ms | 0.55 (0.58) ms | 7.78 ms (6.2 MB) |
| **`ramda`** | 30 | 342.9 KB | 52.6 KB | 14.1 KB | 13.6 KB | 4.83 (9.67) ms | 0.75 (1.14) ms | 0.74 (0.79) ms | 8.85 ms (6.7 MB) |
| **`immutable`** | 30 | 175.4 KB | 64.9 KB | 18.0 KB | 17.3 KB | 4.00 (7.20) ms | 1.35 (1.81) ms | 1.30 (1.63) ms | 9.50 ms (6.4 MB) |
| **`moment`** | 30 | 637.8 KB | 292.3 KB | 74.3 KB | 62.6 KB | 26.20 (30.09) ms | 11.92 (13.01) ms | 11.38 (16.25) ms | 14.97 ms (7.7 MB) |
| **`chroma-js`** | 30 | 109.2 KB | 42.5 KB | 15.4 KB | 14.7 KB | 4.95 (9.10) ms | 0.86 (1.13) ms | 0.80 (0.83) ms | 7.53 ms (6.1 MB) |
| **`acorn`** | 30 | 240.9 KB | 115.6 KB | 33.9 KB | 31.7 KB | 7.17 (12.82) ms | 1.75 (2.40) ms | 1.75 (2.19) ms | 9.91 ms (6.6 MB) |
| **`crc-32`** | 30 | 3.6 KB | 2.0 KB | 0.8 KB | 0.8 KB | 0.05 (3.27) ms | 0.34 (0.39) ms | 0.32 (0.34) ms | 6.45 ms (6.0 MB) |
| **`marked`** | 30 | 49.4 KB | 48.9 KB | 14.5 KB | 14.0 KB | 32.77 (37.75) ms | 1.47 (1.67) ms | 1.23 (1.32) ms | 29.21 ms (6.1 MB) |
| **`d3-scale`** | 30 | 148.9 KB | 71.1 KB | 23.0 KB | 22.2 KB | 6.40 (9.41) ms | 0.94 (1.02) ms | 0.96 (1.23) ms | 9.14 ms (6.4 MB) |
| **`redux`** | 30 | 18.1 KB | 8.8 KB | 3.3 KB | 3.2 KB | 0.81 (4.09) ms | 0.32 (0.35) ms | 0.30 (0.37) ms | 5.02 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 211.9 KB | 86.4 KB | 26.3 KB | 24.4 KB | 17.17 (19.50) ms | 3.46 (3.92) ms | 3.22 (3.42) ms | unsupported |
| **`preact-ssr-app`** | 30 | 22.0 KB | 21.2 KB | 8.6 KB | 8.5 KB | 1.86 (3.71) ms | 0.43 (0.48) ms | 0.43 (0.67) ms | 6.08 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 47.0 KB | 45.1 KB | 15.2 KB | 14.4 KB | 3.50 (7.31) ms | 1.02 (1.27) ms | 0.89 (0.94) ms | 5.77 ms (6.3 MB) |
| **`yaml-router-app`** | 30 | 157.1 KB | 51.8 KB | 17.2 KB | 16.6 KB | 5.91 (11.48) ms | 1.75 (2.08) ms | 1.62 (2.16) ms | 8.76 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 913.3 KB | 778.7 KB | 55.0 KB | 46.5 KB | 24.17 (34.14) ms | 8.25 (8.57) ms | 8.13 (12.23) ms | 23.70 ms (8.7 MB) |
| **`prettier`** | 15 | 1065.6 KB | 1029.4 KB | 290.4 KB | 229.1 KB | 128.02 (134.33) ms | 19.60 (29.12) ms | 18.83 (27.85) ms | 68.89 ms (8.0 MB) |
| **`highlight-js`** | 15 | 1834.5 KB | 957.2 KB | 299.3 KB | 257.2 KB | 92.52 (96.44) ms | 19.12 (25.52) ms | 15.96 (22.73) ms | unsupported |
| **`three`** | 15 | 1914.4 KB | 742.9 KB | 183.2 KB | 163.5 KB | 36.85 (44.58) ms | 4.70 (12.05) ms | 4.52 (4.63) ms | 21.25 ms (10.4 MB) |
| **`mathjs`** | 15 | 2117.9 KB | 839.6 KB | 212.5 KB | 187.9 KB | 227.92 (239.11) ms | 175.36 (203.39) ms | 169.13 (197.77) ms | unsupported |
| **`babel-standalone`** | 12 | 5248.9 KB | 2951.7 KB | 644.3 KB | 466.6 KB | 211.98 (221.45) ms | 64.92 (67.12) ms | 65.22 (67.73) ms | unsupported |
| **`typescript`** | 12 | 8899.1 KB | 3430.8 KB | 944.8 KB | 785.6 KB | 195.52 (206.46) ms | 21.71 (32.56) ms | 23.39 (31.79) ms | 89.90 ms (18.8 MB) |

## 3. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over interleaved runs. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | N | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---:|---|---|---|---|---|---|---|
| **`underscore`** | 30 | 2.92 (5.30) -> 3.44 (7.24) ms | **0.85x** | 0.57 (0.96) -> 0.58 (1.06) ms | **0.98x** | 0.55 (0.58) -> 0.55 (0.59) ms | **1.00x** | 7.78 ms (6.2 MB) |
| **`ramda`** | 30 | 4.83 (9.67) -> 8.47 (13.47) ms | **0.57x** | 0.75 (1.14) -> 0.50 (0.71) ms | **1.50x** | 0.74 (0.79) -> 0.47 (0.54) ms | **1.59x** | 8.85 ms (6.7 MB) |
| **`moment`** | 30 | 26.20 (30.09) -> 38.29 (45.34) ms | **0.68x** | 11.92 (13.01) -> 4.11 (4.50) ms | **2.90x** | 11.38 (16.25) -> 4.00 (5.71) ms | **2.85x** | 14.97 ms (7.7 MB) |
| **`chroma-js`** | 30 | 4.95 (9.10) -> 6.96 (10.69) ms | **0.71x** | 0.86 (1.13) -> 0.80 (1.13) ms | **1.07x** | 0.80 (0.83) -> 0.76 (0.79) ms | **1.06x** | 7.53 ms (6.1 MB) |
| **`acorn`** | 30 | 7.17 (12.82) -> 10.66 (18.78) ms | **0.67x** | 1.75 (2.40) -> 1.63 (2.28) ms | **1.08x** | 1.75 (2.19) -> 1.61 (2.03) ms | **1.09x** | 9.91 ms (6.6 MB) |
| **`crc-32`** | 30 | 0.05 (3.27) -> 0.20 (2.33) ms | **0.27x** | 0.34 (0.39) -> 0.35 (0.38) ms | **0.96x** | 0.32 (0.34) -> 0.33 (0.36) ms | **0.95x** | 6.45 ms (6.0 MB) |
| **`marked`** | 30 | 32.77 (37.75) -> 37.57 (43.36) ms | **0.87x** | 1.47 (1.67) -> 1.28 (1.43) ms | **1.15x** | 1.23 (1.32) -> 1.11 (1.17) ms | **1.11x** | 29.21 ms (6.1 MB) |
| **`preact-ssr-app`** | 30 | 1.86 (3.71) -> 2.23 (4.35) ms | **0.83x** | 0.43 (0.48) -> 0.38 (0.41) ms | **1.12x** | 0.43 (0.67) -> 0.39 (0.58) ms | **1.11x** | 6.08 ms (6.0 MB) |
| **`yaml-router-app`** | 30 | 5.91 (11.48) -> 5.03 (6.62) ms | **1.17x** | 1.75 (2.08) -> 0.72 (0.75) ms | **2.41x** | 1.62 (2.16) -> 0.71 (0.78) ms | **2.28x** | 8.76 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 24.17 (34.14) -> 31.02 (38.29) ms | **0.78x** | 8.25 (8.57) -> 6.50 (6.75) ms | **1.27x** | 8.13 (12.23) -> 6.42 (6.72) ms | **1.27x** | 23.70 ms (8.7 MB) |
| **`highlight-js`** | 15 | 92.52 (96.44) -> 106.50 (113.27) ms | **0.87x** | 19.12 (25.52) -> 13.99 (22.30) ms | **1.37x** | 15.96 (22.73) -> 13.85 (20.67) ms | **1.15x** | n/a |

## 4. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`underscore`** | 67.3 KB -> 99.1 KB (1.47x) | 18.9 KB -> 45.6 KB (2.41x) | 7.2 KB -> 14.0 KB (**1.94x**) | 7.0 KB -> 12.7 KB (**1.81x**) |
| **`ramda`** | 342.9 KB -> 232.9 KB (0.68x) | 52.6 KB -> 121.4 KB (2.31x) | 14.1 KB -> 32.0 KB (**2.26x**) | 13.6 KB -> 24.8 KB (**1.82x**) |
| **`moment`** | 637.8 KB -> 1056.6 KB (1.66x) | 292.3 KB -> 675.0 KB (2.31x) | 74.3 KB -> 167.5 KB (**2.25x**) | 62.6 KB -> 104.9 KB (**1.68x**) |
| **`chroma-js`** | 109.2 KB -> 173.0 KB (1.58x) | 42.5 KB -> 88.3 KB (2.08x) | 15.4 KB -> 30.1 KB (**1.95x**) | 14.7 KB -> 20.2 KB (**1.37x**) |
| **`acorn`** | 240.9 KB -> 429.1 KB (1.78x) | 115.6 KB -> 280.9 KB (2.43x) | 33.9 KB -> 72.5 KB (**2.14x**) | 31.7 KB -> 42.0 KB (**1.32x**) |
| **`crc-32`** | 3.6 KB -> 6.7 KB (1.84x) | 2.0 KB -> 4.5 KB (2.25x) | 0.8 KB -> 1.2 KB (**1.51x**) | 0.8 KB -> 1.1 KB (**1.46x**) |
| **`marked`** | 49.4 KB -> 113.3 KB (2.29x) | 48.9 KB -> 106.6 KB (2.18x) | 14.5 KB -> 27.8 KB (**1.92x**) | 14.0 KB -> 17.6 KB (**1.26x**) |
| **`preact-ssr-app`** | 22.0 KB -> 46.2 KB (2.10x) | 21.2 KB -> 43.2 KB (2.04x) | 8.6 KB -> 12.8 KB (**1.49x**) | 8.5 KB -> 11.4 KB (**1.35x**) |
| **`yaml-router-app`** | 157.1 KB -> 249.7 KB (1.59x) | 51.8 KB -> 110.8 KB (2.14x) | 17.2 KB -> 33.4 KB (**1.94x**) | 16.6 KB -> 22.8 KB (**1.38x**) |
| **`moment-timezone`** | 913.3 KB -> 1824.0 KB (2.00x) | 778.7 KB -> 1632.4 KB (2.10x) | 55.0 KB -> 128.0 KB (**2.33x**) | 46.5 KB -> 75.1 KB (**1.61x**) |
| **`highlight-js`** | 1834.5 KB -> 4133.1 KB (2.25x) | 957.2 KB -> 2990.4 KB (3.12x) | 299.3 KB -> 757.8 KB (**2.53x**) | 257.2 KB -> 310.4 KB (**1.21x**) |

## 5. Diagnostics & Blockers Summary

### `lodash` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Date.now()" called during initialization (lodash.js:6783:21)
- **Compile resources**: 84 ms, peak RSS 79.7 MB
- **Location**: line 6783, column 21
- **Excerpt**: `var stamp = nativeNow(),`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `immutable` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (immutable.js:893:12)
- **Compile resources**: 71 ms, peak RSS 79.7 MB
- **Location**: line 893, column 12
- **Excerpt**: `((Math.random() * 0x100000) | 1) % 0x100000 || 0x9e37;`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `d3-scale` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "new Date()" without arguments called during initialization (d3-scale.js:3086:12)
- **Compile resources**: 69 ms, peak RSS 79.7 MB
- **Location**: line 3086, column 12
- **Excerpt**: `const t0 = new Date, t1 = new Date;`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `redux` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (redux.js:366:33)
- **Compile resources**: 74 ms, peak RSS 79.7 MB
- **Location**: line 366, column 33
- **Excerpt**: `randomString = () => Math.random().toString(36).substring(7).split("").join(".");`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `handlebars-app` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (handlebars-app.js:1302:16)
- **Compile resources**: 70 ms, peak RSS 79.8 MB
- **Location**: line 1302, column 16
- **Excerpt**: `, px = Math.random();`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `react-ssr-app` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Date.now()" called during initialization (react-ssr-app.js:20:236)
- **Compile resources**: 72 ms, peak RSS 79.7 MB
- **Location**: line 20, column 236
- **Excerpt**: `...unction(){return Ba.now()}}else{var ma=Date,Ca=ma.now();v=function(){return ma.now()-Ca}}var q=[],r=[],Da=1,n=null,k=3,F=!1,u=!1,z=!1,ja="fu...`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `prettier` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (prettier.js:1:5250)
- **Compile resources**: 99 ms, peak RSS 79.7 MB
- **Location**: line 1, column 5250
- **Excerpt**: `...)}});var un=xe((L0,Ds)=>{var _l=mt(),Pl=0,Il=Math.random(),kl=_l(1 .toString);Ds.exports=function(e){return"Symbol("+(e===void 0?"":e)+")_"+...`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `three` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (three.js:162:21)
- **Compile resources**: 106 ms, peak RSS 79.7 MB
- **Location**: line 162, column 21
- **Excerpt**: `const d0 = Math.random() * 4294967295 | 0;`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `mathjs` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (mathjs.js:43555:22)
- **Compile resources**: 135 ms, peak RSS 79.7 MB
- **Location**: line 43555, column 22
- **Excerpt**: `mixkey(math2.random(), pool);`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `babel-standalone` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "new Date()" without arguments called during initialization (babel-standalone.js:603:19)
- **Compile resources**: 170 ms, peak RSS 79.7 MB
- **Location**: line 603, column 19
- **Excerpt**: `var startTime = new Date();`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

### `typescript` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Date.now()" called during initialization (typescript.js:5174:18)
- **Compile resources**: 248 ms, peak RSS 90.1 MB
- **Location**: line 5174, column 18
- **Excerpt**: `var timeorigin = timestamp();`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:262:11)`

