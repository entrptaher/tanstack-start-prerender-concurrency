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

## Workaround: `plugins/prerender-workers`

This fork adds a local Vite plugin that does exactly that, without changing TanStack Start.
While Start prerenders, the plugin forwards each page request from Start's preview server
to a pool of worker threads. Each worker runs Start's own unmodified preview server, so
rendering is still done by the official code; only the thread changes. Plain
`vite preview` is left alone.

```ts
import { prerenderWorkers } from "./plugins/prerender-workers/index.js";

plugins: [tanstackStart({ ... }), viteReact(), prerenderWorkers()];
```

- Order doesn't matter: Start's plugin is looked up once Vite has resolved every plugin,
  so it also works when listed before `tanstackStart()`.
- Workers start on demand, up to one per core by default (`prerenderWorkers({ workers: n })`
  to cap it). The number in use is bounded by `prerender.concurrency`, so set that to
  around your core count (Start's default) or higher.
- `npm run bench` now runs with the plugin; `WORKERS=off npm run bench` reproduces the
  original issue. `node plugins/prerender-workers/check.mjs` builds 24 pages with the
  plugin off, after and before `tanstackStart()` and checks the output files match.

Same machine, 1,000 pages, full `vite build`:

| concurrency | official | with plugin |
| ----------- | -------- | ----------- |
| 1           | 20.3s    | 21.3s       |
| 4           | 20.3s    | 6.9s        |
| 10          | 20.3s    | 5.1s        |

Output is byte-identical to the official build apart from the dehydration timestamp.
Not tested with platform plugins such as `@cloudflare/vite-plugin`; those handle requests
before Start's preview slot, so the pool should simply never start there.
