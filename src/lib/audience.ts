// Who is worth emailing, measured rather than assumed (2026-09-20).
//
// The list tripled with the Etsy import, so "send to everyone" now means
// sending to ~800 people who have never opened anything. These helpers split
// the list so extra volume goes to people who actually read us, and the rest
// get a re-engagement pair and then quiet.
const PAGE = 1000;

async function fetchAllRows(db: any, table: string, select: string, apply: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(db.from(table).select(select)).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Emails that opened or clicked anything in the last `days` days. */
export async function engagedEmails(db: any, days = 90): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const rows = await fetchAllRows(db, 'email_events', 'email', (q: any) =>
    q.in('event', ['opened', 'clicked']).gte('created_at', since));
  return new Set(rows.map((r: any) => String(r.email || '').toLowerCase()).filter(Boolean));
}

export type Dormant = { email: string; stage: number; sent_at: string | null };

/**
 * Subscribers who have been given a fair chance and never opened: on the list
 * at least `minAgeDays`, sent at least `minSends` emails in the last 60 days,
 * no open or click in 90 days, still subscribed and not already sunset.
 */
export async function dormantSubscribers(db: any, opts: { minSends?: number; minAgeDays?: number } = {}): Promise<Dormant[]> {
  const minSends = opts.minSends ?? 3;
  const minAgeDays = opts.minAgeDays ?? 21;
  const engaged = await engagedEmails(db, 90);
  const sends = await fetchAllRows(db, 'email_send_log', 'recipient', (q: any) =>
    q.gte('sent_at', new Date(Date.now() - 60 * 86400e3).toISOString()).eq('status', 'sent'));
  const count = new Map<string, number>();
  for (const r of sends) {
    const e = String(r.recipient || '').toLowerCase();
    if (e) count.set(e, (count.get(e) || 0) + 1);
  }
  const subs = await fetchAllRows(db, 'subscribers', 'email, created_at, reengage_stage, reengage_sent_at', (q: any) =>
    q.is('unsubscribed_at', null).is('suppressed_at', null).is('sunset_at', null)
      .lte('created_at', new Date(Date.now() - minAgeDays * 86400e3).toISOString()));
  const out: Dormant[] = [];
  for (const s of subs) {
    const email = String(s.email || '').toLowerCase();
    if (!email || engaged.has(email)) continue;
    if ((count.get(email) || 0) < minSends) continue;
    out.push({ email, stage: Number(s.reengage_stage) || 0, sent_at: s.reengage_sent_at || null });
  }
  return out;
}
