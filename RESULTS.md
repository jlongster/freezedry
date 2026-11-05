# Hybrid Prepack — H5 Results (integration + tuning)

Branch `hybrid` @ worktree `/tmp/opencode/pp-wt/hybrid`. It includes the final `revive` @ `4cf07184` (with `bench2`) and the sibling `react-hybrid` track (`hybrid/react/`, see section 6).
Host: Node v26.7.0 / V8 14.6 on linux/x64 (15 GB RAM, shared with other jobs, so timings are noisy at sub-ms scale).

Compared:

- **Original**: unmodified `bench/libs/dist/*.js`.
- **Prepack**: the final `/tmp/opencode/pp-work/lib/prepack-node.js`, rebuilt from revive `4cf07184` (all tracks merged) at 18:33 UTC. The Prepack side was measured with exactly this build at 19:00–19:17 UTC (`results/prepack-final.{json,md}`), using all 6 option profiles and reporting the best one. The `4cf07184` merge changed nothing under `bench/`, so the hybrid runs use the same harness and corpus.
- **Hybrid**: `hybrid/index.js` (run → capture → emit → guard → verify), default `function` guard fallback. Zero-config (`results/hybrid-final-zeroconfig.*`) and with the documented per-library opt-ins (`HYBRID_OPTINS=corpus`, `results/hybrid-final-optins.*`). Hybrid ignores Prepack's profile flags, so it runs only the `default` profile.

All raw data, including the generated three-way reports (`results/comparison-final-{optins,zeroconfig}.md`) and per-workload oracle records (`results/oracle-{optins,zeroconfig}.jsonl`), is in `hybrid/results/`.

## Headline

| | Prepack (best profile) | Hybrid zero-config | Hybrid opt-ins |
|---|---:|---:|---:|
| Smoke OK (22 workloads) | 18 | 11 | 21 |
| **H4 oracle verified** (heap + `[[Scopes]]` + context sharing + smoke) | n/a | **11** | **19** |
| Clean bailout (original code kept) | 4 FAIL | 11 | 1 (prettier) |
| Smoke OK but oracle could not finish (OOM) | — | — | 2 (mathjs, typescript) |
| **WRONG (silent miscompile)** | **0** | **0** | **0** |

Hard rule: a hybrid result only counts as correct when it passes the H4 oracle. mathjs and typescript compile and pass smoke in VM and fresh Node, but the oracle needs more than 12 GB RSS (two realms holding an 18–19 MB program plus a heap snapshot) and the kernel kills it on this host. They are reported as **UNVERIFIED**, not OK.

`ISO-OK†` = verified with baked volatiles (`--allow-volatile`). The oracle replays exactly the values recorded at build time, so it proves equivalence given those values.

## 1. Correctness (all 22 workloads)

| Workload | Tier | Prepack | Hybrid zero-config (oracle) | Hybrid opt-ins (oracle) |
|---|:-:|---|---|---|
| `lodash` | S | OK (browser-opt) | FAIL (BAIL) | OK (ISO-OK†) |
| `underscore` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `ramda` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `immutable` | S | OK | FAIL (BAIL) | OK (ISO-OK†) |
| `moment` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `chroma-js` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `acorn` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `crc-32` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `marked` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `d3-scale` | S | OK | FAIL (BAIL) | OK (ISO-OK†) |
| `redux` | S | OK | FAIL (BAIL) | OK (ISO-OK†) |
| `handlebars-app` | S | OK (browser-opt) | FAIL (BAIL) | OK (ISO-OK†) |
| `preact-ssr-app` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `react-ssr-app` | S | OK | FAIL (BAIL) | OK (ISO-OK†) |
| `yaml-router-app` | S | OK | OK (ISO-OK) | OK (ISO-OK) |
| `moment-timezone` | L | OK (browser-opt) | OK (ISO-OK) | OK (ISO-OK) |
| `prettier` | L | FAIL | FAIL (BAIL) | FAIL (BAIL) |
| `highlight-js` | L | OK | OK (ISO-OK) | OK (ISO-OK) |
| `three` | L | OK | FAIL (BAIL) | OK (ISO-OK†) |
| `mathjs` | L | FAIL | FAIL (BAIL) | OK (UNVERIFIED) |
| `babel-standalone` | L | FAIL | FAIL (BAIL) | OK (ISO-OK†) |
| `typescript` | L | FAIL | FAIL (BAIL) | OK (UNVERIFIED) |


