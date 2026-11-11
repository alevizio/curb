// The cities CURB already has a map for, found by name: "Request a city" (api/city-request.js) answers a request for one
// with a link to its map instead of filing it. San Francisco plus every city in lib/city-configs.js, which holds exactly
// the public cities (scripts/cities/public.mjs; api/_live-cities.test.mjs checks both lists agree).
//
// A name matches without accents, case or punctuation, with Saint / St. the same, and by a few short names people type
// (NYC, LA, Philly). A state or province, typed in its own field or after the city ("Paterson, NJ", "Paterson New
// Jersey"), has to be the live city's: Glendale, Arizona is a request like any other. With none typed, the name alone
// decides. The folding matches scripts/cities/city-requests.mjs (the issue filer, which is not deployed, so it can't be
// imported here); the test holds the two together.
import '../lib/city-configs.js';

const plain = (s) => String(s || '').replace(/\./g, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z\p{L}]+/gu, ' ').trim();
const cityKey = (s) => plain(s).split(' ').map((w) => ({ st: 'saint', ste: 'sainte', ft: 'fort', mt: 'mount' }[w] || w)).join(' ');

// the live cities' states and provinces → their postal codes
const CODES = {
  California: 'CA', Colorado: 'CO', 'District of Columbia': 'DC', Illinois: 'IL', Massachusetts: 'MA', Minnesota: 'MN',
  'New Jersey': 'NJ', 'New York': 'NY', Ontario: 'ON', Pennsylvania: 'PA', Quebec: 'QC', Virginia: 'VA', Wisconsin: 'WI',
};
const CANADA = new Set(['ON', 'QC']);
const COUNTRY_US = new Set(['us', 'usa', 'u s', 'u s a', 'united states', 'united states of america', 'america']);
// other names people type for a live city
const ALIASES = {
  sf: ['sf'],
  'new-york': ['new york', 'nyc'],
  'los-angeles': ['la'],
  'la-county': ['la county', 'los angeles county', 'unincorporated los angeles county'],
  'washington-dc': ['washington', 'dc', 'district of columbia'],
  philadelphia: ['philly'],
};

export const LIVE = [
  { id: 'sf', name: 'San Francisco', region: 'California', url: '/' },
  ...Object.values(globalThis.CITY_CONFIGS).map((c) => ({ id: c.id, name: c.name, region: c.region, url: `/${c.id}` })),
].map((c) => ({
  ...c,
  code: CODES[c.region] || '',
  keys: new Set([cityKey(c.name), ...(ALIASES[c.id] || [])]),
}));

const isRegion = (p, c) => p === plain(c.region) || p === c.code.toLowerCase();
const isCountry = (p, c) => COUNTRY_US.has(p) || (p === 'canada' && CANADA.has(c.code));
// The typed state, province or country words agree with the city's: none typed (or only its country), or one of them is
// its state or province, by name or code.
function regionAgrees(parts, c) {
  const typed = parts.map(plain).filter((p) => p && !isCountry(p, c));
  return !typed.length || typed.some((p) => isRegion(p, c));
}

/** The live city a request names, as { id, name, url }, or null: the request is for somewhere CURB doesn't cover yet. */
export function liveCity(city, region = '') {
  const regionParts = String(region || '').split(',');
  // `tail`: words typed after the name with no comma. They must be the city's own state or country ("Paterson NJ"), so
  // "Oakland Park" is never Oakland.
  const find = (name, tail, parts) => LIVE.find((c) => c.keys.has(cityKey(name))
    && (!tail || isRegion(tail, c) || isCountry(tail, c)) && regionAgrees(parts, c));
  const [head, ...after] = String(city || '').split(',');
  const words = plain(head).split(' ');
  // the whole city field ("Washington, DC"), then the name before a comma, then before its last words
  let hit = find(city, '', regionParts);
  for (let k = words.length; !hit && k >= 1; k--) {
    hit = find(words.slice(0, k).join(' '), words.slice(k).join(' '), [...after, ...regionParts]);
  }
  return hit ? { id: hit.id, name: hit.name, url: hit.url } : null;
}
