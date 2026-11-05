# Track H1: RUN + CAPTURE (`hybrid/lib/run.js`, `hybrid/lib/capture.js`)

## Overview

Track H1 executes JavaScript initialization code in a fresh V8 `vm` context (`vm.constants.DONT_CONTEXTIFY`), drains microtasks, and captures the resulting reachable heap into the canonical `DESIGN.md` JSON capture graph using JS reflection plus an in-process `inspector.Session` (`Runtime`, `Debugger`, and `HeapProfiler`).

## Public Interfaces

### `run(src, opts)` (`hybrid/lib/run.js`)
- `src`: `string` or `Array<{ filePath, fileContents }>` (compatible with `prepackSources`).
- `opts.env` / `opts.targetEnv`:
  - `"ecma"` (default): pure ECMAScript globals + `globalThis` (`this === globalThis`; V8's default `console` and `WebAssembly` globals are stripped; `global`, `self`, `window` absent).
  - `"browser"`: `"ecma"` + `self` and `window` aliased to `globalThis`.
  - `"worker"`: `"ecma"` + `self` aliased to `globalThis`.
  - `"node"`: `"ecma"` + `global` aliased to `globalThis`.
  - `"universal"`: `"ecma"` + `global`, `self`, and `window` aliased to `globalThis`.
  - Object form `{ preset?: "ecma"|"browser"|..., global?: boolean, self?: boolean, window?: boolean, console?: boolean, webAssembly?: boolean, globals?: Record<string, any> }`.
- **Why `vm.constants.DONT_CONTEXTIFY`**:
  - `probe.js` failed because wrapping a plain `{}` in a `Proxy` and passing it to `vm.createContext(proxy)` causes V8's C++ contextify interceptor to route `globalThis` through `proxy.get(target, "globalThis")`, returning `undefined`.
  - With `vm.constants.DONT_CONTEXTIFY`, `vm.runInContext("this", ctx)` returns V8's genuine `JSGlobalProxy` with zero C++ interceptor distortion (`this === globalThis` inside and outside `vm`).
  - Track H3 can intercept unknown global reads (`typeof module`, `document`, `window`) cleanly by wrapping `Object.getPrototypeOf(globalObj)` in a `Proxy` via `Object.setPrototypeOf(globalObj, trap)` inside `beforeRun` and restoring `origProto` in the cleanup function.
- **Hooks for Track H3**:
  - `beforeRun(ctx, intrinsicsMap, meta)`: runs after pristine intrinsics/descriptors are snapshotted and before user scripts execute. `meta` provides `{ globalObj, envConfig, intrinsicsMap, pristineGlobals, pristineIntrinsics, helpers, addAssumption(a), addBailout(b) }`. May return a cleanup function `() => void` called automatically after microtask draining so tracing wrappers do not appear as `intrinsicPatches`.
  - `afterRun(ctx, intrinsicsMap, meta)`: optional post-drain hook.

### `capture(src, opts)` and `captureFromRun(runResult, opts)` (`hybrid/lib/capture.js`)
- Returns `{ version: 1, roots, intrinsicPatches, nodes, assumptions, bailouts }`.
- Never throws on user-code runtime errors or unsupported heap structures; records `{ reason, where }` in `bailouts`.

## What Works (47 / 47 tests passing)

- **Scope identity & closures**:
  - Single lazy `HeapProfiler.takeHeapSnapshot({ captureNumericValue: true })` per capture maps each function's `HeapProfiler.getHeapObjectId` to its `Context` chain (`internal:context` -> `internal:previous` up to `NativeContext`), using `NativeContext` shape maps (`function_context_map`, `block_context_map`, `catch_context_map`, `script_context_map`) and `ScopeInfo` variable sets.
  - Functions sharing a V8 `Context` share the exact same `scope` node ID; outer contexts already materialized are cached in O(1) so large UMD bundles (`lodash`: 1,013 functions, 478 scopes) capture in ~1.8s.
  - Recovers named `FunctionExpression` self-bindings (`(function mySelf() { ... })`) hidden by V8's `[[Scopes]]` via `HeapProfiler.getObjectByHeapObjectId`.
  - Tracks AST variable declaration kinds (`let`, `const`, `var`, `param`, `fn`) and `FunctionDeclaration` vs `FunctionExpression` (`declaration: boolean`, critical for Babel's self-overwriting `function _typeof() { _typeof = ... }` helpers).
- **Functions, classes, prototypes, and `super`**:
  - All 9 `kind`s (`normal`, `arrow`, `method`, `getter`, `setter`, `generator`, `async`, `asyncGenerator`, `class`), exact `strict` mode detection via Acorn + `[[FunctionLocation]]` + `Debugger.getScriptSource` (including dynamic `new Function(...)`), bound functions (`[[TargetFunction]]`, `[[BoundThis]]`, `[[BoundArgs]]`), and optional `homeObject` for concise methods using `super`.
  - Note for Track H2 (Emit): ES2015 `class` constructors have a non-configurable, non-writable `.prototype`; when instantiating a `class`, adopt `Cls.prototype` as the object table entry for its prototype node ID so `instanceof` holds for pre-existing instances.
- **Objects, collections, binary data, symbols, promises**:
  - Arbitrary cycles across objects, arrays, `Map`, `Set`, closures, bound functions, and settled `Promise` payloads.
  - Descriptors (`writable`, `enumerable`, `configurable`, getters/setters), `frozen`/`sealed`/`extensible` flags, sparse arrays, `null`-prototype objects.
  - `Map`, `Set`, empty `WeakMap`/`WeakSet`, `Date` (including Invalid Date `"NaN"`), `RegExp` (`source`, `flags`, `lastIndex`), `TypedArray` + `DataView` sharing underlying `ArrayBuffer` nodes (`crc-32` `subarray` views), `Error` subclasses (stripping V8's host-specific lazy C++ `stack` accessor), boxed primitives, settled fulfilled/rejected `Promise`s, and unique/registered/well-known `Symbol`s.

## What Bails Out (and Why)

- Uncaught synchronous init exceptions and unhandled background promise rejections during init.
- Pending `Promise` (`[[PromiseState]] === "pending"`).
- Generator / AsyncGenerator objects (`suspended` unstarted, `suspended` mid-yield, or `closed`).
- `Proxy` objects and functions (checked via `util.types.isProxy` before any reflection so user traps never fire).
- Non-empty `WeakMap` / `WeakSet` (`[[Entries]] > 0`), `WeakRef`, `FinalizationRegistry`.
- `Arguments` objects (`sloppy` and `strict`).
- Built-in `Array`, `Map`, `Set`, `String`, `RegExp`, and `Iterator Helper` iterator instances.
- Classes, methods, and instances with `#private` fields or methods (unless expressible as a whole-class unit in a future phase).
- Non-intrinsic `[native code]` host functions, outer-realm host objects, `Buffer`, `Intl.*` / `DisposableStack` instances with C++ internal slots, detached `ArrayBuffer`, `SharedArrayBuffer`, `with` scopes, `eval` scopes, and uninitialized TDZ closure bindings.

## Real-World Corpus (`bench/libs/dist/*.js`, 15 Bundles)

- **Universal / Browser env**: **14 / 15 capture OK** (and all 14 rebuild from JSON and pass `bench/libs/specs.js` smoke checks with exact digest match!), **1 BAIL** (`marked.js`: ES2022 `#e`/`#t`/`#n` private methods on class `a`), **0 CRASH**.
- **Pure `ecma` env** (`self`/`window`/`global` absent): **12 / 15 capture OK** (`redux.js` exports to CJS `exports` when `global` and `self` are both absent, leaving `roots=[]`), **3 BAIL** (`marked.js` on `#private`; `preact-ssr-app.js` and `react-ssr-app.js` on `ReferenceError: self is not defined`), **0 CRASH**.

| Bundle | Src KB | `universal` Status | Time (ms) | Nodes | `ecma` Status | Notes |
|---|---:|---|---:|---:|---|---|
| `acorn.js` | 240.9 | **OK** | 1042 | 837 | **OK** | `acorn` root |
| `chroma-js.js` | 109.2 | **OK** | 726 | 421 | **OK** | `chroma` root |
| `crc-32.js` | 3.6 | **OK** | 533 | 26 | **OK** | 16 `Int32Array` subviews sharing 1 `ArrayBuffer` |
| `d3-scale.js` | 148.9 | **OK** | 3765 | 1389 | **OK** | `class InternMap extends Map` + default params |
| `handlebars-app.js` | 211.9 | **OK** | 2398 | 2213 | **OK** | `new Function` compiled template + `core-js` |
| `immutable.js` | 175.4 | **OK** | 1673 | 994 | **OK** | `Immutable` HAMT/Record hierarchies |
| `lodash.js` | 533.1 | **OK** | 1835 | 2610 | **OK** | 1,013 functions, 478 scopes |
| `marked.js` | 49.4 | **BAIL** | 525 | 357 | **BAIL** | `class` with `#e`/`#t`/`#n` private methods |
| `moment.js` | 637.8 | **OK** | 1437 | 4553 | **OK** | 135+ locales, 4,553 nodes |
| `preact-ssr-app.js` | 22.0 | **OK** | 567 | 151 | **BAIL** (`self`) | Bound `Promise.prototype.then` + SSR |
| `ramda.js` | 342.9 | **OK** | 723 | 1898 | **OK** | 755 curried functions |
| `react-ssr-app.js` | 47.0 | **OK** | 447 | 520 | **BAIL** (`self`) | `Symbol.for` + `ReactDOMServer` init SSR |
| `redux.js` | 18.1 | **OK** | 271 | 57 | **OK** (0 roots) | esbuild IIFE needs `global` or `self` to attach `ReduxBench` |
| `underscore.js` | 67.3 | **OK** | 427 | 860 | **OK** | `_` root |
| `yaml-router-app.js` | 157.1 | **OK** | 492 | 661 | **OK** | `js-yaml` (`_typeof` decl) + `Mustache` + RegExp routes |

## Next Steps

1. Wire `capture` -> Track H2 `emit` -> Track H3 `guard` inside `hybrid/index.js` (`prepackSources`). Note: `bench/prepack-worker.js` calls `prepackSources` synchronously, so `hybrid/index.js` can bridge async `capture()` via a `worker_threads` + `Atomics.wait` synchronous wrapper when needed.
2. Optional future enhancement for `marked@18`: when a `class` with `#private` methods/fields has zero live instances at the end of init and all `#private`-referencing methods belong to that `class` prototype/constructor, Track H1 + H2 can link member nodes to the owning `class` node and emit the `class` declaration intact.