How Prepack's numbers changed versus the stale build used in Phase B: crc-32, marked, d3-scale, underscore (default), redux (default), handlebars-app and highlight-js are now OK, and three and moment-timezone (best profile) compile. Prepack still fails prettier, mathjs, babel-standalone and typescript (`PP0001` abstract-value operations).

## 2. Size, cold start, code cache, exec-only (hybrid = opt-ins build, default `function` fallback)

The speedup in parentheses is the harness's paired-sample speedup versus the original (>1 = faster). "Cold node net" is a fresh `node` process minus the `node -e 0` baseline. "Code-cache" runs the script in a VM context with V8 cached data. "Exec-only" is the VM run with compilation excluded. Sizes: raw bytes, and gzip of the terser-minified output.

| Workload | Raw KB (Orig / PP / Hyb) | Gzip of terser output (Orig / PP / Hyb) | Cold node net ms (Orig / PP / Hyb) | Code-cache ms (Orig / PP / Hyb) | Exec-only ms (Orig / PP / Hyb) |
|---|---|---|---|---|---|
| `lodash` | 533.1 KB / 538.5 KB / 906.4 KB | 24.5 KB / 23.9 KB / 76.4 KB | 17.82 / 17.43 (0.95x) / 30.77 (0.58x) | 4.26 / 4.39 (0.80x) / 3.20 (1.33x) | 3.32 / 3.45 (1.01x) / 2.58 (1.29x) |
| `underscore` | 67.3 KB / 68.6 KB / 99.1 KB | 7.2 KB / 8.1 KB / 14.0 KB | 2.76 / 1.54 (0.53x) / 4.92 (0.56x) | 0.87 / 0.63 (1.02x) / 0.89 (0.97x) | 0.80 / 0.59 (1.00x) / 0.83 (0.96x) |
| `ramda` | 342.9 KB / 137.4 KB / 232.9 KB | 14.1 KB / 15.6 KB / 32.0 KB | 5.08 / 4.03 (0.98x) / 8.04 (0.63x) | 0.84 / 0.47 (1.76x) / 0.55 (1.54x) | 0.85 / 0.56 (1.78x) / 0.54 (1.57x) |
| `immutable` | 175.4 KB / 144.6 KB / 290.8 KB | 18.0 KB / 17.9 KB / 36.9 KB | 5.70 / 6.34 (0.91x) / 11.33 (0.50x) | 1.60 / 1.33 (1.12x) / 1.72 (0.93x) | 1.34 / 1.16 (1.13x) / 1.43 (0.94x) |
| `moment` | 637.8 KB / 669.3 KB / 1.03 MB | 74.3 KB / 98.4 KB / 167.4 KB | 26.71 / 25.20 (1.01x) / 39.45 (0.68x) | 11.65 / 2.48 (4.56x) / 4.01 (2.91x) | 12.84 / 2.47 (4.49x) / 4.32 (2.97x) |
| `chroma-js` | 109.2 KB / 85.4 KB / 173.0 KB | 15.4 KB / 14.5 KB / 30.1 KB | 4.87 / 4.34 (0.47x) / 7.64 (0.64x) | 0.86 / 0.97 (1.09x) / 0.80 (1.06x) | 0.86 / 0.89 (1.11x) / 0.78 (1.11x) |
| `acorn` | 240.9 KB / 252.0 KB / 429.1 KB | 33.9 KB / 36.5 KB / 72.6 KB | 10.01 / 9.06 (0.98x) / 17.38 (0.58x) | 1.64 / 1.60 (1.21x) / 1.57 (1.05x) | 1.59 / 1.42 (1.21x) / 1.55 (1.02x) |
| `crc-32` | 3.6 KB / 105.0 KB / 6.7 KB | 0.8 KB / 44.0 KB / 1.2 KB | 3.43 / 1.40 (1.68x) / 2.64 (1.30x) | 0.46 / 0.25 (1.31x) / 0.46 (1.00x) | 0.63 / 0.23 (1.49x) / 0.41 (1.55x) |
| `marked` | 49.4 KB / 74.2 KB / 113.3 KB | 14.5 KB / 14.4 KB / 27.8 KB | 35.22 / 35.42 (1.05x) / 40.59 (0.87x) | 1.32 / 1.30 (1.02x) / 1.18 (1.12x) | 1.28 / 1.22 (0.99x) / 1.14 (1.12x) |
| `d3-scale` | 148.9 KB / 184.1 KB / 363.9 KB | 23.0 KB / 28.8 KB / 53.3 KB | 6.07 / 6.17 (0.59x) / 13.84 (0.44x) | 1.19 / 0.76 (1.62x) / 0.92 (1.30x) | 1.07 / 0.56 (1.71x) / 0.84 (1.28x) |
| `redux` | 18.1 KB / 14.4 KB / 30.2 KB | 3.3 KB / 2.9 KB / 4.2 KB | 0.88 / 0.11 (4.97x) / 0.00 | 0.32 / 0.32 (1.26x) / 0.26 (1.24x) | 0.31 / 0.25 (1.22x) / 0.24 (1.28x) |
| `handlebars-app` | 211.9 KB / 202.1 KB / 346.4 KB | 26.3 KB / 26.7 KB / 52.7 KB | 18.49 / 5.62 (3.03x) / 10.81 (1.71x) | 3.70 / 1.11 (3.04x) / 1.14 (3.25x) | 3.50 / 1.11 (3.21x) / 1.17 (3.01x) |
| `preact-ssr-app` | 22.0 KB / 35.9 KB / 46.2 KB | 8.6 KB / 8.8 KB / 12.8 KB | 1.83 / 1.30 (1.58x) / 1.31 (1.40x) | 0.47 / 0.34 (1.20x) / 0.47 (0.99x) | 0.41 / 0.34 (1.21x) / 0.47 (0.87x) |
| `react-ssr-app` | 47.0 KB / 94.9 KB / 132.1 KB | 15.2 KB / 17.8 KB / 31.6 KB | 6.17 / 5.41 (0.89x) / 9.28 (0.67x) | 0.97 / 0.68 (1.52x) / 0.82 (1.18x) | 0.92 / 0.61 (1.51x) / 0.79 (1.17x) |
| `yaml-router-app` | 157.1 KB / 124.9 KB / 249.7 KB | 17.2 KB / 17.6 KB / 33.4 KB | 10.67 / 3.75 (2.58x) / 6.91 (1.55x) | 2.79 / 0.83 (2.82x) / 0.84 (3.31x) | 2.40 / 0.67 (2.62x) / 0.79 (3.05x) |
| `moment-timezone` | 913.3 KB / 1001.2 KB / 1.78 MB | 55.0 KB / 73.8 KB / 127.9 KB | 38.05 / 21.84 (1.10x) / 41.64 (0.91x) | 10.97 / 6.41 (1.52x) / 9.05 (1.21x) | 9.61 / 5.64 (1.38x) / 7.75 (1.24x) |
| `prettier` | 1.04 MB / — / — | — / — / — | — / — / — | — / — / — | — / — / — |
| `highlight-js` | 1.79 MB / 2.52 MB / 4.04 MB | 299.3 KB / 595.5 KB / 757.8 KB | 94.17 / 83.40 (1.07x) / 112.04 (0.84x) | 16.25 / 12.73 (1.24x) / 16.10 (1.01x) | 17.32 / 13.06 (1.29x) / 14.10 (1.23x) |
| `three` | 1.87 MB / 1.44 MB / 3.17 MB | 183.2 KB / 206.4 KB / 399.8 KB | 38.24 / 36.77 (0.99x) / 61.17 (0.63x) | 4.83 / 4.82 (0.97x) / 6.13 (0.79x) | 4.61 / 5.04 (0.92x) / 5.75 (0.80x) |
| `mathjs` | 2.07 MB / — / 18.77 MB | 212.5 KB / — / 1.21 MB | 291.59 / — / 905.48 (0.32x) | 211.12 / — / 115.22 (1.83x) | 164.77 / — / 95.15 (1.73x) |
| `babel-standalone` | 5.13 MB / — / 10.05 MB | 644.3 KB / — / 1.37 MB | 199.28 / — / 325.35 (0.61x) | 71.06 / — / 54.80 (1.30x) | 69.76 / — / 54.84 (1.27x) |
| `typescript` | 8.69 MB / — / 18.01 MB | 944.8 KB / — / 2.07 MB | 197.20 / — / 403.06 (0.49x) | 22.88 / — / 35.06 (0.65x) | 21.58 / — / 32.56 (0.66x) |


