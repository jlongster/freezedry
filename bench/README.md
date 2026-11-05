# Benchmark

22 real-world workloads (24 MB of JavaScript) whose module initialization does real work, plus a
harness that compiles each one, checks that the output behaves identically, and measures size and
startup. A separate React SSR benchmark lives in [`react/`](react/README.md).

The harness is compiler-neutral: it drives any module that exposes Prepack's
`prepackSources(sources, options)` API. freezedry exports that API, so it is the default; pass
Prepack's `lib/prepack-node.js` to benchmark Prepack instead. Prepack is never required.

## Setup

```sh
node bench/setup.js        # npm install inside bench/, then bundle the 22 workloads into bench/libs/dist/
```

`setup.js` installs the pinned packages from `bench/package-lock.json` into `bench/node_modules`,
bundles each workload with esbuild (`libs/specs.js` has the build and smoke test for each), runs
every smoke test twice in a fresh `vm` context and twice in a fresh `node` process to check
determinism, and writes `libs/manifest.json` (sizes, sha256, expected smoke digests). The build is
reproducible: on a fresh clone it produces byte-identical bundles, matching the committed manifest.
It does nothing when the bundles already match the manifest (`--force` rebuilds). `npm test` runs
it as `pretest`.

## Running

```sh
node bench/run.js                                   # freezedry, all 22 workloads, full perf harness (slow)
node bench/run.js --only lodash,moment --no-perf    # compile + correctness only
FREEZEDRY_OPTINS=corpus node bench/run.js           # with the documented per-workload opt-ins (docs/env.md)
node bench/run.js --orig-only                       # Original baselines only (timings, sizes, V8 snapshot)
node bench/run.js --compiler /path/to/prepack/lib/prepack-node.js   # benchmark Prepack instead
node bench/run.js --help
```

For each workload, `run.js` compiles it (in a worker process per option profile; freezedry only
needs the `default` profile), then runs the smoke test on the output in a fresh `vm` context and a
fresh `node` process and compares the digest with the original's:

- **OK**: same digest in both.
- **WRONG**: the compiler reported success but behaviour differed (a silent miscompile).
- **FAIL**: the compiler reported an error or bailed out (freezedry: a clean bailout, original code kept).
- **TIMEOUT**.

For OK outputs it then measures, against the original: raw/terser/gzip/brotli size; cold `node`
process time (minus a `node -e 0` baseline); VM run with V8 code cache; VM exec-only time; and a Node
`--build-snapshot` reference where Node supports it. Results go to `bench/results/<timestamp>.json`
and `bench/results/latest.md` (or `--out-json` / `--out-md`).

Large workloads (>= 750 KB or `tier: "large"`) get a 15-minute timeout and a 16 GB heap, run
fewer perf iterations (N=15, or N=12 above 3 MB; `--no-adapt-runs` disables this), and are
scheduled by a memory-weighted worker pool so multi-MB compiles do not run concurrently.

## Comparison report and oracle

```sh
node bench/compare.js --run --opt-ins                       # run freezedry + the heap-isomorphism oracle, write comparison.md
node bench/compare.js --no-verify                           # report from bench/results/freezedry-latest.json only
node bench/compare.js --compare-prepack bench/results/prepack/prepack-final.json   # add a Prepack column from saved data
node bench/compare.js --compare-prepack /path/to/prepack/lib/prepack-node.js       # ...or by running Prepack
```

The oracle (`tools/oracle-one.js`) runs one process per workload and appends to
`bench/results/oracle-{optins,zeroconfig}.jsonl`; existing records are reused unless `--rerun-oracle`.
The large-tier oracle needs a lot of memory (mathjs and typescript need more than 12 GB).

## Workloads

