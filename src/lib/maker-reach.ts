// Can this maker take this Cut Local job? One answer, used by the matcher that
// emails makers, the maker dashboard that lists jobs, and the daily "jobs
// waiting" reminder. No imports, so every caller (and a plain test) can use it.
//
// Why it exists (2026-09-30): the first real buyer request, from Magog,
// Quebec, reached exactly one maker, 2,900 km away in Saskatchewan, who does not
// ship. The three places compared the typed country text exactly, so:
//   - a job from Canada never reached US makers an hour from the border, and
//     their dashboard would not even have listed it;
//   - 5 of 18 US makers wrote "US" or "USA", so a buyer who typed "United
//     States" (the form's own placeholder) never reached them;
//   - a maker who does not ship was told about jobs anywhere in his country.
// Distances come from state / province / country centres, so they are rough
// (100 to 200 km); they decide "near" or "far", nothing finer.

export type ReachKind =
  | 'picked'   // the buyer chose this maker from their profile
  | 'local'    // same country, within the maker's delivery radius (or same town)
  | 'ships'    // same country, the maker ships anywhere in it
  | 'intl'     // other country, the maker said they ship there
  | 'unknown'  // same country, too little location data to judge: kept in, as before
  | 'border'   // other country but close, and the maker ships at home: ASKED, not assumed
  | 'far'      // same country, out of reach
  | 'abroad';  // other country, no sign they ship there
export type Reach = { show: boolean; sure: boolean; kind: ReachKind; km: number | null };

/** How close a maker in a neighbouring country must be to be asked about a job. */
export const BORDER_KM = 800;
/** Slack added to a maker's delivery radius, because the distances are rough. */
const RADIUS_SLACK_KM = 40;

const strip = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();

const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['us', 'usa', 'u s', 'u s a', 'united states', 'united states of america', 'america', 'the united states'],
  CA: ['ca', 'can', 'canada'],
  MX: ['mx', 'mexico'],
  GB: ['gb', 'uk', 'u k', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  IE: ['ie', 'ireland', 'eire', 'republic of ireland'],
  IT: ['it', 'italy', 'italia'],
  CH: ['ch', 'switzerland', 'schweiz', 'suisse', 'svizzera'],
  DE: ['de', 'germany', 'deutschland'],
  AT: ['at', 'austria', 'osterreich'],
  FR: ['fr', 'france'],
  BE: ['be', 'belgium', 'belgique', 'belgie'],
  NL: ['nl', 'netherlands', 'the netherlands', 'nederland', 'holland'],
  ES: ['es', 'spain', 'espana'],
  PT: ['pt', 'portugal'],
  DK: ['dk', 'denmark', 'danmark'],
  SE: ['se', 'sweden', 'sverige'],
  NO: ['no', 'norway', 'norge'],
  FI: ['fi', 'finland', 'suomi'],
  PL: ['pl', 'poland', 'polska'],
  CZ: ['cz', 'czechia', 'czech republic'],
  AU: ['au', 'aus', 'australia'],
  NZ: ['nz', 'new zealand'],
};
const COUNTRY_OF: Record<string, string> = {};
for (const [code, names] of Object.entries(COUNTRY_ALIASES)) for (const n of names) COUNTRY_OF[n] = code;

/** "USA", "United States", "U.S." -> "US"; "Québec"-style accents ignored. Unknown countries keep their own spelling. */
export function countryCode(s: unknown): string {
  const k = strip(s);
  return COUNTRY_OF[k] || k.toUpperCase();
}

/** The countries a maker can be asked to ship to, with the names people know them by. */
export const SHIP_COUNTRY_CHOICES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' }, { code: 'MX', name: 'Mexico' },
  { code: 'GB', name: 'United Kingdom' }, { code: 'IE', name: 'Ireland' }, { code: 'AU', name: 'Australia' },
];
export function cleanShipCountries(v: unknown): string[] {
  const ok = new Set(SHIP_COUNTRY_CHOICES.map((c) => c.code));
  return [...new Set((Array.isArray(v) ? v : []).map((x) => countryCode(x)).filter((c) => ok.has(c)))];
}

