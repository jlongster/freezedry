# Design

## Why

Startup work in JavaScript is mostly initialization: building prototypes, method tables, lookup tables, caches, locale data, grammar definitions. It is the same on every load. Engines can snapshot a heap (V8 startup snapshots, Node `--build-snapshot`), but that is engine- and version-specific, and is not available in browsers, Bun/JavaScriptCore, edge runtimes or Hermes.

Prepack attacked this by evaluating the program in a JavaScript interpreter written in JavaScript and serializing the result. About 35k of its 81k lines re-implement the ECMAScript spec, and that is the long tail every real library hits: classes, generators, async, `Intl`, `Date`, `globalThis`, Annex B.

freezedry **executes initialization in the real engine** (V8 via Node), so semantics are exact and all modern syntax works for free. It **captures the resulting heap** through the V8 inspector and **writes it out as plain JavaScript** that recreates the same state on any engine.

Unknown or environment-dependent values are handled at the boundary: they are detected and become guarded assumptions with a fallback to the original code, or the build bails out. A later phase could hand them to a symbolic engine instead.

Background evidence that motivated the design:

- V8's inspector exposes closure variables through the `[[Scopes]]` internal property, and heap snapshots expose which closures share a `Context`.
- A Node startup snapshot of lodash removes about 58% of its load overhead. That is an engine-level heap snapshot; freezedry aims for the same effect as portable JS.
- Prepack 0.2.54's output for a Promise was a fake object, and async functions were miscompiled. Real-engine capture must never do that: **capture what is exactly reproducible, or bail out with a clear reason.**

## Pipeline

```
input.js ──► [1 RUN]      execute in a fresh vm context, with tracing of environment reads and volatile APIs
          ──► [2 CAPTURE] walk the heap reachable from roots (global additions and changed intrinsics)
                          via Runtime/HeapProfiler inspector APIs → capture graph (JSON, format below)
          ──► [3 EMIT]    capture graph → JS that rebuilds the heap (objects, closures with their shared
                          scopes, prototypes, descriptors, Map/Set/Date/RegExp/typed arrays, settled Promises)
          ──► [4 GUARD]   environment assumptions → runtime guard; on mismatch, run the original code
          ──► [5 VERIFY]  run the original and the output in fresh contexts; check heap isomorphism
                          from the roots; run the smoke tests
```

The pipeline is plain Node (CommonJS), using the built-in `vm`, `inspector` and `v8` modules plus `acorn` for parsing. Module map:

| Stage | Modules | Details |
|---|---|---|
| Run | `lib/run.js`, `lib/inspector-bridge.js` | [capture.md](capture.md) |
| Environment | `lib/env.js`, `lib/env-profiles.js`, `lib/js-scan.js` | [env.md](env.md) |
| Capture | `lib/capture.js`, `lib/heap-snapshot.js`, `lib/ast-info.js`, `lib/intrinsics.js` | [capture.md](capture.md) |
| Emit | `lib/emit.js`, `lib/scope-emitter.js`, `lib/fn-source.js`, `lib/value-emitter.js`, `lib/recompute-table.js` | [emit.md](emit.md) |
| Guard | `lib/guard.js` | [env.md](env.md) |
| Verify | `lib/verify.js`, `lib/behavioral.js` | [verify.md](verify.md) |
| API glue | `index.js`, `lib/bench-adapter.js`, `bin/freezedry.js` | below |

API:

```js
const { freeze } = require("freezedry");
freeze([{ filePath, fileContents }], options); // -> { code, stats, diagnostics, bailouts, verifyResult }
```

`freeze` takes the same arguments as Prepack's `prepackSources` and is also exported under that name (with `prepackVersion`), so the benchmark harness can drive freezedry and Prepack alike. The synchronous `freeze` runs capture in a subprocess (`index.js --capture-worker`) that inherits the parent's heap limit; `freezeAsync` runs in-process.

CLI: `freezedry input.js --out out.js [--profile NAME] [--assume NAME=JSON] [--allow-volatile LIST] [--assume-tz ZONE] [--fallback MODE] [--verify]`.

## Capture graph format

The capture graph is the contract between capture and emit (and is accepted directly by `freeze(..., { captureGraph })`).

