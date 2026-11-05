# react-bench perf (2026-11-05T17:03:57.499Z)

node v26.7.0, AMD EPYC 9554P 64-Core Processor x4, linux 6.12.115; 1.5s warm-up + 3s timed per cell, 3 interleaved round(s). Load average before/after: 3.1 0.8 0.3 / 8.0 4.0 1.6.

## Throughput (warm, cycling through corpus)

renders/s and speedup are medians over rounds (speedup = median of per-round impl/baseline ratios); latency columns come from the median round.

| engine | page | impl | renders/s | speedup | mean ms | p50 ms | p90 ms | p99 ms | alloc KB/render | avg HTML KB |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| jit | small | baseline (ReactDOMServer.renderToString) | 10,187 | 1.00x | 0.098 | 0.065 | 0.086 | 0.368 | 136.7 | 5.9 |
| jit | small | react-hybrid (traced templates + guards) | 44,773 | 5.10x | 0.022 | 0.013 | 0.019 | 0.045 | 16.1 | 5.9 |
| jit | small | handwritten (hand-specialized string concatenation) | 82,659 | 8.80x | 0.012 | 0.008 | 0.012 | 0.019 | 12.8 | 5.9 |
| jit | large | baseline (ReactDOMServer.renderToString) | 216 | 1.00x | 4.631 | 3.468 | 7.613 | 13.366 | 6,414 | 283.8 |
| jit | large | react-hybrid (traced templates + guards) | 1,028 | 4.76x | 0.973 | 0.644 | 1.210 | 7.038 | 725.0 | 283.7 |
| jit | large | handwritten (hand-specialized string concatenation) | 1,661 | 7.69x | 0.602 | 0.456 | 0.672 | 4.506 | 606.3 | 283.7 |
| jitless | small | baseline (ReactDOMServer.renderToString) | 1,502 | 1.00x | 0.666 | 0.502 | 0.679 | 4.774 | 154.9 | 5.9 |
| jitless | small | react-hybrid (traced templates + guards) | 14,995 | 9.96x | 0.067 | 0.047 | 0.064 | 0.497 | 17.6 | 5.9 |
| jitless | small | handwritten (hand-specialized string concatenation) | 20,756 | 19.20x | 0.048 | 0.028 | 0.039 | 0.127 | 13.8 | 5.9 |
| jitless | large | baseline (ReactDOMServer.renderToString) | 25 | 1.00x | 40.331 | 40.495 | 56.223 | 69.366 | 7,187 | 284.1 |
| jitless | large | react-hybrid (traced templates + guards) | 380 | 13.95x | 2.628 | 1.954 | 4.825 | 9.898 | 783.6 | 283.7 |
| jitless | large | handwritten (hand-specialized string concatenation) | 568 | 17.02x | 1.760 | 1.263 | 3.224 | 7.438 | 650.1 | 283.7 |

## Cold start (fresh process, median; small page)

`load` = require impl module (incl. React if it needs it); `first HTML` = load + prepare + first render.

| engine | impl | node boot ms | load ms | prepare ms | 1st render ms | 2nd render ms | first HTML ms |
|---|---|---:|---:|---:|---:|---:|---:|
| jit | baseline (ReactDOMServer.renderToString) | 46.7 | 16.60 | 0.76 | 9.20 | 0.95 | 29.15 |
| jit | react-hybrid (traced templates + guards) | 52.5 | 18.82 | 20.46 | 5.29 | 0.36 | 42.19 |
| jit | handwritten (hand-specialized string concatenation) | 39.0 | 1.04 | 0.10 | 0.86 | 1.99 | 2.97 |
| jitless | baseline (ReactDOMServer.renderToString) | 47.9 | 9.99 | 0.73 | 7.27 | 1.04 | 17.99 |
| jitless | react-hybrid (traced templates + guards) | 66.3 | 25.21 | 30.95 | 2.88 | 0.32 | 58.58 |
| jitless | handwritten (hand-specialized string concatenation) | 46.7 | 0.83 | 0.10 | 0.81 | 0.11 | 1.76 |
