// Build sitemap-blocks.xml — one <url> per /b/<cnn> block share page (api/block.js).
//
// The block pages are unique, server-rendered SEO landing pages: "<Street> Street Cleaning
// (<cross sts>), SF", each with that block's real schedule + citation-derived ticket time. Great
// long-tail search targets ("17th St Mission street cleaning").
//
// Universe = enforcement blocks (the ones carrying the "tickets land ~X" hook) that ALSO have a
// baked schedule in data/schedules.json (build:schedules). api/block answers 404 for any cnn not in
// that file, so intersecting lists only cnns that render a real 200 page — from the same file the
// page is served from, not a separate live DataSF query that could disagree.
// <lastmod> is the day the page's content last changed: the block's own schedule entry, a new
// enforcement or DPW-route build, or the last commit to the page template (scripts/lastmod.mjs).
// Kept separate from sitemap.xml (core + hoods); both are advertised in robots.txt.
import { readFileSync, writeFileSync } from 'node:fs';
import { gitDate } from './lastmod.mjs';

const ROOT = new URL('../', import.meta.url);
const BASE = 'https://curb.guide';
const load = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

const enf = load('data/enforcement.json');
const sched = load('data/schedules.json').b;
const routes = load('data/routes.json');
const enfCnns = Object.keys(enf).filter((k) => k !== '_meta');

// the newest page-wide change: template commit, enforcement rebuild, route rebuild
const floor = [gitDate('api/block.js'), enf._meta?.generated, routes._meta?.generated]
  .filter(Boolean).map((d) => String(d).slice(0, 10)).sort().pop() || '';

const cnns = enfCnns.filter((c) => sched[c]).sort((a, b) => Number(a) - Number(b));
const urls = cnns.map((c) => {
  const mod = [sched[c][8] || '', floor].sort().pop();
  return `  <url><loc>${BASE}/b/${c}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}<changefreq>monthly</changefreq></url>`;
}).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
writeFileSync(new URL('sitemap-blocks.xml', ROOT), xml);
console.error(`[blocksitemap] wrote sitemap-blocks.xml — ${cnns.length} block urls (enforcement ${enfCnns.length}, baked ${Object.keys(sched).length}, dropped ${enfCnns.length - cnns.length}; template/data floor ${floor || 'none'})`);
