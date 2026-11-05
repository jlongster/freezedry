# React SSR specializer (`react/`): trace-based templates with guards

The React specializer takes a **known** React app and **unknown** request data, and builds a specialized
`render(data)` that returns exactly the same bytes as `ReactDOMServer.renderToString(<App data={data}/>)`.
It applies freezedry's approach ([design.md](design.md)) to rendering:

- **Run the real code in the real engine.** The app, React and ReactDOMServer all run in V8 while
  tracing. The specialized renderer still calls the app's own helper functions (`formatMoney`,
  `cx`, `formatDateUTC`, ...) at render time. It never re-implements them.
- **Every assumption is a guard.** The renderer checks each one at runtime. When a guard fails, it
  falls back to the real `renderToString` for that request.
- **Verify.** Build-time probes check every modeled React behaviour against React itself, and a
  self-check runs on the training inputs. Correctness is then measured on the 500-input corpus and
  on random fuzzing beyond it.

It is an implementation module for the React benchmark in [`bench/react/`](../bench/react/README.md): `{ name, prepare(appSource, opts) -> render }`. `bench/react/impl/freezedry.js` points at it.

```
node bench/react/check.js --impl freezedry
node bench/react/perf.js  --impl freezedry --impl handwritten
node react/fuzz.js --n 10000 --seed 1 --mutations 5      # guard fuzzer
node --test test/react*.test.js
```

## Results (`bench/react`, `app/app.js`, 30 components; Node 26; 4-vCPU shared box)

**Correctness.** `check.js`: **500/500 byte-identical** (corpus fingerprint `4fafe7d601e3561d`).
The fuzzer produced **0 mismatches on 50,000 mutated inputs** with the final code (seeds 21–25,
`react/results/fuzz.jsonl`), plus 43,000 more on earlier development versions. Mutations go up to 6 per input:
deleted, nulled or retyped fields, special numbers, escaping-relevant strings, arrays truncated,
duplicated or emptied, extra keys, objects replaced by arrays or strings). Inputs that make the
app itself throw also throw the same error through the specialized renderer.

**Fallback rate.** The default training set is 60 small + 10 large pages from `getTrainingCorpus`,
whose seeds are disjoint from the check corpus. See `react/results/fallback-rate.jsonl`.

| corpus | fallbacks | mismatches |
|---|---:|---:|
| check corpus (500) | **2 (0.4%)** | 0 |
| perf small corpus (500) | 2 | 0 |
| perf large corpus (100 pages, ~4,500 elements each) | 0 | 0 |
| fuzzed inputs (2,000) | 476 (281 of them make the app throw) | 0 |
| same, after one round of offline relearning | **281 (only the throwing inputs)** | 0 |

The 2 check-corpus fallbacks are hand-written edge cases with paths the data generator never
produces, so the training set never traced them: `promo.minOrder === 0` and `specs: []`.
With only 20 + 2 training pages the rate is about 30%: coverage comes from tracing.

**Throughput.** From `perf.js`; the speedup is the median of per-round impl/baseline ratios.
`react/results/perf.md` has the run used here: 5 rounds, under a load average of 5–12 from other jobs.
An earlier quiet run gave the same ratios within about 10% (for example JIT small 5.1x, jitless large 14x).

| | JIT small | JIT large | jitless small | jitless large |
|---|---:|---:|---:|---:|
| baseline `renderToString` | 1.0x | 1.0x | 1.0x | 1.0x |
| **freezedry** | **5.8x** | **4.9x** | **11.9x** | **11.3x** |
| handwritten upper bound | 9.1x | 8.0x | 21.4x | 18.3x |
| freezedry / handwritten | 64% | 61% | 56% | 62% |
| alloc KB/render (baseline → freezedry → handwritten) | 136 → 16 → 13 | 6,408 → 724 → 607 | | |

p50 latency: small pages take 0.014 ms (baseline 0.071, handwritten 0.009), large pages 0.69 ms
(baseline 6.9, handwritten 0.47).

