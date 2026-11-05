# Benchmark results

Raw data behind [docs/results.md](../../docs/results.md). Node v26.7.0, linux/x64, 4 vCPUs (shared).
freezedry was called "hybrid" when these were measured, so the reports say "Hybrid" and use the
older `prepacked`/`prepack` JSON field names for the compiled output and the compiler.

| file | what |
|---|---|
| `freezedry-final-zeroconfig.{json,md}` | `bench/run.js`, freezedry with no opt-ins |
| `freezedry-final-optins.{json,md}` | same, with `FREEZEDRY_OPTINS=corpus` |
| `freezedry-final-optins-throw.{json,md}` | opt-ins with `FREEZEDRY_FALLBACK=throw` (residual only, standard tier) |
| `freezedry-latest.{json,md}` | the latest run (= final opt-ins) |
| `oracle-{zeroconfig,optins}.jsonl` | heap-isomorphism oracle record per workload (`tools/oracle-one.js`) |
| `comparison-final-{zeroconfig,optins}.{json,md}` | three-way reports from `bench/compare.js` |
| `prepack/prepack-final.{json,md}` | the final revived Prepack build on the same harness (reference data) |
| `prepack/prepack-baseline.{json,md}`, `prepack/2026*.json`, `prepack/latest.md` | earlier Prepack runs |
