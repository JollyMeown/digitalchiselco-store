// Guides-only Pinterest RSS feed: /pinterest-guides-rss.xml
//
// Connect this URL in Pinterest (Bulk create Pins > RSS feed) to a board such
// as "CNC Relief Carving Guides". Pinterest polls it about daily and creates a
// Pin for each new guid. The same guide Pins also ride in /pinterest-rss.xml,
// so nothing depends on this feed being connected.
import { guidePins, guideItemXml } from '../lib/pinterest-guides';

export const prerender = false;
const SITE = (process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');

export async function GET() {
  const pins = await guidePins(100);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>DigitalChiselCo — CNC Relief Carving Guides</title>
    <link>${SITE}/blog</link>
    <description>Free guides on carving, finishing, printing and selling bas-relief STL files, from the DigitalChiselCo studio.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${pins.map((g) => guideItemXml(g)).join('\n')}
  </channel>
</rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=1800' } });
}
