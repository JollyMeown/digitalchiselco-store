// Read every row, not the first thousand.
//
// PostgREST caps a single response at 1000 rows regardless of the limit asked
// for, and it does so SILENTLY: `.limit(20000)` returns 1000 rows with no error
// and no warning. Several admin panels were built with a generous limit and
// have been quietly reading a fraction of the data ever since. Measured on
// 2026-09-12: site_events 2,355 rows, email_send_log 7,812, email_events
// 21,176, subscribers 2,334, gsc_page_daily 1,811 in thirty days. Every number
// derived from those was wrong and looked perfectly plausible.
//
// Use this anywhere a panel needs a whole table rather than a page of it.
//
//   const rows = await pageAll((from, to) =>
//     supabase.from('email_events').select('event, email').gte('created_at', since).range(from, to));
export async function pageAll<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = 100000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data } = await build(from, from + 999);
    out.push(...((data || []) as T[]));
    // a short page is the last page; an empty one ends it too
    if (!data || data.length < 1000) break;
  }
  return out;
}
