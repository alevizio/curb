// Build sitemap-blocks.xml — one <url> per /b/<cnn> block share page (api/block.js).
//
// The block pages are unique, server-rendered SEO landing pages: "<Street> (<cross sts>) — when
// sweeping tickets actually land", each with that block's real schedule + citation-derived ticket
// time. Great long-tail search targets ("17th St Mission street cleaning").
//
// Universe = enforcement blocks (the ones carrying the "tickets land ~X" hook) that ALSO have a
// current sweep schedule in DataSF (yhqp-riqs). api/block 302-redirects any cnn WITHOUT sweep rows
// back to "/", so we intersect to only list cnns that render a real 200 page (never a redirect).
// Kept separate from sitemap.xml (core + hoods); both are advertised in robots.txt.
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const BASE = 'https://curb.guide';
const SWEEP = 'https://data.sf.gov/resource/yhqp-riqs.json';

const enf = JSON.parse(readFileSync(new URL('data/enforcement.json', ROOT), 'utf8'));
const enfCnns = Object.keys(enf);

// currently-swept cnns, so we never list one that would 302-redirect
let swept = null;
try {
  const r = await fetch(`${SWEEP}?$select=cnn&$group=cnn&$limit=50000`);
  if (r.ok) swept = new Set((await r.json()).map(x => String(x.cnn).split('.')[0]).filter(Boolean));
} catch (_) { /* fall through */ }
if (!swept) console.error('[blocksitemap] WARN: DataSF swept-cnn fetch failed — listing all enforcement cnns (a few may 302).');

const cnns = (swept ? enfCnns.filter(c => swept.has(c)) : enfCnns).sort((a, b) => Number(a) - Number(b));
const urls = cnns.map(c => `  <url><loc>${BASE}/b/${c}</loc><changefreq>monthly</changefreq></url>`).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
writeFileSync(new URL('sitemap-blocks.xml', ROOT), xml);
console.error(`[blocksitemap] wrote sitemap-blocks.xml — ${cnns.length} block urls (enforcement ${enfCnns.length}${swept ? `, swept ${swept.size}, dropped ${enfCnns.length - cnns.length}` : ', UNFILTERED'})`);
