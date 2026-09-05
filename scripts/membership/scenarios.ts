// Membership engine scenario tests, run against the REAL engine and the live
// database with sending switched off (no RESEND_API_KEY = every send is a
// recorded no-op). Uses throwaway members at @example.test and removes them
// at the end. Time is simulated by passing `today` into the engine.
//
//   node --env-file=.env --import tsx scripts/membership/scenarios.ts
export {};                                             // module: top-level await
process.env.RESEND_API_KEY = '';                       // never send during tests
process.env.TELEGRAM_BOT_TOKEN = '';

const { supabaseAdmin } = await import('../../src/lib/supabase');
const S = await import('../../src/lib/subscriptions');
const db = supabaseAdmin();
const T = (n: string) => `scenario-${n}@example.test`;
const PLAN3 = { slug: '3-month', name: '3-Month CNC STL Membership', months: 3, files_per_month: 8, price_usd: 20 };
const PLAN12 = { slug: '12-month-premium', name: '12-Month Premium CNC STL Membership', months: 12, files_per_month: 8, price_usd: 69.99 };
const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? '✓' : '✗'} ${name}${note ? '  · ' + note : ''}`); };
const sub = async (id: string) => (await db.from('member_subscriptions').select('*').eq('id', id).single()).data as any;
const logs = async (id: string) => ((await db.from('subscription_email_logs').select('email_type, drop_month, status').eq('subscription_id', id).order('sent_at')).data || []) as any[];
const types = async (id: string) => (await logs(id)).map((l) => l.email_type + ':' + l.drop_month);
async function run(id: string, today: string) { const ctx = await S.makeRunContext(today); await S.processSubscription(db, await sub(id), ctx); return ctx.stats; }
async function cleanup() {
  const { data } = await db.from('member_subscriptions').select('id').like('email', 'scenario-%@example.test');
  for (const r of data || []) await db.from('member_subscriptions').delete().eq('id', r.id);
}
await cleanup();
const today = S.todayYMD();

try {
  // S1 new purchase today, this month's pack exists
  const s1 = await S.createSubscriptionForPurchase({ email: T('s1'), customerName: 'S One', plan: PLAN3, paddleTransactionId: 'txn_s1:3-month' });
  let a = await sub(s1.subscriptionId!);
  check('S1 new purchase: term created, first pack sent, next drop next month',
    s1.created && a.drops_sent === 1 && a.next_drop_date === S.addMonths(today, 1) && a.end_date === S.addMonths(today, 3) && (await types(a.id)).includes('first_pack:' + S.toYM(today)),
    `drops ${a.drops_sent}, next ${a.next_drop_date}, end ${a.end_date}`);

  // S2 new member whose start month has NO pack (May 2026; June/July were added 2026-09-06): welcome now, pack later
  // (6-month plan so the term is still running today; a 3-month one from May would already have expired)
  const s2 = await S.createSubscriptionForPurchase({ email: T('s2'), plan: { slug: '6-month', name: '6-Month CNC STL Membership', months: 6, files_per_month: 8, price_usd: 39.99 }, startDate: '2026-05-06', source: 'etsy' });
  a = await sub(s2.subscriptionId!);
  const t2 = await types(a.id);
  check('S2 missing month: welcome sent, nothing else, member held (not skipped)', a.drops_sent === 0 && t2.length === 1 && t2[0] === 'welcome:2026-05', t2.join(', '));

  // S3 backdated Etsy add (start 6 Aug): catch-up sends August AND September in one go
  const s3 = await S.createSubscriptionForPurchase({ email: T('s3'), plan: PLAN3, startDate: '2026-08-01', source: 'etsy' });
  a = await sub(s3.subscriptionId!);
  const t3 = await types(a.id);
  check('S3 backdated add: both past months sent at once, next drop October', a.drops_sent === 2 && a.next_drop_date === '2026-10-01' && t3.join(',') === 'first_pack:2026-08,monthly_drop:2026-09', t3.join(', '));
  // S3b import from the old system: started 1 August, already received 2 packs there: nothing re-sent, next pack October
  const s3b = await S.createSubscriptionForPurchase({ email: T('s3b'), plan: PLAN3, startDate: '2026-08-01', source: 'import', dropsAlreadySent: 2 });
  a = await sub(s3b.subscriptionId!);
  {
    const l3b = await logs(a.id);
    const imported = l3b.filter((l) => l.email_type === 'imported').map((l) => l.drop_month).sort().join(',');
    const emailed = l3b.filter((l) => l.email_type !== 'imported').length;
    check('S3b imported member with 2 packs already received: nothing re-sent, both months pinned, next pack October', a.drops_sent === 2 && a.next_drop_date === '2026-10-01' && emailed === 0 && imported === '2026-08,2026-09', `drops ${a.drops_sent}, next ${a.next_drop_date}, emailed ${emailed}, pinned ${imported}`);
  }

  // S4 month arrives: drop sent once, second run same day is a no-op
  await run(s1.subscriptionId!, '2026-10-06');
  const before = (await logs(s1.subscriptionId!)).length;
  await run(s1.subscriptionId!, '2026-10-06');
  a = await sub(s1.subscriptionId!);
  check('S4 monthly drop when the month arrives, idempotent on a second run', a.drops_sent === 2 && (await logs(a.id)).length === before && before === 2, `drops ${a.drops_sent}, logs ${before}`);

  // S5 reminders at 10 and 3 days, each once, tolerant of a late run
  await run(s1.subscriptionId!, '2026-11-26');   // 10 days before 2026-12-06
  await run(s1.subscriptionId!, '2026-12-03');   // 3 days
  await run(s1.subscriptionId!, '2026-12-04');   // 2 days: no second "3-day" reminder
  const t5 = await types(s1.subscriptionId!);
  check('S5 reminders: one at 10 days, one at 3 days, none repeated', t5.filter((x) => x.startsWith('pre_expiry_10')).length === 1 && t5.filter((x) => x.startsWith('pre_expiry_3')).length === 1, t5.filter((x) => x.startsWith('pre_')).join(', '));
  // November drop also went out on the 26 Nov run? No: its due date is 6 Nov, so it went with the first November-dated run
  check('S5b November pack delivered on the way (catch-up)', t5.includes('monthly_drop:2026-11'), t5.filter((x) => x.startsWith('monthly')).join(', '));

  // S6 expiry day: last pack (December) then the end-of-term email, status expired
  await run(s1.subscriptionId!, '2026-12-06');
  a = await sub(s1.subscriptionId!);
  const t6 = await types(a.id);
  check('S6 expiry: December pack (3 of 3) sent, expiry email sent, status expired', a.status === 'expired' && a.drops_sent === 3 && t6.includes('expiry:2026-12'), `status ${a.status}, drops ${a.drops_sent}`);

  // S7 win-back 14 days after expiry, once
  await run(s1.subscriptionId!, '2026-12-20');
  await run(s1.subscriptionId!, '2026-12-21');
  const t7 = await types(s1.subscriptionId!);
  check('S7 win-back at +14 days, not repeated the next day', t7.filter((x) => x.startsWith('winback')).length === 1, t7.filter((x) => x.startsWith('winback')).join(', '));

  // S8 expired member buys again: new term from today, flagged renewal, first pack now
  const s8 = await S.createSubscriptionForPurchase({ email: T('s1'), plan: PLAN3, paddleTransactionId: 'txn_s8:3-month' });
  a = await sub(s8.subscriptionId!);
  check('S8 expired member re-buys: fresh term starts today, marked renewal, first pack sent', a.is_renewal === true && a.start_date === today && a.drops_sent === 1 && !s8.chainedFrom && !s8.upgradedFrom, `start ${a.start_date}, renewal ${a.is_renewal}`);

  // S9 renewal while active, same plan: chains after the current term; old term's reminders stop
  const s9 = await S.createSubscriptionForPurchase({ email: T('s3'), plan: PLAN3, paddleTransactionId: 'txn_s9:3-month' });
  const old3 = await sub(s3.subscriptionId!); a = await sub(s9.subscriptionId!);
  check('S9 renew while active: new term starts the day the old one ends, nothing sent yet, terms linked', s9.chainedFrom === old3.id && a.start_date === old3.end_date && a.drops_sent === 0 && old3.renewed_to === a.id, `old end ${old3.end_date}, new start ${a.start_date}`);
  await run(old3.id, '2026-10-27');             // 10 days before old end 2026-11-06
  const t9 = await types(old3.id);
  check('S9b no renewal reminder for a term that is already renewed', !t9.some((x) => x.startsWith('pre_expiry')), t9.join(', '));
  await run(a.id, '2026-11-06');                 // the chained term's first month arrives
  a = await sub(a.id);
  check('S9c chained term delivers its first pack when its start date arrives', a.drops_sent === 1 && (await types(a.id)).includes('first_pack:2026-11'), `drops ${a.drops_sent}`);

  // S10 upgrade: one month into a 3-month term, buys 12-month Premium
  const s10a = await S.createSubscriptionForPurchase({ email: T('s10'), plan: PLAN3, paddleTransactionId: 'txn_s10a:3-month' });
  const s10b = await S.createSubscriptionForPurchase({ email: T('s10'), plan: PLAN12, paddleTransactionId: 'txn_s10b:12-month-premium' });
  const oldA = await sub(s10a.subscriptionId!); a = await sub(s10b.subscriptionId!);
  check('S10 upgrade to Premium mid-term: starts today, Premium tier, 2 unused months carried over (14 packs), old term closed as upgraded, first pack sent',
    s10b.upgradedFrom === oldA.id && a.tier === 'premium' && a.total_drops === 14 && a.start_date === today && a.end_date === S.addMonths(today, 14) && oldA.status === 'upgraded' && oldA.renewed_to === a.id && a.drops_sent === 1,
    `tier ${a.tier}, drops ${a.drops_sent}/${a.total_drops}, end ${a.end_date}, old ${oldA.status}`);
  await run(oldA.id, '2026-10-06');
  check('S10b the upgraded-away term sends nothing more', (await logs(oldA.id)).length === 1, `logs ${(await logs(oldA.id)).length}`);

  // S11 duplicate webhook delivery
  const dup = await S.createSubscriptionForPurchase({ email: T('s11'), plan: PLAN3, paddleTransactionId: 'txn_s11:3-month' });
  const dup2 = await S.createSubscriptionForPurchase({ email: T('s11'), plan: PLAN3, paddleTransactionId: 'txn_s11:3-month' });
  check('S11 duplicate webhook: second delivery ignored', dup.created && !dup2.created && dup2.reason === 'duplicate transaction', dup2.reason || '');

  // S12 paused member: month arrives, nothing sent; resume: catch-up
  await db.from('member_subscriptions').update({ status: 'paused' }).eq('id', dup.subscriptionId!);
  await run(dup.subscriptionId!, '2026-10-06');
  const t12 = (await logs(dup.subscriptionId!)).length;
  await db.from('member_subscriptions').update({ status: 'active' }).eq('id', dup.subscriptionId!);
  await run(dup.subscriptionId!, '2026-10-06');
  a = await sub(dup.subscriptionId!);
  check('S12 paused: nothing sent while paused, catch-up on resume', t12 === 1 && a.drops_sent === 2, `paused logs ${t12}, after resume drops ${a.drops_sent}`);

  // S13 cancelled: nothing ever
  await db.from('member_subscriptions').update({ status: 'cancelled', next_drop_date: null }).eq('id', dup.subscriptionId!);
  await run(dup.subscriptionId!, '2026-11-06');
  check('S13 cancelled: no further emails', (await logs(dup.subscriptionId!)).length === 2);

  // S14 member re-send limits
  const r1 = await S.resendPack(s8.subscriptionId!, S.toYM(today), { requireEmail: T('s1') });
  const r2 = await S.resendPack(s8.subscriptionId!, S.toYM(today), { requireEmail: T('s1') });
  const r3 = await S.resendPack(s8.subscriptionId!, S.toYM(today), { requireEmail: T('s3') });
  check('S14 "email me this pack": works once, refused within 12 h, refused for another member', r1.ok && !r2.ok && !r3.ok, `${r2.error} / ${r3.error}`);

  // S15 tracked links
  const ym = S.toYM(today);
  const good = await S.resolvePackClick({ s: s8.subscriptionId!, m: ym, k: 'standard', v: 'portal', t: S.packLinkSig(s8.subscriptionId!, ym, 'standard') });
  const foreign = await S.resolvePackClick({ s: s8.subscriptionId!, m: '2027-02', k: 'standard', v: 'portal', t: S.packLinkSig(s8.subscriptionId!, '2027-02', 'standard') });
  const bonusStd = await S.resolvePackClick({ s: s8.subscriptionId!, m: ym, k: 'bonus', v: 'portal', t: S.packLinkSig(s8.subscriptionId!, ym, 'bonus') });
  const tampered = await S.resolvePackClick({ s: s8.subscriptionId!, m: ym, k: 'standard', v: 'portal', t: 'nope' });
  const dl = (await db.from('pack_downloads').select('id').eq('subscription_id', s8.subscriptionId!)).data || [];
  check('S15 tracked link: valid opens + logs; month outside term, bonus for standard tier, tampered signature all refused', 'url' in good && 'error' in foreign && 'error' in bonusStd && 'error' in tampered && dl.length === 1, `${'error' in foreign ? foreign.error : ''} / ${'error' in bonusStd ? bonusStd.error : ''}`);

  // S16 test months never reach a real member
  const s16 = await S.createSubscriptionForPurchase({ email: T('s16'), plan: PLAN3, startDate: '2099-01-01' });
  await run(s16.subscriptionId!, '2099-01-01');
  check('S16 a 2099 month is never sent to a non-owner address', (await logs(s16.subscriptionId!)).length === 0);
} catch (e: any) {
  check('HARNESS ERROR', false, String(e?.stack || e).slice(0, 400));
} finally {
  await cleanup();
}
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length} of ${results.length} scenarios passed${fails.length ? '; FAILED: ' + fails.map((f) => f.name).join(' | ') : ''}`);
process.exit(fails.length ? 1 : 0);