**Cold start.** Fresh process, small page, median. `first HTML` = load + prepare + first render.

| | load | prepare | 1st render | first HTML |
|---|---:|---:|---:|---:|
| baseline (JIT) | 10.5 ms | 0.7 | 4.8 | 16.2 ms |
| **freezedry (JIT)** | 0.9 ms | 2.7 | 1.2 | **4.9 ms** |
| baseline (jitless) | 7.6 | 0.7 | 4.8 | 14.9 |
| **freezedry (jitless)** | 1.0 | 3.3 | 1.1 | **5.3** |

Three things keep the cached path cheap:

- `prepare` loads the artifact from an on-disk cache, keyed by app source, implementation files
  and training configuration.
- It uses a per-V8-flag-set code cache.
- It evaluates the template's module instance against a verified React stub, so neither `react`
  nor `react-dom/server` loads unless a fallback happens.

**Build.** A full build (trace 70 inputs, learn, generate, self-check) takes 2–4 s, mostly
tracing: 22k frames.

**Size.** The generated templates are 72.6 KB (13.2 KB gzip), including 4.2 KB of runtime helpers:
48 template functions, 9 call-site specializations, 5 tabulated helper calls and 75 fallback sites.
`render.code` (what `check.js` reports, 104.5 KB) is `app.js` plus the templates, because the
templates call the app's helpers in the same module scope. See `react/results/generated-template.js`.

## How it works

### 1. Trace: concolic execution of the real app (`instrument.js`, `trace.js`)

The app source is rewritten with acorn. Each operation becomes a hook (`__h.b("+", a, b)`,
`__h.g(o, k)`, `__h.t(test)`, `__h.mc(o, "m", args)`, ...), and each function gets a thin wrapper.
The hooks compute the **concrete result with the real operator or function**, so the app's
semantics come from V8. When an operand is *symbolic*, meaning derived from request data, they
also build the **symbolic expression** of the result.

- **Frames.** A frame opens when React calls a component, with roots `P` (props), `C<i>` (contexts)
  and `I<k>` (`useId` values). A frame also opens when `Array#map` calls an element-building
  callback, with roots `A0..A2` and the callback's free variables `E<j>`. Each frame records its
  decisions, its return value, and the elements created in it. Because frames are per invocation,
  one component template serves every instance, and a map callback becomes a loop over any array length.
- **Decisions.** The tracer records every branch on a symbolic value, along with the key sets of
  spread objects and the classes of values used in the output.
- **Opaque calls.** A **pure** app function, as decided by a conservative syntactic purity
  analysis, runs concretely. Its call is recorded as `call(fn, args)`, so the template calls the
  original helper at runtime. The template never re-executes its body symbolically.
  `Math.*`, `String(...)` and the non-mutating `String.prototype`/`Array.prototype` methods are
  handled the same way.
- **Poisoning.** Anything the tracer cannot express soundly *poisons* the frame. The frame keeps
  executing concretely, so React still renders, but it is not learned, and at runtime that point
  falls back. Poisoning covers:
  - impure calls with symbolic receivers;
  - writes to objects not created in the frame;
  - reads of reassigned module bindings;
  - reads of shared objects that any traced render writes to (detected after all traces);
  - `Math.random` / `Date`;
  - `setState` during render, `useReducer`, `React.Children`, `cloneElement`;
  - caught exceptions, symbolic element types, `defaultProps`, and similar.

Why instrumentation rather than Proxy-wrapped data? Proxies observe *reads*, but not what the code
computes from them: `"ns-btn-" + variant`, `count <= 0`, `formatMoney(price, locale)`. Concolic
hooks record those expressions exactly, while V8 still computes every value. Proxies would also
change the data that React sees.

### 2. Learn: guarded paths and leaves (`learn.js`)

Each frame becomes a **path** of decisions plus a **leaf**: an output tree of constant HTML chunks,
slots, child-template calls, loops, providers and dynamic children. Paths are merged into one
decision **trie** per template. Two traces that disagree on the same guarded path mark the
template as *conflicting*, and it always falls back.

