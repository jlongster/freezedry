# react-bench perf (2026-11-05T17:13:17.398Z)

node v26.7.0, AMD EPYC 9554P 64-Core Processor x4, linux 6.12.115; 1.5s warm-up + 3s timed per cell, 5 interleaved round(s). Load average before/after: 12.4 7.5 3.8 / 4.6 7.6 5.0.

## Throughput (warm, cycling through corpus)

renders/s and speedup are medians over rounds (speedup = median of per-round impl/baseline ratios); latency columns come from the median round.

| engine | page | impl | renders/s | speedup | mean ms | p50 ms | p90 ms | p99 ms | alloc KB/render | avg HTML KB |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| jit | small | baseline (ReactDOMServer.renderToString) | 3,750 | 1.00x | 0.267 | 0.071 | 0.102 | 6.873 | 135.8 | 5.9 |
| jit | small | react-hybrid (traced templates + guards) | 21,813 | 5.82x | 0.046 | 0.014 | 0.021 | 0.198 | 16.1 | 5.9 |
| jit | small | handwritten (hand-specialized string concatenation) | 30,551 | 9.08x | 0.033 | 0.009 | 0.013 | 0.026 | 12.8 | 5.9 |
| jit | large | baseline (ReactDOMServer.renderToString) | 160 | 1.00x | 6.267 | 6.881 | 10.549 | 16.605 | 6,408 | 283.7 |
| jit | large | react-hybrid (traced templates + guards) | 690 | 4.87x | 1.449 | 0.693 | 4.711 | 8.829 | 723.7 | 283.7 |
| jit | large | handwritten (hand-specialized string concatenation) | 1,047 | 8.03x | 0.955 | 0.470 | 2.017 | 8.515 | 606.5 | 283.7 |
| jitless | small | baseline (ReactDOMServer.renderToString) | 1,002 | 1.00x | 0.998 | 0.525 | 2.461 | 8.531 | 155.1 | 5.9 |
| jitless | small | react-hybrid (traced templates + guards) | 10,402 | 11.92x | 0.096 | 0.049 | 0.069 | 1.284 | 17.6 | 5.9 |
| jitless | small | handwritten (hand-specialized string concatenation) | 20,195 | 21.43x | 0.050 | 0.029 | 0.041 | 0.167 | 13.8 | 5.9 |
| jitless | large | baseline (ReactDOMServer.renderToString) | 43 | 1.00x | 23.163 | 21.751 | 28.820 | 42.540 | 7,176 | 283.9 |
| jitless | large | react-hybrid (traced templates + guards) | 487 | 11.28x | 2.053 | 1.868 | 2.405 | 6.010 | 783.9 | 283.7 |
| jitless | large | handwritten (hand-specialized string concatenation) | 788 | 18.26x | 1.269 | 1.189 | 1.348 | 4.739 | 649.9 | 283.7 |

## Cold start (fresh process, median; small page)

`load` = require impl module (incl. React if it needs it); `first HTML` = load + prepare + first render.

| engine | impl | node boot ms | load ms | prepare ms | 1st render ms | 2nd render ms | first HTML ms |
|---|---|---:|---:|---:|---:|---:|---:|
| jit | baseline (ReactDOMServer.renderToString) | 31.0 | 10.49 | 0.70 | 4.80 | 0.91 | 16.16 |
| jit | react-hybrid (traced templates + guards) | 27.4 | 0.92 | 2.71 | 1.16 | 3.90 | 4.88 |
| jit | handwritten (hand-specialized string concatenation) | 25.6 | 0.78 | 0.10 | 0.84 | 3.39 | 1.72 |
| jitless | baseline (ReactDOMServer.renderToString) | 26.5 | 7.60 | 0.72 | 4.83 | 1.03 | 14.86 |
| jitless | react-hybrid (traced templates + guards) | 28.1 | 0.95 | 3.25 | 1.06 | 0.29 | 5.29 |
| jitless | handwritten (hand-specialized string concatenation) | 27.0 | 0.78 | 0.09 | 0.78 | 0.10 | 1.65 |
