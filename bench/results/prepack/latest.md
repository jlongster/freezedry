# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T10:15:47.067Z`
- **Prepack**: `/tmp/opencode/pp-wt/bench2/lib/prepack-node.js` (version `0.2.55-alpha.0`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30` (adaptRuns=`true`), `warmup=5`, `timeout=300000ms` (large=`900000ms`), `maxOldSpace=16384MB`
- **`node -e 0` Cold Process Baseline**: median **69.70 ms** (p90 81.20 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **22** | 15 standard + 7 large (17 libraries + 5 app workloads) |
| **OK (default options)** | **10** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **12** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **2** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **8** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded per-workload timeout (300s standard / 900s large) |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile (RSS) | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **OK** | **OK** | `default` | 17835 ms (511 MB) | — |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **FAIL** | **OK** | `jsc` | 975 ms (173 MB) | *(default FAIL)* `PP0001` @ L139:35: This operation is not yet supported on document at childNodes |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `default` | 2019 ms (215 MB) | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `default` | 1592 ms (209 MB) | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 19108 ms (753 MB) | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `default` | 1169 ms (206 MB) | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `default` | 1520 ms (213 MB) | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **FAIL** | **FAIL** | — | 305 ms (115 MB) | `PP0037` @ L57:2: failed to emit a residual loop: the loop calls an unknown or unsupported function in global cod |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **FAIL** | **FAIL** | — | 61 ms (93 MB) | `PP1004` @ L13:1309: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBindi |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **FAIL** | **FAIL** | — | 1169 ms (178 MB) | `UNDIAGNOSED_FATAL` (ResidualFunctions.spliceFunctions (lib/serializer/ResidualFunctions.js:602:23)): TODO: do not know how to deal with non-Identifier parameters |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **FAIL** | **OK** | `browser-seed` | 523 ms (121 MB) | *(default FAIL)* `PP0031` @ L366:74: property access on unknown object |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **WRONG** | **WRONG** | — | 810 ms (202 MB) | `PP0023` @ L2665:53: VM runtime threw: TypeError: not an object |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 722 ms (164 MB) | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **OK** | **OK** | `default` | 1960 ms (201 MB) | — |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 4355 ms (330 MB) | — |
| **`moment-timezone`** | moment@2.31.0 + moment-timezone@0.6.6 (MIT) | lib (large) | 913.3 KB | **OK** | **OK** | `default` | 3462 ms (377 MB) | — |
| **`prettier`** | prettier@2.8.8 (MIT) | lib (large) | 1065.6 KB | **FAIL** | **FAIL** | — | 40 ms (95 MB) | `PP1004` @ L1:694: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBindi |
| **`highlight-js`** | highlight.js@11.12.0 (BSD-3-Clause) | lib (large) | 1834.5 KB | **WRONG** | **WRONG** | — | 1000 ms (261 MB) | `PP0023` @ L54:36: VM runtime threw: TypeError: TypeError |
| **`three`** | three@0.187.0 (MIT) | lib (large) | 1914.4 KB | **FAIL** | **FAIL** | — | 2773 ms (467 MB) | `PP0037` @ L454:5: failed to emit a residual loop: PP0001: This operation is not yet supported on (some value) at  |
| **`mathjs`** | mathjs@15.2.0 (Apache-2.0) | lib (large) | 2117.9 KB | **FAIL** | **FAIL** | — | 128 ms (130 MB) | `PP1004` @ L9000:37: Syntax error: Identifier directly after number (9000:36) |
| **`babel-standalone`** | @babel/standalone@7.29.13 (MIT) | lib (large) | 5248.9 KB | **FAIL** | **FAIL** | — | 12875 ms (1055 MB) | `PP0037` @ L35867:3: failed to emit a residual loop: the loop calls an unknown or unsupported function in global cod |
| **`typescript`** | typescript@5.9.3 (Apache-2.0) | lib (large) | 8899.1 KB | **FAIL** | **FAIL** | — | 185 ms (125 MB) | `PP1004` @ L2387:27: Syntax error: This experimental syntax requires enabling the parser plugin: 'nullishCoalescingO |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | OK (872.3 KB) | OK (901.1 KB) | OK (901.1 KB) | FAIL (`PP0001`) | OK (901.1 KB) | OK (878.0 KB) |
| `underscore` | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | OK (78.2 KB) | FAIL (`PP0001`) | FAIL (`PP0001`) |
| `ramda` | OK (260.0 KB) | OK (270.7 KB) | OK (270.7 KB) | OK (249.5 KB) | OK (270.7 KB) | OK (263.0 KB) |
| `immutable` | OK (144.6 KB) | OK (152.5 KB) | OK (152.3 KB) | OK (144.4 KB) | OK (152.3 KB) | OK (146.0 KB) |
| `moment` | OK (642.6 KB) | OK (753.2 KB) | OK (753.2 KB) | OK (642.1 KB) | OK (753.2 KB) | OK (834.2 KB) |
| `chroma-js` | OK (87.2 KB) | OK (94.9 KB) | OK (94.9 KB) | OK (85.1 KB) | OK (94.9 KB) | OK (91.7 KB) |
| `acorn` | OK (271.4 KB) | OK (280.6 KB) | OK (280.6 KB) | OK (271.1 KB) | OK (280.6 KB) | OK (276.0 KB) |
| `crc-32` | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) |
| `marked` | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) |
| `d3-scale` | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) |
| `redux` | FAIL (`PP0031`) | FAIL (`PP0031`) | OK (14.6 KB) | OK (14.0 KB) | OK (14.6 KB) | OK (15.0 KB) |
| `handlebars-app` | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) |
| `preact-ssr-app` | OK (35.1 KB) | OK (37.4 KB) | OK (37.4 KB) | WRONG (`PP0023`) | WRONG (`PP0023`) | OK (36.0 KB) |
| `react-ssr-app` | OK (125.2 KB) | OK (151.9 KB) | OK (151.9 KB) | WRONG (`PP0023`) | OK (151.9 KB) | OK (131.1 KB) |
| `yaml-router-app` | OK (127.5 KB) | OK (136.5 KB) | OK (136.5 KB) | OK (127.2 KB) | OK (136.5 KB) | OK (137.5 KB) |
| `moment-timezone` | OK (1005.3 KB) | OK (1054.4 KB) | OK (1054.4 KB) | OK (1004.8 KB) | FAIL (`PP0031`) | OK (1066.9 KB) |
| `prettier` | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) |
| `highlight-js` | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) |
| `three` | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | WRONG (`PP0023`) | FAIL (`PP0037`) | FAIL (`PP0037`) |
| `mathjs` | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) |
| `babel-standalone` | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0001`) | FAIL (`PP0037`) | FAIL (`PP0037`) |
| `typescript` | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) |

