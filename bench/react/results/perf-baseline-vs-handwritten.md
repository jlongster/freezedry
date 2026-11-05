# react-bench perf (2026-11-05T15:28:01.916Z)

node v26.7.0, AMD EPYC 9554P 64-Core Processor x4, linux 6.12.93; 1.5s warm-up + 3s timed per cell, 3 interleaved round(s). Load average before/after: 11.3 9.2 6.5 / 11.8 9.9 7.1.

## Throughput (warm, cycling through corpus)

renders/s and speedup are medians over rounds (speedup = median of per-round impl/baseline ratios); latency columns come from the median round.

| engine | page | impl | renders/s | speedup | mean ms | p50 ms | p90 ms | p99 ms | alloc KB/render | avg HTML KB |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| jit | small | baseline (ReactDOMServer.renderToString) | 6,369 | 1.00x | 0.157 | 0.068 | 0.092 | 4.101 | 136.5 | 5.9 |
| jit | small | handwritten (hand-specialized string concatenation) | 49,831 | 9.01x | 0.020 | 0.009 | 0.013 | 0.164 | 12.8 | 5.9 |
| jit | large | baseline (ReactDOMServer.renderToString) | 164 | 1.00x | 6.095 | 6.296 | 10.279 | 15.234 | 6,409 | 283.7 |
| jit | large | handwritten (hand-specialized string concatenation) | 824 | 5.63x | 1.214 | 0.488 | 4.501 | 9.645 | 606.9 | 283.7 |
| jitless | small | baseline (ReactDOMServer.renderToString) | 985 | 1.00x | 1.015 | 0.525 | 2.741 | 8.553 | 154.9 | 5.9 |
| jitless | small | handwritten (hand-specialized string concatenation) | 14,092 | 15.20x | 0.071 | 0.028 | 0.040 | 0.549 | 13.8 | 5.9 |
| jitless | large | baseline (ReactDOMServer.renderToString) | 17 | 1.00x | 57.985 | 55.449 | 74.356 | 98.715 | 7,217 | 284.4 |
| jitless | large | handwritten (hand-specialized string concatenation) | 323 | 18.12x | 3.096 | 1.338 | 7.016 | 15.121 | 650.1 | 283.8 |

## Cold start (fresh process, median; small page)

`load` = require impl module (incl. React if it needs it); `first HTML` = load + prepare + first render.

| engine | impl | node boot ms | load ms | prepare ms | 1st render ms | 2nd render ms | first HTML ms |
|---|---|---:|---:|---:|---:|---:|---:|
| jit | baseline (ReactDOMServer.renderToString) | 75.4 | 20.68 | 0.76 | 9.92 | 1.55 | 32.06 |
| jit | handwritten (hand-specialized string concatenation) | 60.2 | 0.85 | 0.10 | 0.87 | 3.71 | 1.87 |
| jitless | baseline (ReactDOMServer.renderToString) | 70.8 | 22.14 | 0.77 | 13.90 | 1.04 | 37.86 |
| jitless | handwritten (hand-specialized string concatenation) | 63.6 | 0.83 | 0.10 | 0.82 | 0.11 | 2.65 |
