# freezedry

Run your JavaScript's initialization once at build time in the real engine (V8), capture the resulting heap — closures and their shared scopes, prototypes, property order, Maps/Sets, typed arrays, settled promises… — through the V8 inspector, and emit plain JavaScript that rebuilds exactly that state.

- Environment assumptions are **recorded and guarded at runtime**; if a guard fails, the original code runs instead.
- Volatile and host reads (`Date.now()`, `Math.random()`, timezone, locale, timers…) during init **bail out** unless you explicitly allow them.
- An **independent heap-isomorphism verifier** checks that the output rebuilds the same heap as the original: same object graph, descriptors, property order, `[[Scopes]]` values and closure-context sharing.
- Plus **trace-based template specialization for React SSR**: byte-identical to `renderToString`, with per-request guards and a fallback to React.

**Live demo** of the React specializer: <https://jamesbox.exe.xyz/northstar/hybrid/> · **Write-up**: <https://jamesbox.exe.xyz/artifacts/freezedry/>

Status: research prototype. It works on real libraries (lodash, moment, three, babel-standalone, typescript…) and has never silently miscompiled one of the 22 benchmark workloads, but it is not packaged or tuned for production use.

## Example

```js
// counter.js
var lib = (function () {
  let count = 0;
  const table = new Map();
  for (let i = 0; i < 5; i++) table.set("k" + i, i * i);
  class Counter {
    inc() { return ++count; }
  }
  return { counter: new Counter(), table, square: (k) => table.get(k) };
})();
```

`freezedry counter.js --verify` runs it, captures the heap, verifies the output, and prints:

```js
(function(__h$g) {
  var __h$0 = new Map([["k0", 0], ["k1", 1], ["k2", 4], ["k3", 9], ["k4", 16]]);
  var __h$1 = (function(__h$p) {
    var __h$o = new Array(3);
    let count = 0;
    const table = __h$p[0];
    __h$o[0] = (
class Counter {
    inc() { return ++count; }
  }
);
    __h$o[1] = __h$o[0].prototype;
    { const square = (
(k) => table.get(k)
); __h$o[2] = square; }
    return __h$o;
  })([__h$0]);
  var __h$2 = __h$1[0], __h$3 = __h$1[1];
  var __h$4 = { counter: { __proto__: __h$3 }, table: __h$0, square: __h$1[2] };
  Object.defineProperty(__h$g, "lib", { value: __h$4, writable: true, enumerable: true, configurable: false });
})(typeof globalThis !== "undefined" ? globalThis : this);
```

The loop is gone; the closure scope that `inc` and `square` share is rebuilt once, with `count` still a mutable `let` and `table` a `const`. When init reads the environment, the output carries a guard:

```js
// env.js: var isBrowser = typeof window !== "undefined"; var config = { isBrowser, mode: isBrowser ? "client" : "server" };
// freezedry env.js --profile browser
if (!("window" in globalThis && typeof window === "object" && window === globalThis)) {
  (function () { /* original code */ }).call(this);
} else {
  /* rebuilt heap: config = { isBrowser: true, mode: "client" } */
}
```

## Quick start

Developed and tested on Node 26.

```sh
git clone https://github.com/jlongster/freezedry && cd freezedry
npm install
npm test            # first run also fetches and builds the benchmark corpus (bench/setup.js)

node bin/freezedry.js input.js --out output.js --verify
```

### CLI

```
freezedry <input.js> [more inputs...] [options]
```

