// Builds the same app with different `prerender.concurrency` values and prints the
// wall-clock build time for each. On a multi-core machine the times stay roughly equal.
import { execSync } from "node:child_process";
import { availableParallelism } from "node:os";

const cores = availableParallelism();
const values = [...new Set([1, 4, cores])];
const results = [];

for (const concurrency of values) {
  const started = performance.now();
  execSync("npx vite build", {
    stdio: "ignore",
    env: { ...process.env, CONCURRENCY: String(concurrency) },
  });
  results.push({ concurrency, seconds: ((performance.now() - started) / 1000).toFixed(1) });
  console.log(`concurrency=${concurrency}: ${results.at(-1).seconds}s`);
}

console.log(`\n${cores} logical cores, ${process.env.PAGE_COUNT ?? 1000} pages`);
console.table(results);
