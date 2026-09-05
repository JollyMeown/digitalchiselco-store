// One-off (safe to re-run): give every pack email sent before migration 107 a
// pack_snapshot of the bundle that was live when it was sent, worked out from
// monthly_files.link_history (the archive written whenever a link changes).
//   node --env-file=.env scripts/membership/backfill_pack_snapshots.mjs [--dry]
const DRY = process.argv.includes('--dry');
const H = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json', prefer: 'return=representation' };
const U = process.env.PUBLIC_SUPABASE_URL + '/rest/v1/';
const g = async (q) => (await fetch(U + q, { headers: H })).json();

const packs = await g('monthly_files?select=month,title,preview_note,standard_drive_link,bonus_drive_link,cover_image_url,items,bonus_items,link_history');
const byMonth = new Map(packs.map((p) => [p.month, p]));
const logs = await g("subscription_email_logs?select=id,subscription_id,email,email_type,drop_month,sent_at&email_type=in.(first_pack,monthly_drop,imported)&status=eq.sent&pack_snapshot=is.null&order=sent_at");
if (!Array.isArray(logs)) { console.error('query failed:', JSON.stringify(logs)); process.exit(1); }
console.log(`${logs.length} pack log(s) without a snapshot`);
let done = 0, skipped = 0;
for (const l of logs) {
  const ym = String(l.drop_month).split('#')[0];
  const p = byMonth.get(ym);
  if (!p) { skipped++; console.log(`  skip ${l.email} ${ym}: no pack row`); continue; }
  const at = l.sent_at || new Date().toISOString();
  // version live at send time = the earliest archived version replaced AFTER the send, else the current row
  const hist = (p.link_history || []).filter((h) => h.replaced_at && h.replaced_at > at).sort((a, b) => a.replaced_at.localeCompare(b.replaced_at));
  const v = hist[0];
  const snap = v
    ? { title: v.title ?? p.title, preview_note: p.preview_note, standard_drive_link: v.standard_drive_link ?? null, bonus_drive_link: v.bonus_drive_link ?? null, cover_image_url: null, items: [], bonus_items: [], captured_at: new Date().toISOString(), backfilled_from: 'link_history' }
    : { title: p.title, preview_note: p.preview_note, standard_drive_link: p.standard_drive_link, bonus_drive_link: p.bonus_drive_link, cover_image_url: p.cover_image_url, items: p.items || [], bonus_items: p.bonus_items || [], captured_at: new Date().toISOString(), backfilled_from: 'current' };
  console.log(`  ${l.email} ${l.email_type} ${ym} sent ${String(at).slice(0, 16)} -> ${v ? 'archived version' : 'current row'} (${(snap.standard_drive_link || '').slice(-12)})`);
  if (DRY) continue;
  const r = await fetch(U + 'subscription_email_logs?id=eq.' + l.id, { method: 'PATCH', headers: H, body: JSON.stringify({ pack_snapshot: snap }) });
  if (r.ok) done++; else console.log('   !! failed', r.status, await r.text());
}
console.log(`${DRY ? 'would write' : 'wrote'} ${DRY ? logs.length - skipped : done}, skipped ${skipped}`);
