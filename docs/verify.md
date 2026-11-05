# Verification: the heap-isomorphism oracle (`lib/verify.js`, `lib/behavioral.js`)

## Overview

The verifier is an **independent oracle**: it shares no code with capture, emit or the environment layer and uses only Node built-ins (`vm`, `inspector`, `v8`, `util`, `crypto`) plus `acorn`. `freezedry --verify` (or `freeze(..., { verify: true })`) runs it on every build and rejects the output on any difference; the benchmark's oracle mode (`tools/oracle-one.js`, `bench/compare.js`) runs it per workload.

## What it checks

1. **Heap Isomorphism Oracle (`lib/verify.js`)**:
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

2. **Behavioral Checks (`lib/behavioral.js`)**:
   - `verifySmoke(originalSrc, outputSrc, opts)`: executes `bench/libs/specs.js` smoke suites in VM (and optionally fresh Node via `checkFreshNode: true`) and compares SHA-256 digests.
   - `verifyMutationProbe(originalSrc, outputSrc, opts)`: invokes explicit probes or auto-discovered exported root functions/methods under a synchronized deterministic PRNG/clock, comparing thrown/returned values and re-running full heap isomorphism on the post-mutation heaps.

3. **Benchmark integration**:
   - `lib/bench-adapter.js` adapts Prepack-style `prepackSources` options (as passed by `bench/worker.js`) to freezedry options, reports diagnostics through `errorHandler`, and gates outputs on `verify` when requested (`FZD_VERIFY_FAILED`).
   - `tools/oracle-one.js <id> <out.jsonl>` runs the full oracle (heap + `[[Scopes]]` + context sharing + smoke) for one workload in its own process and appends a JSON line; `bench/compare.js` drives it across the corpus.

## Oracle findings on the standard corpus

Running the oracle on the original workloads (before any compilation) separates deterministic heaps from ones that read clocks or RNGs during init:

- **10 / 15** standard workloads (`underscore`, `ramda`, `moment`, `chroma-js`, `acorn`, `crc-32`, `marked`, `handlebars-app`, `preact-ssr-app`, `yaml-router-app`) have **deterministic heaps**: two runs are isomorphic with no seeding.
- **5 / 15** read volatile clock/RNG APIs during module init, which is why freezedry bails on them by default or bakes the values under `--allow-volatile`:
  - `lodash`: `Date.now()` stored in `shortOut` closure (`_.cond (scope var "baseRest") (scope var "setToString") (scope var "lastCalled")`)
  - `immutable`: `Math.random()` hash salt (`... (scope var "COLLISION_HASH_BASE")`)
  - `d3-scale`: `new Date()` scratch instances (`d3.timeInterval (scope var "t0")`)
  - `redux`: `Math.random()` action type token (`... (scope var "actionTypes_default").INIT`)
  - `react-ssr-app`: `Date.now()` / `performance.now()` scheduler baseline
- **Rejected states**: `Proxy` objects and pending `Promise`s are flagged immediately (`unsupported-slot` / `pending-promise`).

Baked volatiles are replayed: verify registers the recorded values as replay functions (and replays Error stack text through `Error.prepareStackTrace`), so `ISO-OK†` in the results means "equivalent given the values recorded at build time".

## Details

- Runs in a `DONT_CONTEXTIFY` realm, uses acorn for free-variable and strictness analysis, recovers named-function-expression and lexical-`this` context edges from the heap snapshot, and aligns `[[Scopes]]` frames with V8 contexts.
- Checks guard conditions before comparing.
- A named function expression's own name is excluded from the binding comparison only when the function is an NFE with that name in both realms (via `[[FunctionLocation]]`). Declaration-versus-NFE differences are still compared.

## Interfaces

- `require("freezedry/lib/verify").verify(originalSrc, outputSrc, opts) -> { ok, firstDiff, stats }`
- `verifySmoke(originalSrc, outputSrc, opts)`, `verifyMutationProbe(originalSrc, outputSrc, opts)`
- `require("freezedry/lib/bench-adapter").createPrepackSources(customPipeline)`

## Known limits

- On the 18–19 MB outputs (mathjs, typescript) the oracle needs more than 12 GB RSS (two realms holding the program plus a full JSON heap snapshot), so those workloads are reported **UNVERIFIED**. Streaming or pruning the heap snapshot, comparing scopes lazily, or running the two realms in separate processes would fix it.
