// One Vite preview server (with TanStack Start's own SSR middleware) in this worker thread.
import { parentPort, workerData } from "node:worker_threads";
import { preview } from "vite";

// Same inline config Start's prerenderWithVite passes to vite.preview().
const server = await preview({ configFile: workerData.configFile, preview: { port: 0, open: false } });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("[prerender-workers] worker preview server has no local URL");

parentPort.once("message", async () => {
  await server.close();
  // Exit explicitly so module-level timers in the SSR bundle cannot keep this thread alive
  // (same rationale as TanStack PR #8430).
  process.exit(process.exitCode ?? 0);
});
parentPort.postMessage(url);