| ID | Tier | Packages | Size | What init does |
|---|---|---|---:|---|
| `lodash` | standard | lodash@4.18.1 | 533.1 KB | Utility library; module init constructs LodashWrapper/LazyWrapper prototypes, 300+ methods, and lookup tables. |
| `underscore` | standard | underscore@1.13.8 | 67.3 KB | Functional utility library; module init performs environment feature checks and mixes 100+ functions onto `_.prototype`. |
| `ramda` | standard | ramda@0.32.0 | 342.9 KB | Point-free curried functional library; module init wraps 250+ combinators in _curry1/_curry2/_curry3 dispatchers. |
| `immutable` | standard | immutable@4.3.9 | 175.4 KB | Persistent HAMT/trie collections (Map, List, Set, OrderedMap, Record); builds prototype hierarchies and sentinels at init. |
| `moment` | standard | moment@2.31.0 | 637.8 KB | Init-heavy date/time library with 135+ bundled locales registered via defineLocale() and regex token tables built at load. |
| `chroma-js` | standard | chroma-js@2.4.2 | 109.2 KB | Color conversion & scale library; module init registers RGB/HSL/Lab/LCH/CMYK color spaces, ColorBrewer palettes, and W3C named colors. |
| `acorn` | standard | acorn@8.19.0 | 240.9 KB | ECMAScript parser; module init builds token types, keyword regexes, operator precedence tables, and Unicode identifier bitmaps. |
| `crc-32` | standard | crc-32@1.2.2 | 3.6 KB | Lookup-table CRC-32 implementation; module init computes a 256-entry table and 16 slice-by-16 Int32Array subtables (4,096 entries). |
| `marked` | standard | marked@18.1.3 | 49.4 KB | Markdown parser & compiler; module init constructs GFM/pedantic/normal block and inline grammar regex tables. |
| `d3-scale` | standard | d3-scale@4.0.3, d3-array@3.2.5, d3-interpolate@3.0.2, d3-color@3.1.1, d3-format@3.1.3, d3-time@3.1.1, d3-time-format@4.1.1, internmap@2.0.3 | 148.9 KB | Data visualization quantitative/ordinal/time scales, array statistics, formatters, and color interpolators initialized on `d3`. |
| `redux` | standard | redux@5.0.1 | 18.1 KB | Redux bundled into an ES2015 IIFE; module init composes reducers, applies logging/validation middleware, creates a store, and dispatches seed actions. |
| `handlebars-app` | standard | handlebars@4.7.10 | 211.9 KB | App workload: loads Handlebars compiler+runtime, registers helpers/partials, compiles an invoice template AST to JS, and renders a boot view at module init. |
| `preact-ssr-app` | standard | preact@10.29.0, preact-render-to-string@6.6.7 | 22.0 KB | App workload: Preact + preact-render-to-string renders a multi-component documentation dashboard at module init and exposes dynamic SSR at runtime. |
| `react-ssr-app` | standard | react@18.3.1, react-dom@18.3.1 | 47.0 KB | App workload: React 18 + ReactDOMServer legacy browser bundle renders a multi-component storefront catalog at module init and serves runtime SSR. |
| `yaml-router-app` | standard | js-yaml@4.3.2, mustache@4.2.0 | 157.1 KB | Init-heavy app workload: parses a 95-line YAML service/route manifest with js-yaml, compiles 10 parameterized REST routes into RegExps, and pre-parses Mustache views at module init. |
| `moment-timezone` | large | moment@2.31.0, moment-timezone@0.6.6 | 913.3 KB | Moment core + full Moment Timezone data (~0.91 MB); module init unpacks base-60 IANA transition tables and links for 590+ timezones. |
| `prettier` | large | prettier@2.8.8 | 1065.6 KB | Prettier standalone formatter bundled with Babel, PostCSS, and HTML parser plugins (~1.07 MB); builds printer AST dispatchers and parser grammars at init. |
| `highlight-js` | large | highlight.js@11.12.0 | 1834.5 KB | Full Highlight.js syntax highlighter (~1.72 MB ES2015 IIFE); module init registers all 193 language grammar factories and freezes core tables. |
| `three` | large | three@0.187.0 | 1914.4 KB | Three.js 3D engine (~1.90 MB ES2015 IIFE); module init constructs math LUTs, color management spaces, shader chunks, uniform libraries, and geometry/material classes. |
| `mathjs` | large | mathjs@15.2.0 | 2117.9 KB | Init-heavy math engine (~2.11 MB IIFE); module init constructs 300+ multi-signature functions via typed-function, unit tables, physical constants, and expression algebra. |
| `babel-standalone` | large | @babel/standalone@7.29.13 | 5248.9 KB | Standalone Babel 7 compiler (~5.25 MB UMD); module init registers @babel/parser, @babel/traverse, @babel/generator, core-js compat tables, 100+ plugins, and built-in presets. |
| `typescript` | large | typescript@5.9.3 | 8899.1 KB | Full TypeScript 5.9 compiler (~8.90 MB standalone script); module init constructs scanner/parser/binder/checker/emitter dispatch tables, token maps, and diagnostic catalogs. |

Pinning notes: `typescript@5.9.3` and `prettier@2.8.8` are pinned because `typescript@7` on npm
is the native Go port (no `lib/typescript.js`) and `prettier@3` is async-only.

Node 26's own `--build-snapshot` fails on 3 of the 7 large workloads (`mathjs` and `highlight-js`
abort in Node's C++ snapshotter with `std::length_error`; `babel-standalone` trips Node's
`globalThis.localStorage` getter).

## Results

See [docs/results.md](../docs/results.md) and [`results/`](results/README.md).

## Files

| file | role |
|---|---|
| `setup.js` | install packages, bundle workloads, check determinism, write the manifest |
| `libs/specs.js` | per-workload build recipe and deterministic smoke test |
| `libs/manifest.json` | sizes, sha256 and expected smoke digests (generated by `setup.js`, committed) |
| `run.js` | the benchmark driver |
| `worker.js` | compiles one workload with one option profile in a child process and checks it |
| `harness.js` | sandboxed `vm` and fresh-`node` smoke runners, digests |
| `perf.js` | size and timing measurements |
| `compare.js` | comparison report (freezedry vs Original, optionally vs Prepack) + oracle driver |
| `react/` | React SSR specializer benchmark |
| `results/` | committed results |

JSON field names: per-workload measurements use `orig` and `compiled`. Reports written before the
rename (everything in `results/`) use `prepacked` for the compiled output and `prepack` for the
compiler; `compare.js` reads both.