## 2. Original Baseline Measurements (All Workloads)

Baseline timings and compressed sizes for every unmodified workload (including workloads where Prepack fails), covering **library load + deterministic smoke test**.

| Workload | N | Raw | Terser | Gzip | Brotli | Cold `node` Net Med (p90) | V8 `cachedData` Med (p90) | VM Exec-Only Med (p90) | V8 `--snapshot-blob` Net Med |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 30 | 533.1 KB | 69.0 KB | 24.5 KB | 23.6 KB | 38.83 (57.31) ms | 11.39 (27.20) ms | 3.82 (17.38) ms | 44.84 ms (7.2 MB) |
| **`underscore`** | 30 | 67.3 KB | 18.9 KB | 7.2 KB | 7.0 KB | 13.62 (27.46) ms | 1.02 (5.26) ms | 1.16 (5.05) ms | 23.53 ms (6.2 MB) |
| **`ramda`** | 30 | 342.9 KB | 52.6 KB | 14.1 KB | 13.6 KB | 5.10 (20.09) ms | 3.55 (8.48) ms | 2.81 (7.51) ms | 23.16 ms (6.7 MB) |
| **`immutable`** | 30 | 175.4 KB | 64.9 KB | 18.0 KB | 17.3 KB | 16.18 (40.14) ms | 1.38 (1.67) ms | 1.39 (1.80) ms | 8.67 ms (6.4 MB) |
| **`moment`** | 30 | 637.8 KB | 292.3 KB | 74.3 KB | 62.6 KB | 24.81 (28.55) ms | 11.38 (11.99) ms | 10.91 (11.32) ms | 13.99 ms (7.7 MB) |
| **`chroma-js`** | 30 | 109.2 KB | 42.5 KB | 15.4 KB | 14.7 KB | 6.17 (30.78) ms | 0.82 (3.61) ms | 0.91 (3.44) ms | 6.93 ms (6.1 MB) |
| **`acorn`** | 30 | 240.9 KB | 115.6 KB | 33.9 KB | 31.7 KB | 9.38 (14.59) ms | 1.57 (3.06) ms | 1.55 (1.80) ms | 10.18 ms (6.6 MB) |
| **`crc-32`** | 30 | 3.6 KB | 2.0 KB | 0.8 KB | 0.8 KB | 0.00 (3.46) ms | 0.31 (0.54) ms | 0.48 (0.53) ms | 5.33 ms (6.0 MB) |
| **`marked`** | 30 | 49.4 KB | 48.9 KB | 14.5 KB | 14.0 KB | 34.39 (40.30) ms | 1.28 (1.60) ms | 1.22 (1.41) ms | 27.60 ms (6.1 MB) |
| **`d3-scale`** | 30 | 148.9 KB | 71.1 KB | 23.0 KB | 22.2 KB | 6.00 (13.99) ms | 1.17 (1.28) ms | 1.17 (1.24) ms | 7.20 ms (6.4 MB) |
| **`redux`** | 30 | 18.1 KB | 8.8 KB | 3.3 KB | 3.2 KB | 0.66 (4.12) ms | 0.36 (0.44) ms | 0.34 (0.41) ms | 4.16 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 211.9 KB | 86.4 KB | 26.3 KB | 24.4 KB | 19.06 (63.74) ms | 3.51 (9.34) ms | 3.45 (3.63) ms | unsupported |
| **`preact-ssr-app`** | 30 | 22.0 KB | 21.2 KB | 8.6 KB | 8.5 KB | 2.58 (5.48) ms | 0.41 (0.49) ms | 0.43 (0.45) ms | 5.85 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 47.0 KB | 45.1 KB | 15.2 KB | 14.4 KB | 3.43 (55.60) ms | 1.47 (5.58) ms | 0.91 (2.14) ms | 9.89 ms (6.3 MB) |
| **`yaml-router-app`** | 30 | 157.1 KB | 51.8 KB | 17.2 KB | 16.6 KB | 11.80 (24.95) ms | 3.62 (7.62) ms | 3.69 (7.60) ms | 7.18 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 913.3 KB | 778.7 KB | 55.0 KB | 46.5 KB | 26.44 (39.97) ms | 9.32 (17.96) ms | 10.40 (21.35) ms | 21.10 ms (8.7 MB) |
| **`prettier`** | 15 | 1065.6 KB | 1029.4 KB | 290.4 KB | 229.1 KB | 123.95 (128.38) ms | 20.55 (40.19) ms | 22.74 (35.04) ms | 76.44 ms (8.0 MB) |
| **`highlight-js`** | 15 | 1834.5 KB | 957.2 KB | 299.3 KB | 257.2 KB | 105.03 (212.28) ms | 17.96 (40.58) ms | 51.92 (65.79) ms | unsupported |
| **`three`** | 15 | 1914.4 KB | 742.9 KB | 183.2 KB | 163.5 KB | 37.71 (59.71) ms | 5.09 (6.53) ms | 4.90 (7.17) ms | 15.39 ms (10.4 MB) |
| **`mathjs`** | 15 | 2117.9 KB | 839.6 KB | 212.5 KB | 187.9 KB | 264.24 (305.39) ms | 183.88 (226.15) ms | 190.07 (211.97) ms | unsupported |
| **`babel-standalone`** | 12 | 5248.9 KB | 2951.7 KB | 644.3 KB | 466.6 KB | 229.01 (286.59) ms | 69.02 (80.08) ms | 72.48 (79.44) ms | unsupported |
| **`typescript`** | 12 | 8899.1 KB | 3430.8 KB | 944.8 KB | 785.6 KB | 194.97 (214.17) ms | 23.02 (36.67) ms | 21.85 (38.92) ms | 88.39 ms (18.8 MB) |

