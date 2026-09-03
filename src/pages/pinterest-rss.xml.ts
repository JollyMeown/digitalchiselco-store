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

// --- Pin-sized images -----------------------------------------------------
// Pinterest rejected the feed ("can't find images") because the stored product
// images are 794x596, under its minimum for a publishable Pin. Serve them
// through the Netlify Image CDN at 1200x900 instead: the source ratio (1.332)
// and 4:3 (1.333) are the same, so this upscales with essentially no crop, and
// the image is served from our own domain. Requires the [images] remote_images
// allow-list in netlify.toml.
// Pins now use the purpose-built 2:3 vertical art from /pin/<slug>.jpg
// (branded canvas, full carving, title + CTA) instead of the raw landscape
// photo, which rendered small in Pinterest's vertical feed.
const PIN_W = 1000, PIN_H = 1500;
function pinImage(slug: string): string {
  if (!slug) return '';
  // ?v= busts the 30-day edge cache AND makes Pinterest re-fetch after a
  // template change (v2: text drawn as paths, the v1 art showed tofu boxes)
  return `${SITE}/pin/${encodeURIComponent(slug)}.jpg?v=2`;
}
// Real byte size for <enclosure length>. length="0" declares an EMPTY file,
// which is why strict parsers ignored the enclosure. Sizes are fetched once
// per feed build (the response is cached 30 min) and fall back to an estimate
// if the HEAD request fails, so a slow origin can never break the feed.
const FALLBACK_BYTES = 180_000;
async function imageBytes(url: string): Promise<number> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(url, { method: 'HEAD', signal: ctl.signal });
    clearTimeout(t);
    const n = Number(r.headers.get('content-length'));
    return Number.isFinite(n) && n > 0 ? n : FALLBACK_BYTES;
  } catch { return FALLBACK_BYTES; }
}
function clean(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

const FALLBACK = (t: string) =>
  `${t} is a high-detail 3D bas-relief STL for CNC routers, laser engravers and 3D printers. Instant download, commercial use included. Tested in Aspire, VCarve Pro, Carveco and Fusion 360.`;

export async function GET() {
  const now = Date.now();
  // Cut Local second door in the Pin text: speaks to pinners with no machine.
  let makerCta = false;
  try {
    // growth_settings is RLS-locked to admin, so this needs the service client
    const { supabaseAdmin } = await import('../lib/supabase');
    const { data: gs } = await supabaseAdmin().from('growth_settings').select('marketplace_enabled').eq('id', 1).maybeSingle();
    makerCta = !!gs?.marketplace_enabled;
  } catch {}
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

  // Byte sizes for every Pin image, resolved in parallel before rendering.
  const pinUrls = items.map((p) => pinImage(clean(p.slug)));
  const pinBytes = await Promise.all(pinUrls.map((u) => (u ? imageBytes(u) : Promise.resolve(FALLBACK_BYTES))));

  const itemXml = items.map((p, idx) => {
    const rawTitle = clean(p.seo_title || (p.title || '').split('|')[0]).slice(0, 100);
    const url = `${SITE}/product/${p.slug}`;
    // Tagged link for attribution in the admin Channel panel. <guid> stays the
    // CLEAN url: it is Pinterest's dedupe key, and changing it would make every
    // already-published Pin look new and republish.
    const linkUrl = `${url}?utm_source=pinterest&utm_medium=rss`;
    const img = pinUrls[idx] || clean(p.image_url);
    const bytes = pinBytes[idx];
    // Description: SEO copy + a couple of long-tail keyword phrases + free-pack CTA.
    let kws: string[] = [];
    if (Array.isArray(p.seo_keywords)) kws = p.seo_keywords.map((k: any) => clean(k)).filter(Boolean);
    const base = clean(p.seo_description || (p.description || '').slice(0, 360) || FALLBACK(rawTitle));
    const kwLine = kws.length ? ` Great for ${kws.slice(0, 4).join(', ')}.` : '';
    const cta = (makerCta ? ' No CNC or 3D printer? A vetted local maker can build this for you, free to request a quote.' : '')
      + ' Instant download with commercial use. Grab 5 free STL files at digitalchiselco.com/free.';
    const desc = (base + kwLine + cta).slice(0, 500);
    const descHtml = `<img src="${xmlEscape(img)}" alt="${xmlEscape(rawTitle)}" /><p>${xmlEscape(desc)}</p>`;
    return `    <item>
      <title>${xmlEscape(rawTitle)}</title>
      <link>${xmlEscape(linkUrl)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <pubDate>${p._pubDate.toUTCString()}</pubDate>
      <description>${cdata(descHtml)}</description>
      <content:encoded>${cdata(descHtml)}</content:encoded>
      <enclosure url="${xmlEscape(img)}" type="image/jpeg" length="${bytes}" />
      <media:content url="${xmlEscape(img)}" medium="image" type="image/jpeg" width="${PIN_W}" height="${PIN_H}" fileSize="${bytes}" />
      <media:thumbnail url="${xmlEscape(img)}" width="${PIN_W}" height="${PIN_H}" />
      <image>${xmlEscape(img)}</image>
    </item>`;
  }).join('\n');

  // ── Promotional Pins ────────────────────────────────────────────────
  // The shop's own Pinterest numbers say designed "hook" Pins earn ~22x the
  // impressions per Pin that catalogue product Pins do. These three sell the
  // offers rather than a single design, and each carries its own link.
  // The guid holds the month, so each promo republishes once a month rather
  // than once ever, without duplicating on every poll.
  const month = new Date(now).toISOString().slice(0, 7);            // YYYY-MM
  const promos = [
    { key: 'cut-local', title: 'Love a design? Get it made near you', to: '/makers',
      desc: 'No CNC or 3D printer? Post any design and a vetted maker near you builds it, ready for local pickup. Compare quotes and star ratings, they do the making. Free to request.' },
    { key: 'get-paid', title: 'Own a CNC, laser or 3D printer? Get paid to build', to: '/become-a-maker',
      desc: 'Paid jobs near you with the design file already in hand. Free to join, the buyer pays you directly, and we take just 3% on completed jobs.' },
    { key: 'free-files', title: 'Five bas-relief STL files, free', to: '/free',
      desc: 'Test how our reliefs carve on your own machine before you spend anything. Ready for CNC routers, laser engravers and 3D printers, commercial use included.' },
  ];
  const promoXml = (await Promise.all(promos.map(async (pr) => {
    const img = `${SITE}/pin/promo/${pr.key}.jpg?m=${month}`;
    const link = `${SITE}${pr.to}?utm_source=pinterest&utm_medium=social&utm_campaign=promo-${pr.key}`;
    const bytes = await imageBytes(img);
    if (!bytes) return '';                                          // gated promo: skip
    return `    <item>
      <title>${xmlEscape(pr.title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="false">${xmlEscape(`${SITE}/promo/${pr.key}/${month}`)}</guid>
      <pubDate>${new Date(now).toUTCString()}</pubDate>
      <description>${cdata(pr.desc)}</description>
      <content:encoded>${cdata(pr.desc)}</content:encoded>
      <enclosure url="${xmlEscape(img)}" type="image/jpeg" length="${bytes}" />
      <media:content url="${xmlEscape(img)}" medium="image" type="image/jpeg" width="${PIN_W}" height="${PIN_H}" fileSize="${bytes}" />
      <media:thumbnail url="${xmlEscape(img)}" width="${PIN_W}" height="${PIN_H}" />
      <image>${xmlEscape(img)}</image>
    </item>`;
  }))).filter(Boolean).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>DigitalChiselCo — New STL Releases</title>
    <link>${xmlEscape(SITE)}</link>
    <description>Fresh bas-relief STL files for CNC routers, laser engravers and 3D printers, released daily.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>
${promoXml}
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
