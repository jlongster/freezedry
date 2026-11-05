# Environment boundary and runtime guard (`lib/env.js`, `lib/guard.js`)

## Overview

`lib/env.js` isolates build-time VM execution from the Node build host so initialization never silently bakes host-specific globals, clocks, random numbers, locales, or timezones:

1. **Target Environment Profiles (`lib/env-profiles.js`)**: Defines deployment profiles (`ecmascript`, `browser`, `worker`, `node`, `bun`, `hermes`, and the default `universal`, with aliases `bench`, `ecma` and `bare`), distinguishing:
   - Pure ECMA-262 globals (shared across all targets).
   - Global aliases (`window` / `self` in `browser`, `self` in `worker`, `global` in `node` / `hermes`, `global` / `self` in `bun`) mapped directly to `globalThis` so captured closure references (e.g. Lodash/Underscore `var root = self`) remain genuine `{ "global": true }` references rather than `Proxy` objects.
   - Host globals that exist in the target with unknown values at build time (`document`, `navigator`, `location`, `localStorage`, `process`, `module`, `exports`, `require`, `fetch`, `setTimeout`, `performance`, `crypto`, `console`, `WebAssembly`, ...).
   - Absent globals (`typeof X === "undefined"`).
2. **Global Prototype Membrane + Stand-ins (`lib/env.js`)**:
   - Inserts a realm-local `Proxy` between `Object.getPrototypeOf(globalThis)` and `Object.prototype` inside `ctx` (plus detaching V8's default `console` and `WebAssembly` own properties during `run`).
   - Avoids polluting `Reflect.ownKeys(globalThis)` so capture's global-root diffing sees only user-created globals, and adds zero trap overhead on standard ES globals (`Object`, `Array`, `Map`, ...) or ordinary objects (`{}.foo`).
   - `recorder.restore()` cleanly removes the `Proxy` and restores wrapped intrinsics (while preserving any user `intrinsicPatches` made during init) before heap capture.
   - Registers all stand-ins and volatile wrappers in the run's `intrinsicsMap` (`Map<object, string>`, `WeakMap<object, string>`, or `Map<string, object>`), so closures caching references like `var st = setTimeout` or `var now = Date.now` capture as `{ "intrinsic": "setTimeout" }` / `{ "intrinsic": "Date.now" }`.
3. **Volatile & Host-Dependent APIs**:
   - `Math.random`: bails out by default (even if user code wraps it in `try/catch`, e.g. Redux `combineReducers`); `--seed` / `mathRandomSeed` is explicitly rejected; `--allow-volatile=Math.random` bakes and documents every call in `recorder.bakedVolatiles` and `recorder.diagnostics`.
   - `Date`: `Proxy` over `Date` preserving `Date.prototype` identity, `Date.prototype.constructor`, `instanceof Date`, `class extends Date`, and `[native code]` `Function.prototype.toString`. `Date.now()`, `new Date()` (0 args), and `Date()` bail out unless opted in via `--allow-volatile`.
   - Timezone-dependent `Date` operations (`new Date(y, m, ...)`, non-UTC `new Date(str)` / `Date.parse(str)`, and `Date.prototype` local getters/setters/`toString`/`toDateString`/`toTimeString`) bail out by default; `--assume-tz=UTC` (or named IANA zone) pins `process.env.TZ` during `run`, restores it on `recorder.restore()`, and emits a runtime timezone guard (`new Date(0).getTimezoneOffset() === 0` for UTC). Deterministic UTC operations (`new Date(ms)`, `Date.UTC(...)`, ISO `Z`/offset/date-only strings, `getUTC*`, `toISOString`) run with zero assumptions or bailouts.
   - `performance.now`, `crypto.getRandomValues`, `crypto.randomUUID`, `setTimeout`/`setInterval`/`setImmediate`/`requestAnimationFrame`, `Intl.*`, `*.prototype.toLocale*`, `String.prototype.localeCompare`, and `console.*` bail out when called during init (with `--allow-volatile` opt-ins where applicable). `queueMicrotask` is supported via `ctx`'s `Promise.resolve().then(...)`.
   - Error stack text is host/call-site dependent: formatting a stack during init (`new Error().stack`), assigning `Error.prepareStackTrace`, or reading it bails; `--allow-volatile=Error.stack` bakes the formatted text (verify replays it through `Error.prepareStackTrace`).
4. **Runtime Guard & Fallback Emission (`lib/guard.js`)**:
   - Compiles recorded `{ kind, expr, observed }` assumptions into a short-circuit-safe `if (!(<cond>)) { <fallback> } else { <rebuilt> }` wrapper.
   - Preserves encounter order so `typeof X === "object" && X !== null` always guards downstream `X.prop` checks (preventing `ReferenceError` on undeclared globals and `TypeError` when `X === null`), handles non-identifier keys (`globalThis["__core-js_shared__"]`), and handles `NaN` (`Number.isNaN`), `-0` (`Object.is(x, -0)`), `Infinity`, and `bigint`.
   - Emits 0 bytes of guard/fallback when `assumptions` is empty.
   - Supports four fallback strategies:
     - `"eval"`: `(0, eval)("<escaped>")` — preserves global `var`/`function` bindings without V8 direct-`eval` scope deopt; HTML `</script>` and U+2028/U+2029 safe.
     - `"function"` (default in `freeze()` and the CLI): `(function () {\n<orig>\n}).call(this)` — CSP-safe (no `unsafe-eval`), V8 lazy-preparsed, CommonJS `module`/`exports` compatible, and compresses tightly with gzip via shared LZ77 backreferences.
     - `"throw"`: `throw new Error(...)` — ~215–660 B raw (~65–152 B gzip) overhead.
     - `"external"`: `require("<externalPath>")` / `import("<externalPath>")` for bundler code-splitting (~345–773 B raw, ~103–190 B gzip).

---

## Per-Benchmark-Library Environment Reads & Volatile Calls (`bench/libs/dist/*.js`)

Measured under the `"browser"` profile (`window === globalThis`, `self === globalThis`):

| Workload | Default (`browser`) | Global / Env Reads During Init | Volatile / Unknown Calls During Init | Opt-in to Unlock (`browser`) |
|---|---|---|---|---|
| **`acorn`** | **OK** | `exports` (`undefined`), `define` (`undefined`) | None | *(none)* |
| **`chroma-js`** | **OK** | `exports` (`undefined`), `define` (`undefined`) | None | *(none)* |
| **`crc-32`** | **OK** | `DO_NOT_EXPORT_CRC` (`undefined`), `exports` (`undefined`), `define` (`undefined`), `global` (`undefined`), `self` (`globalThis`) | None | *(none)* |
| **`marked`** | **OK** | `exports` (`undefined`), `define` (`undefined`) | None | *(none)* |
| **`moment`** | **OK** | `exports` (`undefined`), `define` (`undefined`) | None | *(none)* |
| **`preact-ssr-app`** | **OK** | `define` (`undefined`), `module` (`undefined`), `self` (`globalThis`), `exports` (`undefined`), `global` (`undefined`) | None | *(none)* |
| **`ramda`** | **OK** | `exports` (`undefined`), `define` (`undefined`) | None | *(none)* |
| **`yaml-router-app`** | **OK** | `exports` (`undefined`), `define` (`undefined`), `global` (`undefined`), `self` (`globalThis`) | None | *(none)* |
| **`underscore`** | **BAIL** (`document.childNodes` at `139:49`); **OK** in `worker`/`ecmascript` | `exports` (`undefined`), `define` (`undefined`), `_` (`undefined`, for `noConflict`), `self` (`globalThis`), `document` (`object`) | Reads unasserted `document.childNodes` for legacy Safari 8 `typeof NodeList` check | `--assume typeof:document.childNodes='"object"'` (or `worker` profile) |
| **`react-ssr-app`** | **BAIL** (`navigator.scheduling` at `21:20`) | `exports`, `define`, `self`, `performance`, `performance.now` (`function`, cached not called), `setTimeout` (`function`, cached), `clearTimeout` (`function`, cached), `setImmediate` (`undefined`), `navigator`, `MessageChannel`, `global` | Probes `navigator.scheduling.isInputPending`; constructs `new MessageChannel()` if `MessageChannel` is defined | `--assume navigator.scheduling=undefined --assume MessageChannel=undefined` |
| **`lodash`** | **BAIL** (`Date.now` at `6783:21`) | `global` (`undefined`), `self` (`globalThis`), `exports` (`undefined`), `__core-js_shared__` (`undefined`), `_` (`undefined`, for `noConflict`), `clearTimeout` (`function`), `setTimeout` (`function`), `define` (`undefined`) | Calls `Date.now()` 50x inside `shortOut(baseSetToString)` hot-call detector during method setup | `--allow-volatile=Date.now` |
| **`redux`** | **BAIL** (`Math.random` at `366:33`) | `global` (`undefined`), `self` (`globalThis`) | Calls `Math.random()` 4x (`ActionTypes.INIT`, `ActionTypes.REPLACE`, and 2x `PROBE_UNKNOWN_ACTION()` inside `combineReducers` `try/catch`) | `--allow-volatile=Math.random` |
| **`immutable`** | **BAIL** (`Math.random` at `893:12`) | `exports` (`undefined`), `define` (`undefined`) | Calls `Math.random()` 1x to initialize `v8Random` hash seed | `--allow-volatile=Math.random` |
| **`handlebars-app`** | **BAIL** (`Math.random` at `1302:16`) | `exports`, `define`, `window`, `__g`, `__e`, `__core-js_shared__`, `Handlebars`, `global`, `self` | Calls `Math.random()` 1x in bundled `core-js` `Symbol` uid helper | `--allow-volatile=Math.random` |
| **`d3-scale`** | **BAIL** (`new Date()` at `3086:12`) | `exports` (`undefined`), `define` (`undefined`), `d3` (`undefined`) | Allocates `const t0 = new Date, t1 = new Date` scratch `Date`s at top level of `d3-time` (`+new Date("2000-01-01T00:00:00.000Z")` is UTC-safe) | `--allow-volatile="new Date" --assume-tz=UTC` |

Large workloads ([bench/README.md](../bench/README.md under `universal`:

| Workload | Default | Volatile / Unknown Reads During Init | Opt-in to Unlock |
|---|---|---|---|
| **`moment-timezone`** | **OK** | None | *(none)* |
| **`highlight-js`** | **OK** | None | *(none)* |
| **`prettier`** | **BAIL** (`Math.random` at `1:5250`) | `core-js` shared-store uid; with the opt-in it still bails on a non-empty `WeakMap` (`__core-js_shared__.state`), which cannot be emitted without approximating | `--allow-volatile=Math.random` (still bails, falls back to original) |
| **`three`** | **BAIL** (`Math.random` at `162:21`) | `MathUtils` UUID lookup seed | `--allow-volatile=Math.random` |
| **`mathjs`** | **BAIL** (`Math.random` at `43555:22`) | `Math.random` + `Date.now` in seeded-RNG / config setup | `--allow-volatile=Math.random,Date.now --assume-tz=UTC` |
| **`babel-standalone`** | **BAIL** (`new Date()` at `603:19`) | `new Date()`, `Date.now`, `Math.random`; probes `console.firebug` / `console.exception` (debug feature detection) | `--allow-volatile="new Date,Date.now,Math.random" --assume-tz=UTC --assume console.firebug=undefined --assume console.exception=undefined` |
| **`typescript`** | **BAIL** (`Date.now` at `5174:18`) | `Date.now` performance timestamp | `--allow-volatile=Date.now` |

---

## Guard Size & Startup Overhead

- **Runtime startup cost**: ~0.60 µs for a 2-clause UMD guard (`typeof exports === "undefined" && typeof define === "undefined"`), ~0.13 µs for UTC timezone guard (`new Date(0).getTimezoneOffset() === 0`), and ~3.7 µs for React's 15-clause guard in `vm.createContext` (< 0.1% of typical library init).
- **Byte overhead**:
  - `fallback: "throw"`: +215 B to +660 B raw (+65 B to +152 B gzip) across all 15 corpus bundles.
  - `fallback: "external"`: +345 B to +773 B raw (+103 B to +190 B gzip).
  - `fallback: "function"` vs `fallback: "eval"`: both embed `originalSource` (~2.00x raw for `function`, ~2.04x raw for `eval`), but on bundles <= 32 KB (`crc-32`, `redux`, `preact-ssr-app`), `function` adds only **+3.9% to +7.9% gzip** (vs +22.5% to +41.7% for `eval`) because unescaped JS shares LZ77 deflate dictionary backreferences with emitted residual functions.

---

## Exports and next steps

- **Exports (`lib/env.js`)**:
  - `installEnvironment(ctx, profile, assumptions, opts) -> recorder`
  - `createBeforeRunHook(profile, assumptions, opts) -> { beforeRun(ctx, intrinsicsMap), afterRun(), getRecorder() }`
  - `emitGuard(recordedAssumptions, originalSource, opts) -> { prelude, wrap(code), condition, fallbackCode }`
  - `measureGuardOverhead(recordedAssumptions, originalSource, rebuiltCode, opts)`
  - `parseEnvFlags(argv)` / `parseAssumeValue(raw)` / `PROFILES`
- **Per-workload opt-ins** used for the benchmark's "opt-ins" mode live in one place, `getCorpusOptInForLibrary` in `lib/bench-adapter.js`, and match the "Opt-in to Unlock" columns above. They are applied only with `useCorpusOptIns: true` or `FREEZEDRY_OPTINS=corpus`.
- **Next steps**: for libraries like `lodash` (`shortOut` `lastCalled` timestamp) and `d3-time` (`t0`/`t1` scratch `Date`s), where a build-time timestamp sits in a dead or scratch closure slot, dead-value or scratch-state analysis could remove the need for `--allow-volatile`.
