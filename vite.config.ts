import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

const PAGE_COUNT = Number(process.env.PAGE_COUNT ?? 1000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 1);

export default defineConfig({
  plugins: [
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
  ],
});