| Flag | Meaning |
|---|---|
| `--out <file>` | Write the output there (default: stdout). |
| `--profile <name>` | Target environment: `universal` (default), `browser`, `worker`, `node`, `bun`, `hermes`, `ecmascript`. Decides which globals exist (and alias `globalThis`), which are host globals with unknown values, and which are absent. See [docs/env.md](docs/env.md). |
| `--assume <NAME=JSON>` | Assert a global or property value, e.g. `--assume MessageChannel=undefined`, or a type with `--assume 'typeof:document.childNodes="object"'`. Assertions become guards. Repeatable. |
| `--allow-volatile <list>` | Bake the values that volatile APIs returned during init: `Date.now`, `new Date`, `Math.random`, `Error.stack`, … The values are recorded in the diagnostics. Without this, a volatile read during init bails out. |
| `--assume-tz <zone>` | Run init with this timezone (e.g. `UTC`) and guard on it at runtime, so timezone-dependent `Date` operations can be baked. |
| `--fallback <mode>` | What the guard does on mismatch: `function` (default; original code inline, CSP-safe), `eval` (original as a string through indirect eval), `throw`, or `external` (load `--fallback-file <path>`). |
| `--verify` | Run the heap-isomorphism verifier on the output and fail if it differs. |

When the build bails out, the CLI prints the reason to stderr and emits the original code unchanged.

### API

```js
const { freeze } = require("freezedry");

const result = freeze([{ filePath: "input.js", fileContents: source }], {
  profile: "browser",
  assume: { MessageChannel: undefined },
  allowVolatile: ["Date.now"],
  tz: "UTC",
  fallback: "function",
  verify: true,
});
result.code;          // the output (or the original code if the build bailed out)
result.bailouts;      // [{ reason, where }] when it bailed out
result.diagnostics;   // e.g. FZD_VOLATILE_BAKED for each baked Date.now() value
result.stats;         // node/scope/closure counts, assumptions, sizes, verifier stats
```

`freeze` is synchronous (capture runs in a child process); `freezeAsync` runs in-process. Both take the same arguments as Prepack's `prepackSources` and are also exported under that name, which is how the benchmark drives either tool. Pass `errorHandler` to receive diagnostics and turn bailouts into errors instead of falling back.

## How it works

```
input.js ─► RUN      execute in a fresh V8 context behind an environment membrane
                     (records environment reads, intercepts volatile APIs)
         ─► CAPTURE  walk the heap reachable from new globals and patched intrinsics via the
                     inspector (Runtime, Debugger, HeapProfiler) → capture graph
         ─► EMIT     capture graph → JavaScript that rebuilds it
         ─► GUARD    recorded assumptions → runtime check, original code as fallback
         ─► VERIFY   run original and output in fresh realms and compare the heaps
```

1. **Run.** The input runs in a `vm` context with `DONT_CONTEXTIFY` (a genuine global object). A proxy inserted into the global object's prototype chain sees every read of a global that does not exist, and stand-ins for host globals (`document`, `process`, `setTimeout`, …) record how they are used. Volatile APIs are wrapped: calling them bails out unless allowed. See [docs/env.md](docs/env.md).
2. **Capture.** Starting from the globals the program created and the intrinsics it patched, capture reflects over every reachable object. Closure variables come from V8's `[[Scopes]]`; **which closures share a scope** comes from the heap snapshot (two functions share a context exactly when their `context` edges point at the same V8 Context). Function sources come from `[[FunctionLocation]]`, with acorn for strictness and declaration kinds. See [docs/capture.md](docs/capture.md) and the capture-graph format in [docs/design.md](docs/design.md).
3. **Emit.** Objects are emitted in prototype order as literals where possible (`{ __proto__: p, ... }`), with exact property order, descriptors and integrity levels. Scopes become nested factory functions that mirror V8's context tree, so closures that shared state still share it, `const` stays `const`, and nothing leaks into `[[Scopes]]`. Classes are re-emitted from source and their prototypes adopted. Maps, Sets, typed arrays sharing one `ArrayBuffer`, Dates, RegExps, Errors, boxed primitives, symbols and settled Promises are rebuilt directly. See [docs/emit.md](docs/emit.md).
4. **Guard.** Every recorded assumption (`typeof window === "object"`, `"fetch" in globalThis`, the timezone offset, …) becomes part of one condition in encounter order. If it fails at runtime, the original code runs instead. No assumptions means no guard.
5. **Verify.** The verifier shares no code with the stages above. It runs the original and the output in two fresh realms and walks both heaps in lockstep, maintaining a bijection over objects, symbols and V8 scope contexts, comparing descriptors, property order, prototypes, internal slots, function source and strictness, and `[[Scopes]]` values. It reports the first difference as a path, like `counter.get (scope var "count")`. See [docs/verify.md](docs/verify.md).

