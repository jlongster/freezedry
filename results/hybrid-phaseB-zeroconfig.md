# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T10:57:15.136Z`
- **Prepack**: `/tmp/opencode/pp-wt/hybrid/hybrid/index.js` (version `0.0.1-hybrid`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30`, `warmup=5`, `timeout=300000ms`
- **`node -e 0` Cold Process Baseline**: median **24.15 ms** (p90 27.72 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **15** | 10 libraries + 5 init-heavy app workloads |
| **OK (default options)** | **8** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **8** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **0** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **7** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded 300s per-lib cap |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **FAIL** | **FAIL** | — | 209 ms | `HYB_VOLATILE_BAILOUT` @ L6783:21: volatile API "Date.now()" called during initialization (lodash.js:6783:21) |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **OK** | **OK** | `browser-opt` | 2708 ms | — |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `browser-opt` | 3562 ms | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **FAIL** | **FAIL** | — | 94 ms | `HYB_VOLATILE_BAILOUT` @ L893:12: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `browser-opt` | 4089 ms | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `browser-opt` | 1472 ms | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `browser-opt` | 1573 ms | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **OK** | **OK** | `default` | 757 ms | — |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **FAIL** | **FAIL** | — | 1005 ms | `HYB_BAILOUT` (handleBailoutList (lib/bench-adapter.js:249:11)): class or function with private fields (#x) (a) (global.marked.Hooks.get.[[Scope:s20]].O) |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **FAIL** | **FAIL** | — | 135 ms | `HYB_VOLATILE_BAILOUT` @ L3086:12: volatile API "new Date()" without arguments called during initialization (d3-scale.js:3086:12) |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **FAIL** | **FAIL** | — | 117 ms | `HYB_VOLATILE_BAILOUT` @ L366:33: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **FAIL** | **FAIL** | — | 178 ms | `HYB_VOLATILE_BAILOUT` @ L1302:16: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 817 ms | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **FAIL** | **FAIL** | — | 133 ms | `HYB_VOLATILE_BAILOUT` @ L20:236: volatile API "Date.now()" called during initialization (react-ssr-app.js:20:236) |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 1007 ms | — |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `underscore` | OK (235.9 KB) | OK (235.9 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `ramda` | OK (545.0 KB) | OK (545.0 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `immutable` | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `moment` | OK (1443.2 KB) | OK (1442.8 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `chroma-js` | OK (236.3 KB) | OK (236.2 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `acorn` | OK (556.8 KB) | OK (556.6 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `crc-32` | OK (30.0 KB) | OK (30.0 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `marked` | FAIL (`HYB_BAILOUT`) | FAIL (`HYB_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `d3-scale` | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `redux` | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `handlebars-app` | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `preact-ssr-app` | OK (52.2 KB) | OK (52.2 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `react-ssr-app` | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_VOLATILE_BAILOUT`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |
| `yaml-router-app` | OK (458.2 KB) | OK (458.2 KB) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_NO_RANDOM_SEED`) | FAIL (`HYB_UNSUPPORTED_LAZY`) |

## 2. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over `N=30` interleaved runs after `5` warmups. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---|---|---|---|---|---|---|
| **`underscore`** | 2.27 (9.69) -> 6.71 (12.67) ms | **0.34x** | 0.47 (0.70) -> 0.78 (1.05) ms | **0.60x** | 0.50 (0.59) -> 0.82 (0.94) ms | **0.61x** | 7.06 ms (6.2 MB) |
| **`ramda`** | 4.08 (10.39) -> 10.13 (16.92) ms | **0.40x** | 0.64 (0.68) -> 0.80 (0.88) ms | **0.81x** | 0.74 (0.79) -> 0.88 (0.94) ms | **0.83x** | 19.86 ms (6.7 MB) |
| **`moment`** | 42.40 (72.61) -> 90.88 (136.56) ms | **0.47x** | 12.22 (21.18) -> 4.69 (7.09) ms | **2.61x** | 13.38 (34.40) -> 4.75 (11.92) ms | **2.82x** | 30.15 ms (7.7 MB) |
| **`chroma-js`** | 10.59 (32.33) -> 11.94 (39.88) ms | **0.89x** | 0.71 (1.04) -> 1.16 (1.82) ms | **0.61x** | 0.65 (0.71) -> 0.77 (0.79) ms | **0.84x** | 6.90 ms (6.1 MB) |
| **`acorn`** | 9.40 (18.76) -> 15.34 (33.34) ms | **0.61x** | 1.47 (1.59) -> 1.56 (2.54) ms | **0.94x** | 1.43 (2.53) -> 1.54 (1.89) ms | **0.93x** | 17.80 ms (6.6 MB) |
| **`crc-32`** | 2.82 (14.17) -> 2.04 (8.02) ms | **1.39x** | 0.40 (3.28) -> 0.12 (0.17) ms | **3.31x** | 0.20 (1.29) -> 0.09 (0.12) ms | **2.34x** | 5.69 ms (6.0 MB) |
| **`preact-ssr-app`** | 1.42 (4.48) -> 2.44 (5.70) ms | **0.58x** | 0.27 (0.39) -> 0.27 (0.34) ms | **1.01x** | 0.24 (0.25) -> 0.23 (0.25) ms | **1.05x** | 4.70 ms (6.0 MB) |
| **`yaml-router-app`** | 9.22 (46.31) -> 6.54 (61.16) ms | **1.41x** | 1.80 (5.48) -> 0.88 (0.93) ms | **2.05x** | 1.71 (2.08) -> 0.81 (1.11) ms | **2.09x** | 7.87 ms (6.4 MB) |

## 3. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`underscore`** | 67.3 KB -> 235.9 KB (3.50x) | 18.9 KB -> 82.1 KB (4.34x) | 7.2 KB -> 25.2 KB (**3.50x**) | 7.0 KB -> 15.7 KB (**2.23x**) |
| **`ramda`** | 342.9 KB -> 545.0 KB (1.59x) | 52.6 KB -> 150.2 KB (2.85x) | 14.1 KB -> 40.2 KB (**2.85x**) | 13.6 KB -> 29.0 KB (**2.13x**) |
| **`moment`** | 637.8 KB -> 1442.8 KB (2.26x) | 292.3 KB -> 741.6 KB (2.54x) | 74.3 KB -> 181.9 KB (**2.45x**) | 62.6 KB -> 113.4 KB (**1.81x**) |
| **`chroma-js`** | 109.2 KB -> 236.2 KB (2.16x) | 42.5 KB -> 100.3 KB (2.36x) | 15.4 KB -> 32.0 KB (**2.08x**) | 14.7 KB -> 22.0 KB (**1.49x**) |
| **`acorn`** | 240.9 KB -> 556.6 KB (2.31x) | 115.6 KB -> 314.0 KB (2.72x) | 33.9 KB -> 77.6 KB (**2.29x**) | 31.7 KB -> 43.9 KB (**1.39x**) |
| **`crc-32`** | 3.6 KB -> 30.0 KB (8.30x) | 2.0 KB -> 27.0 KB (13.51x) | 0.8 KB -> 18.2 KB (**22.73x**) | 0.8 KB -> 17.8 KB (**23.16x**) |
| **`preact-ssr-app`** | 22.0 KB -> 52.2 KB (2.38x) | 21.2 KB -> 45.8 KB (2.16x) | 8.6 KB -> 13.3 KB (**1.54x**) | 8.5 KB -> 11.8 KB (**1.39x**) |
| **`yaml-router-app`** | 157.1 KB -> 458.2 KB (2.92x) | 51.8 KB -> 160.4 KB (3.10x) | 17.2 KB -> 49.8 KB (**2.90x**) | 16.6 KB -> 26.3 KB (**1.59x**) |

## 4. Diagnostics & Blockers Summary

### `lodash` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Date.now()" called during initialization (lodash.js:6783:21)
- **Location**: line 6783, column 21
- **Excerpt**: `var stamp = nativeNow(),`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

### `immutable` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (immutable.js:893:12)
- **Location**: line 893, column 12
- **Excerpt**: `((Math.random() * 0x100000) | 1) % 0x100000 || 0x9e37;`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

### `marked` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_BAILOUT`
- **Message**: class or function with private fields (#x) (a) (global.marked.Hooks.get.[[Scope:s20]].O)
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

### `d3-scale` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "new Date()" without arguments called during initialization (d3-scale.js:3086:12)
- **Location**: line 3086, column 12
- **Excerpt**: `const t0 = new Date, t1 = new Date;`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

### `redux` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (redux.js:366:33)
- **Location**: line 366, column 33
- **Excerpt**: `randomString = () => Math.random().toString(36).substring(7).split("").join(".");`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

### `handlebars-app` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Math.random()" called during initialization; pass --allow-volatile=Math.random to bake and document it (handlebars-app.js:1302:16)
- **Location**: line 1302, column 16
- **Excerpt**: `, px = Math.random();`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

### `react-ssr-app` — default `FAIL`, overall `FAIL`
- **Code**: `HYB_VOLATILE_BAILOUT`
- **Message**: volatile API "Date.now()" called during initialization (react-ssr-app.js:20:236)
- **Location**: line 20, column 236
- **Excerpt**: `...unction(){return Ba.now()}}else{var ma=Date,Ca=ma.now();v=function(){return ma.now()-Ca}}var q=[],r=[],Da=1,n=null,k=3,F=!1,u=!1,z=!1,ja="fu...`
- **Internal Prepack frame**: `handleBailoutList (lib/bench-adapter.js:249:11)`