Reading the numbers:

- **Code-cache and exec-only (what a warm app or a snapshot-backed startup pays)**: hybrid is faster than the original on 15 of 21 compiled workloads: yaml-router-app 3.3x, handlebars-app 3.3x, moment 2.9x, mathjs 1.8x, ramda 1.5x, lodash 1.3x, babel-standalone 1.3x, d3-scale 1.3x, redux 1.2x, moment-timezone 1.2x, react-ssr-app 1.2x; chroma-js, acorn, marked and highlight-js gain 1–12%. It is about level (0.93–1.00x) on underscore, immutable, preact-ssr-app and crc-32. It is slower on three (0.8x) and typescript (0.65x), where reconstructing the much larger heap (output about 2x raw) costs more than the init code it replaces.
- **Against Prepack**, where Prepack compiles, Prepack is usually faster on code-cache/exec (moment 2.5 vs 4.0 ms, crc-32, d3-scale, react-ssr-app, highlight-js, three, moment-timezone) and smaller (gzip about 1.0x of the original versus about 2x for hybrid with the fallback). Hybrid beats it on lodash (3.2 vs 4.4 ms), chroma-js and marked, and ties on acorn, handlebars-app and yaml-router-app. Hybrid's advantages are coverage (it is the only one to produce code for mathjs, babel-standalone and typescript, with babel-standalone oracle-verified) and a machine-checked equivalence proof for every counted output.
- **Cold `node` start** is worse for hybrid on most workloads (0.4–0.9x). The default `function` fallback embeds the whole original source behind the guard, so V8 scans about 2x the bytes. Section 3 separates the residual from the fallback.
- **Size**: with the fallback, hybrid is 1.25–2.5x the original (gzip of terser output), with lodash at 3.1x (its 497 KB `runInContext` factory is retained) and mathjs at 5.8x (19 MB raw residual heap). Without the fallback the residual alone is close to the original: section 3.