## Guarantees and bailouts

The rule is **never emit approximate state**: capture what is exactly reproducible, or bail out with a reason and keep the original code.

It bails out on:

- **Unreproducible internal state**: pending Promises, suspended generators, iterators mid-iteration, `Proxy` objects, non-empty `WeakMap`/`WeakSet`, `WeakRef`, `FinalizationRegistry`, `arguments` objects, host objects and native functions with no intrinsic path, instances with `#private` fields.
- **Volatile reads during init** (unless `--allow-volatile`): `Date.now()`, `new Date()`, `Math.random()`, `performance.now()`, `crypto.*`, timers, Error stack text; timezone-dependent `Date` operations (unless `--assume-tz`); `Intl` and `toLocale*`.
- **Code that can observe its scope dynamically**: `with`, direct `eval`.
- **Init errors**: uncaught exceptions and unhandled rejections during init.

It guards (rather than bails) on environment reads: globals that are absent, host globals that are present, and anything passed with `--assume`.

Output never depends on the build host: timezone, locale and `process.env` are assumptions or bailouts. Seeding `Math.random` is rejected; use `--allow-volatile=Math.random` to bake values explicitly.

## React SSR specializer

[`react/`](react) applies the same idea to rendering. Given a **known** React app and **unknown** request data, it builds `render(data)` that returns exactly the bytes of `ReactDOMServer.renderToString(<App data={data}/>)`:

- It **traces the real app in V8** with concolic instrumentation: every operation computes its concrete value with the real operator, and records a symbolic expression when the operand came from request data.
- It **learns guarded templates** per component and per `.map` callback. Host elements are never re-implemented: they are rendered by React itself with marker values, and every modeled React behaviour (escaping, attribute rules, `<!-- -->` separators, `useId`) is checked against React at build time.
- At runtime **every assumption is a guard**; a failed guard falls back to the real `renderToString` for that request. The app's own helper functions are called, not re-implemented.

On the bundled benchmark app (30 components, `bench/react/`): **500/500 byte-identical**, 0 mismatches on 50,000 fuzzed inputs, 0.4% fallbacks, **5–6x** faster than `renderToString` under JIT and **11–12x** under `--jitless` (56–64% of a hand-written renderer), and 4.9 ms vs 16.2 ms to first HTML in a cold process.

```sh
node bench/react/check.js --impl freezedry
node bench/react/perf.js --impl freezedry --impl handwritten
```

Details: [docs/react.md](docs/react.md).

## Results

22 real-world workloads ([bench/](bench/README.md)): lodash, underscore, ramda, immutable, moment, chroma-js, acorn, crc-32, marked, d3-scale, redux, Handlebars/Preact/React SSR/YAML apps, and seven large ones (moment-timezone, prettier, highlight.js, three, mathjs, babel-standalone, typescript). Node 26, shared 4-vCPU machine. The revived Prepack build is included as reference data.

| | Prepack (best profile) | freezedry zero-config | freezedry with opt-ins |
|---|---:|---:|---:|
| Smoke test OK | 18 | 11 | 21 |
| Verified by the heap-isomorphism oracle | n/a | 11 | 19 |
| Clean bailout (original kept) | 4 fail | 11 | 1 (prettier) |
| Compiled and smoke OK, oracle ran out of memory | — | — | 2 (mathjs, typescript) |
| **Silent miscompile** | **0** | **0** | **0** |

Zero-config mode bails on 11 workloads because their init reads a clock or RNG (lodash, immutable, redux, d3-scale, three, …) or probes the environment; "opt-ins" are the documented per-workload `--allow-volatile`/`--assume` flags.

