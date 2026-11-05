# Large Real-World Workloads (`bench/`)

Extends `bench/` from 15 small/medium workloads (`3.6 KB – 637.8 KB`, `2.70 MB` total) to **22 real-world workloads (`24.18 MB` total)** by adding **7 large, init-heavy libraries (`0.91 MB – 8.90 MB` each)** for head-to-head evaluation of:
1. **Original** (unmodified JS, with V8 `cachedData` and Node `--build-snapshot` references),
2. **Prepack** (`lib/prepack-node.js`, branch `revive`), and
3. **Hybrid** (`hybrid/index.js` — V8 init execution + heap capture + JS emission).

---

## 1. The 7 Large Workloads

| ID | Package(s) & Version | License | Build | Raw | Terser | Gzip | Brotli | Init Work & Smoke Test |
|---|---|---|---|---:|---:|---:|---:|---|
| **`moment-timezone`** | `moment@2.31.0` + `moment-timezone@0.6.6` | MIT | UMD | 913.3 KB | 778.7 KB | 55.0 KB | 46.5 KB | Unpacks base-60 IANA transition rules & links for 597 timezones at load; smoke converts winter/summer UTC timestamps & DST jumps across 6 global zones (zero host-TZ dependency). |
| **`prettier`** | `prettier@2.8.8` (`standalone` + `babel` + `postcss` + `html`) | MIT | UMD | 1065.6 KB | 1029.4 KB | 290.4 KB | 229.1 KB | Registers standalone printer + 3 parser plugins; smoke formats JS, CSS, and HTML snippets and hashes exact formatted outputs. |
| **`highlight-js`** | `highlight.js@11.12.0` | BSD-3-Clause | esbuild IIFE (ES2015) | 1834.5 KB | 957.2 KB | 299.3 KB | 257.2 KB | Registers all 193 language grammar definitions onto `hljs` at load; smoke highlights 5 languages (`javascript`, `python`, `rust`, `sql`, `xml`) + runs `highlightAuto`. |
| **`three`** | `three@0.187.0` | MIT | esbuild IIFE (ES2015) | 1914.4 KB | 742.9 KB | 183.2 KB | 163.5 KB | Initializes math LUTs, color spaces, shader chunks, and 3D classes; smoke runs `Matrix4`/`Quaternion`/`Ray`/`Box3` math, builds a hierarchical `Scene` (`Group`, `BoxGeometry`, `SphereGeometry`, materials, `DirectionalLight`, `PerspectiveCamera`), projects world->NDC, and canonicalizes `scene.toJSON()`. |
| **`mathjs`** | `mathjs@15.2.0` | Apache-2.0 | esbuild IIFE (ES2020) | 2117.9 KB | 839.6 KB | 212.5 KB | 187.9 KB | Eagerly constructs 300+ multi-dispatch functions via `typed-function`, data types (`DenseMatrix`, `Complex`, `Fraction`, `Unit`), physical constants, and algebra transforms (~185 ms pure init); smoke runs `lusolve`, `det`, `inv`, symbolic `derivative` & `simplify`, `compile`, `Complex`, `Fraction`, and `Unit` conversion. |
| **`babel-standalone`** | `@babel/standalone@7.29.13` | MIT | UMD | 5248.9 KB | 2951.7 KB | 644.3 KB | 466.6 KB | Registers `@babel/parser`, `@babel/traverse`, `@babel/generator`, `core-js` compat tables, 100+ plugins, and built-in presets; smoke transforms ES2022+JSX (`class`, `?.`, `??`, `**`, rest/spread) with `preset-env` + `preset-react` and inspects AST + output. |
| **`typescript`** | `typescript@5.9.3` (`lib/typescript.js`) | Apache-2.0 | Standalone script | 8899.1 KB | 3430.8 KB | 944.8 KB | 785.6 KB | Initializes full TS 5.9 scanner, parser, binder, checker, emitter, and diagnostic tables; smoke runs `ts.transpileModule` (enums, generics, parameter properties, `??`) and walks `ts.createSourceFile` AST with `ts.forEachChild`. |

*(Note: on npm in 2026, `typescript@7.x` is the native Go port wrapper without `lib/typescript.js`, and `prettier@3.x` is async-only; pinning `typescript@5.9.3` and `prettier@2.8.8` provides the canonical single-script JS compiler and synchronous formatter bundles.)*