## 3. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over interleaved runs. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | N | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---:|---|---|---|---|---|---|---|
| **`lodash`** | 30 | 38.83 (57.31) -> 44.58 (62.23) ms | **0.87x** | 11.39 (27.20) -> 5.54 (11.38) ms | **2.06x** | 3.82 (17.38) -> 2.65 (18.88) ms | **1.44x** | 44.84 ms (7.2 MB) |
| **`underscore`** | 30 | 13.62 (27.46) -> 4.59 (24.27) ms | **2.97x** | 1.02 (5.26) -> 1.63 (4.39) ms | **0.63x** | 1.16 (5.05) -> 1.74 (6.08) ms | **0.67x** | 23.53 ms (6.2 MB) |
| **`ramda`** | 30 | 5.10 (20.09) -> 15.71 (30.73) ms | **0.33x** | 3.55 (8.48) -> 3.53 (8.61) ms | **1.01x** | 2.81 (7.51) -> 1.71 (3.66) ms | **1.64x** | 23.16 ms (6.7 MB) |
| **`immutable`** | 30 | 16.18 (40.14) -> 16.72 (43.42) ms | **0.97x** | 1.38 (1.67) -> 1.29 (1.94) ms | **1.07x** | 1.39 (1.80) -> 1.31 (7.72) ms | **1.06x** | 8.67 ms (6.4 MB) |
| **`moment`** | 30 | 24.81 (28.55) -> 26.00 (29.99) ms | **0.95x** | 11.38 (11.99) -> 3.96 (4.41) ms | **2.87x** | 10.91 (11.32) -> 3.81 (3.94) ms | **2.86x** | 13.99 ms (7.7 MB) |
| **`chroma-js`** | 30 | 6.17 (30.78) -> 5.55 (23.00) ms | **1.11x** | 0.82 (3.61) -> 0.80 (2.36) ms | **1.03x** | 0.91 (3.44) -> 1.06 (5.00) ms | **0.86x** | 6.93 ms (6.1 MB) |
| **`acorn`** | 30 | 9.38 (14.59) -> 10.63 (14.45) ms | **0.88x** | 1.57 (3.06) -> 1.81 (3.00) ms | **0.87x** | 1.55 (1.80) -> 1.81 (2.64) ms | **0.85x** | 10.18 ms (6.6 MB) |
| **`redux`** | 30 | 0.66 (4.12) -> 0.88 (4.58) ms | **0.75x** | 0.36 (0.44) -> 0.31 (0.36) ms | **1.19x** | 0.34 (0.41) -> 0.29 (0.33) ms | **1.19x** | 4.16 ms (6.0 MB) |
| **`preact-ssr-app`** | 30 | 2.58 (5.48) -> 2.27 (8.59) ms | **1.14x** | 0.41 (0.49) -> 0.35 (0.40) ms | **1.18x** | 0.43 (0.45) -> 0.35 (0.46) ms | **1.25x** | 5.85 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 3.43 (55.60) -> 3.31 (46.59) ms | **1.04x** | 1.47 (5.58) -> 2.03 (4.13) ms | **0.72x** | 0.91 (2.14) -> 1.20 (2.36) ms | **0.76x** | 9.89 ms (6.3 MB) |
| **`yaml-router-app`** | 30 | 11.80 (24.95) -> 5.35 (12.80) ms | **2.20x** | 3.62 (7.62) -> 2.93 (7.56) ms | **1.24x** | 3.69 (7.60) -> 2.84 (5.19) ms | **1.30x** | 7.18 ms (6.4 MB) |
| **`moment-timezone`** | 15 | 26.44 (39.97) -> 28.17 (30.89) ms | **0.94x** | 9.32 (17.96) -> 8.89 (12.59) ms | **1.05x** | 10.40 (21.35) -> 9.53 (15.13) ms | **1.09x** | 21.10 ms (8.7 MB) |

