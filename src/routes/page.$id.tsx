import { createFileRoute } from "@tanstack/react-router";

// Stands in for a real page that does CPU work while rendering (looking up and
// transforming bundled data, rendering a large list, etc.). No network or disk I/O,
// so the only way to prerender faster is to use more CPU cores.
function expensiveData(seed: number) {
  let x = seed + 1;
  const rows: number[] = [];
  for (let i = 0; i < 500_000; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    if (i % 2_500 === 0) rows.push(x);
  }
  return rows;
}

export const Route = createFileRoute("/page/$id")({
  loader: ({ params }) => ({ id: params.id, rows: expensiveData(Number(params.id)) }),
  component: Page,
});

function Page() {
  const { id, rows } = Route.useLoaderData();
  return (
    <main>
      <h1>Page {id}</h1>
      <ul>
        {rows.map((row, i) => (
          <li key={i}>{row}</li>
        ))}
      </ul>
    </main>
  );
}
