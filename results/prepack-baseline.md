# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T10:54:04.852Z`
- **Prepack**: `/tmp/opencode/pp-work/lib/prepack-node.js` (version `0.2.55-alpha.0`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30`, `warmup=5`, `timeout=300000ms`
- **`node -e 0` Cold Process Baseline**: median **24.80 ms** (p90 27.87 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **15** | 10 libraries + 5 init-heavy app workloads |
| **OK (default options)** | **9** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **11** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **1** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **3** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded 300s per-lib cap |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **OK** | **OK** | `default` | 11562 ms | — |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **FAIL** | **OK** | `jsc` | 1351 ms | *(default FAIL)* `PP0001` @ L139:35: This operation is not yet supported on document at childNodes |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `default` | 2036 ms | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `default` | 1866 ms | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 17770 ms | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `default` | 990 ms | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `default` | 1684 ms | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **FAIL** | **FAIL** | — | 210 ms | `PP0037` @ L57:2: failed to emit a residual loop: the loop calls an unknown or unsupported function in global cod |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **FAIL** | **FAIL** | — | 35 ms | `PP1004` @ L13:1309: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBindi |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **FAIL** | **FAIL** | — | 1021 ms | `INVARIANT` (invariant (lib/invariant.js:24:15)): serialized 1339 of 1341 |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **FAIL** | **OK** | `browser-seed` | 336 ms | *(default FAIL)* `PP0031` @ L366:74: property access on unknown object |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **WRONG** | **WRONG** | — | 858 ms | `PP0023` @ L2665:53: VM runtime threw: TypeError: not an object |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 642 ms | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **OK** | **OK** | `default` | 1799 ms | — |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 4648 ms | — |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | OK (536.1 KB) | OK (538.8 KB) | OK (538.8 KB) | FAIL (`PP0001`) | OK (538.8 KB) | OK (762.1 KB) |
| `underscore` | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | OK (67.6 KB) | FAIL (`PP0001`) | FAIL (`PP0001`) |
| `ramda` | OK (135.3 KB) | OK (145.5 KB) | OK (145.5 KB) | OK (135.8 KB) | OK (145.5 KB) | OK (138.5 KB) |
| `immutable` | OK (143.8 KB) | OK (151.6 KB) | OK (151.5 KB) | OK (144.9 KB) | OK (151.5 KB) | OK (145.3 KB) |
| `moment` | OK (632.6 KB) | OK (744.2 KB) | OK (744.2 KB) | OK (638.4 KB) | OK (744.2 KB) | OK (824.2 KB) |
| `chroma-js` | OK (84.0 KB) | OK (92.4 KB) | OK (92.4 KB) | OK (84.0 KB) | OK (92.4 KB) | OK (88.6 KB) |
| `acorn` | OK (266.8 KB) | OK (276.0 KB) | OK (276.0 KB) | OK (270.8 KB) | OK (276.0 KB) | OK (272.0 KB) |
| `crc-32` | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) |
| `marked` | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) |
| `d3-scale` | FAIL (`INVARIANT`) | FAIL (`INVARIANT`) | FAIL (`INVARIANT`) | FAIL (`INVARIANT`) | FAIL (`INVARIANT`) | FAIL (`INVARIANT`) |
| `redux` | FAIL (`PP0031`) | FAIL (`PP0031`) | OK (14.6 KB) | OK (14.0 KB) | OK (14.6 KB) | OK (15.0 KB) |
| `handlebars-app` | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) |
| `preact-ssr-app` | OK (34.7 KB) | OK (37.0 KB) | OK (37.0 KB) | WRONG (`PP0023`) | WRONG (`PP0023`) | OK (35.5 KB) |
| `react-ssr-app` | OK (118.8 KB) | OK (145.5 KB) | OK (145.5 KB) | WRONG (`PP0023`) | OK (145.5 KB) | OK (124.7 KB) |
| `yaml-router-app` | OK (126.2 KB) | OK (135.2 KB) | OK (135.2 KB) | OK (127.1 KB) | OK (135.2 KB) | OK (136.2 KB) |

## 2. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over `N=30` interleaved runs after `5` warmups. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---|---|---|---|---|---|---|
| **`lodash`** | 13.97 (53.02) -> 14.33 (47.16) ms | **0.97x** | 3.04 (5.62) -> 3.75 (9.26) ms | **0.81x** | 2.96 (4.92) -> 2.88 (6.82) ms | **1.03x** | 9.41 ms (7.2 MB) |
| **`underscore`** | 1.07 (5.05) -> 1.19 (4.50) ms | **0.90x** | 0.45 (0.49) -> 0.44 (0.47) ms | **1.01x** | 0.38 (0.41) -> 0.38 (0.42) ms | **1.01x** | 5.87 ms (6.2 MB) |
| **`ramda`** | 4.22 (5.69) -> 3.69 (5.37) ms | **1.14x** | 0.64 (0.70) -> 0.29 (0.32) ms | **2.23x** | 0.59 (0.64) -> 0.26 (0.27) ms | **2.28x** | 6.53 ms (6.7 MB) |
| **`immutable`** | 5.69 (8.66) -> 5.61 (7.70) ms | **1.01x** | 1.15 (2.15) -> 1.02 (1.54) ms | **1.12x** | 1.10 (1.15) -> 0.98 (1.07) ms | **1.12x** | 9.05 ms (6.4 MB) |
| **`moment`** | 24.83 (29.65) -> 23.72 (28.26) ms | **1.05x** | 10.83 (11.89) -> 2.37 (2.81) ms | **4.58x** | 11.11 (11.52) -> 2.51 (2.77) ms | **4.43x** | 11.85 ms (7.7 MB) |
| **`chroma-js`** | 4.75 (16.70) -> 4.82 (13.06) ms | **0.98x** | 0.71 (0.76) -> 0.66 (0.69) ms | **1.08x** | 0.70 (0.74) -> 0.65 (0.69) ms | **1.08x** | 7.32 ms (6.1 MB) |
| **`acorn`** | 8.21 (10.83) -> 8.93 (12.94) ms | **0.92x** | 1.47 (2.40) -> 1.25 (1.80) ms | **1.17x** | 1.50 (1.76) -> 1.24 (1.40) ms | **1.21x** | 14.07 ms (6.6 MB) |
| **`redux`** | 0.82 (8.46) -> 0.00 (11.10) ms | **—** | 0.23 (0.84) -> 0.16 (0.17) ms | **1.44x** | 0.22 (0.34) -> 0.15 (0.17) ms | **1.47x** | 4.66 ms (6.0 MB) |
| **`preact-ssr-app`** | 2.35 (4.84) -> 2.21 (4.18) ms | **1.06x** | 0.33 (0.37) -> 0.25 (0.29) ms | **1.32x** | 0.24 (0.28) -> 0.18 (0.20) ms | **1.34x** | 4.92 ms (6.0 MB) |
| **`react-ssr-app`** | 7.56 (34.31) -> 4.04 (37.14) ms | **1.87x** | 0.73 (0.78) -> 0.45 (0.47) ms | **1.63x** | 0.73 (0.87) -> 0.44 (0.47) ms | **1.66x** | 11.05 ms (6.2 MB) |
| **`yaml-router-app`** | 8.12 (13.12) -> 4.05 (9.40) ms | **2.00x** | 1.58 (1.67) -> 0.51 (0.55) ms | **3.08x** | 1.49 (3.48) -> 0.47 (0.66) ms | **3.17x** | 8.94 ms (6.4 MB) |

## 3. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 536.1 KB (1.00x) | 69.0 KB -> 72.3 KB (1.05x) | 24.5 KB -> 23.7 KB (**0.97x**) | 23.6 KB -> 22.8 KB (**0.97x**) |
| **`underscore`** | 67.3 KB -> 67.6 KB (1.00x) | 18.9 KB -> 32.7 KB (1.73x) | 7.2 KB -> 7.9 KB (**1.10x**) | 7.0 KB -> 7.7 KB (**1.09x**) |
| **`ramda`** | 342.9 KB -> 135.3 KB (0.40x) | 52.6 KB -> 64.8 KB (1.23x) | 14.1 KB -> 15.2 KB (**1.08x**) | 13.6 KB -> 14.2 KB (**1.05x**) |
| **`immutable`** | 175.4 KB -> 143.8 KB (0.82x) | 64.9 KB -> 62.9 KB (0.97x) | 18.0 KB -> 17.9 KB (**0.99x**) | 17.3 KB -> 17.2 KB (**1.00x**) |
| **`moment`** | 637.8 KB -> 632.6 KB (0.99x) | 292.3 KB -> 347.4 KB (1.19x) | 74.3 KB -> 99.1 KB (**1.33x**) | 62.6 KB -> 82.8 KB (**1.32x**) |
| **`chroma-js`** | 109.2 KB -> 84.0 KB (0.77x) | 42.5 KB -> 40.0 KB (0.94x) | 15.4 KB -> 14.3 KB (**0.93x**) | 14.7 KB -> 13.6 KB (**0.93x**) |
| **`acorn`** | 240.9 KB -> 266.8 KB (1.11x) | 115.6 KB -> 163.1 KB (1.41x) | 33.9 KB -> 38.7 KB (**1.14x**) | 31.7 KB -> 33.7 KB (**1.06x**) |
| **`redux`** | 18.1 KB -> 14.6 KB (0.81x) | 8.8 KB -> 7.7 KB (0.87x) | 3.3 KB -> 3.0 KB (**0.89x**) | 3.2 KB -> 2.8 KB (**0.88x**) |
| **`preact-ssr-app`** | 22.0 KB -> 34.7 KB (1.58x) | 21.2 KB -> 21.7 KB (1.02x) | 8.6 KB -> 8.7 KB (**1.00x**) | 8.5 KB -> 8.4 KB (**1.00x**) |
| **`react-ssr-app`** | 47.0 KB -> 118.8 KB (2.53x) | 45.1 KB -> 76.6 KB (1.70x) | 15.2 KB -> 21.0 KB (**1.38x**) | 14.4 KB -> 18.4 KB (**1.28x**) |
| **`yaml-router-app`** | 157.1 KB -> 126.2 KB (0.80x) | 51.8 KB -> 58.6 KB (1.13x) | 17.2 KB -> 18.0 KB (**1.05x**) | 16.6 KB -> 17.3 KB (**1.04x**) |

## 4. Diagnostics & Blockers Summary

### `underscore` — default `FAIL`, overall `OK`
- **Code**: `PP0001`
- **Message**: This operation is not yet supported on document at childNodes
- **Location**: line 139, column 35
- **Excerpt**: `var nodelist = root.document && root.document.childNodes;`
- **Internal Prepack frame**: `PropertiesImplementation.OrdinaryGetOwnProperty (lib/methods/properties.js:1467:15)`
- **Workaround profile**: `jsc` (`--compatibility jsc-600-1-4-17 --mathRandomSeed 0`) -> **OK**

### `crc-32` — default `FAIL`, overall `FAIL`
- **Code**: `PP0037`
- **Message**: failed to emit a residual loop: the loop calls an unknown or unsupported function in global code (PP0002: might be an object with an unknown valueOf or toString or Symbol.toPrimitive method)
- **Location**: line 57, column 2
- **Excerpt**: `for(n = 1; n != 16; ++n) out[n - 1] = typeof Int32Array !== 'undefined' ? table.subarray(n...`
- **Internal Prepack frame**: `fail (lib/evaluators/residualLoop.js:387:9)`

### `marked` — default `FAIL`, overall `FAIL`
- **Code**: `PP1004`
- **Message**: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBinding' (13:1308)
- **Location**: line 13, column 1309
- **Excerpt**: `...)=>{try{return!!new RegExp("(?<=1)(?<!1)"+a)}catch{return!1}})(),T={codeRemoveIndent:/^(?: {0,3}\t| {1,4})/gm,outputLinkReplace:/\\([\[\]])/...`
- **Internal Prepack frame**: `LexicalEnvironment.concatenateAndParse (lib/environment.js:1003:21)`

### `d3-scale` — default `FAIL`, overall `FAIL`
- **Code**: `INVARIANT`
- **Message**: serialized 1339 of 1341
- **Internal Prepack frame**: `invariant (lib/invariant.js:24:15)`

### `redux` — default `FAIL`, overall `OK`
- **Code**: `PP0031`
- **Message**: property access on unknown object
- **Location**: line 366, column 74
- **Excerpt**: `...=> Math.random().toString(36).substring(7).split("").join(".");`
- **Internal Prepack frame**: `AbstractObjectValue.$Get (lib/values/AbstractObjectValue.js:647:13)`
- **Workaround profile**: `browser-seed` (`--compatibility browser --mathRandomSeed 0 --delayInitializations --inlineExpressions`) -> **OK**

### `handlebars-app` — default `WRONG`, overall `WRONG`
- **Code**: `PP0023`
- **Message**: VM runtime threw: TypeError: not an object
- **Location**: line 2665, column 53
- **Excerpt**: `...Object.prototype.__defineGetter__('__magic__', function () {`