## 3. Residual-only reference (`HYBRID_FALLBACK=throw`, standard tier)

`fallback: "throw"` keeps only the guard and residual (no embedded original). Use it when the deployment environment is known; it is not the safe default. Data: `results/hybrid-final-optins-throw.*`.

| Workload | Raw (Orig / Hyb function / Hyb throw) | Gzip terser (Orig / Hyb function / Hyb throw) | Cold node net ms (Orig / Hyb function / Hyb throw) |
|---|---|---|---|
| `lodash` | 533.1 KB / 906.4 KB / 755.9 KB | 24.5 KB / 76.4 KB / 52.7 KB | 18.00 / 30.77 / 22.45 (0.802x) |
| `underscore` | 67.3 KB / 99.1 KB / 64.7 KB | 7.2 KB / 14.0 KB / 9.5 KB | 1.55 / 4.92 / 1.03 (1.511x) |
| `ramda` | 342.9 KB / 232.9 KB / 146.6 KB | 14.1 KB / 32.0 KB / 18.8 KB | 5.15 / 8.04 / 5.55 (0.927x) |
| `immutable` | 175.4 KB / 290.8 KB / 171.0 KB | 18.0 KB / 36.9 KB / 20.0 KB | 6.30 / 11.33 / 6.86 (0.919x) |
| `moment` | 637.8 KB / 1056.8 KB / 676.6 KB | 74.3 KB / 167.4 KB / 93.7 KB | 26.97 / 39.45 / 30.30 (0.89x) |
| `chroma-js` | 109.2 KB / 173.0 KB / 108.1 KB | 15.4 KB / 30.1 KB / 16.4 KB | 2.88 / 7.64 / 4.23 (0.681x) |
| `acorn` | 240.9 KB / 429.1 KB / 267.5 KB | 33.9 KB / 72.6 KB / 38.7 KB | 8.55 / 17.38 / 8.74 (0.978x) |
| `crc-32` | 3.6 KB / 6.7 KB / 4.1 KB | 0.8 KB / 1.2 KB / 1.0 KB | 1.76 / 2.64 / 0.00 (nullx) |
| `marked` | 49.4 KB / 113.3 KB / 64.4 KB | 14.5 KB / 27.8 KB / 15.3 KB | 34.95 / 40.59 / 37.09 (0.942x) |
| `d3-scale` | 148.9 KB / 363.9 KB / 249.6 KB | 23.0 KB / 53.3 KB / 30.7 KB | 5.42 / 13.84 / 9.65 (0.561x) |
| `redux` | 18.1 KB / 30.2 KB / 16.0 KB | 3.3 KB / 4.2 KB / 3.1 KB | 0.31 / 0.00 / 0.00 (nullx) |
| `handlebars-app` | 211.9 KB / 346.4 KB / 210.4 KB | 26.3 KB / 52.7 KB / 27.4 KB | 17.72 / 10.81 / 8.79 (2.015x) |
| `preact-ssr-app` | 22.0 KB / 46.2 KB / 24.8 KB | 8.6 KB / 12.8 KB / 9.1 KB | 0.00 / 1.31 / 1.07 (0.001x) |
| `react-ssr-app` | — | — | WRONG (guard refuses in Node: profile asserts no performance/setImmediate) |
| `yaml-router-app` | 157.1 KB / 249.7 KB / 154.4 KB | 17.2 KB / 33.4 KB / 18.1 KB | 6.73 / 6.91 / 3.92 (1.719x) |