---

## 2. Original Baseline Measurements & V8 Snapshot Reference

Measured on Node `v26.7.0` (`linux/x64`, 4 CPUs, 15.6 GB RAM; `node -e 0` cold baseline median `69.70 ms`):

| Workload | N | Raw | Gzip (Terser) | Cold `node` Net Med (p90) | V8 `cachedData` Med (p90) | VM Exec-Only Med (p90) | V8 `--snapshot-blob` Net Med (Blob) |
|---|---:|---:|---:|---:|---:|---:|---|
| **`moment-timezone`** | 15 | 913.3 KB | 55.0 KB | 26.44 (39.97) ms | 9.32 (17.96) ms | 10.40 (21.35) ms | 21.10 ms (8.7 MB) |
| **`prettier`** | 15 | 1065.6 KB | 290.4 KB | 123.95 (128.38) ms | 20.55 (40.19) ms | 22.74 (35.04) ms | 76.44 ms (8.0 MB) |
| **`highlight-js`** | 15 | 1834.5 KB | 299.3 KB | 105.03 (212.28) ms | 17.96 (40.58) ms | 51.92 (65.79) ms | *unsupported* (`std::length_error` in Node C++ snapshotter) |
| **`three`** | 15 | 1914.4 KB | 183.2 KB | 37.71 (59.71) ms | 5.09 (6.53) ms | 4.90 (7.17) ms | 15.39 ms (10.4 MB) |
| **`mathjs`** | 15 | 2117.9 KB | 212.5 KB | 264.24 (305.39) ms | 183.88 (226.15) ms | 190.07 (211.97) ms | *unsupported* (`std::length_error` in Node C++ snapshotter) |
| **`babel-standalone`** | 12 | 5248.9 KB | 644.3 KB | 229.01 (286.59) ms | 69.02 (80.08) ms | 72.48 (79.44) ms | *unsupported* (`localStorage` getter probe during snapshot) |
| **`typescript`** | 12 | 8899.1 KB | 944.8 KB | 194.97 (214.17) ms | 23.02 (36.67) ms | 21.85 (38.92) ms | 88.39 ms (18.8 MB) |

Notable engine observation: Node 26's native `--build-snapshot` fails on **3 of the 7 large workloads** (`mathjs` and `highlight-js` abort inside V8/Node C++ serialization with `std::length_error: vector::_M_range_insert`, while `babel-standalone` trips Node's unconfigured `globalThis.localStorage` getter).

---

## 3. Current Prepack (`revive`) Results on the 7 Large Workloads

- **Summary across the 7 large workloads**: **1 `OK`**, **1 `WRONG`** *(silent miscompile)*, **5 `FAIL`**, **0 `TIMEOUT`**.
- **Combined 22-workload corpus**: **10 `OK` default** / **12 `OK` best profile**, **2 `WRONG`**, **8 `FAIL`**, **0 `TIMEOUT`**.

