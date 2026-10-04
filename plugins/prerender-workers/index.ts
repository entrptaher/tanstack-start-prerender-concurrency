import http from "node:http";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Connect, Logger, Plugin, PreviewServerHook } from "vite";

// Spreads TanStack Start's prerender requests over N Vite preview servers running in
// worker threads, so CPU-bound SSR uses more than one core. Rendering is still done by
// Start's own preview server + SSR middleware; only the thread it runs on changes.
//
// ponytail: relies on Start's internal plugin name `tanstack-start-core:preview-server`
// and its `configurePreviewServer` post-hook shape (returns a fn that registers the SSR
// middleware). If Start renames or reshapes it, this warns and falls back to the official
// single-thread flow. Upgrade path: an official `prerender.workers` option upstream
// (TanStack/router#8483, on top of PR #8430), then delete this folder.
const START_PREVIEW_PLUGIN = "tanstack-start-core:preview-server";
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade"]);
const wrapped = new WeakSet<Plugin>();

type Slot = { worker: Worker; inflight: number; ready: Promise<URL> };

export function prerenderWorkers(options: { workers?: number } = {}): Plugin {
  const workers = options.workers ?? availableParallelism();
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`prerenderWorkers: "workers" must be an integer >= 1, got ${workers}`);
  }

  // Inside one of our own worker previews: render in this thread, exactly like Start does.
  if (process.env.PRERENDER_WORKERS_CHILD === "1") return { name: "prerender-workers" };

  const pool: Slot[] = [];
  let agent: http.Agent | undefined;
  let failure: unknown;
  let logger: Logger | undefined;
  let spawned = 0;
  let requests = 0;

  function spawn(configFile: string | undefined): Slot {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: { configFile },
      env: { ...process.env, PRERENDER_WORKERS_CHILD: "1" },
    });
    const ready = new Promise<URL>((resolve, reject) => {
      worker.once("message", (url: string) => resolve(new URL(url)));
      // A crashed worker would have crashed the whole build in single-thread mode: fail fast.
      worker.on("error", (error) => {
        failure ??= error;
        reject(error);
      });
      worker.once("exit", (code) => reject(new Error(`[prerender-workers] worker exited with code ${code} before it was ready`)));
    });
    const slot: Slot = { worker, inflight: 0, ready };
    worker.once("exit", () => pool.splice(pool.indexOf(slot), 1));
    pool.push(slot);
    spawned++;
    return slot;
  }

  function pick(configFile: string | undefined): Slot {
    const idle = pool.find((slot) => slot.inflight === 0);
    if (idle) return idle;
    if (pool.length < workers) return spawn(configFile);
    return pool.reduce((a, b) => (b.inflight < a.inflight ? b : a));
  }

  // Sits in Start's SSR slot and proxies the request, untouched, to a worker's preview server.
  function forwardToPool(configFile: string | undefined): Connect.NextHandleFunction {
    agent ??= new http.Agent({ keepAlive: true });
    return async (req, res, next) => {
      if (failure) return next(failure);
      const slot = pick(configFile);
      slot.inflight++;
      let url: URL;
      try {
        url = await slot.ready;
      } catch (error) {
        slot.inflight--;
        failure ??= error;
        return next(error);
      }
      requests++;

      const headers = { ...req.headers };
      for (const name of HOP_BY_HOP) delete headers[name];
      // node:http, not fetch: keeps the original Host header, so absolute URLs and redirect
      // Locations rendered by the worker carry the origin Start's prerenderer validates.
      const upstream = http.request(
        { hostname: url.hostname, port: url.port, method: req.method, path: req.originalUrl ?? req.url, headers, agent },
        (up) => {
          for (const [name, value] of Object.entries(up.headers)) {
            if (value !== undefined && !HOP_BY_HOP.has(name)) res.setHeader(name, value);
          }
          // writeHead before streaming, same Vite preview compression workaround as Start's middleware.
          res.writeHead(up.statusCode!, up.statusMessage);
          up.on("error", (error) => res.destroy(error));
          up.pipe(res);
        },
      );
      // ClientRequest 'close' fires exactly once, after the response ends or on error. (Vite's
      // compression middleware patches res.on and defers listeners, so res 'close' is not reliable here.)
      upstream.on("close", () => slot.inflight--);
      upstream.on("error", next);
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    };
  }

  return {
    name: "prerender-workers",
    // Looked up here, not at construction: by configResolved Vite has every plugin, so
    // this works whether it is listed before or after tanstackStart().
    configResolved(config) {
      logger = config.logger;
      const start = config.plugins.find((plugin) => plugin.name === START_PREVIEW_PLUGIN);
      const hook = start?.configurePreviewServer;
      if (!start || !hook) {
        config.logger.warnOnce(`[prerender-workers] "${START_PREVIEW_PLUGIN}" not found; prerender workers are disabled.`);
        return;
      }
      if (wrapped.has(start)) return;
      wrapped.add(start);

      const original = typeof hook === "function" ? hook : hook.handler;
      const handler: PreviewServerHook = async function (server) {
        const post = await original.call(this, server);
        // Plain `vite preview` (not prerendering) is left exactly as Start set it up.
        if (process.env.TSS_PRERENDERING !== "true") return post;
        return () => {
          server.middlewares.use(forwardToPool(server.config.configFile));
          // Still let Start register its SSR middleware; the forwarder answers first.
          post?.();
        };
      };
      start.configurePreviewServer = typeof hook === "function" ? handler : { ...hook, handler };
    },
    async closePreviewServer() {
      agent?.destroy();
      await Promise.all(
        pool.map((slot) => {
          const exited = new Promise((resolve) => slot.worker.once("exit", resolve));
          slot.worker.postMessage("close");
          return exited;
        }),
      );
      if (spawned) logger?.info(`[prerender-workers] ${requests} requests rendered by ${spawned} worker thread(s)`);
    },
  };
}
