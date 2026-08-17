// Smart search: synonyms + expansions + fuzzy "did you mean".
//
// Layer 1 — SYNONYMS: shopper words → catalog words. Buyers say "cowboy hat",
//   catalog titles say "western"; "xmas" vs "christmas"; "kitty" vs "cat";
//   "US flag" vs "american flag". Each query token is expanded to its synonym
//   group before searching, so these no longer return zero.
// Layer 2 — FUZZY: when a query still finds nothing, we score every distinct
//   title word in the catalog against each query token (Damerau-Levenshtein
//   with a length-scaled threshold) and propose the best "did you mean X?" —
//   catches typos ("eagel", "wolfe", "reliefs").
// The zero-result search itself is STILL logged (Design Scout feeds on it),
// so a suggestion never hides real demand.

const GROUPS: string[][] = [
  ['christmas', 'xmas', 'noel', 'santa', 'holiday'],
  ['halloween', 'spooky', 'pumpkin', 'jack o lantern', 'jackolantern'],
  ['easter', 'bunny', 'rabbit'],
  ['valentine', 'valentines', 'love', 'heart', 'romantic'],
  ['thanksgiving', 'turkey', 'harvest', 'autumn', 'fall'],
  ['cowboy', 'cowgirl', 'western', 'rodeo', 'ranch', 'wild west'],
  ['native', 'american indian', 'indian', 'tribal', 'chief', 'headdress'],
  ['usa', 'us flag', 'american flag', 'america', 'patriotic', 'stars and stripes'],
  ['eagle', 'bald eagle', 'eagles'],
  ['deer', 'buck', 'stag', 'whitetail', 'antler', 'antlers', 'elk'],
  ['fish', 'bass', 'trout', 'fishing', 'angler', 'salmon', 'marlin', 'pike'],
  ['duck', 'ducks', 'mallard', 'waterfowl'],
  ['bear', 'grizzly', 'bears'],
  ['wolf', 'wolves', 'wolfe'],
  ['horse', 'horses', 'stallion', 'mare', 'pony', 'equestrian'],
  ['dog', 'dogs', 'puppy', 'labrador', 'retriever', 'german shepherd', 'husky', 'bulldog'],
  ['cat', 'cats', 'kitten', 'kitty', 'feline'],
  ['owl', 'owls'],
  ['lion', 'lions', 'leo'],
  ['jesus', 'christ', 'crucifix', 'cross', 'religious', 'christian', 'last supper', 'holy'],
  ['mary', 'virgin mary', 'madonna', 'our lady', 'guadalupe'],
  ['angel', 'angels', 'cherub'],
  ['skull', 'skulls', 'gothic', 'day of the dead', 'sugar skull', 'calavera'],
  ['dragon', 'dragons', 'fantasy', 'mythical'],
  ['tree', 'trees', 'tree of life', 'oak', 'forest', 'woodland'],
  ['flower', 'flowers', 'floral', 'rose', 'roses', 'botanical', 'lily'],
  ['barn', 'farm', 'farmhouse', 'country', 'rustic', 'countryside', 'tractor'],
  ['boat', 'ship', 'sailboat', 'nautical', 'anchor', 'lighthouse', 'coastal', 'sea'],
  ['plane', 'airplane', 'aircraft', 'ww2', 'wwii', 'warbird', 'aviation'],
  ['car', 'cars', 'classic car', 'hot rod', 'sedan', 'truck', 'pickup'],
  ['motorcycle', 'motorbike', 'harley', 'biker', 'chopper'],
  ['guitar', 'music', 'musical', 'piano', 'violin', 'notes'],
  ['baseball', 'softball', 'pitcher', 'catcher', 'mlb'],
  ['football', 'nfl', 'quarterback', 'gridiron'],
  ['soccer', 'football club', 'futbol'],
  ['golf', 'golfer', 'golfing'],
  ['hunting', 'hunter', 'lodge', 'cabin', 'game'],
  ['military', 'army', 'navy', 'marines', 'veteran', 'soldier', 'memorial', 'tribute'],
  ['firefighter', 'fireman', 'fire department', 'maltese cross'],
  ['police', 'cop', 'sheriff', 'thin blue line', 'law enforcement'],
  ['nurse', 'medical', 'doctor', 'caduceus'],
  ['mandala', 'celtic', 'knot', 'geometric', 'pattern'],
  ['tray', 'serving tray', 'platter', 'dish', 'bowl', 'coaster'],
  ['sign', 'welcome sign', 'plaque', 'wall art', 'wall hanging', 'panel'],
  ['box', 'jewelry box', 'keepsake', 'lid'],
  ['clock', 'clocks', 'timepiece'],
  ['relief', 'reliefs', 'bas relief', 'bas-relief', '3d relief', 'carving', 'carved'],
  ['stl', 'stl file', 'cnc', 'cnc file', 'router', 'aspire', 'vcarve', 'carveco', '3d model'],
];

// token → the full group it belongs to (all lowercase, single tokens + phrases)
const SYN = new Map<string, string[]>();
for (const g of GROUPS) for (const w of g) SYN.set(w, g);

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'in', 'on', 'to', 'my', 'me', 'i', 'file', 'files', 'design', 'designs', 'model', 'models', 'stl', 'cnc', 'relief', 'reliefs', 'carving', 'wood', 'wooden', '3d']);

/** Split a query into meaningful lowercase tokens (drops filler words). */
export function tokens(q: string): string[] {
  return q.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Expand a query into alternative search terms via synonym groups. Returns
 *  the original tokens first, then synonym alternatives (deduped). */
export function expand(q: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
  const lower = q.toLowerCase().trim();
  // whole-phrase synonym first ("us flag" → group)
  for (const w of SYN.get(lower) || []) push(w);
  for (const t of tokens(q)) { push(t); for (const w of SYN.get(t) || []) push(w); }
  return out;
}

// Damerau–Levenshtein (optimal string alignment) — small strings only.
function dist(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

/** Given a failed query and the catalog vocabulary (distinct title words with
 *  frequency), return the best "did you mean" phrase or null. Each token is
 *  replaced by its closest vocab word within a length-scaled edit distance;
 *  at least one token must change for a suggestion to be offered. */
export function didYouMean(q: string, vocab: Map<string, number>): string | null {
  const ts = tokens(q);
  if (!ts.length) return null;
  let changed = false;
  const fixed = ts.map((t) => {
    if (vocab.has(t)) return t;
    const maxD = t.length <= 4 ? 1 : t.length <= 8 ? 2 : 3;
    let best: string | null = null, bestScore = Infinity;
    for (const [w, freq] of vocab) {
      if (Math.abs(w.length - t.length) > maxD) continue;
      if (w[0] !== t[0] && dist(w[0], t[0]) > 0 && maxD < 2) continue;  // cheap prefilter for short words
      const dd = dist(t, w);
      if (dd > maxD) continue;
      // prefer smaller distance, then more frequent words
      const score = dd * 1000 - Math.min(freq, 999);
      if (score < bestScore) { bestScore = score; best = w; }
    }
    if (best && best !== t) { changed = true; return best; }
    return t;
  });
  return changed ? fixed.join(' ') : null;
}
