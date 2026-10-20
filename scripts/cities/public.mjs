// Which city maps are public, the one list (owner, 2026-10-20). A public city's page (scripts/cities/city-page.mjs) is
// indexed, with a real title, description, canonical URL and share card; it gets a readable page at /<id>/about
// (scripts/cities/city-pages.mjs), a place on curb.guide/cities and in sitemap.xml (scripts/build-hood-pages.mjs), and
// curb.guide sends a first visit there when the visitor is inside its bounds (index.html CITY_MAPS, written by
// scripts/cities/configs.mjs). Every other built city stays a preview: noindex, "(preview)" in its title, unlisted.
// Boston (built by hand, boston-page.mjs) stays hidden until its contact replies.
//
// Making a built city public is one line here, then run, in order:
//   node scripts/cities/configs.mjs && node scripts/cities/city-page.mjs && node scripts/cities/boston-page.mjs \
//     && node scripts/cities/city-pages.mjs && npm run build:hoodpages
export const PUBLIC = [
  'berkeley', 'chicago', 'denver', 'glendale', 'hoboken', 'la-county', 'los-angeles', 'madison', 'milwaukee', 'montreal',
  'new-york', 'norfolk', 'oakland', 'paterson', 'philadelphia', 'pittsburgh', 'riverside', 'sacramento', 'saint-paul',
  'san-diego', 'san-jose', 'santa-monica', 'somerville', 'washington-dc',
];

// On curb.guide/cities under "In progress" until the city is public (a public city leaves this list by itself).
export const IN_PROGRESS = [
  { id: 'toronto', name: 'Toronto', region: 'Ontario', note: 'Being built now.' },
  { id: 'cambridge', name: 'Cambridge', region: 'Massachusetts', note: 'Waiting on the City\'s data: its only street table is from 2014.' },
  { id: 'san-mateo', name: 'San Mateo', region: 'California', note: 'Which streets have posted sweeping signs isn\'t known yet.' },
];

export const isPublic = (id) => PUBLIC.includes(id);

/** Whether a city's map is about street sweeping (every city so far) or another rule (Milwaukee: words.what). */
export const sweepsIn = (c) => !(c.words && c.words.what && c.words.what !== 'street sweeping');
/** The words people search for a city's rule, from its own facts: Milwaukee's "night parking" (words.what), "alternate side
 *  parking" or "street cleaning" when the City's rule sentence says so, else "street sweeping". */
export function ruleTerm(c) {
  const rule = String((c.words && c.words.rule) || '');
  if (!sweepsIn(c)) return c.words.what;
  if (/alternate side/i.test(rule)) return 'alternate side parking';
  if (/street cleaning/i.test(rule) && !/sweep/i.test(rule)) return 'street cleaning';
  return 'street sweeping';
}
/** A public city page's title and description, from its city.json (the title drops its second half past 60 characters). */
export function seoWords(c) {
  const term = ruleTerm(c), sweeps = sweepsIn(c), Term = term.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const long = `${c.name} ${Term} Map: ${sweeps ? 'Schedules by Block' : 'Tonight\'s Side by Block'} | CURB`;
  const title = long.length <= 60 ? long : `${c.name} ${Term} Map | CURB`;
  const fine = c.fine ? (sweeps ? `A missed sweep is a ${c.fine} ticket. ` : `The wrong side is a ${c.fine} ticket. `) : '';
  const description = `${c.name} ${term}, block by block: ${sweeps ? 'every curb colored by its next sweep' : 'tonight\'s side of every street'}. ${fine}Free, with alerts, from the City's open data.`;
  return { term, Term, title, description };
}
/** JSON for a <script type="application/ld+json">: the HTML delimiters as \u escapes, so no value can close the element. */
export const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