## 4. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 872.3 KB (1.64x) | 69.0 KB -> 218.1 KB (3.16x) | 24.5 KB -> 50.7 KB (**2.07x**) | 23.6 KB -> 38.7 KB (**1.64x**) |
| **`underscore`** | 67.3 KB -> 78.2 KB (1.16x) | 18.9 KB -> 34.8 KB (1.84x) | 7.2 KB -> 8.0 KB (**1.11x**) | 7.0 KB -> 7.7 KB (**1.10x**) |
| **`ramda`** | 342.9 KB -> 260.0 KB (0.76x) | 52.6 KB -> 133.8 KB (2.54x) | 14.1 KB -> 22.9 KB (**1.62x**) | 13.6 KB -> 18.9 KB (**1.39x**) |
| **`immutable`** | 175.4 KB -> 144.6 KB (0.82x) | 64.9 KB -> 62.8 KB (0.97x) | 18.0 KB -> 17.9 KB (**1.00x**) | 17.3 KB -> 17.2 KB (**1.00x**) |
| **`moment`** | 637.8 KB -> 642.6 KB (1.01x) | 292.3 KB -> 352.3 KB (1.21x) | 74.3 KB -> 99.2 KB (**1.34x**) | 62.6 KB -> 82.9 KB (**1.32x**) |
| **`chroma-js`** | 109.2 KB -> 87.2 KB (0.80x) | 42.5 KB -> 42.2 KB (0.99x) | 15.4 KB -> 14.7 KB (**0.96x**) | 14.7 KB -> 14.2 KB (**0.96x**) |
| **`acorn`** | 240.9 KB -> 271.4 KB (1.13x) | 115.6 KB -> 164.8 KB (1.43x) | 33.9 KB -> 38.8 KB (**1.15x**) | 31.7 KB -> 33.8 KB (**1.07x**) |
| **`redux`** | 18.1 KB -> 14.6 KB (0.81x) | 8.8 KB -> 7.7 KB (0.87x) | 3.3 KB -> 3.0 KB (**0.89x**) | 3.2 KB -> 2.8 KB (**0.89x**) |
| **`preact-ssr-app`** | 22.0 KB -> 35.1 KB (1.60x) | 21.2 KB -> 22.0 KB (1.04x) | 8.6 KB -> 8.8 KB (**1.02x**) | 8.5 KB -> 8.6 KB (**1.01x**) |
| **`react-ssr-app`** | 47.0 KB -> 125.2 KB (2.66x) | 45.1 KB -> 79.4 KB (1.76x) | 15.2 KB -> 21.0 KB (**1.38x**) | 14.4 KB -> 18.5 KB (**1.29x**) |
| **`yaml-router-app`** | 157.1 KB -> 127.5 KB (0.81x) | 51.8 KB -> 59.4 KB (1.15x) | 17.2 KB -> 18.1 KB (**1.05x**) | 16.6 KB -> 17.4 KB (**1.05x**) |
| **`moment-timezone`** | 913.3 KB -> 1005.3 KB (1.10x) | 778.7 KB -> 863.7 KB (1.11x) | 55.0 KB -> 72.6 KB (**1.32x**) | 46.5 KB -> 59.9 KB (**1.29x**) |

