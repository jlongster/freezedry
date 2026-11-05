# Run and capture (`lib/run.js`, `lib/capture.js`)

## Overview

freezedry executes JavaScript initialization code in a fresh V8 `vm` context (`vm.constants.DONT_CONTEXTIFY`), drains microtasks, and captures the resulting reachable heap into the JSON capture graph described in [design.md](design.md#capture-graph-format) using JS reflection plus an in-process `inspector.Session` (`Runtime`, `Debugger`, and `HeapProfiler`).

## Public Interfaces

### `run(src, opts)` (`lib/run.js`)
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
  - The environment layer ([env.md](env.md)) intercepts unknown global reads (`typeof module`, `document`, `window`) cleanly by wrapping `Object.getPrototypeOf(globalObj)` in a `Proxy` via `Object.setPrototypeOf(globalObj, trap)` inside `beforeRun` and restoring `origProto` in the cleanup function.
- **Environment hooks** (used by `lib/env.js`):
  - `beforeRun(ctx, intrinsicsMap, meta)`: runs after pristine intrinsics/descriptors are snapshotted and before user scripts execute. `meta` provides `{ globalObj, envConfig, intrinsicsMap, pristineGlobals, pristineIntrinsics, helpers, addAssumption(a), addBailout(b) }`. May return a cleanup function `() => void` called automatically after microtask draining so tracing wrappers do not appear as `intrinsicPatches`.
  - `afterRun(ctx, intrinsicsMap, meta)`: optional post-drain hook.

### `capture(src, opts)` and `captureFromRun(runResult, opts)` (`lib/capture.js`)
- Returns `{ version: 1, roots, intrinsicPatches, nodes, assumptions, bailouts }`.
- Never throws on user-code runtime errors or unsupported heap structures; records `{ reason, where }` in `bailouts`.

## What works

- **Scope identity & closures**:
  - Single lazy `HeapProfiler.takeHeapSnapshot({ captureNumericValue: true })` per capture maps each function's `HeapProfiler.getHeapObjectId` to its `Context` chain (`internal:context` -> `internal:previous` up to `NativeContext`), using `NativeContext` shape maps (`function_context_map`, `block_context_map`, `catch_context_map`, `script_context_map`) and `ScopeInfo` variable sets.
  - Functions sharing a V8 `Context` share the exact same `scope` node ID; outer contexts already materialized are cached in O(1) so large UMD bundles (`lodash`: 1,013 functions, 478 scopes) capture in ~1.8s.
  - Recovers named `FunctionExpression` self-bindings (`(function mySelf() { ... })`) hidden by V8's `[[Scopes]]` via `HeapProfiler.getObjectByHeapObjectId`.
  - Tracks AST variable declaration kinds (`let`, `const`, `var`, `param`, `fn`) and `FunctionDeclaration` vs `FunctionExpression` (`declaration: boolean`, critical for Babel's self-overwriting `function _typeof() { _typeof = ... }` helpers).
- **Functions, classes, prototypes, and `super`**:
  - All 9 `kind`s (`normal`, `arrow`, `method`, `getter`, `setter`, `generator`, `async`, `asyncGenerator`, `class`), exact `strict` mode detection via Acorn + `[[FunctionLocation]]` + `Debugger.getScriptSource` (including dynamic `new Function(...)`), bound functions (`[[TargetFunction]]`, `[[BoundThis]]`, `[[BoundArgs]]`), and optional `homeObject` for concise methods using `super`.
  - Note for emit: ES2015 `class` constructors have a non-configurable, non-writable `.prototype`; when instantiating a `class`, adopt `Cls.prototype` as the object table entry for its prototype node ID so `instanceof` holds for pre-existing instances.
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
- Instances with `#private` fields, and `#private` members that cannot be linked to a zero-instance owning class (see `ownerClass`).
- Non-intrinsic `[native code]` host functions, outer-realm host objects, `Buffer`, `Intl.*` / `DisposableStack` instances with C++ internal slots, detached `ArrayBuffer`, `SharedArrayBuffer`, `with` scopes, `eval` scopes, and uninitialized TDZ closure bindings.

## Real-world corpus

Capture handles all 22 benchmark workloads except where the environment layer or the hard rules bail out (clock/RNG reads without opt-ins, prettier's non-empty `WeakMap`). Two capture features were added after the first corpus pass and unlocked more workloads:

- arrow functions with lexical `this` (including primitive `this` decoded from the heap snapshot);
- zero-instance classes using `#private` members, linked through `ownerClass` so the class is emitted intact (this unlocked marked).

Lodash, the largest standard workload by function count (1,013 functions in 478 scopes), captures in about 1.8 s. Current per-workload status is in [results.md](results.md).
