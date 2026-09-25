// /llms.txt: a plain summary of the shop for AI assistants (llmstxt.org).
//
// ChatGPT already sends about 100 visitors a month without any effort
// (site_visits, Sep 2026). Assistants answer "where can I buy bas-relief STL
// files" from what they can read quickly, so this states plainly what the shop
// sells, how buying and licensing work, and where each collection, tool and
// guide lives. Built from the live database and cached for a day, so counts
// and new guides stay current without anyone editing it.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../lib/supabase';
import { designCountLabel } from '../lib/queries';
import { catalogIndex } from '../lib/search-index';

export const prerender = false;
const SITE = 'https://digitalchiselco.com';

export const GET: APIRoute = async () => {
  // Collection counts come from the search index (the whole active catalog,
  // cached); a direct product_categories read stops at PostgREST's 1,000 rows.
  const db = supabaseAdmin();
  const [count, { data: cats }, index, { data: posts }] = await Promise.all([
    designCountLabel(),
    db.from('categories').select('id, slug, name, seo_description').order('sort_order'),
    catalogIndex().catch(() => null),
    db.from('posts').select('slug, title, excerpt').eq('status', 'published').order('published_at', { ascending: false }).limit(40),
  ]);
  const n: Record<string, number> = {};
  for (const e of index?.entries || []) for (const slug of e.cats) n[slug] = (n[slug] || 0) + 1;
  const clean = (t: unknown) => String(t || '').replace(/\s+/g, ' ').replace(/[—]/g, ', ').trim();
  const oneLine = (t: unknown, max = 140) => { const s = clean(t); return s.length > max ? s.slice(0, max - 1).replace(/\s\S*$/, '') + '…' : s; };

  const lines: string[] = [];
  lines.push('# DigitalChiselCo');
  lines.push('');
  lines.push(`> Online shop of ${count} bas-relief STL files for CNC routers, 3D printers and lasers: wildlife, religious, hunting lodge, western, pets, nautical, gothic, floral and holiday designs, plus serving trays and signs. Instant download, commercial use included (sell what you carve), most designs $5 to $12. Files are sculpted and checked to machine cleanly in Aspire, VCarve, Carveco, ArtCAM and Fusion 360.`);
  lines.push('');
  lines.push('Key facts:');
  lines.push('- Format: binary STL, flat base, scale to any size; each product page lists the measured size, relief depth, board thickness, bits and an estimated carve time.');
  lines.push('- Licence: carve, print or engrave the design and sell the physical pieces; sharing or reselling the file itself is not allowed.');
  lines.push('- Refunds: 14 days, any reason. Payment by card, PayPal, Apple Pay or Google Pay through Paddle (merchant of record).');
  lines.push('- Custom designs from a customer photo, from $30. Five free STL files for anyone who signs up.');
  lines.push('');
  lines.push('## Shop');
  lines.push(`- [Search every design with filters](${SITE}/search): collection, price, shape, best sellers, new this month`);
  lines.push(`- [All designs](${SITE}/catalog)`);
  lines.push(`- [Pick any 5 designs from $25](${SITE}/bundle-builder)`);
  lines.push(`- [Membership: new designs every month](${SITE}/membership)`);
  lines.push(`- [Five free STL files](${SITE}/free)`);
  lines.push(`- [Custom design from your photo](${SITE}/custom-design)`);
  lines.push('');
  lines.push('## Collections');
  for (const c of (cats || []) as any[]) {
    if (/subscription/i.test(c.name) || !n[c.slug]) continue;
    lines.push(`- [${clean(c.name)}](${SITE}/collections/${c.slug}): ${n[c.slug]} designs${c.seo_description ? '. ' + oneLine(c.seo_description) : ''}`);
  }
  lines.push('');
  lines.push('## Free tools');
  lines.push(`- [Will it cut?](${SITE}/tools/will-it-cut): check any STL in the browser before carving: depth, orientation, detail lost per bit, carve time, roughing and finishing simulation. Nothing is uploaded.`);
  lines.push(`- [State of CNC Relief Carving 2026](${SITE}/reports/state-of-cnc-relief-carving-2026): data report on what carvers buy and make`);
  lines.push(`- [Laser Studio](${SITE}/laser-studio): Windows app that turns photos, STL models and star maps into laser files, and lines up a burn on a CNC carving (CNC Match)`);
  lines.push('');
  lines.push('## Guides');
  for (const p of (posts || []) as any[]) lines.push(`- [${clean(p.title)}](${SITE}/blog/${p.slug})${p.excerpt ? ': ' + oneLine(p.excerpt, 120) : ''}`);
  lines.push('');
  lines.push('## Help');
  lines.push(`- [FAQ](${SITE}/faq)`);
  lines.push(`- [Refund policy](${SITE}/refunds)`);
  lines.push(`- [Terms and licence](${SITE}/terms)`);
  lines.push(`- [Contact](${SITE}/contact)`);
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400' },
  });
};