## 5. Diagnostics & Blockers Summary

### `underscore` — default `FAIL`, overall `OK`
- **Code**: `PP0001`
- **Message**: This operation is not yet supported on document at childNodes
- **Compile resources**: 410 ms, peak RSS 127 MB
- **Location**: line 139, column 35
- **Excerpt**: `var nodelist = root.document && root.document.childNodes;`
- **Internal Prepack frame**: `PropertiesImplementation.OrdinaryGetOwnProperty (lib/methods/properties.js:1467:15)`
- **Workaround profile**: `jsc` (`--compatibility jsc-600-1-4-17 --mathRandomSeed 0`) -> **OK**

### `crc-32` — default `FAIL`, overall `FAIL`
- **Code**: `PP0037`
- **Message**: failed to emit a residual loop: the loop calls an unknown or unsupported function in global code (PP0002: might be an object with an unknown valueOf or toString or Symbol.toPrimitive method)
- **Compile resources**: 305 ms, peak RSS 115.1 MB
- **Location**: line 57, column 2
- **Excerpt**: `for(n = 1; n != 16; ++n) out[n - 1] = typeof Int32Array !== 'undefined' ? table.subarray(n...`
- **Internal Prepack frame**: `fail (lib/evaluators/residualLoop.js:387:9)`

### `marked` — default `FAIL`, overall `FAIL`
- **Code**: `PP1004`
- **Message**: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBinding' (13:1308)
- **Compile resources**: 61 ms, peak RSS 92.6 MB
- **Location**: line 13, column 1309
- **Excerpt**: `...)=>{try{return!!new RegExp("(?<=1)(?<!1)"+a)}catch{return!1}})(),T={codeRemoveIndent:/^(?: {0,3}\t| {1,4})/gm,outputLinkReplace:/\\([\[\]])/...`
- **Internal Prepack frame**: `LexicalEnvironment.concatenateAndParse (lib/environment.js:1003:21)`

