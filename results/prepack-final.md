# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T19:17:57.558Z`
- **Prepack**: `/tmp/opencode/pp-work/lib/prepack-node.js` (version `0.2.55-alpha.0`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30` (adaptRuns=`true`), `warmup=5`, `timeout=300000ms` (large=`900000ms`), `maxOldSpace=8192MB`
- **`node -e 0` Cold Process Baseline**: median **29.05 ms** (p90 31.99 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **22** | 15 standard + 7 large (17 libraries + 5 app workloads) |
| **OK (default options)** | **15** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **18** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **0** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **4** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded per-workload timeout (300s standard / 900s large) |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile (RSS) | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **FAIL** | **OK** | `browser-opt` | 2773 ms (313 MB) | *(default FAIL)* `PP0012` @ L17008:5: member expression object abstract value   is unknown |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **OK** | **OK** | `browser-opt` | 884 ms (197 MB) | — |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `browser-opt` | 842 ms (216 MB) | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `browser-opt` | 781 ms (222 MB) | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `browser-opt` | 5137 ms (624 MB) | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `browser-opt` | 572 ms (195 MB) | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `browser-opt` | 1024 ms (217 MB) | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **OK** | **OK** | `browser-opt` | 524 ms (136 MB) | — |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **OK** | **OK** | `browser-opt` | 486 ms (183 MB) | — |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **OK** | **OK** | `browser-opt` | 914 ms (206 MB) | — |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **OK** | **OK** | `default` | 363 ms (130 MB) | — |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **FAIL** | **OK** | `browser-opt` | 3627 ms (346 MB) | *(default FAIL)* `INVARIANT` (invariant (lib/invariant.js:24:15)):  |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `browser-opt` | 489 ms (165 MB) | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **OK** | **OK** | `browser-opt` | 1576 ms (214 MB) | — |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `browser-opt` | 2482 ms (323 MB) | — |
| **`moment-timezone`** | moment@2.31.0 + moment-timezone@0.6.6 (MIT) | lib (large) | 913.3 KB | **FAIL** | **OK** | `browser-opt` | 2937 ms (353 MB) | *(default FAIL)* `PP0002` @ L5975:86: might be an object with an unknown valueOf or toString or Symbol.toPrimitive method |
| **`prettier`** | prettier@2.8.8 (MIT) | lib (large) | 1065.6 KB | **FAIL** | **FAIL** | — | 2756 ms (425 MB) | `PP0001` @ L1:3157: This operation is not yet supported on abstract value global  |
| **`highlight-js`** | highlight.js@11.12.0 (BSD-3-Clause) | lib (large) | 1834.5 KB | **OK** | **OK** | `default` | 11520 ms (705 MB) | — |
| **`three`** | three@0.187.0 (MIT) | lib (large) | 1914.4 KB | **OK** | **OK** | `default` | 6080 ms (615 MB) | — |
| **`mathjs`** | mathjs@15.2.0 (Apache-2.0) | lib (large) | 2117.9 KB | **FAIL** | **FAIL** | — | 5525 ms (515 MB) | `PP0001` @ L43553:47: This operation is not yet supported on abstract value   |
| **`babel-standalone`** | @babel/standalone@7.29.13 (MIT) | lib (large) | 5248.9 KB | **FAIL** | **FAIL** | — | 7462 ms (1085 MB) | `PP0001` @ L31989:66: This operation is not yet supported on abstract value   |
| **`typescript`** | typescript@5.9.3 (Apache-2.0) | lib (large) | 8899.1 KB | **FAIL** | **FAIL** | — | 8693 ms (1308 MB) | `PP0001` @ L8490:31: This operation is not yet supported on abstract value   |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | FAIL (`PP0012`) | OK (538.5 KB) | OK (538.5 KB) | FAIL (`PP0001`) | OK (538.5 KB) | OK (761.2 KB) |
| `underscore` | OK (220.0 KB) | OK (68.6 KB) | OK (68.6 KB) | OK (67.6 KB) | OK (68.6 KB) | OK (71.4 KB) |
| `ramda` | OK (878.9 KB) | OK (137.4 KB) | OK (137.4 KB) | OK (135.8 KB) | OK (137.4 KB) | OK (138.5 KB) |
| `immutable` | OK (443.4 KB) | OK (144.6 KB) | OK (144.4 KB) | OK (143.4 KB) | OK (144.4 KB) | OK (145.2 KB) |
| `moment` | OK (1586.8 KB) | OK (669.3 KB) | OK (669.3 KB) | OK (594.0 KB) | OK (669.3 KB) | OK (800.3 KB) |
| `chroma-js` | OK (238.8 KB) | OK (85.4 KB) | OK (85.4 KB) | OK (83.6 KB) | OK (85.4 KB) | OK (88.6 KB) |
| `acorn` | OK (633.2 KB) | OK (252.0 KB) | OK (252.0 KB) | OK (249.8 KB) | OK (252.0 KB) | OK (256.4 KB) |
| `crc-32` | OK (159.6 KB) | OK (105.0 KB) | OK (105.0 KB) | OK (103.9 KB) | OK (105.0 KB) | OK (104.8 KB) |
| `marked` | OK (230.2 KB) | OK (74.2 KB) | OK (74.2 KB) | FAIL (`PP0001`) | OK (74.2 KB) | OK (83.8 KB) |
| `d3-scale` | OK (522.7 KB) | OK (184.1 KB) | OK (184.1 KB) | FAIL (`PP0023`) | OK (184.1 KB) | OK (184.6 KB) |
| `redux` | OK (14.4 KB) | OK (14.7 KB) | OK (14.4 KB) | OK (14.0 KB) | OK (14.4 KB) | OK (15.0 KB) |
| `handlebars-app` | FAIL (`INVARIANT`) | OK (202.1 KB) | OK (202.1 KB) | OK (197.0 KB) | OK (202.1 KB) | OK (245.1 KB) |
| `preact-ssr-app` | OK (75.9 KB) | OK (35.9 KB) | OK (35.9 KB) | FAIL (`PP0001`) | FAIL (`PP0023`) | OK (35.4 KB) |
| `react-ssr-app` | OK (285.7 KB) | OK (94.9 KB) | OK (94.9 KB) | FAIL (`PP0023`) | OK (94.9 KB) | OK (96.3 KB) |
| `yaml-router-app` | OK (333.9 KB) | OK (124.9 KB) | OK (124.9 KB) | OK (121.8 KB) | OK (124.9 KB) | OK (134.1 KB) |
| `moment-timezone` | FAIL (`PP0002`) | OK (1001.2 KB) | OK (1001.2 KB) | OK (970.6 KB) | FAIL (`PP0031`) | OK (1045.6 KB) |
| `prettier` | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0023`) | FAIL (`PP0001`) | FAIL (`PP0001`) |
| `highlight-js` | OK (2577.1 KB) | OK (2831.3 KB) | OK (2831.3 KB) | FAIL (`PP0023`) | OK (2831.3 KB) | OK (3157.1 KB) |
| `three` | OK (1479.4 KB) | OK (1560.8 KB) | OK (1541.0 KB) | FAIL (`PP0023`) | OK (1541.0 KB) | OK (1571.2 KB) |
| `mathjs` | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) |
| `babel-standalone` | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) |
| `typescript` | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0023`) | FAIL (`PP0031`) | FAIL (`PP0001`) |

## 2. Original Baseline Measurements (All Workloads)

Baseline timings and compressed sizes for every unmodified workload (including workloads where Prepack fails), covering **library load + deterministic smoke test**.

| Workload | N | Raw | Terser | Gzip | Brotli | Cold `node` Net Med (p90) | V8 `cachedData` Med (p90) | VM Exec-Only Med (p90) | V8 `--snapshot-blob` Net Med |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 30 | 533.1 KB | 69.0 KB | 24.5 KB | 23.6 KB | 16.56 (27.34) ms | 3.50 (6.88) ms | 3.48 (3.72) ms | 12.88 ms (7.2 MB) |
| **`underscore`** | 30 | 67.3 KB | 18.9 KB | 7.2 KB | 7.0 KB | 0.82 (7.40) ms | 0.65 (0.81) ms | 0.59 (1.03) ms | 6.90 ms (6.2 MB) |
| **`ramda`** | 30 | 342.9 KB | 52.6 KB | 14.1 KB | 13.6 KB | 3.94 (11.99) ms | 0.83 (0.98) ms | 0.99 (2.81) ms | 6.07 ms (6.7 MB) |
| **`immutable`** | 30 | 175.4 KB | 64.9 KB | 18.0 KB | 17.3 KB | 5.74 (12.49) ms | 1.50 (2.52) ms | 1.31 (1.38) ms | 10.90 ms (6.4 MB) |
| **`moment`** | 30 | 637.8 KB | 292.3 KB | 74.3 KB | 62.6 KB | 25.55 (32.22) ms | 11.33 (12.63) ms | 11.07 (11.50) ms | 15.68 ms (7.7 MB) |
| **`chroma-js`** | 30 | 109.2 KB | 42.5 KB | 15.4 KB | 14.7 KB | 2.05 (13.64) ms | 1.07 (1.23) ms | 0.99 (1.26) ms | 9.61 ms (6.1 MB) |
| **`acorn`** | 30 | 240.9 KB | 115.6 KB | 33.9 KB | 31.7 KB | 8.93 (15.00) ms | 1.93 (3.87) ms | 1.72 (4.07) ms | 13.20 ms (6.6 MB) |
| **`crc-32`** | 30 | 3.6 KB | 2.0 KB | 0.8 KB | 0.8 KB | 2.35 (7.17) ms | 0.33 (0.61) ms | 0.34 (0.54) ms | 6.25 ms (6.0 MB) |
| **`marked`** | 30 | 49.4 KB | 48.9 KB | 14.5 KB | 14.0 KB | 37.27 (55.68) ms | 1.33 (1.62) ms | 1.21 (1.33) ms | 30.71 ms (6.1 MB) |
| **`d3-scale`** | 30 | 148.9 KB | 71.1 KB | 23.0 KB | 22.2 KB | 3.64 (15.01) ms | 1.23 (1.58) ms | 0.96 (1.13) ms | 9.06 ms (6.4 MB) |
| **`redux`** | 30 | 18.1 KB | 8.8 KB | 3.3 KB | 3.2 KB | 0.54 (10.35) ms | 0.40 (0.43) ms | 0.30 (0.34) ms | 6.83 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 211.9 KB | 86.4 KB | 26.3 KB | 24.4 KB | 17.04 (21.71) ms | 3.37 (3.58) ms | 3.58 (6.07) ms | unsupported |
| **`preact-ssr-app`** | 30 | 22.0 KB | 21.2 KB | 8.6 KB | 8.5 KB | 2.07 (6.18) ms | 0.41 (0.54) ms | 0.40 (0.51) ms | 5.78 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 47.0 KB | 45.1 KB | 15.2 KB | 14.4 KB | 4.83 (15.39) ms | 1.03 (1.22) ms | 0.93 (3.25) ms | 7.44 ms (6.2 MB) |
| **`yaml-router-app`** | 30 | 157.1 KB | 51.8 KB | 17.2 KB | 16.6 KB | 9.66 (13.65) ms | 2.34 (3.24) ms | 1.75 (2.21) ms | 7.54 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 913.3 KB | 778.7 KB | 55.0 KB | 46.5 KB | 24.11 (27.75) ms | 9.74 (15.48) ms | 7.78 (8.50) ms | 23.74 ms (8.7 MB) |
| **`prettier`** | 15 | 1065.6 KB | 1029.4 KB | 290.4 KB | 229.1 KB | 123.51 (133.62) ms | 17.24 (22.28) ms | 17.69 (26.18) ms | 68.31 ms (8.0 MB) |
| **`highlight-js`** | 15 | 1834.5 KB | 957.2 KB | 299.3 KB | 257.2 KB | 89.66 (101.92) ms | 15.74 (22.46) ms | 16.85 (24.95) ms | unsupported |
| **`three`** | 15 | 1914.4 KB | 742.9 KB | 183.2 KB | 163.5 KB | 36.48 (38.96) ms | 4.68 (5.77) ms | 4.64 (5.20) ms | 48.86 ms (10.4 MB) |
| **`mathjs`** | 15 | 2117.9 KB | 839.6 KB | 212.5 KB | 187.9 KB | 396.32 (568.52) ms | 322.85 (367.83) ms | 326.45 (429.23) ms | unsupported |
| **`babel-standalone`** | 12 | 5248.9 KB | 2951.7 KB | 644.3 KB | 466.6 KB | 391.28 (425.91) ms | 81.95 (100.54) ms | 65.44 (69.40) ms | unsupported |
| **`typescript`** | 12 | 8899.1 KB | 3430.8 KB | 944.8 KB | 785.6 KB | 284.33 (354.73) ms | 38.79 (101.22) ms | 28.10 (41.39) ms | 170.80 ms (18.8 MB) |

## 3. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over interleaved runs. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | N | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---:|---|---|---|---|---|---|---|
| **`lodash`** | 30 | 16.56 (27.34) -> 17.43 (25.92) ms | **0.95x** | 3.50 (6.88) -> 4.39 (4.86) ms | **0.80x** | 3.48 (3.72) -> 3.45 (11.09) ms | **1.01x** | 12.88 ms (7.2 MB) |
| **`underscore`** | 30 | 0.82 (7.40) -> 1.54 (5.59) ms | **0.53x** | 0.65 (0.81) -> 0.63 (0.71) ms | **1.02x** | 0.59 (1.03) -> 0.59 (1.37) ms | **1.00x** | 6.90 ms (6.2 MB) |
| **`ramda`** | 30 | 3.94 (11.99) -> 4.03 (8.38) ms | **0.98x** | 0.83 (0.98) -> 0.47 (0.50) ms | **1.76x** | 0.99 (2.81) -> 0.56 (1.45) ms | **1.78x** | 6.07 ms (6.7 MB) |
| **`immutable`** | 30 | 5.74 (12.49) -> 6.34 (8.97) ms | **0.91x** | 1.50 (2.52) -> 1.33 (2.14) ms | **1.12x** | 1.31 (1.38) -> 1.16 (1.29) ms | **1.13x** | 10.90 ms (6.4 MB) |
| **`moment`** | 30 | 25.55 (32.22) -> 25.20 (28.93) ms | **1.01x** | 11.33 (12.63) -> 2.48 (2.63) ms | **4.56x** | 11.07 (11.50) -> 2.47 (2.71) ms | **4.49x** | 15.68 ms (7.7 MB) |
| **`chroma-js`** | 30 | 2.05 (13.64) -> 4.34 (18.15) ms | **0.47x** | 1.07 (1.23) -> 0.97 (1.27) ms | **1.09x** | 0.99 (1.26) -> 0.89 (1.23) ms | **1.11x** | 9.61 ms (6.1 MB) |
| **`acorn`** | 30 | 8.93 (15.00) -> 9.06 (15.54) ms | **0.98x** | 1.93 (3.87) -> 1.60 (3.81) ms | **1.21x** | 1.72 (4.07) -> 1.42 (2.58) ms | **1.21x** | 13.20 ms (6.6 MB) |
| **`crc-32`** | 30 | 2.35 (7.17) -> 1.40 (4.51) ms | **1.68x** | 0.33 (0.61) -> 0.25 (0.28) ms | **1.31x** | 0.34 (0.54) -> 0.23 (0.24) ms | **1.49x** | 6.25 ms (6.0 MB) |
| **`marked`** | 30 | 37.27 (55.68) -> 35.42 (63.73) ms | **1.05x** | 1.33 (1.62) -> 1.30 (1.57) ms | **1.02x** | 1.21 (1.33) -> 1.22 (1.35) ms | **0.99x** | 30.71 ms (6.1 MB) |
| **`d3-scale`** | 30 | 3.64 (15.01) -> 6.17 (19.28) ms | **0.59x** | 1.23 (1.58) -> 0.76 (3.59) ms | **1.62x** | 0.96 (1.13) -> 0.56 (1.63) ms | **1.71x** | 9.06 ms (6.4 MB) |
| **`redux`** | 30 | 0.54 (10.35) -> 0.11 (7.79) ms | **4.97x** | 0.40 (0.43) -> 0.32 (0.34) ms | **1.26x** | 0.30 (0.34) -> 0.25 (0.31) ms | **1.22x** | 6.83 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 17.04 (21.71) -> 5.62 (8.72) ms | **3.03x** | 3.37 (3.58) -> 1.11 (1.18) ms | **3.04x** | 3.58 (6.07) -> 1.11 (1.69) ms | **3.21x** | n/a |
| **`preact-ssr-app`** | 30 | 2.07 (6.18) -> 1.30 (8.11) ms | **1.58x** | 0.41 (0.54) -> 0.34 (0.37) ms | **1.20x** | 0.40 (0.51) -> 0.34 (0.35) ms | **1.21x** | 5.78 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 4.83 (15.39) -> 5.41 (11.15) ms | **0.89x** | 1.03 (1.22) -> 0.68 (0.80) ms | **1.52x** | 0.93 (3.25) -> 0.61 (0.99) ms | **1.51x** | 7.44 ms (6.2 MB) |
| **`yaml-router-app`** | 30 | 9.66 (13.65) -> 3.75 (11.43) ms | **2.58x** | 2.34 (3.24) -> 0.83 (3.50) ms | **2.82x** | 1.75 (2.21) -> 0.67 (0.88) ms | **2.62x** | 7.54 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 24.11 (27.75) -> 21.84 (26.72) ms | **1.10x** | 9.74 (15.48) -> 6.41 (7.85) ms | **1.52x** | 7.78 (8.50) -> 5.64 (8.22) ms | **1.38x** | 23.74 ms (8.7 MB) |
| **`highlight-js`** | 15 | 89.66 (101.92) -> 83.40 (107.27) ms | **1.07x** | 15.74 (22.46) -> 12.73 (19.80) ms | **1.24x** | 16.85 (24.95) -> 13.06 (22.89) ms | **1.29x** | n/a |
| **`three`** | 15 | 36.48 (38.96) -> 36.77 (38.13) ms | **0.99x** | 4.68 (5.77) -> 4.82 (5.17) ms | **0.97x** | 4.64 (5.20) -> 5.04 (6.76) ms | **0.92x** | 48.86 ms (10.4 MB) |

## 4. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 538.5 KB (1.01x) | 69.0 KB -> 73.2 KB (1.06x) | 24.5 KB -> 23.9 KB (**0.98x**) | 23.6 KB -> 23.0 KB (**0.97x**) |
| **`underscore`** | 67.3 KB -> 68.6 KB (1.02x) | 18.9 KB -> 33.6 KB (1.78x) | 7.2 KB -> 8.1 KB (**1.12x**) | 7.0 KB -> 7.8 KB (**1.11x**) |
| **`ramda`** | 342.9 KB -> 137.4 KB (0.40x) | 52.6 KB -> 65.7 KB (1.25x) | 14.1 KB -> 15.6 KB (**1.10x**) | 13.6 KB -> 14.4 KB (**1.06x**) |
| **`immutable`** | 175.4 KB -> 144.6 KB (0.82x) | 64.9 KB -> 63.2 KB (0.97x) | 18.0 KB -> 17.9 KB (**0.99x**) | 17.3 KB -> 17.2 KB (**1.00x**) |
| **`moment`** | 637.8 KB -> 669.3 KB (1.05x) | 292.3 KB -> 338.7 KB (1.16x) | 74.3 KB -> 98.4 KB (**1.32x**) | 62.6 KB -> 83.6 KB (**1.33x**) |
| **`chroma-js`** | 109.2 KB -> 85.4 KB (0.78x) | 42.5 KB -> 40.6 KB (0.96x) | 15.4 KB -> 14.5 KB (**0.94x**) | 14.7 KB -> 14.0 KB (**0.95x**) |
| **`acorn`** | 240.9 KB -> 252.0 KB (1.05x) | 115.6 KB -> 152.8 KB (1.32x) | 33.9 KB -> 36.5 KB (**1.07x**) | 31.7 KB -> 33.0 KB (**1.04x**) |
| **`crc-32`** | 3.6 KB -> 105.0 KB (29.03x) | 2.0 KB -> 93.7 KB (46.87x) | 0.8 KB -> 44.0 KB (**55.12x**) | 0.8 KB -> 22.1 KB (**28.74x**) |
| **`marked`** | 49.4 KB -> 74.2 KB (1.50x) | 48.9 KB -> 48.8 KB (1.00x) | 14.5 KB -> 14.4 KB (**0.99x**) | 14.0 KB -> 13.9 KB (**0.99x**) |
| **`d3-scale`** | 148.9 KB -> 184.1 KB (1.24x) | 71.1 KB -> 89.8 KB (1.26x) | 23.0 KB -> 28.8 KB (**1.25x**) | 22.2 KB -> 26.2 KB (**1.18x**) |
| **`redux`** | 18.1 KB -> 14.4 KB (0.80x) | 8.8 KB -> 7.5 KB (0.85x) | 3.3 KB -> 2.9 KB (**0.87x**) | 3.2 KB -> 2.8 KB (**0.87x**) |
| **`handlebars-app`** | 211.9 KB -> 202.1 KB (0.95x) | 86.4 KB -> 95.2 KB (1.10x) | 26.3 KB -> 26.7 KB (**1.02x**) | 24.4 KB -> 24.7 KB (**1.01x**) |
| **`preact-ssr-app`** | 22.0 KB -> 35.9 KB (1.63x) | 21.2 KB -> 22.1 KB (1.04x) | 8.6 KB -> 8.8 KB (**1.01x**) | 8.5 KB -> 8.6 KB (**1.01x**) |
| **`react-ssr-app`** | 47.0 KB -> 94.9 KB (2.02x) | 45.1 KB -> 56.6 KB (1.25x) | 15.2 KB -> 17.8 KB (**1.17x**) | 14.4 KB -> 16.8 KB (**1.17x**) |
| **`yaml-router-app`** | 157.1 KB -> 124.9 KB (0.80x) | 51.8 KB -> 57.7 KB (1.11x) | 17.2 KB -> 17.6 KB (**1.02x**) | 16.6 KB -> 17.1 KB (**1.03x**) |
| **`moment-timezone`** | 913.3 KB -> 1001.2 KB (1.10x) | 778.7 KB -> 857.3 KB (1.10x) | 55.0 KB -> 73.8 KB (**1.34x**) | 46.5 KB -> 59.4 KB (**1.28x**) |
| **`highlight-js`** | 1834.5 KB -> 2577.1 KB (1.41x) | 957.2 KB -> 1924.1 KB (2.01x) | 299.3 KB -> 595.5 KB (**1.99x**) | 257.2 KB -> 309.3 KB (**1.20x**) |
| **`three`** | 1914.4 KB -> 1479.4 KB (0.77x) | 742.9 KB -> 840.7 KB (1.13x) | 183.2 KB -> 206.4 KB (**1.13x**) | 163.5 KB -> 174.8 KB (**1.07x**) |

## 5. Diagnostics & Blockers Summary

### `lodash` — default `FAIL`, overall `OK`
- **Code**: `PP0012`
- **Message**: member expression object abstract value   is unknown
- **Compile resources**: 80230 ms, peak RSS 1281.7 MB
- **Location**: line 17008, column 5
- **Excerpt**: `lodash.VERSION = VERSION;`
- **Internal Prepack frame**: `RequireObjectCoercible (lib/methods/abstract.js:105:13)`
- **Workaround profile**: `browser-opt` (`--compatibility browser --delayInitializations --inlineExpressions`) -> **OK**

### `handlebars-app` — default `FAIL`, overall `OK`
- **Code**: `INVARIANT`
- **Message**: 
- **Compile resources**: 2442 ms, peak RSS 275.8 MB
- **Internal Prepack frame**: `invariant (lib/invariant.js:24:15)`
- **Workaround profile**: `browser-opt` (`--compatibility browser --delayInitializations --inlineExpressions`) -> **OK**

### `moment-timezone` — default `FAIL`, overall `OK`
- **Code**: `PP0002`
- **Message**: might be an object with an unknown valueOf or toString or Symbol.toPrimitive method
- **Compile resources**: 7509 ms, peak RSS 582.4 MB
- **Location**: line 5975, column 86
- **Excerpt**: `...s Moment.js >= 2.6.0. You are using Moment.js ' + moment.version + '. See momentjs.com');`
- **Workaround profile**: `browser-opt` (`--compatibility browser --delayInitializations --inlineExpressions`) -> **OK**

