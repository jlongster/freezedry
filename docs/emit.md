# Emit (`lib/emit.js`)

## Overview

`emit(captureGraph, opts) -> { code, bailouts, stats }` translates a V8 heap capture graph (see [design.md](design.md#capture-graph-format)) into a portable, deterministic classic JavaScript script wrapped in a zero-leak IIFE that reconstructs the captured heap, applies `intrinsicPatches`, and binds `roots`.

Modules:
- `lib/emit.js`: Reachability walk, prototype-tier topological sorting, single-use inlining, multi-phase heap emission, and `stats` measurement.
- `lib/scope-emitter.js`: Scope-tree factory generation, `let`/`const`/`var`/`param`/`fn` fidelity, strict/sloppy subtree handling, leaf scope-template deduplication, and cyclic scope variable setters.
- `lib/fn-source.js`: `acorn`-backed AST analyzer for function, arrow, concise method/getter/setter, generator, async, and `class` sources, plus safety/bailout checks.
- `lib/value-emitter.js`: Descriptor analysis (`freeze`/`seal`-aware literal fast paths, prototype-setter & `__proto__` safety), binary `ArrayBuffer`/`TypedArray` emission, and `RegExp` literal validation.
- `lib/intrinsics.js`: Portable intrinsic resolution & pristine-VM canonicalization (mapping aliases like `Object.getPrototypeOf(Symbol)` back to `Function.prototype` and `%GeneratorPrototype%` to standard expressions).
- `lib/recompute-table.js`: Recomputes pure `ArrayBuffer` tables (for example CRC tables) instead of serializing their bytes.
- `index.js`: Wires `freeze` (synchronous, capture in a worker process) and `freezeAsync` across `capture -> emit -> [guard] -> [verify]`.

## What Works

- **Object identity, cycles & prototype chains**:
  - Prototype-tier topological sort (`maxHardDepthToSink` + soft-edge post-order DFS in $O(V + E)$) guarantees prototypes, base classes, buffers, and bound targets exist before dependents.
  - Emits `{ __proto__: proto, ... }` literals (`0` `Object.setPrototypeOf` calls across 13/14 benchmark workloads, avoiding V8 prototype-mutation map deopts).
  - Preserves exact `Reflect.ownKeys` enumeration order even across cyclic references via `void 0` literal placeholders and ordered Phase 3 fixups.
  - Safe assignment (`o.k = v`) when no prototype setter/readonly hazard exists; `Object.defineProperty` (aliased to `__h$dp` when used >= 2 times) for custom descriptors, `"__proto__"` own data properties, and unsafe prototype chains.
  - `Object.freeze`, `Object.seal`, and `Object.preventExtensions` applied last in Phase 4, with freeze/seal-aware literal emission (`Object.freeze({ ... })`, `Object.freeze([...])`).
- **Built-in & exotic types**:
  - `Array` with holes (`[a, , b,]` vs `new Array(n)` for large sparse arrays), non-writable `length`, custom prototypes (`Reflect.construct`), and extra properties.
  - `Map` and `Set` in exact insertion order (including cyclic keys/elements and functions as keys), plus empty `WeakMap` / `WeakSet`.
  - `ArrayBuffer`, `SharedArrayBuffer`, `TypedArray` (`Int8Array`..`BigUint64Array`, `Float16Array`), and `DataView`, preserving shared `ArrayBuffer` identity across multiple views at distinct `byteOffset`s and using `Uint8Array.fromBase64` with a pure-JS fallback (works in bare `vm` contexts without `Buffer` or `atob`).
  - `Date` (including `Invalid Date`), `RegExp` (validated literals + `lastIndex`), boxed primitives (`Number(-0)`, `String`, `Boolean`, `Object(bigint)`, `Object(symbol)`).
  - `Error` (`Error`, `TypeError`, `RangeError`, `AggregateError`, `SuppressedError`, custom `Error` subclasses via `Reflect.construct`), preserving `.message`, `.stack`, `.cause`, `.errors`, and own props.
  - Settled `Promise` (`Promise.resolve` and `Promise.reject` with `.catch(noop)` handler attachment so standalone Node processes never crash with `UnhandledPromiseRejection`).
  - `Symbol` (`Symbol.for`, shared unique `Symbol(desc)` nodes, well-known `Symbol.*`), and bound functions (`Function.prototype.bind.call`).
- **Closures, scopes & classes**:
  - Nested scope factories mirroring V8's `Context` tree with zero leaked helper bindings in `[[Scopes]]` (`__h$o` and `__h$p` are passed as stack parameters rather than captured from an outer closure).
  - Collision-free generated identifier prefix (`__h$` -> `__h1$` -> ...).
  - `const` immutability preserved (including self/mutually-recursive `const` closures); Phase 3 scope setters emitted only for genuinely cyclic cross-unit bindings.
  - Self-overwriting `FunctionDeclaration` support (e.g. Babel's `function _typeof(o) { _typeof = ...; }`), stripping the NFE self-binding so reassignments mutate the scope binding while restoring `.name`.
  - Deduplication of repeated leaf closure factories (e.g. `lodash` `overRest`/`baseRest`, `ramda` curried wrappers), cutting output size by 20–45% on functional libraries.
  - Strict + sloppy mix in the same scope tree (`"use strict"` hoisted to pure-strict subtrees; per-function strict IIFE wrappers in mixed scopes).
  - `class` reconstruction with `extends` (including unscoped superclass parameters and side-effect-free stripping of already-executed `static {}` blocks / impure static field initializers), mapping `Cls.prototype` and static/instance methods/accessors directly onto graph nodes instead of recreating them separately.

## What Bails Out and Why

- Non-empty `captureGraph.bailouts` (propagated directly; `emit` returns `{ code: null, bailouts, stats }`).
- Pending `Promise` (`state !== "fulfilled" && state !== "rejected"`).
- Function/class source containing a `WithStatement` or unshadowed direct `eval(...)` call (could observe or mutate lexical bindings dynamically).
- Arrow function referencing lexical `this` without a captured `this` value on the function/scope, or referencing lexical `arguments` / `super` / `new.target`.
- Standalone concise method/getter/setter referencing `super` outside a reconstructed `class` (`[[HomeObject]]` cannot be rebound in portable JS without `Object.setPrototypeOf` on a wrapper home object).
- Classes with static `#private` fields, or classes with instance `#private` fields when pre-existing instances exist in the captured heap (`Object.create(Cls.prototype)` cannot install V8 `[[PrivateElements]]`).
- Non-empty `WeakMap` / `WeakSet` or unsupported internal-slot types (`Proxy`, `WeakRef`, suspended generators/iterators, native/host functions without an intrinsic path).

## Later fixes found by the oracle on real workloads

Each of these has a regression test:

- The `class X extends Name` heritage reference keeps the shared scope binding instead of shadowing it with a wrapper parameter (three).
- Hoisted FunctionDeclarations keep their binding until the scope subtree ends when another function later takes over the name (babel `getModuleName`).
- Leaf-scope templates shared by several closures bake one name, and the other instances get `.name` reconciled (babel / gensync).
- An anonymous function named by NamedEvaluation is only emitted inline when no strict wrapper is needed; otherwise it gets a slot and Phase-3 reconciliation (mathjs `parse`).
- Grouped get/set member reconciliation, direct out-slot and omitted-slot guards, and leaf templates only when all captured values exist (three, babel).
- Strict prologues, descriptor-exact prototype redefinition, source-faithful formatting, and intrinsic-identity keyed scope inputs.

Size and speed work: demand-driven pruning of dead scope variables, lazy default `fn.prototype` elision, SetFunctionName via `const name = fn`, direct `res[i]` for single-use slots, root-hoisted leaf templates, single-use leaf IIFEs, and pure ArrayBuffer table recomputation (crc-32: 30 KB → 6.7 KB).

## Next steps

- **HomeObject reconstruction for standalone `super` methods**: an object literal `{ __proto__: base, m() { return super.f(); } }` outside a `class` could be emitted inside its owning object literal when `[[HomeObject]]` identity is recorded.
- **Recompute-or-lazy emission** for large pure derived data (generalizing `recompute-table.js` beyond ArrayBuffers), and retention analysis to drop dead factories (lodash `runInContext`).
- **Fewer per-property definitions** on very large heaps (batched `Object.defineProperties`, more prototype literals, fewer Phase-3 fixups).
