// One-off (or occasional) full submission of every sitemap URL to IndexNow,
// so Bing (and through it ChatGPT and Copilot) learns the whole site at once.
// The nightly growth step then sends only what changed each day.
// Run AFTER the key file is live: https://digitalchiselco.com/<key>.txt
//   node scripts/indexnow_submit_sitemap.mjs          # dry run: count URLs
//   node scripts/indexnow_submit_sitemap.mjs --apply  # submit
const KEY = 'd8645a298486e17b25dc84f748badb5a';
const SITE = 'https://digitalchiselco.com';
const APPLY = process.argv.includes('--apply');

const keyOk = await fetch(`${SITE}/${KEY}.txt`).then((r) => r.ok && r.text()).then((t) => (t || '').trim() === KEY).catch(() => false);
console.log('key file live:', keyOk);
const idx = await (await fetch(`${SITE}/sitemap.xml`)).text();
let urls = [];
for (const m of [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1])) {
  if (!m.endsWith('.xml')) { urls.push(m); continue; }
  const x = await (await fetch(m)).text();
  urls.push(...[...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((y) => y[1]));
}
urls = [...new Set(urls)].filter((u) => u.startsWith(SITE + '/'));
console.log('sitemap URLs:', urls.length);
if (!APPLY) { console.log('dry run'); process.exit(0); }
if (!keyOk) { console.error('key file is not live yet; deploy first'); process.exit(1); }
for (let i = 0; i < urls.length; i += 10000) {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'digitalchiselco.com', key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls.slice(i, i + 10000) }),
  });
  console.log(`batch ${i / 10000 + 1}: HTTP ${res.status} ${res.status === 200 || res.status === 202 ? 'accepted' : await res.text()}`);
}