| Workload | Default | Best | Compile Time | Peak RSS | Primary Blocker / Result |
|---|---|---|---:|---:|---|
| **`moment-timezone`** | **OK** | **OK** (`default`) | 3,462 ms | 376.9 MB | Passes (`1.05x` code-cache speedup, `9.32 -> 8.89 ms`; `1.09x` VM exec speedup; `1.32x` gzip size `55.0 -> 72.6 KB`; `node-react` fails with `PP0031`). |
| **`highlight-js`** | **WRONG** | **WRONG** | 1,000 ms | 260.7 MB | **Silent miscompile (`Warning PP0023` only)** across all 6 profiles: Prepack throws inside `deepFreeze` (`Object.getOwnPropertyNames(obj).forEach(...)` at `L54:36`) and emits a bundle that unconditionally throws `TypeError` at startup. |
| **`three`** | **FAIL** | **FAIL** | 2,773 ms | 467.2 MB | `FatalError PP0037` wrapping `PP0001` (`$ArrayBufferData` unsupported inside 256-iteration init loop at `L454:5`); `jsc` profile silently miscompiles (`WRONG PP0023`). |
| **`babel-standalone`** | **FAIL** | **FAIL** | 12,875 ms | 1,054.9 MB | Evaluates ~13s / 1.05 GB into init, then aborts with `FatalError PP0037` wrapping `PP0001` (`$ArrayBufferData` inside loop at `L35867:3`); `jsc` fails with `PP0001` on `new Set(iterable)`. |
| **`prettier`** | **FAIL** | **FAIL** | 40 ms | 94.7 MB | `FatalError PP1004` at `L1:694` (`@babel/parser` plugin `optionalCatchBinding` not enabled for ES2019 `catch {}`). |
| **`mathjs`** | **FAIL** | **FAIL** | 128 ms | 129.8 MB | `FatalError PP1004` at `L9000:37` (ES2020 `BigInt` literal `1n` unsupported by Prepack's parser/values). |
| **`typescript`** | **FAIL** | **FAIL** | 185 ms | 125.4 MB | `FatalError PP1004` at `L2387:27` (`@babel/parser` plugin `nullishCoalescingOperator` not enabled for ES2020 `??`). |

---

## 4. Harness Scaling & Hybrid Compatibility

1. **Timeouts & Heap Scaling**:
   - Large workloads (`>= 750 KB` or `tier: "large"`) default to a **15-minute (`900,000 ms`) worker timeout** (`--large-timeout`) and **`--max-old-space-size=16384` (16 GB)**, forwarded both via `options.timeout` (so Hybrid's capture worker and Prepack's `Realm` share the same limit) and `NODE_OPTIONS` (for nested sub-workers).
   - A memory-weighted worker pool runs `>= 3 MB` workloads (`babel-standalone`, `typescript`) with full worker capacity (1 at a time on a 4-CPU / 15.6 GB host) and `0.75–3 MB` workloads at half concurrency, avoiding Linux kernel OOM kills while keeping `< 750 KB` workloads at 4-way parallelism.
   - Compile time (`compileMs`) and peak worker memory (`peakRssMb` via `process.resourceUsage().maxRSS` + `/proc/<pid>/status` `VmHWM` polling) are recorded for every profile outcome (`OK`, `WRONG`, `FAIL`, `TIMEOUT`).
   - Terser size measurement on files `>= 512 KB` runs in an isolated child process (`--max-old-space-size=8192`, 5-minute timeout) so multi-MB minification ASTs never bloat or hang the benchmark driver.
2. **Adaptive Perf Iterations**:
   - `< 750 KB` (all 15 original workloads): `N=30, warmup=5` (unchanged).
   - `0.75 MB – 3 MB` (`moment-timezone`, `prettier`, `highlight-js`, `three`, `mathjs`): `N=15, warmup=3`.
   - `>= 3 MB` (`babel-standalone`, `typescript`): `N=12, warmup=3` (`N >= 10` preserved; disable with `--no-adapt-runs`).
3. **Original Baselines on All Workloads**:
   - `origPerf` is recorded on all 22 library entries even when Prepack fails, while `perf` retains its exact `OK`-only schema so `hybrid/bench-compare.js` works unchanged.
4. **Driving Hybrid (`hybrid/index.js`)**:
   - Verified end-to-end with `node bench/run.js --prepack /tmp/opencode/pp-wt/hybrid/hybrid/index.js` (e.g. `moment-timezone`, `highlight-js`, and 8.9 MB `typescript` all capture, emit, and pass VM + fresh-Node smoke checks in zero-flag `default` mode; `three`, `mathjs`, `babel-standalone` hit explicit volatile `Math.random`/`new Date` guards; `prettier` hits a clean `WeakMap` state bailout).

---

## 5. Commands

```sh
# 1. Install npm packages inside bench/node_modules and build all 22 workloads
node bench/setup.js

# 2. Full 22-workload sweep + perf harness against Prepack (revive)
node bench/run.js --prepack lib/prepack-node.js

# 3. Run only the 7 large workloads against Prepack
node bench/run.js --prepack lib/prepack-node.js \
  --only moment-timezone,prettier,highlight-js,three,mathjs,babel-standalone,typescript

# 4. Measure Original-only baselines (timings, sizes, V8 snapshots) without running Prepack
node bench/run.js --orig-only

# 5. Drive Hybrid head-to-head on the same workloads
node bench/run.js --prepack /path/to/hybrid/index.js --profiles default \
  --out-json bench/results/hybrid.json --out-md bench/results/hybrid.md
```
