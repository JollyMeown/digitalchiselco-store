// Paced Pinterest RSS auto-publish feed. Served at /pinterest-rss.xml.
//
// Connect this URL in Pinterest (Business hub -> Bulk create / "Connect your RSS
// feed to publish Pins automatically") and assign it a board. Pinterest polls the
// feed (roughly daily) and auto-creates a standard Pin -> product page for every
// NEW <item> it sees, deduping by <guid>. No API token, no script, no cost.
//
// Why "paced": dumping all 1,235 products at once would spam the account. Instead
// every active product gets a deterministic release slot (PER_DAY products/day,
// starting START_DATE, ordered by id for category variety). The feed only exposes
// products whose slot has arrived within the last WINDOW_DAYS, so Pinterest sees a
// small rolling batch of "fresh" items each poll and the whole catalog rolls out
// over ~total/PER_DAY days. Already-published pins never re-publish (guid dedupe),
// so the exact poll cadence doesn't matter as long as Pinterest fetches >= daily.
//
// To change cadence: edit PER_DAY (and redeploy). To split across multiple boards,
// connect several feeds with ?group=<name> once group filtering is added.

import { supabase } from '../lib/supabase';

export const prerender = false;

const SITE = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com';

// --- Pacing knobs ---------------------------------------------------------
const PER_DAY = 12;                          // products released per day
const WINDOW_DAYS = 2;                        // how long a released item stays in the feed
const START_DATE = Date.UTC(2026, 5, 28);     // rollout start (month is 0-based: 5 = June)
const DAY_MS = 86_400_000;
const MAX_ITEMS = PER_DAY * WINDOW_DAYS + PER_DAY; // safety cap on emitted items
// -------------------------------------------------------------------------

function xmlEscape(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function cdata(v: unknown): string {
  return `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]&gt;')}]]>`;
}
function clean(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

const FALLBACK = (t: string) =>
  `${t} is a high-detail 3D bas-relief STL for CNC routers, laser engravers and 3D printers. Instant download, commercial use included. Tested in Aspire, VCarve Pro, Carveco and Fusion 360.`;

export async function GET() {
  const now = Date.now();
  const daysSinceStart = Math.floor((now - START_DATE) / DAY_MS); // 0 on the start day, negative before

  // Empty (but valid) feed before the rollout starts.
  let items: any[] = [];
  if (daysSinceStart >= 0) {
    const releasedCount = (daysSinceStart + 1) * PER_DAY; // products whose slot has arrived
    const fetchTo = releasedCount - 1;
    const fetchFrom = Math.max(0, releasedCount - WINDOW_DAYS * PER_DAY); // rolling window start
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, title, slug, image_url, seo_title, seo_description, description, seo_keywords')
        .eq('active', true)
        .not('image_url', 'is', null)
        .order('id')
        .range(fetchFrom, fetchTo);
      if (error) console.error('pinterest-rss query failed:', error);
      const batch = data || [];
      items = batch.map((p: any, i: number) => {
        const absIndex = fetchFrom + i;
        const releaseDay = Math.floor(absIndex / PER_DAY);
        const pubDate = new Date(START_DATE + releaseDay * DAY_MS);
        return { ...p, _pubDate: pubDate };
      });
      // Newest-released first, capped.
      items.reverse();
      if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);
    } catch (e) {
      console.error('pinterest-rss failed:', e);
    }
  }

  const itemXml = items.map((p) => {
    const rawTitle = clean(p.seo_title || (p.title || '').split('|')[0]).slice(0, 100);
    const url = `${SITE}/product/${p.slug}`;
    const img = clean(p.image_url);
    // Description: SEO copy + a couple of long-tail keyword phrases + free-pack CTA.
    let kws: string[] = [];
    if (Array.isArray(p.seo_keywords)) kws = p.seo_keywords.map((k: any) => clean(k)).filter(Boolean);
    const base = clean(p.seo_description || (p.description || '').slice(0, 360) || FALLBACK(rawTitle));
    const kwLine = kws.length ? ` Great for ${kws.slice(0, 4).join(', ')}.` : '';
    const cta = ' Instant download with commercial use. Grab 5 free STL files at digitalchiselco.com/free.';
    const desc = (base + kwLine + cta).slice(0, 500);
    const descHtml = `<img src="${xmlEscape(img)}" alt="${xmlEscape(rawTitle)}" /><p>${xmlEscape(desc)}</p>`;
    return `    <item>
      <title>${xmlEscape(rawTitle)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <pubDate>${p._pubDate.toUTCString()}</pubDate>
      <description>${cdata(descHtml)}</description>
      <content:encoded>${cdata(descHtml)}</content:encoded>
      <enclosure url="${xmlEscape(img)}" type="image/jpeg" length="0" />
      <media:content url="${xmlEscape(img)}" medium="image" type="image/jpeg" />
      <media:thumbnail url="${xmlEscape(img)}" />
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>DigitalChiselCo — New STL Releases</title>
    <link>${xmlEscape(SITE)}</link>
    <description>Fresh bas-relief STL files for CNC routers, laser engravers and 3D printers, released daily.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>
${itemXml}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      // Short cache so the rolling window advances promptly each day.
      'cache-control': 'public, max-age=1800',
    },
  });
}