Performance, opt-ins build with the default `function` fallback:

- **Code-cache / exec-only time** (a warm or snapshot-backed start): faster than the original on 15 of 21 compiled workloads, e.g. handlebars-app 3.3x, yaml-router-app 3.3x, moment 2.9x, mathjs 1.8x, ramda 1.5x, lodash 1.3x, babel-standalone 1.3x. Slower on three (0.8x) and typescript (0.65x), where rebuilding a very large heap costs more than the init it replaces.
- **Cold `node` start** is usually worse (0.4–0.9x), because the safe fallback embeds the whole original source behind the guard. With `--fallback throw` (residual only, for a known environment) gzip size is 0.94–1.33x the original and cold start beats the original on underscore, handlebars-app and yaml-router-app.
- **Size** with the fallback is 1.25–2.5x the original (gzip of terser output); the residual alone is close to the original.

Full tables and analysis: [docs/results.md](docs/results.md). Raw data: [bench/results/](bench/results/README.md).

## Limitations

- **Cold start and size** pay for the embedded fallback. An external fallback file or a pinned-environment `throw` mode avoids it.
- **Large heaps**: mathjs's output is 19 MB raw (it captures large derived tables and dispatch caches), and the verifier needs more than 12 GB for mathjs and typescript, so they are reported unverified.
- **prettier** bails on a non-empty `WeakMap`; weak collections cannot be enumerated without heap-snapshot recovery of ephemeron tables.
- **The `function` fallback runs the original code inside a function**, so top-level `var` and function declarations of a classic script become locals instead of globals on the fallback path. UMD/IIFE bundles (the benchmark corpus) are unaffected; for plain scripts that declare globals, use `--fallback eval`.
- **Zero-config coverage** is limited by clock/RNG reads during init; dead-value analysis (lodash's `shortOut` timestamp, d3-time's scratch `Date`s) could remove the need for opt-ins.
- **React specializer**: function components only (no classes, Suspense, `lazy`, portals); destructuring, optional chaining, async functions and generators in the app disable it; request data is assumed to be plain data (`checkPlainData` enforces it per request).

## Background

freezedry grew out of an experiment reviving Facebook's [Prepack](https://github.com/facebookarchive/prepack), a partial evaluator that ran JavaScript in an interpreter written in JavaScript and serialized the resulting heap ([jlongster/prepack-revived](https://github.com/jlongster/prepack-revived)). Re-implementing the spec is where Prepack struggled: modern syntax, `Intl`, `Date`, async, and the long tail of real libraries. Running initialization in V8 itself and capturing the heap through the inspector sidesteps all of that. freezedry is its own project and does not depend on Prepack; it keeps a Prepack-compatible API only so the same benchmark harness can measure both.

## Repository layout

```
index.js            public API: freeze, freezeAsync (+ Prepack-compatible aliases)
bin/freezedry.js    CLI
lib/                run, inspector bridge, capture, heap snapshot, emit, scope/value/function emitters,
                    intrinsics, environment profiles and membrane, guard, verifier, benchmark adapter
react/              React SSR trace-based specializer, guard fuzzer, results
test/               node:test suites (unit, corpus, end-to-end, React)
tools/oracle-one.js run the verifier on one benchmark workload
bench/              real-world benchmark: setup, driver, perf harness, comparison report, results
bench/react/        React SSR benchmark: app, data generator, check/perf harnesses, reference impls
docs/               design and capture-graph format, capture, emit, environment, verify, React, results
```

## Development

```sh
npm test                       # 148 tests; builds the benchmark corpus on first run
npm run test:large             # end-to-end oracle on the 7 large workloads (slow, needs lots of memory)
node bench/run.js --help       # benchmark driver
node bench/compare.js --help   # comparison report
```

## License

MIT. All code here was written for this project; none of it is derived from Prepack's source (the benchmark harness and React benchmark were written alongside it in the prepack-revived repository, under the same author).
