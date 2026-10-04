import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { prerenderWorkers } from "./plugins/prerender-workers/index.js";

const PAGE_COUNT = Number(process.env.PAGE_COUNT ?? 1000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 1);
// WORKERS=off → official single-thread prerender; WORKERS=<n> → n threads; unset → one per core.
const WORKERS = process.env.WORKERS;
const workers = WORKERS === "off" ? null : prerenderWorkers(WORKERS ? { workers: Number(WORKERS) } : {});
const workersFirst = process.env.WORKERS_ORDER === "before";

export default defineConfig({
  plugins: [
    workersFirst && workers,
    tanstackStart({
      pages: Array.from({ length: PAGE_COUNT }, (_, i) => ({ path: `/page/${i}` })),
      prerender: {
        enabled: true,
        concurrency: CONCURRENCY,
        crawlLinks: false,
        autoStaticPathsDiscovery: false,
        failOnError: true,
      },
    }),
    viteReact(),
    !workersFirst && workers,
  ],
});
