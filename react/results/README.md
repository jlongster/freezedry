# react-hybrid results

| file | what |
|---|---|
| `check.json` | `react-bench/check.js --json` output: 500/500 byte-identical |
| `perf.md`, `perf.json` | `react-bench/perf.js --impl react-hybrid --impl handwritten --rounds 5` (throughput under JIT and jitless, cold start) |
| `fallback-rate.jsonl`, `fallback-rate.js` | fallback rate on the check, small and large corpora for 3 training-set sizes |
| `fuzz.jsonl` | `fuzz.js --n 10000 --mutations 6`, seeds 21–25: 0 mismatches |
| `relearn.json`, `relearn-demo.js` | offline relearning from collected fallback inputs (fuzzed eval set) |
| `build-stats.json` | build statistics: frames, templates, decisions, sizes, timings |
| `generated-template.js` | the generated templates for the bench app (default training set) |

The numbers were measured on a shared 4-vCPU box (AMD EPYC, Node 26.7) while other agents were
running. Speedups are medians of per-round ratios against baseline.