### `d3-scale` — default `FAIL`, overall `FAIL`
- **Code**: `UNDIAGNOSED_FATAL`
- **Message**: TODO: do not know how to deal with non-Identifier parameters
- **Compile resources**: 1169 ms, peak RSS 178.2 MB
- **Internal Prepack frame**: `ResidualFunctions.spliceFunctions (lib/serializer/ResidualFunctions.js:602:23)`

### `redux` — default `FAIL`, overall `OK`
- **Code**: `PP0031`
- **Message**: property access on unknown object
- **Compile resources**: 287 ms, peak RSS 119.3 MB
- **Location**: line 366, column 74
- **Excerpt**: `...=> Math.random().toString(36).substring(7).split("").join(".");`
- **Internal Prepack frame**: `AbstractObjectValue.$Get (lib/values/AbstractObjectValue.js:647:13)`
- **Workaround profile**: `browser-seed` (`--compatibility browser --mathRandomSeed 0 --delayInitializations --inlineExpressions`) -> **OK**

### `handlebars-app` — default `WRONG`, overall `WRONG`
- **Code**: `PP0023`
- **Message**: VM runtime threw: TypeError: not an object
- **Compile resources**: 810 ms, peak RSS 201.7 MB
- **Location**: line 2665, column 53
- **Excerpt**: `...Object.prototype.__defineGetter__('__magic__', function () {`

### `prettier` — default `FAIL`, overall `FAIL`
- **Code**: `PP1004`
- **Message**: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBinding' (1:693)
- **Compile resources**: 40 ms, peak RSS 94.7 MB
- **Location**: line 1, column 694
- **Excerpt**: `...fu)=>{fu.exports=function(e){try{return!!e()}catch{return!0}}});var yt=xe((u0,Du)=>{var Mo=Dt();Du.exports=!Mo(function(){return Object.defi...`
- **Internal Prepack frame**: `LexicalEnvironment.concatenateAndParse (lib/environment.js:1003:21)`

### `highlight-js` — default `WRONG`, overall `WRONG`
- **Code**: `PP0023`
- **Message**: VM runtime threw: TypeError: TypeError
- **Compile resources**: 1000 ms, peak RSS 260.7 MB
- **Location**: line 54, column 36
- **Excerpt**: `Object.getOwnPropertyNames(obj).forEach((name) => {`

### `three` — default `FAIL`, overall `FAIL`
- **Code**: `PP0037`
- **Message**: failed to emit a residual loop: PP0001: This operation is not yet supported on (some value) at $ArrayBufferData (PP0001: This operation is not yet supported on (some value) at $ArrayBufferData)
- **Compile resources**: 2773 ms, peak RSS 467.2 MB
- **Location**: line 454, column 5
- **Excerpt**: `for (let i = 0; i < 256; ++i) {`
- **Internal Prepack frame**: `fail (lib/evaluators/residualLoop.js:387:9)`

### `mathjs` — default `FAIL`, overall `FAIL`
- **Code**: `PP1004`
- **Message**: Syntax error: Identifier directly after number (9000:36)
- **Compile resources**: 128 ms, peak RSS 129.8 MB
- **Location**: line 9000, column 37
- **Excerpt**: `Fraction: (r) => r.d === 1n,`
- **Internal Prepack frame**: `LexicalEnvironment.concatenateAndParse (lib/environment.js:1003:21)`

### `babel-standalone` — default `FAIL`, overall `FAIL`
- **Code**: `PP0037`
- **Message**: failed to emit a residual loop: the loop calls an unknown or unsupported function in global code (PP0001: This operation is not yet supported on (some value) at $ArrayBufferData)
- **Compile resources**: 12875 ms, peak RSS 1054.9 MB
- **Location**: line 35867, column 3
- **Excerpt**: `for (var i$1 = 0; i$1 < chars.length; i$1++) {`
- **Internal Prepack frame**: `fail (lib/evaluators/residualLoop.js:387:9)`

### `typescript` — default `FAIL`, overall `FAIL`
- **Code**: `PP1004`
- **Message**: Syntax error: This experimental syntax requires enabling the parser plugin: 'nullishCoalescingOperator' (2387:26)
- **Compile resources**: 185 ms, peak RSS 125.4 MB
- **Location**: line 2387, column 27
- **Excerpt**: `for (let i = startIndex ?? 0; i < array.length; i++) {`
- **Internal Prepack frame**: `LexicalEnvironment.concatenateAndParse (lib/environment.js:1003:21)`