// Rough population centres, [lat, lng]. Population rather than geographic
// centres, because a buyer is far more likely to live near Montreal than in
// northern Quebec.
const US: Record<string, [number, number]> = {
  AL: [33.0, -86.8], AK: [61.4, -149.2], AZ: [33.4, -111.9], AR: [34.9, -92.4], CA: [35.5, -119.4],
  CO: [39.5, -105.0], CT: [41.5, -72.8], DE: [39.4, -75.6], DC: [38.9, -77.0], FL: [27.8, -81.6],
  GA: [33.3, -84.1], HI: [21.3, -157.8], ID: [43.6, -115.9], IL: [41.3, -88.4], IN: [40.0, -86.3],
  IA: [41.9, -93.0], KS: [38.5, -97.0], KY: [37.8, -85.5], LA: [30.7, -91.5], ME: [44.3, -69.8],
  MD: [39.1, -76.8], MA: [42.3, -71.4], MI: [42.9, -84.2], MN: [45.2, -93.5], MS: [32.6, -89.4],
  MO: [38.4, -92.2], MT: [46.7, -111.3], NE: [41.2, -97.4], NV: [36.6, -115.6], NH: [43.1, -71.5],
  NJ: [40.4, -74.4], NM: [34.6, -106.3], NY: [41.8, -74.8], NC: [35.6, -79.4], ND: [47.4, -99.3],
  OH: [40.5, -82.7], OK: [35.6, -97.2], OR: [44.7, -122.6], PA: [40.5, -77.1], RI: [41.8, -71.4],
  SC: [34.0, -81.0], SD: [44.0, -99.0], TN: [35.8, -86.4], TX: [30.9, -97.4], UT: [40.5, -111.9],
  VT: [44.1, -72.8], VA: [37.8, -77.8], WA: [47.3, -121.6], WV: [38.8, -80.8], WI: [43.7, -89.0],
  WY: [42.6, -106.6], PR: [18.3, -66.4],
};
const US_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', 'washington dc': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI',
  idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
  maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
};
const CA: Record<string, [number, number]> = {
  AB: [52.0, -113.7], BC: [49.6, -122.9], MB: [50.3, -97.6], NB: [46.2, -66.0], NL: [47.9, -54.9],
  NS: [45.0, -63.6], NT: [62.4, -114.4], NU: [63.7, -68.5], ON: [44.0, -79.5], PE: [46.3, -63.2],
  QC: [46.3, -72.7], SK: [51.5, -106.0], YT: [60.7, -135.0],
};
const CA_NAMES: Record<string, string> = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB', newfoundland: 'NL',
  'newfoundland and labrador': 'NL', 'nova scotia': 'NS', 'northwest territories': 'NT', nunavut: 'NU',
  ontario: 'ON', 'prince edward island': 'PE', quebec: 'QC', saskatchewan: 'SK', yukon: 'YT',
};
const AU: Record<string, [number, number]> = {
  NSW: [-33.5, 150.5], VIC: [-37.7, 145.0], QLD: [-26.5, 152.5], WA: [-32.0, 116.0], SA: [-34.8, 138.6],
  TAS: [-42.5, 147.0], ACT: [-35.3, 149.1], NT: [-12.8, 131.5],
};
const AU_NAMES: Record<string, string> = {
  'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD', 'western australia': 'WA',
  'south australia': 'SA', tasmania: 'TAS', 'australian capital territory': 'ACT', 'northern territory': 'NT',
};
// Countries small enough that their centre is good enough for a "near or far" call.
const SMALL: Record<string, [number, number]> = {
  IE: [53.3, -7.7], GB: [52.9, -1.8], IT: [42.5, 12.5], CH: [46.9, 8.2], DE: [51.0, 10.4], AT: [47.6, 14.1],
  FR: [46.6, 2.4], BE: [50.6, 4.6], NL: [52.2, 5.4], ES: [40.3, -3.7], PT: [39.6, -8.3], DK: [55.9, 10.0],
  CZ: [49.8, 15.5], PL: [52.0, 19.4], NZ: [-39.5, 174.5],
};

function regionIn(table: Record<string, [number, number]>, names: Record<string, string>, region: unknown): [number, number] | null {
  const r = strip(region);
  if (!r) return null;
  const code = r.toUpperCase().replace(/\s/g, '');
  return table[code] || (names[r] ? table[names[r]] : null);
}

/** Rough [lat, lng] of a maker or a job, or null when it cannot be placed. */
export function placeOf(p: { country?: unknown; region?: unknown }): [number, number] | null {
  const c = countryCode(p.country);
  if (c === 'US') return regionIn(US, US_NAMES, p.region);
  if (c === 'CA') return regionIn(CA, CA_NAMES, p.region);
  if (c === 'AU') return regionIn(AU, AU_NAMES, p.region);
  return SMALL[c] || null;
}

export function kmBetween(a: [number, number] | null, b: [number, number] | null): number | null {
  if (!a || !b) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function reach(m: any, r: any): Reach {
  const km = kmBetween(placeOf(m), placeOf(r));
  if (r?.preferred_maker_id && r.preferred_maker_id === m?.id) return { show: true, sure: true, kind: 'picked', km };
  const wantsShip = r?.delivery !== 'pickup';          // 'ship', 'either', or not said
  const mc = countryCode(m?.country), rc = countryCode(r?.country);
  const sameCountry = !mc || !rc || mc === rc;

  if (sameCountry) {
    const sameTown = !!strip(m?.city) && strip(m?.city) === strip(r?.city);
    if (sameTown) return { show: true, sure: true, kind: 'local', km };
    if (km !== null && km <= (Number(m?.deliver_radius_km) || 0) + RADIUS_SLACK_KM) return { show: true, sure: true, kind: 'local', km };
    if (m?.deliver_domestic_ship && wantsShip) return { show: true, sure: true, kind: 'ships', km };
    if (km === null) return { show: true, sure: false, kind: 'unknown', km };
    return { show: false, sure: false, kind: 'far', km };
  }

  if (!wantsShip) return { show: false, sure: false, kind: 'abroad', km };
  const shipsThere = Array.isArray(m?.ship_countries) && m.ship_countries.map(countryCode).includes(rc);
  if (m?.deliver_intl || shipsThere) return { show: true, sure: true, kind: 'intl', km };
  // A maker who ships at home and sits near the border is ASKED: the job email
  // and the dashboard say plainly that the buyer is in another country.
  if (m?.deliver_domestic_ship && km !== null && km <= BORDER_KM) return { show: true, sure: false, kind: 'border', km };
  return { show: false, sure: false, kind: 'abroad', km };
}

/** Best first: the buyer's pick, then local, shipping, abroad-by-choice, unclear, and border asks by distance. */
export const REACH_ORDER: Record<ReachKind, number> = { picked: 0, local: 1, ships: 2, intl: 3, unknown: 4, border: 5, far: 9, abroad: 9 };
