// IndexNow: tell Bing (and Yandex, Seznam, Naver) the moment a page is new or
// changed, instead of waiting for them to crawl.
//
// Why Bing matters here: ChatGPT's web search and Microsoft Copilot answer
// from Bing's index, and ChatGPT already sends ~100 visitors a month
// (site_visits, Sep 2026). A design Bing has not indexed cannot be
// recommended. Google does not take IndexNow; it has the sitemap and Search
// Console.
//
// The key is public by design: the protocol proves ownership by serving it at
// /<key>.txt (public/d8645a298486e17b25dc84f748badb5a.txt), so it is not a
// secret and lives in the code.
export const INDEXNOW_KEY = 'd8645a298486e17b25dc84f748badb5a';
const HOST = 'digitalchiselco.com';
const SITE = `https://${HOST}`;

/** Submit up to 10,000 absolute URLs per call. Returns HTTP statuses per batch
 *  (200/202 accepted; 403 key not found yet; 422 URL not on this host). */
export async function submitIndexNow(urls: string[]): Promise<number[]> {
  const clean = [...new Set(urls.filter((u) => u.startsWith(SITE + '/')))];
  const statuses: number[] = [];
  for (let i = 0; i < clean.length; i += 10000) {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList: clean.slice(i, i + 10000) }),
      signal: AbortSignal.timeout(20000),
    });
    statuses.push(res.status);
  }
  return statuses;
}

export const productUrl = (slug: string) => `${SITE}/product/${slug}`;
export const postUrl = (slug: string) => `${SITE}/blog/${slug}`;