- Without the fallback, hybrid's gzip size is 0.94–1.33x the original (lodash 2.15x; ramda raw 0.43x). Cold start becomes faster than the original on underscore (1.5x), handlebars-app (2.0x) and yaml-router-app (1.7x), and about level on several others. Sub-millisecond "net" values (crc-32, redux, preact) are below the noise floor of the fresh-process measurement.
- **react-ssr-app in throw mode is the guard working as designed, not a miscompile.** The `universal` profile asserts `!("performance" in globalThis)` and `!("setImmediate" in globalThis)`, both false in real Node, so the guard refuses and throws. With the default `function` fallback, the same build falls back to the original and is OK (section 2). The bench harness labels any throw "WRONG"; with `fallback: "function"` (the default) there were 0 WRONG.

## 4. What changed in H5

Pipeline and integration:

- `hybrid/index.js` is one coherent pipeline: H3 environment (through H1 `beforeRun`/`afterRun`) → capture → emit → H3 `emitGuard` → optional H4 `verify`. Bailouts fall back to the original code and are reported through `errorHandler`. Sync `prepackSources` captures in a `--capture-worker` subprocess, which now inherits the parent's heap limit (needed for mathjs and typescript). `prepackSourcesAsync` runs in-process.
- The CLI (`bin/hybrid.js`) supports `--profile --assume --allow-volatile --assume-tz --verify --fallback`.
- `env-profiles.js` is the single source of truth for environments: a `universal` default profile and the aliases `bench`, `ecma` and `bare`.
- Per-library opt-ins live in one place (`bench-adapter.js` `getCorpusOptInForLibrary`, documented in `docs/env.md`) and are used only with `useCorpusOptIns` / `HYBRID_OPTINS=corpus`. Seeding `Math.random` is rejected.
- New volatile source: **Error stack text**. Formatting a stack during init (babel's `extendedTrace` stores one), assigning `Error.prepareStackTrace`, or reading it all bail by default. `--allow-volatile=Error.stack` bakes the text, and verify replays it through `Error.prepareStackTrace`.

Capture:

- Arrow functions with lexical `this` (including primitive `this` decoded from the heap snapshot) and zero-instance classes using `#private` members (`ownerClass` linking). This unlocked marked.

Emit correctness fixes, each found by the oracle on real workloads and covered by a regression test:

- The `class X extends Name` heritage reference keeps the shared scope binding instead of shadowing it with a wrapper parameter (three).
- Hoisted FunctionDeclarations keep their binding until the scope subtree ends when another function later takes over the name (babel `getModuleName`).
- Leaf-scope templates shared by several closures bake one name, and the other instances get `.name` reconciled (babel / gensync `transform` vs `loadOptionsImpl`).
- An anonymous function named by NamedEvaluation is only emitted inline when no strict wrapper is needed; otherwise it gets a slot and Phase-3 reconciliation (mathjs `parse`).
- Grouped get/set member reconciliation, direct out-slot and omitted-slot guards, and leaf templates only when all captured values exist (three, babel `__h$N is not defined`).
- Strict prologues, descriptor-exact prototype redefinition, source-faithful formatting, and intrinsic-identity keyed scope inputs.

Emit size and performance:

- Demand-driven pruning of dead scope variables; lazy default `fn.prototype` elision.
- SetFunctionName via `const name = fn`; no `__h$o` slots for self-bound scope functions; direct `res[i]` for single-use slots; `new Array(n)` out arrays.
- Root-hoisted leaf templates and single-use leaf IIFEs.
- Pure ArrayBuffer table recomputation (`lib/recompute-table.js`: crc-32 dropped from 30 KB to 6.7 KB, versus 105 KB from Prepack).
- The compacted `function` fallback body.

Oracle (verify):

- Runs in a `DONT_CONTEXTIFY` realm, uses acorn for free-variable and strictness analysis, recovers NFE and lexical-`this` context edges from the heap snapshot, and aligns `[[Scopes]]` frames with V8 contexts.
- Checks guard conditions and replays baked volatiles, registering the replay functions as intrinsics.
- **NFE self-reference**: a named function expression's own name is excluded from the binding comparison only when the function is an NFE with that name in both realms (via `[[FunctionLocation]]`). An outer binding captured only by dead closures in the original no longer causes a false DIFF; declaration-versus-NFE differences are still compared.

Testing and benchmarks:

- 148/148 tests (`npm test`): 131 hybrid unit and e2e tests plus 17 react-hybrid tests.
- The e2e corpus suite covers all 15 standard bundles in-process. The 7 large bundles run in `test/pipeline-large-e2e.test.js`, one subprocess each (gated by `HYBRID_E2E_LARGE=1`).
- `tools/oracle-one.js` and `bench-compare.js --oracle-jsonl` run the oracle one process per workload with incremental JSONL output.

## 5. What remains

- **prettier**: bails on a non-empty `WeakMap` (`__core-js_shared__.state`). Weak collections can't be enumerated from JS, so emitting it would mean approximating state, which the hard rules forbid. A fix needs heap-snapshot-based WeakMap entry recovery (V8 `EphemeronHashTable`) plus key-reachability proof.
- **mathjs and typescript are UNVERIFIED**: the oracle needs more than 12 GB RSS on 18–19 MB programs. Options: stream or prune the heap snapshot (the verify side currently materializes the full JSON snapshot), compare scopes lazily, or run the two realms in separate processes.
- **mathjs output size** (19 MB raw, 5.8x gzip): the captured heap holds large derived tables, factories and typed-function dispatch caches. It needs recompute-or-lazy emission for pure derived data (generalizing `recompute-table.js` beyond ArrayBuffers) and retention analysis like Prepack's size track (lodash `runInContext`).
- **Cold start**: the safe `function` fallback roughly doubles bytes to scan. Possible paths: an external fallback file (`fallback: "external"`), a lazily compiled fallback (V8 already pre-parses lazily, but scanning still costs), or a per-deployment `throw` mode when the environment is pinned.
- **Exec regressions** on three and typescript: emit cost is dominated by per-property definitions on very large heaps. Candidates: batch `Object.defineProperties`, more prototype literals, fewer Phase-3 fixups.
- **Zero-config coverage**: 11 of 22 workloads read a clock or RNG during init. Dead/scratch-value analysis (for example lodash `shortOut`, d3-time scratch `Date`s) could unlock several without opt-ins.

## 6. Sibling track: React-Hybrid (merged from `react-hybrid`)

`hybrid/react/` does trace-based template specialization of React SSR `renderToString` for a known app with unknown request data, guarded per request with a fallback to the real `renderToString`. On react-bench it is **500/500 byte-identical**, with 0 mismatches on 50,000 fuzzed inputs. Details and performance: `hybrid/react/README.md` and `hybrid/react/results/`. It touches only `hybrid/react/` and its own tests, so the main pipeline results above are unaffected.
