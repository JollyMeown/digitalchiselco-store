// Themed-collage Pinterest feed. Served at /pinterest-themes.xml.
//
// Connect this to a SECOND board (something like "CNC Design Collections").
// The product feed at /pinterest-rss.xml sells one design at a time; this one
// sells a subject: hunting, ducks, dogs, cowboy, fishing. The shop's own
// analytics (2026-09-03) show designed Pins earning roughly 22x the impressions
// per Pin that catalogue product Pins do, so the collage format is where the
// reach is.
//
// Pacing: one theme per day, rotating deterministically through the categories,
// so a board gets a steady drip rather than a dump. The guid carries the date,
// so a theme that comes round again publishes as a genuinely new Pin with a
// fresh collage (the art rotates its four designs daily too).
import { supabase } from '../lib/supabase';

export const prerender = false;

const SITE = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const PER_DAY = 1;         // themes published per day
const WINDOW_DAYS = 3;     // how long each stays in the feed, so a missed poll still lands
const PIN_W = 1000, PIN_H = 1500;
const DAY_MS = 86_400_000;
const FALLBACK_BYTES = 220_000;

// Categories that are administrative rather than a subject a pinner searches.
const SKIP = new Set(['premium-bundle-offer', 'subscription-plans']);

const xmlEscape = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cdata = (v: unknown) => `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]&gt;')}]]>`;

async function designCount(categoryId: string): Promise<number> {
  const { count } = await supabase
    .from('products')
    .select('id, product_categories!inner(category_id)', { count: 'exact', head: true })
    .eq('active', true).eq('product_categories.category_id', categoryId)
    .not('image_url', 'is', null);
  return count || 0;
}

export async function GET() {
  const now = Date.now();
  const today = Math.floor(now / DAY_MS);

  const { data: cats } = await supabase.from('categories').select('id, name, slug').order('name');
  const themes = (cats || []).filter((c: any) => c.slug && !SKIP.has(c.slug));

  const items: { cat: any; day: number }[] = [];
  if (themes.length) {
    // One theme per day, walking the list in order and wrapping round.
    for (let back = 0; back < WINDOW_DAYS; back++) {
      const day = today - back;
      for (let n = 0; n < PER_DAY; n++) {
        items.push({ cat: themes[(day * PER_DAY + n) % themes.length], day });
      }
    }
  }

  // A collage needs four designs to look deliberate; smaller categories are
  // skipped rather than padded with repeats.
  const counts = new Map<string, number>();
  await Promise.all([...new Set(items.map((i) => i.cat.id))].map(async (id) => counts.set(id, await designCount(id))));

  const built = await Promise.all(items.map(async ({ cat, day }) => {
    if ((counts.get(cat.id) || 0) < 4) return '';
    const date = new Date(day * DAY_MS);
    const stamp = date.toISOString().slice(0, 10);
    const img = `${SITE}/pin/theme/${encodeURIComponent(cat.slug)}.jpg?d=${stamp}`;
    const bytes = FALLBACK_BYTES;
    const link = `${SITE}/collections/${cat.slug}?utm_source=pinterest&utm_medium=themes&utm_campaign=theme-${cat.slug}`;
    const name = String(cat.name || '').replace(/\s{2,}/g, ' ').trim();
    const title = `${name} bas-relief STL files for CNC carving`.slice(0, 100);
    const desc = `Browse our ${name.toLowerCase()} collection: high-detail bas-relief STL files ready for CNC routers, laser engravers and 3D printers. `
      + 'No modelling work, instant download, commercial use included. Tested in Aspire, VCarve Pro, Carveco and Fusion 360. '
      + 'Grab 5 free STL files at digitalchiselco.com/free.';
    return `    <item>
      <title>${xmlEscape(title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="false">${xmlEscape(`${SITE}/theme/${cat.slug}/${stamp}`)}</guid>
      <pubDate>${date.toUTCString()}</pubDate>
      <description>${cdata(desc)}</description>
      <content:encoded>${cdata(`<img src="${img}" alt="${xmlEscape(name)}" /><p>${xmlEscape(desc)}</p>`)}</content:encoded>
      <enclosure url="${xmlEscape(img)}" type="image/jpeg" length="${bytes}" />
      <media:content url="${xmlEscape(img)}" medium="image" type="image/jpeg" width="${PIN_W}" height="${PIN_H}" fileSize="${bytes}" />
      <media:thumbnail url="${xmlEscape(img)}" width="${PIN_W}" height="${PIN_H}" />
      <image>${xmlEscape(img)}</image>
    </item>`;
  }));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>DigitalChiselCo — Design Collections</title>
    <link>${xmlEscape(SITE)}</link>
    <description>Themed collections of bas-relief STL designs for CNC routers, laser engravers and 3D printers.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>
${built.filter(Boolean).join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=1800',
    },
  });
}
