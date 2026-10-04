// Runnable check for prerender-workers (no test framework). Run from the repro root:
//   node plugins/prerender-workers/check.mjs
// Builds 24 pages three ways (official single thread, plugin after tanstackStart(), plugin
// before it) and asserts the plugin builds use >= 2 worker threads and write the same files.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "dist/client";
const LOG_LINE = /\[prerender-workers\] (\d+) requests rendered by (\d+) worker thread/;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function build(name, extraEnv) {
  const env = { ...process.env, PAGE_COUNT: "24", CONCURRENCY: "4", ...extraEnv };
  delete env.PRERENDER_WORKERS_CHILD;
  if (!("WORKERS" in extraEnv)) delete env.WORKERS;
  if (!("WORKERS_ORDER" in extraEnv)) delete env.WORKERS_ORDER;

  const started = performance.now();
  const result = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { env, encoding: "utf8" });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const log = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) fail(`${name} build exited with ${result.status ?? result.signal}\n${log.slice(-3000)}`);

  const files = new Map();
  for (const entry of readdirSync(OUT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    // Mask epoch-ms timestamps (the dehydrated `u:` updatedAt differs per render).
    files.set(relative(OUT, path), readFileSync(path, "latin1").replace(/\b1\d{12}\b/g, "<ts>"));
  }
  return { name, seconds, log, files, match: log.match(LOG_LINE) };
}

const off = build("off", { WORKERS: "off" });
if (off.log.includes("[prerender-workers]")) fail("WORKERS=off build logged a [prerender-workers] line");
const pages = [...off.files.keys()].filter((file) => file.endsWith("index.html")).length;
if (pages < 24) fail(`WORKERS=off build wrote only ${pages} index.html files, expected 24`);

const results = [off];
for (const [name, env] of [["after", {}], ["before", { WORKERS_ORDER: "before" }]]) {
  const run = build(name, env);
  if (!run.match) fail(`${name} build did not log a [prerender-workers] line`);
  if (Number(run.match[2]) < 2) fail(`${name} build used ${run.match[2]} worker thread(s), expected >= 2`);

  const expected = [...off.files.keys()].sort().join("\n");
  const actual = [...run.files.keys()].sort().join("\n");
  if (actual !== expected) fail(`${name} build wrote a different file list than WORKERS=off`);
  for (const [file, content] of off.files) {
    if (run.files.get(file) !== content) fail(`${name} build: ${file} differs from WORKERS=off`);
  }
  results.push(run);
}

for (const run of results) {
  const workers = run.match ? `${run.match[1]} requests, ${run.match[2]} worker threads` : "no workers";
  console.log(`${run.name.padEnd(6)} ${run.seconds}s  ${run.files.size} files  ${workers}`);
}
console.log(`OK: ${pages} pages; plugin builds (after + before tanstackStart) match WORKERS=off byte-for-byte (timestamps masked).`);
