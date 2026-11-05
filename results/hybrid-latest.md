# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T07:48:05.444Z`
- **Prepack**: `/tmp/opencode/pp-wt/hybrid-verify/hybrid/index.js` (version `0.0.1-hybrid`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=10`, `warmup=3`, `timeout=300000ms`
- **`node -e 0` Cold Process Baseline**: median **35.64 ms** (p90 66.96 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **15** | 10 libraries + 5 init-heavy app workloads |
| **OK (default options)** | **15** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **15** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **0** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **0** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded 300s per-lib cap |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **OK** | **OK** | `default` | 0 ms | — |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `default` | 0 ms | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `default` | 0 ms | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `default` | 0 ms | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **OK** | **OK** | `default` | 16 ms | — |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **OK** | **OK** | `default` | 1 ms | — |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 1 ms | — |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | OK (533.1 KB) | OK (533.1 KB) | OK (533.1 KB) | OK (533.1 KB) | OK (533.1 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `underscore` | OK (67.3 KB) | OK (67.3 KB) | OK (67.3 KB) | OK (67.3 KB) | OK (67.3 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `ramda` | OK (342.9 KB) | OK (342.9 KB) | OK (342.9 KB) | OK (342.9 KB) | OK (342.9 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `immutable` | OK (175.4 KB) | OK (175.4 KB) | OK (175.4 KB) | OK (175.4 KB) | OK (175.4 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `moment` | OK (637.8 KB) | OK (637.8 KB) | OK (637.8 KB) | OK (637.8 KB) | OK (637.8 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `chroma-js` | OK (109.2 KB) | OK (109.2 KB) | OK (109.2 KB) | OK (109.2 KB) | OK (109.2 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `acorn` | OK (240.9 KB) | OK (240.9 KB) | FAIL (`WORKER_CRASH`) | OK (240.9 KB) | OK (240.9 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `crc-32` | OK (3.6 KB) | OK (3.6 KB) | OK (3.6 KB) | OK (3.6 KB) | OK (3.6 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `marked` | OK (49.4 KB) | OK (49.4 KB) | OK (49.4 KB) | OK (49.4 KB) | OK (49.4 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `d3-scale` | OK (148.9 KB) | OK (148.9 KB) | OK (148.9 KB) | OK (148.9 KB) | OK (148.9 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `redux` | OK (18.1 KB) | OK (18.1 KB) | OK (18.1 KB) | OK (18.1 KB) | OK (18.1 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `handlebars-app` | OK (211.9 KB) | OK (211.9 KB) | OK (211.9 KB) | OK (211.9 KB) | OK (211.9 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `preact-ssr-app` | OK (22.0 KB) | OK (22.0 KB) | OK (22.0 KB) | OK (22.0 KB) | OK (22.0 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `react-ssr-app` | OK (47.0 KB) | OK (47.0 KB) | OK (47.0 KB) | OK (47.0 KB) | OK (47.0 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `yaml-router-app` | OK (157.1 KB) | OK (157.1 KB) | OK (157.1 KB) | OK (157.1 KB) | OK (157.1 KB) | FAIL (`HYB_UNSUPPORTED_LAZY`) |

## 2. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over `N=10` interleaved runs after `3` warmups. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---|---|---|---|---|---|---|
| **`lodash`** | 31.33 (44.55) -> 26.74 (61.97) ms | **1.17x** | 3.85 (11.71) -> 4.33 (6.31) ms | **0.89x** | 3.09 (9.63) -> 3.04 (7.01) ms | **1.02x** | 24.28 ms (7.2 MB) |
| **`underscore`** | 6.85 (27.75) -> 7.72 (20.25) ms | **0.89x** | 0.52 (0.55) -> 0.56 (1.10) ms | **0.93x** | 0.54 (0.82) -> 0.53 (4.64) ms | **1.02x** | 14.22 ms (6.2 MB) |
| **`ramda`** | 9.31 (21.53) -> 13.25 (23.75) ms | **0.70x** | 0.70 (5.67) -> 0.86 (4.66) ms | **0.81x** | 0.67 (0.86) -> 0.60 (0.80) ms | **1.12x** | 0.00 ms (6.7 MB) |
| **`immutable`** | 19.01 (29.79) -> 19.51 (27.49) ms | **0.97x** | 2.41 (4.74) -> 1.25 (2.06) ms | **1.93x** | 1.30 (2.79) -> 1.14 (1.30) ms | **1.14x** | 38.86 ms (6.4 MB) |
| **`moment`** | 43.98 (78.76) -> 46.49 (84.06) ms | **0.95x** | 17.89 (24.63) -> 16.83 (24.93) ms | **1.06x** | 17.67 (26.90) -> 18.49 (23.78) ms | **0.96x** | 44.23 ms (7.7 MB) |
| **`chroma-js`** | 8.77 (17.81) -> 5.37 (12.65) ms | **1.63x** | 0.77 (0.83) -> 0.77 (4.80) ms | **1.00x** | 0.72 (0.77) -> 0.75 (4.71) ms | **0.96x** | 22.05 ms (6.1 MB) |
| **`acorn`** | 13.44 (43.09) -> 19.53 (41.95) ms | **0.69x** | 2.09 (4.24) -> 4.58 (16.39) ms | **0.46x** | 1.53 (4.96) -> 3.65 (7.09) ms | **0.42x** | 22.09 ms (6.6 MB) |
| **`crc-32`** | 4.35 (20.73) -> 0.00 (21.27) ms | **—** | 0.21 (4.31) -> 0.23 (0.24) ms | **0.93x** | 0.20 (0.47) -> 0.19 (1.02) ms | **1.03x** | 7.65 ms (6.0 MB) |
| **`marked`** | 81.19 (93.05) -> 81.26 (117.30) ms | **1.00x** | 1.37 (2.72) -> 1.38 (5.46) ms | **0.99x** | 5.17 (19.04) -> 1.54 (5.36) ms | **3.35x** | 48.08 ms (6.1 MB) |
| **`d3-scale`** | 15.67 (31.53) -> 0.23 (42.61) ms | **69.03x** | 0.95 (2.07) -> 0.92 (6.84) ms | **1.04x** | 0.91 (3.38) -> 0.91 (1.98) ms | **0.99x** | 20.05 ms (6.4 MB) |
| **`redux`** | 0.04 (5.42) -> 13.15 (20.67) ms | **0.00x** | 0.20 (0.21) -> 0.21 (0.26) ms | **0.94x** | 0.20 (0.23) -> 0.20 (0.67) ms | **0.99x** | 14.23 ms (6.0 MB) |
| **`handlebars-app`** | 22.15 (40.28) -> 12.26 (61.81) ms | **1.81x** | 9.64 (14.13) -> 9.61 (12.06) ms | **1.00x** | 3.03 (3.15) -> 3.05 (3.98) ms | **0.99x** | n/a |
| **`preact-ssr-app`** | 0.00 (10.64) -> 2.28 (12.07) ms | **0.00x** | 0.25 (0.26) -> 0.25 (3.82) ms | **0.98x** | 0.31 (0.35) -> 0.30 (0.35) ms | **1.01x** | 11.65 ms (6.0 MB) |
| **`react-ssr-app`** | 1.21 (49.97) -> 0.00 (20.19) ms | **—** | 1.55 (5.20) -> 2.44 (4.92) ms | **0.64x** | 1.63 (5.88) -> 1.74 (8.51) ms | **0.94x** | 32.76 ms (6.2 MB) |
| **`yaml-router-app`** | 20.27 (34.98) -> 28.02 (64.68) ms | **0.72x** | 3.23 (7.53) -> 2.30 (3.61) ms | **1.41x** | 4.23 (5.14) -> 2.13 (8.10) ms | **1.99x** | 23.08 ms (6.4 MB) |

## 3. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 533.1 KB (1.00x) | 69.0 KB -> 69.0 KB (1.00x) | 24.5 KB -> 24.5 KB (**1.00x**) | 23.6 KB -> 23.6 KB (**1.00x**) |
| **`underscore`** | 67.3 KB -> 67.3 KB (1.00x) | 18.9 KB -> 18.9 KB (1.00x) | 7.2 KB -> 7.2 KB (**1.00x**) | 7.0 KB -> 7.0 KB (**1.00x**) |
| **`ramda`** | 342.9 KB -> 342.9 KB (1.00x) | 52.6 KB -> 52.6 KB (1.00x) | 14.1 KB -> 14.1 KB (**1.00x**) | 13.6 KB -> 13.6 KB (**1.00x**) |
| **`immutable`** | 175.4 KB -> 175.4 KB (1.00x) | 64.9 KB -> 64.9 KB (1.00x) | 18.0 KB -> 18.0 KB (**1.00x**) | 17.3 KB -> 17.3 KB (**1.00x**) |
| **`moment`** | 637.8 KB -> 637.8 KB (1.00x) | 292.3 KB -> 292.3 KB (1.00x) | 74.3 KB -> 74.3 KB (**1.00x**) | 62.6 KB -> 62.6 KB (**1.00x**) |
| **`chroma-js`** | 109.2 KB -> 109.2 KB (1.00x) | 42.5 KB -> 42.5 KB (1.00x) | 15.4 KB -> 15.4 KB (**1.00x**) | 14.7 KB -> 14.7 KB (**1.00x**) |
| **`acorn`** | 240.9 KB -> 240.9 KB (1.00x) | 115.6 KB -> 115.6 KB (1.00x) | 33.9 KB -> 33.9 KB (**1.00x**) | 31.7 KB -> 31.7 KB (**1.00x**) |
| **`crc-32`** | 3.6 KB -> 3.6 KB (1.00x) | 2.0 KB -> 2.0 KB (1.00x) | 0.8 KB -> 0.8 KB (**1.00x**) | 0.8 KB -> 0.8 KB (**1.00x**) |
| **`marked`** | 49.4 KB -> 49.4 KB (1.00x) | 48.9 KB -> 48.9 KB (1.00x) | 14.5 KB -> 14.5 KB (**1.00x**) | 14.0 KB -> 14.0 KB (**1.00x**) |
| **`d3-scale`** | 148.9 KB -> 148.9 KB (1.00x) | 71.1 KB -> 71.1 KB (1.00x) | 23.0 KB -> 23.0 KB (**1.00x**) | 22.2 KB -> 22.2 KB (**1.00x**) |
| **`redux`** | 18.1 KB -> 18.1 KB (1.00x) | 8.8 KB -> 8.8 KB (1.00x) | 3.3 KB -> 3.3 KB (**1.00x**) | 3.2 KB -> 3.2 KB (**1.00x**) |
| **`handlebars-app`** | 211.9 KB -> 211.9 KB (1.00x) | 86.4 KB -> 86.4 KB (1.00x) | 26.3 KB -> 26.3 KB (**1.00x**) | 24.4 KB -> 24.4 KB (**1.00x**) |
| **`preact-ssr-app`** | 22.0 KB -> 22.0 KB (1.00x) | 21.2 KB -> 21.2 KB (1.00x) | 8.6 KB -> 8.6 KB (**1.00x**) | 8.5 KB -> 8.5 KB (**1.00x**) |
| **`react-ssr-app`** | 47.0 KB -> 47.0 KB (1.00x) | 45.1 KB -> 45.1 KB (1.00x) | 15.2 KB -> 15.2 KB (**1.00x**) | 14.4 KB -> 14.4 KB (**1.00x**) |
| **`yaml-router-app`** | 157.1 KB -> 157.1 KB (1.00x) | 51.8 KB -> 51.8 KB (1.00x) | 17.2 KB -> 17.2 KB (**1.00x**) | 16.6 KB -> 16.6 KB (**1.00x**) |

## 4. Diagnostics & Blockers Summary

