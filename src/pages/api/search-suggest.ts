// Typeahead for every search box on the site. Uses the same in-memory search
// as /search (synonyms, translations, typo fixes, collections), so the
// dropdown and the results page always agree. Cached briefly at the edge.
import type { APIRoute } from 'astro';
import { suggest } from '../../lib/search-index';

export const prerender = false;

const json = (d: unknown, cache = true) => new Response(JSON.stringify(d), {
  headers: { 'content-type': 'application/json', ...(cache ? { 'cache-control': 'public, max-age=60, s-maxage=300' } : {}) },
});

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const cat = (url.searchParams.get('cat') || '').trim().slice(0, 80);
  if (q.length < 2) return json({ items: [], cats: [], total: 0 });
  try {
    return json(await suggest(q, cat || undefined));
  } catch (e) {
    console.error('search-suggest failed:', e);
    return json({ items: [], cats: [], total: 0 }, false);
  }
};
