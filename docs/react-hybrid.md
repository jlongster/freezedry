# Track React-Hybrid: trace-based template specialization of React SSR

Full design and results: `hybrid/react/README.md`.

**What works.** For the react-bench app (30 components, React 18.3), `hybrid/react/index.js`
traces the real app in V8 using concolic source instrumentation. It learns guarded per-component
and per-map-callback templates, and emits a specialized renderer that calls the app's own pure
helpers. Correctness:

- `check.js`: 500/500 byte-identical, with 0.4% fallback (the 2 hand-written edge cases);
- 0/100 fallbacks on large pages;
- 0 mismatches on 50,000 fuzzed inputs.

Speed: 4.9–5.8x baseline under JIT and 11–12x under `--jitless`, which is 56–64% of the
hand-written upper bound. Cold first HTML is 4.9 ms vs 16.2 ms for baseline.

**What falls back, and why.**

- Untraced paths (fixable with more training or with offline relearning from collected fallbacks).
- Poisoned frames, meaning impure or history-dependent rendering: mutable module state, writes to
  shared objects, `Math.random`/`Date`, `useReducer`, render-phase `setState`, `React.Children`,
  caught exceptions.
- Unsupported syntax disables the build entirely: classes, async functions and generators,
  destructuring, optional chaining.

**Assumption.** Request data is plain data. `opts.checkPlainData` enforces it at runtime.

**Next steps.**

- Extend the instrumenter: destructuring, optional chaining, class components.
- Static escape-safety from data provenance.
- Cheaper tree-context handling.
- Key the artifact cache by React version.
- Share the symbolic expression layer with the Phase 2 symbolic engine.