```jsonc
{
  "version": 1,
  "roots": [ { "kind": "global", "key": "_", "value": <ref>, "descriptor": {...} }, ... ],
  "intrinsicPatches": [ { "path": "Array.prototype", "key": "includes", "descriptor": {...} } ],
  "nodes": {                      // id -> node
    "o1": { "type": "object", "proto": <ref>, "extensible": true, "frozen": false, "sealed": false,
            "props": [ { "key": <key>, "value": <ref> | null, "get": <ref>, "set": <ref>,
                         "enumerable": true, "writable": true, "configurable": true } ] },
    "a2": { "type": "array", ...object fields..., "length": 3 },
    "f3": { "type": "function", "source": "function inc(){...}", "kind": "normal|arrow|method|getter|setter|generator|async|asyncGenerator|class",
            "strict": true, "name": "inc", "scope": "s7" | null, "bound": null | { "target": <ref>, "this": <ref>, "args": [<ref>] },
            ...object fields (own props such as prototype)... },
    "s7": { "type": "scope", "parent": "s6" | null, "vars": [ { "name": "count", "value": <ref>, "kind": "let|const|var|param|fn" } ] },
    "m4": { "type": "map", "entries": [[<ref>, <ref>]], ...object fields },  "set": { "entries": [<ref>] },
    "d5": { "type": "date", "time": 0 }, "r6": { "type": "regexp", "source": "...", "flags": "g", "lastIndex": 0 },
    "t8": { "type": "typedarray", "ctor": "Int32Array", "bytes": "<base64>", "byteOffset": 0, "length": 4096, "buffer": <ref> },
    "p9": { "type": "promise", "state": "fulfilled|rejected", "value": <ref> },     // pending → bail
    "e10": { "type": "error", "ctor": "TypeError", "message": "...", ...object fields },
    "x11": { "type": "boxed", "primitive": <ref> }                                   // new Number(1) etc.
  },
  "assumptions": [ { "kind": "typeof|value|json|tz", "expr": "typeof window", "observed": "undefined" } ],
  "bailouts": [ { "reason": "pending promise", "where": "..." } ]   // non-empty → no output (fall back to original)
}
// <ref> = { "$": "o1" } | { "intrinsic": "Array.prototype.push" } | { "global": true }
//       | { "prim": "number|string|boolean|undefined|null|bigint|symbol", "value": "...", "special": "NaN|-0|Infinity|-Infinity" }
//       | { "symbol": "o12" }   (unique symbols are nodes too: { "type": "symbol", "description": "...", "registered": "key"|null })
```

Node and field details:

- A property `<key>` is a plain string for string keys, or a symbol `<ref>` (`{ "intrinsic": "Symbol.iterator" }` or `{ "symbol": "y1" }`) for symbol keys.
- `"function"` nodes also carry `"declaration": boolean` (`true` for a `FunctionDeclaration`, which has no immutable inner self-name binding, so self-overwriting helpers like `function _typeof() { _typeof = ... }` stay mutable), an optional `"homeObject": <ref>` when a concise method/getter/setter uses `super`, an optional `"this": <ref>` for top-level arrows capturing global `this`, and an optional `"ownerClass": "<classNodeId>"` linking public prototype/static members that reference `#private` fields or methods back to a zero-instance owning `class` node.
- `"scope"` nodes represent lexical `this` captured by arrow functions as `{ "name": "this", "value": <ref>, "kind": "const" }` in `vars` (or an optional `"this": <ref>`).
- `typedarray.buffer` (and `{ "type": "dataview", "byteOffset": 0, "byteLength": N, "buffer": <ref>, ...object fields }`) points to `{ "type": "arraybuffer", "bytes": "<base64>", "byteLength": N, ...object fields }`, so several views over one `ArrayBuffer` keep sharing it.
- Empty `WeakMap` / `WeakSet` instances capture as `{ "type": "weakmap" | "weakset", ...object fields }`; non-empty ones bail out. An invalid `Date` encodes `"time": "NaN"`.

**Scope identity** comes from the heap snapshot. Two functions share a context exactly when their `context` edges point at the same Context node; contexts chain through `previous`. Per-function `[[Scopes]]` gives the values. A function's `scope` points at the innermost context that has captured variables.

## Hard rules

- **Never emit approximate state.** Unknown internal slots (WeakMap/WeakRef contents, Proxy, pending Promise, suspended generator, iterators mid-iteration, host objects, `arguments` objects) produce a bailout with a clear reason.
- **Volatile reads during init** (`Date.now`, `new Date()`, `Math.random`, `performance.now`, `crypto.getRandomValues`, timers, I/O, Error stack text) produce a bailout, or a baked and recorded value if the user passes `--allow-volatile`.
- **Environment reads** of globals that may differ in the target (`window`, `document`, `process`, `module`, `define`, …) become recorded **assumptions** that are emitted as a guard. Any mismatch at runtime runs the original code.
- **Verification is part of the product:** `--verify` and the test suite check heap isomorphism, not just smoke output.
- **Output must not depend on the build host:** timezone, locale, `process.env`. These are assumptions or bailouts.
