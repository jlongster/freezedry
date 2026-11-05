# Hybrid Prepack: run the known parts in the real engine

## Why

About 35k of Prepack's 81k lines re-implement the ECMAScript spec, and that is the long tail every real library hits: classes, generators, async, `Intl`, `Date`, `globalThis`, Annex B. The hybrid **executes initialization code in the real engine** (V8 via Node), so semantics are exact and all modern syntax works for free. It **captures the resulting heap** and **writes it out as JavaScript** that recreates the same state.

Unknown or environment-dependent values are handled at the boundary:
- **Phase 1:** they are detected and become guarded assumptions with a fallback to the original code.
- **Phase 2:** they are handed to Prepack's symbolic engine.

Prior evidence, in `/tmp/opencode/pp-lab`:
- V8's inspector exposes closure variables through the `[[Scopes]]` internal property (`scopes.js`).
- Node startup snapshots of lodash remove about 58% of its load overhead. That's an engine-level heap snapshot. We want the same effect as portable JS for runtimes without heap snapshots: browsers, Bun/JavaScriptCore, edge runtimes, Hermes.
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

The whole pipeline is pure Node 26, using only the built-in `vm` and `inspector` modules. Code lives in `hybrid/`, which has its own `package.json`.

API, so `bench/run.js` can drive it unchanged:

```js
require("hybrid/index.js").prepackSources([{ filePath, fileContents }], options) // -> { code, stats, diagnostics }
```

CLI: `node hybrid/bin/hybrid.js input.js --out out.js [--assume NAME=JSON] [--verify]`.

## Capture graph format (contract between agents)

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

**Scope identity** comes from the heap snapshot. Two functions share a context exactly when their `context` edges point at the same Context node; contexts chain through `previous`. Per-function `[[Scopes]]` gives the values. A function's `scope` points at the innermost context that has captured variables.

## Hard rules

- **Never emit approximate state.** Unknown internal slots (WeakMap/WeakRef contents, Proxy, pending Promise, suspended generator, iterators mid-iteration, host objects, `arguments` objects) produce a bailout with a clear reason.
- **Volatile reads during init** (`Date.now`, `new Date()`, `Math.random`, `performance.now`, `crypto.getRandomValues`, timers, I/O) produce a bailout in Phase 1, or a guarded assumption if the user passes `--assume`.
- **Environment reads** of globals that don't exist in the target (`window`, `document`, `process`, `module`, `define`, …) become recorded **assumptions** that are emitted as a guard. Any mismatch at runtime runs the original code.
- **Verification is part of the product:** `--verify` and the test suite check heap isomorphism, not just smoke output.
- **Output must not depend on the build host:** timezone, locale, `process.env`. Treat these as assumptions or bailouts.