**Host elements are never re-implemented.** Each element is rendered by the real
`ReactDOMServer.renderToString`, with private-use **marker** strings (`\uE000<n>\uE001`) in place
of symbolic values. The result is cut at the markers into constant chunks and slots. A slot
transform is used only after **probing React** with a battery of values of the guarded class:

- attribute escaping: `prefix + escape("" + v) + suffix` for strings and numbers, including `""`, `&<>"'`, `NaN`, `-0`, `1e21` and `javascript:`;
- style values: trimmed strings, or numbers with or without `px`, checked per property and with `0` for unitless properties;
- `__html`.

**Attribute regions.** For attributes whose value can be a string, number, boolean, `null` or
`undefined`, React renders the element with the attribute set to a marker, `true`, `false` and
`null`. The insertion each value produces is tabulated, which captures boolean-attribute rules,
`data-*`/`aria-*` stringification and React's attribute order (`value` comes last on `<input>`).
The composed model is then **checked exhaustively against React** for every combination of
values before it is used. Elements whose output depends on children or ancestors (`select`,
`textarea`, `option`, `svg`, ...) are rendered as constant subtrees, with their values pinned by
equality guards.

### 3. Generate (`codegen.js`)

There is one JS function per template (`$T<fid>` for components, `$B<fid>` for map callbacks).
Each walks its trie, and every missing edge is a numbered `$fb(site)`. Output goes to a module
string; React's `<!-- -->` text-separator state is tracked statically where it is known and at
runtime otherwise. `useId` uses the same tree-context arithmetic as React's Fizz, and is verified
against React at build time.

Optimizations:

- **Common subexpressions.** Shared subexpressions are bound once.
- **Static typing of expressions.** `!x` is boolean and `"a" + x` is a string, so many guards and escapes disappear.
- **Escape analysis.** Ids, numbers and constant concatenations are escape-free, a value escaped twice is escaped once, and escaping distributes over concatenation.
- **Positional props.** Components whose props are only read as `P.key` take their props as positional parameters, with no props objects.
- **Call-site specialization.** Constant props are folded into a specialized copy of the callee, with operations on constants performed at build time by the real operators and helpers. For example `<ActionButton variant="secondary" size="sm" extraAttrs={{...}}>` becomes one constant string plus a `disabled` ternary.
- **Finite-domain tabulation.** A pure helper call whose only non-constant inputs are booleans is evaluated at build time for every combination, for example `cx("ns-card", {featured, out})` becomes a 4-entry table.

### 4. Verify and run (`index.js`)

The build performs four checks before a template is accepted:

1. The instrumented app must render byte-identically to the original on every training input. Otherwise specialization is disabled.
2. Build-time probes check the runtime's text escaping, `<!-- -->` separators and `useId` model against React, including ids that overflow 30 bits.
3. **Self-check.** The generated renderer must match `renderToString` on every training input. Any mismatch disables it: it is a modeling bug and is never accepted.
4. **React stub check.** Stub mode is enabled only if the app's module top level touches nothing but `React.createContext`, and the stub instance reproduces the self-check.

At runtime, `render(data)` runs the template. A failed guard (`$fb`) or any exception falls back
to `renderToString` with the real app module, so app errors propagate unchanged.
`render.stats.fallbackReasons` names the guard that failed. With `opts.collectFallbacks = N`, the
renderer keeps copies of inputs that fell back, so the app can be rebuilt with them as extra
training inputs (*offline relearning*, `react/results/relearn-demo.js`).

## Guards (what is checked at runtime)