### `prettier` — default `FAIL`, overall `FAIL`
- **Code**: `PP0001`
- **Message**: This operation is not yet supported on abstract value global 
- **Compile resources**: 2756 ms, peak RSS 425.2 MB
- **Location**: line 1, column 3157
- **Excerpt**: `...&&dt[0]<4?1:+(dt[0]+dt[1]));!fr&&Kr&&(dt=Kr.match(/Edge\/(\d+)/),(!dt||dt[1]>=74)&&(dt=Kr.match(/Chrome\/(\d+)/),dt&&(fr=+dt[1])));Uu.export...`
- **Internal Prepack frame**: `AbstractValue.throwIfNotConcrete (lib/values/AbstractValue.js:573:11)`

### `mathjs` — default `FAIL`, overall `FAIL`
- **Code**: `PP0001`
- **Message**: This operation is not yet supported on abstract value  
- **Compile resources**: 5525 ms, peak RSS 515.3 MB
- **Location**: line 43553, column 47
- **Excerpt**: `return String.fromCharCode.apply(0, a);`
- **Internal Prepack frame**: `ToImplementation.ToNumber (lib/methods/to.js:492:13)`

### `babel-standalone` — default `FAIL`, overall `FAIL`
- **Code**: `PP0001`
- **Message**: This operation is not yet supported on abstract value  
- **Compile resources**: 7462 ms, peak RSS 1085.1 MB
- **Location**: line 31989, column 66
- **Excerpt**: `...= (typeof namespaces === 'string' ? namespaces : '').trim().replace(/\s+/g, ',').split(',').filter(Boolean);`
- **Internal Prepack frame**: `AbstractValue.throwIfNotConcreteObject (lib/values/AbstractValue.js:598:11)`

### `typescript` — default `FAIL`, overall `FAIL`
- **Code**: `PP0001`
- **Message**: This operation is not yet supported on abstract value  
- **Compile resources**: 8693 ms, peak RSS 1308.4 MB
- **Location**: line 8490, column 31
- **Excerpt**: `return s.replace(/\w/g, (ch) => {`
- **Internal Prepack frame**: `AbstractValue.throwIfNotConcrete (lib/values/AbstractValue.js:573:11)`

