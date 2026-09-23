# TanStack Start: `prerender.concurrency` doesn't speed up CPU-bound pages

Minimal reproduction. Every page is rendered in a single preview server process, so
raising `prerender.concurrency` only overlaps I/O. When rendering itself is CPU work,
the total prerender time stays the same regardless of `concurrency` or core count.

- One route, `/page/$id`, whose loader does ~15 ms of synchronous CPU work (a stand-in
  for looking up and transforming bundled data). No network or disk I/O.
- 1,000 pages prerendered (`PAGE_COUNT` env var to change).
- Plain TanStack Start with the default Node preview server; no deployment adapter.

## Run

```sh
npm install
npm run bench
```

`bench.mjs` runs `vite build` with `concurrency` set to 1, 4 and the machine's core count,
and prints the wall-clock time of each build.

## Result (Apple M-series, 10 logical cores, Node 24)

| concurrency | build time |
| ----------- | ---------- |
| 1           | 21.3s      |
| 4           | 20.4s      |
| 10          | 19.6s      |

## Expected

With `concurrency` above 1 on a multi-core machine, prerendering CPU-bound pages should
get faster, e.g. by spreading pages across several preview server processes/workers.
