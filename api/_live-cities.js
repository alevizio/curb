// The cities CURB already has a map for, found by name: "Request a city" (api/city-request.js) answers a request for one
// with a link to its map instead of filing it. San Francisco, every public city in lib/city-configs.js and Boston (built
// by hand, so not in that file; public since 2026-11-12): a city that is built but not public yet carries `preview`
// there and is still a request like any other (Lodi, NJ, 2026-11-11)
// (scripts/cities/public.mjs; api/_live-cities.test.mjs checks both lists agree).
//
// A name matches without accents, case or punctuation, with Saint / St. the same, and by a few short names people type
// (NYC, LA, Philly). A state or province, typed in its own field or after the city ("Paterson, NJ", "Paterson New
// Jersey"), has to be the live city's: Glendale, Arizona is a request like any other. With none typed, the name alone
// decides. The folding matches scripts/cities/city-requests.mjs (the issue filer, which is not deployed, so it can't be
// imported here); the test holds the two together.
//
// The LA County map is not one city but the unincorporated communities around Los Angeles, and people ask for those by
// name ("Florence Graham, CA", 2026-11-11). PLACES holds the ones the map covers; a request for one is answered with
// that community's name and the map it is on.
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
  ...Object.values(globalThis.CITY_CONFIGS).filter((c) => !c.preview)
    .map((c) => ({ id: c.id, name: c.name, region: c.region, url: `/${c.id}` })),
  { id: 'boston', name: 'Boston', region: 'Massachusetts', url: '/boston' },
].map((c) => ({
  ...c,
  code: CODES[c.region] || '',
  keys: new Set([cityKey(c.name), ...(ALIASES[c.id] || [])]),
}));

// The communities a map covers, by the neighborhood the map files them under (data/<id>/city.json `neighborhoods`; the
// test checks each is there) → the names people type. `map` is how the answer names the map. Left out on purpose: the
// LA County areas named after a city CURB has no map for (Arcadia, the San Gabriel ones), so a request for that city is
// never mistaken for them.
const COMMUNITIES = {
  'la-county': {
    map: 'LA County',
    places: {
      'East Los Angeles': ['East Los Angeles', 'East LA'],
      'Florence-Firestone': ['Florence-Firestone', 'Florence-Graham'],
      'South Whittier': ['South Whittier'],
      'West Whittier/Los Nietos': ['West Whittier', 'Los Nietos', 'West Whittier-Los Nietos'],
      Willowbrook: ['Willowbrook'],
      'Hacienda Heights': ['Hacienda Heights'],
      'East Rancho Dominguez': ['East Rancho Dominguez'],
      'Rowland Heights': ['Rowland Heights'],
      'North Whittier': ['North Whittier'],
    },
  },
};
export const PLACES = Object.entries(COMMUNITIES).flatMap(([id, { map, places }]) => {
  const { region, code, url } = LIVE.find((c) => c.id === id);
  return Object.entries(places).flatMap(([hood, names]) => names.map((name) => (
    { id, name, region, code, url, map, hood, keys: new Set([cityKey(name)]) })));
});
const FINDABLE = [...LIVE, ...PLACES];   // a city's own name wins over a community's

const isRegion = (p, c) => p === plain(c.region) || p === c.code.toLowerCase();
const isCountry = (p, c) => COUNTRY_US.has(p) || (p === 'canada' && CANADA.has(c.code));
// The typed state, province or country words agree with the city's: none typed (or only its country), or one of them is
// its state or province, by name or code.
function regionAgrees(parts, c) {
  const typed = parts.map(plain).filter((p) => p && !isCountry(p, c));
  return !typed.length || typed.some((p) => isRegion(p, c));
}

/** The live city a request names, as { id, name, url }, or the community on a live map, as { id, name, url, map } (id and
 *  url are the map's, name the community's), or null: the request is for somewhere CURB doesn't cover yet. */
export function liveCity(city, region = '') {
  const regionParts = String(region || '').split(',');
  // `tail`: words typed after the name with no comma. They must be the city's own state or country ("Paterson NJ"), so
  // "Oakland Park" is never Oakland.
  const find = (name, tail, parts) => FINDABLE.find((c) => c.keys.has(cityKey(name))
    && (!tail || isRegion(tail, c) || isCountry(tail, c)) && regionAgrees(parts, c));
  const [head, ...after] = String(city || '').split(',');
  const words = plain(head).split(' ');
  // the whole city field ("Washington, DC"), then the name before a comma, then before its last words
  let hit = find(city, '', regionParts);
  for (let k = words.length; !hit && k >= 1; k--) {
    hit = find(words.slice(0, k).join(' '), words.slice(k).join(' '), [...after, ...regionParts]);
  }
  return hit ? { id: hit.id, name: hit.name, url: hit.url, ...(hit.map ? { map: hit.map } : {}) } : null;
}