| assumption | guard |
|---|---|
| branch outcome on a data-derived value | `if (expr)` re-evaluates the app's own predicate expression; the untraced side is `$fb` |
| value-dependent output (pinned attribute, `<select>` value, ...) | `expr === <traced value>` chains, else `$fb` |
| shape of a spread object (`{...extraAttrs}`, `Object.assign`) | exact own-key list and order |
| attribute value type | the region model covers string, number, `true`, `false`, `null` and `undefined`; other types use `$fb` |
| style value class | non-empty string, or non-zero number (or any number for unitless properties) |
| text child type | string, number or nullish/boolean is emitted; element or array children go through `$emitNode`; objects use `$fb` |
| list | `Array.isArray`, then any length; each element runs the callback's guarded template |
| reads that may throw | every property read and call the traced code performed is performed again by the template, so a template never succeeds where the original would throw |
| component/callback never traced | `$fb` |

## What falls back, and why

- **Untraced paths.** Branches, values or key sets that no training input exercised, for example
  an untraced `sortBy` option or `minOrder === 0`. Train on more data, or relearn from collected
  fallbacks.
- **Poisoned frames.** History-dependent or impure rendering: module-level mutable state, writes
  to shared objects, impure helpers with data arguments, `Math.random`/`Date`, `useReducer`,
  render-phase `setState`, `React.Children`/`cloneElement`, caught exceptions, `defaultProps`, and
  data-dependent element types.
- **Disabled builds.** Unsupported syntax disables the whole build: classes and class components,
  async functions and generators, destructuring patterns, optional chaining, getters and setters,
  and `super`. The renderer is then exactly `renderToString`. The instrumenter could be extended to
  cover these.
- **Errors.** When the app throws, the same error is rethrown by the fallback path.

## Limits and assumptions

- **Plain data.** Request data is assumed to be plain data: property reads have no side effects
  and return stable values (JSON-like, as `check.js` passes). The template evaluates the app's
  expressions, but not necessarily with the same number or order of property reads.
  `opts.checkPlainData` validates this per request (no accessors, symbols or Proxies; plain
  prototypes) and falls back otherwise, at the cost of an O(size) walk.
- **Purity analysis** is syntactic and conservative. Aliasing a module object through another
  function before mutating it is not tracked statically, but such writes are caught dynamically
  during tracing (poisoning plus the shared-read check). They would be missed only if no training
  input ever executed them.
- **Model checks are tied to this React version.** The text model, separators, `useId`, attribute
  regions and style values are checked against the React loaded at build time. Changing React
  rebuilds the artifact, because the cache is keyed by implementation files and app source, not by
  the React version. Rebuild after upgrading React.
- **Supported features.** Function components, hooks (`useContext`, `useMemo`, `useCallback`,
  `useState` without updates, `useRef`, `useId`), context providers, fragments, keyed lists,
  `dangerouslySetInnerHTML`. There is no Suspense, `lazy`, class components or portals:
  those fall back.
- **Compared with the handwritten version,** the remaining gap is mostly guard and class checks
  on values whose type cannot be proven statically, escaping values a human knows are safe, and
  props and tree-context allocations.

## Files (in `react/` unless noted)

| file | role |
|---|---|
| `index.js` | `prepare`/`build`, verification, renderer with fallback, artifact and code cache, React stub, plain-data check |
| `instrument.js` | acorn-based rewriting, scope analysis, purity analysis, mutable-binding detection |
| `trace.js` | concolic runtime (`__h`), frames, decisions, poisoning, React API interposition |
| `expr.js` | symbolic expression nodes (canonical JS source as key), static typing |
| `learn.js` | frames → tries; host elements via real React with markers; probes; attribute regions |
| `codegen.js` | tries → JS; runtime helpers; folding, specialization, tabulation; runtime-model verification |
| `fuzz.js` | guard fuzzer |
| `results/` | `check.json`, `perf.md`/`perf.json`, `fallback-rate.jsonl`, `fuzz.jsonl`, `relearn.json`, `build-stats.json`, `generated-template.js` |
| `test/react*.test.js` (repo root) | 17 tests: features, soundness boundaries, cache/stub, end-to-end on `bench/react` |

## Next steps

- Extend the instrumenter: destructuring, optional chaining, class components.
- Static escape-safety from data provenance.
- Cheaper tree-context handling.
- Key the artifact cache by React version.
