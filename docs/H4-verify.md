# Track H4: Heap Isomorphism Verifier & Benchmark Integration

## Overview

Track H4 provides the **independent verification oracle** (`hybrid/lib/verify.js` + `hybrid/lib/behavioral.js`), the **Prepack benchmark adapter** (`hybrid/lib/bench-adapter.js`), and the **side-by-side comparison report generator** (`hybrid/bench-compare.js`). It shares no code with H1 (capture), H2 (emit), or H3 (environment/guard), relying strictly on Node 26 built-ins (`vm`, `inspector`, `v8`, `util`, `crypto`).

## What Works

1. **Heap Isomorphism Oracle (`hybrid/lib/verify.js`)**:
   - `verify(originalSrc, outputSrc, opts) -> { ok, firstDiff, stats }`
   - Executes `originalSrc` and `outputSrc` in two isolated `vm.createContext({})` realms configured with an identical environment profile (`"bare"`, `"bench"`/`"browser"`, `"node"`, plus optional `mathRandomSeed`, `fixedTime`, `assume`, `globals`, `prelude`).
   - Snapshots 810+ baseline intrinsics (including hidden `%GeneratorPrototype%`, `%AsyncFunction.prototype%`, `%TypedArray%`, `%ArrayIteratorPrototype%`, `%ErrorStackGetter%`, etc.) before running user scripts to detect both **global root changes** and **intrinsic polyfill patches / leaks** (`Object.prototype`, `Array.prototype`, etc.).
   - Iterative BFS walk maintaining exact bijections across:
     - **Heap objects & functions** (catches both lost DAG sharing and spurious aliasing; handles arbitrary cycles without stack overflow).
     - **Symbols** (well-known symbols, `Symbol.for(...)`, and a bijection for unique unregistered `Symbol(...)` values and property keys).
     - **Descriptors & property order** (`Reflect.ownKeys` in exact order, data vs accessor without invoking getters, `writable`/`enumerable`/`configurable`).
     - **Object integrity & prototypes** (`isFrozen`, `isSealed`, `isExtensible`, intrinsic or mapped `[[Prototype]]`).
     - **Primitives** (`Object.is` / `SameValue`, distinguishing `-0` vs `+0` and matching `NaN` to `NaN`).
     - **Exotics**: `Array` (including sparse holes vs `undefined`), `Date` (`getTime` via `Object.is`), `RegExp` (`source`, `flags`, `lastIndex`), `Map` and `Set` (iteration order), `ArrayBuffer` / `SharedArrayBuffer`, `TypedArray` / `DataView` (`ctor`, `byteOffset`, `byteLength`, `length`, elements, and shared `.buffer` identity), boxed primitives, `Error`, settled `Promise` (`[[PromiseState]]` / `[[PromiseResult]]`, filtering Node's `async_hooks` symbols), and bound functions (`[[TargetFunction]]`, `[[BoundThis]]`, `[[BoundArgs]]`).
     - **Functions & Closure State**: `kind` (`normal`, `arrow`, `method`, `getter`, `setter`, `generator`, `async`, `asyncArrow`, `asyncMethod`, `asyncGenerator`, `class`, `bound`, `native`), `strict` mode (runtime `caller` check for normal functions + `Debugger.getScriptSource` lexical interval scan for arrow/method/async/generator), `fn.toString()`, `[[Scopes]]` variable values via `inspector.Session`, and **closure scope sharing** via V8 `v8.getHeapSnapshot()` `Context` chain node IDs (bijection on `(ctxId, varName)` catching both lost sharing and spurious scope merging, while tolerating eliminated dead compile-time helpers).
   - Reports pinpoint paths on first mismatch, e.g. `_.templateSettings.imports._ (scope var "root").scale`, `counter.get (scope var "count")`, `views.b.buffer`.

2. **Behavioral Checks (`hybrid/lib/behavioral.js`)**:
   - `verifySmoke(originalSrc, outputSrc, opts)`: executes `bench/libs/specs.js` smoke suites in VM (and optionally fresh Node via `checkFreshNode: true`) and compares SHA-256 digests.
   - `verifyMutationProbe(originalSrc, outputSrc, opts)`: invokes explicit probes or auto-discovered exported root functions/methods under a synchronized deterministic PRNG/clock, comparing thrown/returned values and re-running full heap isomorphism on the post-mutation heaps.

3. **Benchmark Adapter & Comparison Generator**:
   - `node bench/run.js --prepack hybrid/index.js` runs unchanged against all 15 corpus workloads (currently using the self-labeled `HYB_STANDIN` identity transform until H1/H2/H3 merge; auto-loads `./capture`, `./emit`, `./guard` once present).
   - `node hybrid/bench-compare.js` generates `hybrid/results/comparison.md` and `hybrid/results/comparison.json` comparing Original vs Prepack (`0.2.55-alpha.0`) vs Hybrid + V8 `--build-snapshot` + Heap Isomorphism Oracle status across all 15 libraries.

## What Fails / Bails in Unseeded Init (Oracle Findings on the 15-Lib Corpus)

Running the oracle across all 15 workloads in `bench/libs/dist/*.js`:
- **10 / 15** (`underscore`, `ramda`, `moment`, `chroma-js`, `acorn`, `crc-32`, `marked`, `handlebars-app`, `preact-ssr-app`, `yaml-router-app`) are **strictly deterministic heaps** (`ISO-OK` with zero seeding).
- **5 / 15** read volatile clock/RNG APIs during module init (which H1/H3 must either bail out on by default or guard under `--assume` / `--mathRandomSeed`):
  - `lodash`: `Date.now()` stored in `shortOut` closure (`_.cond (scope var "baseRest") (scope var "setToString") (scope var "lastCalled")`)
  - `immutable`: `Math.random()` hash salt (`... (scope var "COLLISION_HASH_BASE")`)
  - `d3-scale`: `new Date()` scratch instances (`d3.timeInterval (scope var "t0")`)
  - `redux`: `Math.random()` action type token (`... (scope var "actionTypes_default").INIT`)
  - `react-ssr-app`: `Date.now()` / `performance.now()` scheduler baseline (`...Scheduler.unstable_scheduleCallback (scope var "v") (scope var "Ca")`)
  - All 5 pass `verify()` (`15 / 15 ISO-OK`) when `mathRandomSeed` and `fixedTime` are supplied.
- **Rejected states**: `Proxy` objects and pending `Promise`s are flagged immediately by `verify()` (`unsupported-slot` / `pending-promise`).

## Interfaces Owned by H4

- `require("./hybrid/lib/verify").verify(originalSrc, outputSrc, opts) -> { ok, firstDiff, stats }`
- `require("./hybrid/lib/verify").verifySmoke(originalSrc, outputSrc, opts)`
- `require("./hybrid/lib/verify").verifyMutationProbe(originalSrc, outputSrc, opts)`
- `require("./hybrid/lib/bench-adapter").createPrepackSources(customPipeline)`
- `node hybrid/bench-compare.js [--run-hybrid] [--prepack-json ...] [--hybrid-json ...]`

## Next Steps (Post-Merge)

1. Once H1 (`hybrid/lib/capture.js`), H2 (`hybrid/lib/emit.js`), and H3 (`hybrid/lib/guard.js`) merge, `hybrid/lib/bench-adapter.js` (`tryLoadRealPipeline()`) will automatically pick them up in `prepackSources` without adapter changes; verify signature alignment (`capture(code, opts) -> graph`, `emit(graph, opts) -> code | { code }`, `wrapWithGuard(outCode, origCode, assumptions, opts) -> code`).
2. Re-run `HYBRID_VERIFY=1 node hybrid/bench-compare.js --run-hybrid --runs 30 --warmup 5` so every library compiled by H1+H2+H3 is gated by heap isomorphism + smoke + post-init mutation probes and benchmarked at full 30-run precision.
