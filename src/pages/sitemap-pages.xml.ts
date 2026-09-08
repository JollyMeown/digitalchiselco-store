// Everything that is not a single design or a guide: home, the commerce
// surfaces, every collection, the SEO landing pages and live seasonal pages.
import { supabase } from '../lib/supabase';
import { SITE, entry, urlset, STATIC_PATHS } from '../lib/sitemap';
import { LANDING_TOPICS } from '../lib/landing';

export const prerender = false;

export async function GET() {
  const urls: string[] = [];

  for (const s of STATIC_PATHS) urls.push(entry(`${SITE}${s.path}`, null, s.changefreq, s.priority));

  // SEO landing pages (themes + machines)
  urls.push(entry(`${SITE}/designs`, null, 'weekly', 0.7));
  for (const t of LANDING_TOPICS) urls.push(entry(`${SITE}/designs/${t.slug}`, null, 'weekly', 0.7));

  // Collections are the crawl path to every design, so they rank high here.
  try {
    const { data: cats } = await supabase.from('categories').select('slug, created_at').limit(500);
    for (const c of cats || []) urls.push(entry(`${SITE}/collections/${c.slug}`, c.created_at, 'weekly', 0.8));
  } catch (e) { console.error('sitemap categories failed:', e); }

  // Live seasonal collections (active + inside their date window)
  try {
    const nowIso = new Date().toISOString();
    const { data: seasonal } = await supabase.from('seasonal_collections')
      .select('slug, created_at, starts_at, ends_at').eq('active', true).limit(200);
    for (const s of seasonal || []) {
      if ((s.starts_at && s.starts_at > nowIso) || (s.ends_at && s.ends_at < nowIso)) continue;
      urls.push(entry(`${SITE}/seasonal/${s.slug}`, s.created_at, 'weekly', 0.7));
    }
  } catch (e) { console.error('sitemap seasonal failed:', e); }

  return urlset(urls);
}
