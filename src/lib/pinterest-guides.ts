// Guide Pins for the Pinterest RSS feeds: one item per published article
// that has a poster (posts.pin_image_url, built by scripts/blog/compose_pins.mjs).
//
// Used by /pinterest-rss.xml (the feed already connected to the CNC board, so
// the guides publish with no new setup) and by /pinterest-guides-rss.xml (a
// guides-only feed the owner can connect to a dedicated board).
//
// The guid is the clean article URL plus a version from pin_at, so a rebuilt
// poster republishes once; the link carries attribution.
import { supabase } from './supabase';

const SITE = (process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const PIN_W = 1000, PIN_H = 1500;
const xmlEscape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cdata = (v: unknown) => `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]&gt;')}]]>`;

export type GuidePin = { slug: string; title: string; description: string; image: string; url: string; guid: string; pubDate: Date };

export async function guidePins(limit = 50): Promise<GuidePin[]> {
  const { data } = await supabase.from('posts')
    .select('slug, title, excerpt, pin_image_url, pin_title, pin_description, pin_at, published_at')
    .eq('status', 'published').not('pin_image_url', 'is', null)
    .order('pin_at', { ascending: false }).limit(limit);
  return (data || []).map((p: any) => {
    const url = `${SITE}/blog/${p.slug}`;
    const v = p.pin_at ? new Date(p.pin_at).toISOString().slice(0, 10) : '1';
    return {
      slug: p.slug,
      title: String(p.pin_title || p.title).slice(0, 100),
      description: String(p.pin_description || p.excerpt || '').slice(0, 500),
      image: String(p.pin_image_url),
      url: `${url}?utm_source=pinterest&utm_medium=rss&utm_campaign=guides`,
      guid: `${url}#pin-${v}`,
      pubDate: new Date(p.pin_at || p.published_at || Date.now()),
    };
  });
}

export function guideItemXml(g: GuidePin, bytes = 250_000): string {
  const html = `<img src="${xmlEscape(g.image)}" alt="${xmlEscape(g.title)}" /><p>${xmlEscape(g.description)}</p>`;
  return `    <item>
      <title>${xmlEscape(g.title)}</title>
      <link>${xmlEscape(g.url)}</link>
      <guid isPermaLink="false">${xmlEscape(g.guid)}</guid>
      <pubDate>${g.pubDate.toUTCString()}</pubDate>
      <description>${cdata(html)}</description>
      <content:encoded>${cdata(html)}</content:encoded>
      <enclosure url="${xmlEscape(g.image)}" type="image/jpeg" length="${bytes}" />
      <media:content url="${xmlEscape(g.image)}" medium="image" type="image/jpeg" width="${PIN_W}" height="${PIN_H}" fileSize="${bytes}" />
      <media:thumbnail url="${xmlEscape(g.image)}" width="${PIN_W}" height="${PIN_H}" />
      <image>${xmlEscape(g.image)}</image>
    </item>`;
}
