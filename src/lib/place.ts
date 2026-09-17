// One way to show where a maker (or a buyer's job) is.
//
// A US maker in Terry Healy's words (2026-09-17): "your listings for US
// addresses are displayed by {CITY} and USA. Might I suggest using {STATE}
// USA instead of city? It would be much more understandable by US folks."
// Pages each joined the parts differently, most as "City, Country", so a US
// maker read "Lima, USA". Makers also type the parts freely: "Al", "Mi",
// "NC", "Ohio", and the country as "US", "USA" or "United States".
//
// Rule: in the US and the other federal countries people place a town by its
// state or province, so show "City, State" (Lima, Ohio). Everywhere else show
// "City, Country" (Kildare, Ireland). `withCountry` adds the country to the
// federal form for pages seen by a worldwide audience (Lima, Ohio, USA).

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'Washington DC', PR: 'Puerto Rico',
};
const CA_PROVINCES: Record<string, string> = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island',
  QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};
const AU_STATES: Record<string, string> = {
  NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', WA: 'Western Australia',
  SA: 'South Australia', TAS: 'Tasmania', ACT: 'Australian Capital Territory', NT: 'Northern Territory',
};

type Kind = 'US' | 'CA' | 'AU' | null;
function countryKind(country?: string | null): Kind {
  const c = String(country || '').trim().toLowerCase().replace(/[.\s]+/g, ' ').trim();
  if (/^(us|usa|u s a|u s|united states( of america)?|america)$/.test(c)) return 'US';
  if (/^(ca|can|canada)$/.test(c)) return 'CA';
  if (/^(au|aus|australia)$/.test(c)) return 'AU';
  return null;
}
const COUNTRY_SHORT: Record<string, string> = { US: 'USA', CA: 'Canada', AU: 'Australia' };

/** "big river" -> "Big River"; leaves "McAllen" and "O'Fallon" alone when already cased. */
function tidy(s?: string | null): string {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const cap = (w: string) => w.replace(/(^|[\-'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  if (t === t.toLowerCase() || t === t.toUpperCase()) return t.toLowerCase().split(' ').map(cap).join(' ');
  // Mixed case ("Big river", "McAllen"): keep words the maker cased on purpose,
  // capitalise the ones left all lower-case, except short joining words.
  return t.split(' ').map((w, i) => (w === w.toLowerCase() && (i === 0 || !/^(of|on|de|la|le|du|am|im|an|and)$/.test(w)) ? cap(w) : w)).join(' ');
}

/** The state or province written out in full, or null when it is not recognised. */
function fullRegion(kind: Kind, region?: string | null): string | null {
  const r = String(region || '').trim();
  if (!r || !kind) return null;
  const table = kind === 'US' ? US_STATES : kind === 'CA' ? CA_PROVINCES : AU_STATES;
  const code = r.replace(/\./g, '').toUpperCase();
  if (table[code]) return table[code];
  const byName = Object.values(table).find((n) => n.toLowerCase() === r.toLowerCase());
  return byName || tidy(r);
}

export function placeLabel(
  p: { city?: string | null; region?: string | null; country?: string | null },
  opts: { withCountry?: boolean } = {},
): string {
  const kind = countryKind(p.country);
  const city = tidy(p.city);
  if (kind) {
    const region = fullRegion(kind, p.region);
    const parts = [city, region].filter(Boolean);
    if (!region || opts.withCountry) parts.push(COUNTRY_SHORT[kind]);
    return [...new Set(parts)].join(', ');
  }
  const country = tidy(p.country);
  const parts = city ? [city, country] : [tidy(p.region), country];
  return [...new Set(parts.filter(Boolean))].join(', ');
}
