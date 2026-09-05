// Read a whole table, not the first 1,000 rows of it.
//
// PostgREST caps every response at the project's max-rows setting (1,000 here)
// and it does so silently: `.limit(50000)` returns 1,000 rows and no error.
// Measured 2026-09-05: email_send_log had 2,797 rows and `.limit(20000)` came
// back with exactly 1,000. Any code that builds a "who already had this" set
// from a capped read will one day mail people twice, and any report built on
// one will quietly undercount. Page through instead.
//
// Usage:
//   const rows = await fetchAll((a, b) => db.from('t').select('x').eq(...).range(a, b));
//
// To keep an existing `{ data }` destructuring untouched:
//   const { data } = await fetchAll(...).then((data) => ({ data }));
export async function fetchAll<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) { console.error('[fetchAll]', error?.message || error); break; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}
