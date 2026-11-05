# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T19:42:13.733Z`
- **Prepack**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (version `0.0.1-hybrid`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30` (adaptRuns=`true`), `warmup=5`, `timeout=300000ms` (large=`900000ms`), `maxOldSpace=16384MB`
- **`node -e 0` Cold Process Baseline**: median **23.80 ms** (p90 26.22 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **15** | 15 standard + 0 large (10 libraries + 5 app workloads) |
| **OK (default options)** | **14** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **14** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **1** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **0** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded per-workload timeout (300s standard / 900s large) |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile (RSS) | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **OK** | **OK** | `default` | 1873 ms (191 MB) | — |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **OK** | **OK** | `default` | 841 ms (89 MB) | — |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `default` | 1315 ms (112 MB) | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `default` | 986 ms (100 MB) | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 2158 ms (148 MB) | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `default` | 709 ms (88 MB) | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `default` | 892 ms (100 MB) | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **OK** | **OK** | `default` | 458 ms (70 MB) | — |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **OK** | **OK** | `default` | 906 ms (109 MB) | — |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **OK** | **OK** | `default` | 2388 ms (127 MB) | — |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **OK** | **OK** | `default` | 505 ms (67 MB) | — |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **OK** | **OK** | `default` | 1229 ms (101 MB) | — |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 571 ms (79 MB) | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **WRONG** | **WRONG** | — | 696 ms (89 MB) | `SILENT_MISCOMPILE`: Node runtime threw: exit 1: /tmp/opencode/pp-bench-run-AOPs4d/react-ssr-app-default-8741-swyh9w |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 757 ms (89 MB) | — |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | OK (755.9 KB) | — | — | — | — | — |
| `underscore` | OK (64.7 KB) | — | — | — | — | — |
| `ramda` | OK (146.6 KB) | — | — | — | — | — |
| `immutable` | OK (171.0 KB) | — | — | — | — | — |
| `moment` | OK (676.6 KB) | — | — | — | — | — |
| `chroma-js` | OK (108.1 KB) | — | — | — | — | — |
| `acorn` | OK (267.5 KB) | — | — | — | — | — |
| `crc-32` | OK (4.1 KB) | — | — | — | — | — |
| `marked` | OK (64.4 KB) | — | — | — | — | — |
| `d3-scale` | OK (249.6 KB) | — | — | — | — | — |
| `redux` | OK (16.0 KB) | — | — | — | — | — |
| `handlebars-app` | OK (210.4 KB) | — | — | — | — | — |
| `preact-ssr-app` | OK (24.8 KB) | — | — | — | — | — |
| `react-ssr-app` | WRONG (`SILENT_MISCOMPILE`) | — | — | — | — | — |
| `yaml-router-app` | OK (154.4 KB) | — | — | — | — | — |

## 2. Original Baseline Measurements (All Workloads)

Baseline timings and compressed sizes for every unmodified workload (including workloads where Prepack fails), covering **library load + deterministic smoke test**.

| Workload | N | Raw | Terser | Gzip | Brotli | Cold `node` Net Med (p90) | V8 `cachedData` Med (p90) | VM Exec-Only Med (p90) | V8 `--snapshot-blob` Net Med |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 30 | 533.1 KB | 69.0 KB | 24.5 KB | 23.6 KB | 18.00 (32.10) ms | 4.30 (12.02) ms | 3.12 (6.92) ms | 15.20 ms (7.2 MB) |
| **`underscore`** | 30 | 67.3 KB | 18.9 KB | 7.2 KB | 7.0 KB | 1.55 (5.58) ms | 0.55 (0.72) ms | 0.54 (0.66) ms | 11.22 ms (6.2 MB) |
| **`ramda`** | 30 | 342.9 KB | 52.6 KB | 14.1 KB | 13.6 KB | 5.15 (7.84) ms | 0.79 (0.91) ms | 0.74 (0.78) ms | 9.36 ms (6.7 MB) |
| **`immutable`** | 30 | 175.4 KB | 64.9 KB | 18.0 KB | 17.3 KB | 6.30 (12.23) ms | 1.32 (1.45) ms | 1.28 (1.37) ms | 10.04 ms (6.4 MB) |
| **`moment`** | 30 | 637.8 KB | 292.3 KB | 74.3 KB | 62.6 KB | 26.97 (34.62) ms | 11.63 (12.83) ms | 11.56 (12.14) ms | 16.52 ms (7.7 MB) |
| **`chroma-js`** | 30 | 109.2 KB | 42.5 KB | 15.4 KB | 14.7 KB | 2.88 (7.82) ms | 0.87 (0.93) ms | 0.99 (1.17) ms | 8.22 ms (6.1 MB) |
| **`acorn`** | 30 | 240.9 KB | 115.6 KB | 33.9 KB | 31.7 KB | 8.55 (17.24) ms | 1.67 (1.89) ms | 1.91 (2.36) ms | 13.27 ms (6.6 MB) |
| **`crc-32`** | 30 | 3.6 KB | 2.0 KB | 0.8 KB | 0.8 KB | 1.76 (7.02) ms | 0.55 (0.57) ms | 0.53 (0.56) ms | 6.54 ms (6.0 MB) |
| **`marked`** | 30 | 49.4 KB | 48.9 KB | 14.5 KB | 14.0 KB | 34.95 (42.96) ms | 1.27 (1.62) ms | 1.21 (1.24) ms | 33.12 ms (6.1 MB) |
| **`d3-scale`** | 30 | 148.9 KB | 71.1 KB | 23.0 KB | 22.2 KB | 5.42 (9.49) ms | 0.98 (1.52) ms | 0.94 (1.01) ms | 9.85 ms (6.4 MB) |
| **`redux`** | 30 | 18.1 KB | 8.8 KB | 3.3 KB | 3.2 KB | 0.31 (4.70) ms | 0.35 (0.43) ms | 0.32 (0.35) ms | 6.47 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 211.9 KB | 86.4 KB | 26.3 KB | 24.4 KB | 17.72 (25.64) ms | 3.85 (4.35) ms | 3.73 (11.37) ms | unsupported |
| **`preact-ssr-app`** | 30 | 22.0 KB | 21.2 KB | 8.6 KB | 8.5 KB | 0.00 (9.24) ms | 0.42 (0.49) ms | 0.42 (0.47) ms | 8.61 ms (6.0 MB) |
| **`react-ssr-app`** | 30 | 47.0 KB | 45.1 KB | 15.2 KB | 14.4 KB | 5.68 (11.13) ms | 1.07 (1.35) ms | 0.90 (1.07) ms | 7.62 ms (6.2 MB) |
| **`yaml-router-app`** | 30 | 157.1 KB | 51.8 KB | 17.2 KB | 16.6 KB | 6.73 (11.82) ms | 1.75 (2.14) ms | 1.87 (2.55) ms | 8.67 ms (6.4 MB) |

## 3. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over interleaved runs. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | N | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---:|---|---|---|---|---|---|---|
| **`lodash`** | 30 | 18.00 (32.10) -> 22.45 (35.11) ms | **0.80x** | 4.30 (12.02) -> 3.08 (5.38) ms | **1.39x** | 3.12 (6.92) -> 2.37 (7.02) ms | **1.32x** | 15.20 ms (7.2 MB) |
| **`underscore`** | 30 | 1.55 (5.58) -> 1.03 (6.51) ms | **1.51x** | 0.55 (0.72) -> 0.56 (0.66) ms | **0.98x** | 0.54 (0.66) -> 0.55 (0.62) ms | **0.98x** | 11.22 ms (6.2 MB) |
| **`ramda`** | 30 | 5.15 (7.84) -> 5.55 (8.19) ms | **0.93x** | 0.79 (0.91) -> 0.54 (0.92) ms | **1.48x** | 0.74 (0.78) -> 0.48 (0.54) ms | **1.54x** | 9.36 ms (6.7 MB) |
| **`immutable`** | 30 | 6.30 (12.23) -> 6.86 (10.91) ms | **0.92x** | 1.32 (1.45) -> 1.39 (1.51) ms | **0.95x** | 1.28 (1.37) -> 1.36 (1.50) ms | **0.94x** | 10.04 ms (6.4 MB) |
| **`moment`** | 30 | 26.97 (34.62) -> 30.30 (36.07) ms | **0.89x** | 11.63 (12.83) -> 4.09 (4.31) ms | **2.84x** | 11.56 (12.14) -> 3.98 (4.10) ms | **2.91x** | 16.52 ms (7.7 MB) |
| **`chroma-js`** | 30 | 2.88 (7.82) -> 4.23 (11.58) ms | **0.68x** | 0.87 (0.93) -> 0.82 (0.89) ms | **1.06x** | 0.99 (1.17) -> 0.92 (1.25) ms | **1.08x** | 8.22 ms (6.1 MB) |
| **`acorn`** | 30 | 8.55 (17.24) -> 8.74 (14.01) ms | **0.98x** | 1.67 (1.89) -> 1.55 (2.24) ms | **1.08x** | 1.91 (2.36) -> 1.66 (1.99) ms | **1.15x** | 13.27 ms (6.6 MB) |
| **`crc-32`** | 30 | 1.76 (7.02) -> 0.00 (5.37) ms | **—** | 0.55 (0.57) -> 0.47 (0.59) ms | **1.16x** | 0.53 (0.56) -> 0.39 (0.56) ms | **1.35x** | 6.54 ms (6.0 MB) |
| **`marked`** | 30 | 34.95 (42.96) -> 37.09 (51.03) ms | **0.94x** | 1.27 (1.62) -> 1.12 (1.32) ms | **1.13x** | 1.21 (1.24) -> 1.06 (1.10) ms | **1.14x** | 33.12 ms (6.1 MB) |
| **`d3-scale`** | 30 | 5.42 (9.49) -> 9.65 (16.49) ms | **0.56x** | 0.98 (1.52) -> 0.77 (0.97) ms | **1.28x** | 0.94 (1.01) -> 0.70 (0.81) ms | **1.34x** | 9.85 ms (6.4 MB) |
| **`redux`** | 30 | 0.31 (4.70) -> 0.00 (1.58) ms | **—** | 0.35 (0.43) -> 0.28 (0.34) ms | **1.26x** | 0.32 (0.35) -> 0.26 (0.28) ms | **1.22x** | 6.47 ms (6.0 MB) |
| **`handlebars-app`** | 30 | 17.72 (25.64) -> 8.79 (12.49) ms | **2.02x** | 3.85 (4.35) -> 1.34 (1.49) ms | **2.88x** | 3.73 (11.37) -> 1.18 (1.34) ms | **3.17x** | n/a |
| **`preact-ssr-app`** | 30 | 0.00 (9.24) -> 1.07 (6.62) ms | **0.00x** | 0.42 (0.49) -> 0.37 (0.45) ms | **1.14x** | 0.42 (0.47) -> 0.36 (0.42) ms | **1.15x** | 8.61 ms (6.0 MB) |
| **`yaml-router-app`** | 30 | 6.73 (11.82) -> 3.92 (6.20) ms | **1.72x** | 1.75 (2.14) -> 0.74 (0.86) ms | **2.37x** | 1.87 (2.55) -> 0.72 (0.91) ms | **2.59x** | 8.67 ms (6.4 MB) |

## 4. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 755.9 KB (1.42x) | 69.0 KB -> 172.2 KB (2.49x) | 24.5 KB -> 52.7 KB (**2.15x**) | 23.6 KB -> 40.7 KB (**1.73x**) |
| **`underscore`** | 67.3 KB -> 64.7 KB (0.96x) | 18.9 KB -> 26.8 KB (1.42x) | 7.2 KB -> 9.5 KB (**1.32x**) | 7.0 KB -> 9.0 KB (**1.28x**) |
| **`ramda`** | 342.9 KB -> 146.6 KB (0.43x) | 52.6 KB -> 68.9 KB (1.31x) | 14.1 KB -> 18.8 KB (**1.33x**) | 13.6 KB -> 17.3 KB (**1.27x**) |
| **`immutable`** | 175.4 KB -> 171.0 KB (0.97x) | 64.9 KB -> 67.0 KB (1.03x) | 18.0 KB -> 20.0 KB (**1.11x**) | 17.3 KB -> 19.1 KB (**1.11x**) |
| **`moment`** | 637.8 KB -> 676.6 KB (1.06x) | 292.3 KB -> 383.0 KB (1.31x) | 74.3 KB -> 93.7 KB (**1.26x**) | 62.6 KB -> 78.3 KB (**1.25x**) |
| **`chroma-js`** | 109.2 KB -> 108.1 KB (0.99x) | 42.5 KB -> 45.9 KB (1.08x) | 15.4 KB -> 16.4 KB (**1.07x**) | 14.7 KB -> 15.6 KB (**1.06x**) |
| **`acorn`** | 240.9 KB -> 267.5 KB (1.11x) | 115.6 KB -> 165.5 KB (1.43x) | 33.9 KB -> 38.7 KB (**1.14x**) | 31.7 KB -> 34.4 KB (**1.09x**) |
| **`crc-32`** | 3.6 KB -> 4.1 KB (1.12x) | 2.0 KB -> 2.7 KB (1.33x) | 0.8 KB -> 1.0 KB (**1.25x**) | 0.8 KB -> 1.0 KB (**1.24x**) |
| **`marked`** | 49.4 KB -> 64.4 KB (1.30x) | 48.9 KB -> 57.7 KB (1.18x) | 14.5 KB -> 15.3 KB (**1.05x**) | 14.0 KB -> 14.3 KB (**1.02x**) |
| **`d3-scale`** | 148.9 KB -> 249.6 KB (1.68x) | 71.1 KB -> 111.8 KB (1.57x) | 23.0 KB -> 30.7 KB (**1.33x**) | 22.2 KB -> 28.3 KB (**1.27x**) |
| **`redux`** | 18.1 KB -> 16.0 KB (0.88x) | 8.8 KB -> 7.8 KB (0.89x) | 3.3 KB -> 3.1 KB (**0.92x**) | 3.2 KB -> 2.9 KB (**0.92x**) |
| **`handlebars-app`** | 211.9 KB -> 210.4 KB (0.99x) | 86.4 KB -> 98.2 KB (1.14x) | 26.3 KB -> 27.4 KB (**1.04x**) | 24.4 KB -> 25.0 KB (**1.02x**) |
| **`preact-ssr-app`** | 22.0 KB -> 24.8 KB (1.13x) | 21.2 KB -> 22.1 KB (1.04x) | 8.6 KB -> 9.1 KB (**1.05x**) | 8.5 KB -> 8.9 KB (**1.05x**) |
| **`yaml-router-app`** | 157.1 KB -> 154.4 KB (0.98x) | 51.8 KB -> 59.1 KB (1.14x) | 17.2 KB -> 18.1 KB (**1.05x**) | 16.6 KB -> 17.4 KB (**1.05x**) |

## 5. Diagnostics & Blockers Summary

### `react-ssr-app` — default `WRONG`, overall `WRONG`
- **Code**: `SILENT_MISCOMPILE`
- **Message**: Node runtime threw: exit 1: /tmp/opencode/pp-bench-run-AOPs4d/react-ssr-app-default-8741-swyh9w6x2g.js:6 |   throw new Error("Prepack environment assumption failed (!(\"exports\" in globalThis) && !(\"define\" in globalThis) && \"self\" in globalTh...)"); |   ^ | 
- **Compile resources**: 696 ms, peak RSS 89.3 MB

