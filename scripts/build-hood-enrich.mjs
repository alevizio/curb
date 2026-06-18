#!/usr/bin/env node
// Per-neighborhood enrichment for the /n/<hood> pages → data/hood-enrich.json.
// Joined to the 41 DataSF Analysis Neighborhoods (data/neighborhoods.geojson, same names as stats.json):
//   curbMix — share of mapped curb by category (SFMTA Digital Curb ArcGIS) via per-hood spatial groupBy.
//             (The layer's own NHOOD field uses an older 37-hood scheme, so we join by GEOMETRY, not name.)
//   garages — public off-street parking in the hood (DataSF mizu-nf6z), point-in-polygon.
// Run: npm run build:hoodenrich   (Node 18+, no deps; ~1 min — one spatial query per hood + 1 garage fetch)

import { readFileSync, writeFileSync } from 'node:fs';

const CURBS = 'https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Curb_Zones_with_All_Policies/FeatureServer/0/query';
const GARAGES = 'https://data.sfgov.org/resource/mizu-nf6z.json';
const log = (...a) => console.error('[hood-enrich]', ...a);

const geo = JSON.parse(readFileSync(new URL('../data/neighborhoods.geojson', import.meta.url), 'utf8'));
const ringsOf = (f) => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : f.geometry.coordinates);
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---- curb-mix per hood: spatial groupBy (POST — the polygon is too big for a GET URL) ----
const NOPARK = new Set(['No Parking Anytime', 'No Parking Some Time', 'No Stopping']);
const isLoading = (c) => /Loading/.test(c);
async function curbMix(rings) {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: '1=1',
    groupByFieldsForStatistics: 'PCY_CAT',
    outStatistics: '[{"statisticType":"sum","onStatisticField":"LENGTH_FT","outStatisticFieldName":"ft"}]',
    returnGeometry: 'false', f: 'json',
  });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await (await fetch(CURBS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'curb-guide-build' }, body })).json();
      if (r.features) {
        let general = 0, rpp = 0, loading = 0, other = 0;
        for (const a of r.features.map((x) => x.attributes)) {
          const ft = a.ft || 0, c = a.PCY_CAT || '';
          if (c === 'General Parking') general += ft;
          else if (c === 'Residential Permit Parking') rpp += ft;
          else if (isLoading(c)) loading += ft;
          else if (!NOPARK.has(c)) other += ft; // accessible / motorcycle / car-share / etc. (skip No Parking)
        }
        const parkable = general + rpp + loading + other;
        if (parkable < 1500) return null; // too little mapped parkable curb to characterize honestly
        const pct = (n) => Math.round((100 * n) / parkable);
        return { parkableFt: Math.round(parkable), general: pct(general), rpp: pct(rpp), loading: pct(loading) };
      }
    } catch (e) { /* retry */ }
    await new Promise((s) => setTimeout(s, 1200 * (i + 1)));
  }
  return null;
}

// ---- garages: point-in-polygon against the hood ----
const pip = (pt, rings) => { let inside = false; for (const ring of rings) { for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside; } } return inside; };
const numf = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
log('fetching off-street parking (mizu-nf6z)…');
const allGar = await (await fetch(GARAGES + '?$limit=2000&$where=the_geom IS NOT NULL')).json();
const gpts = allGar.map((g) => {
  const c = g.the_geom && g.the_geom.coordinates; if (!c) return null;
  const hr = numf(g.onehr_1), two = numf(g.twohr_1), day = numf(g.dailyfla_1), mo = numf(g.regmonth_1);
  return { c, cap: Math.round(numf(g.regcap_1)), type: (String(g.g_l_1 || '').toUpperCase().startsWith('G') ? 'Garage' : 'Lot'),
    addr: (g.address_1 || g.name2_1 || g.owner || '').trim(), hr, paid: hr > 0 || two > 0 || day > 0 || mo > 0 };
}).filter((g) => g && g.addr && g.cap >= 25);

// ---- assemble per Analysis-Neighborhood ----
const out = {};
let withMix = 0, withGar = 0;
for (const f of geo.features) {
  const nh = f.properties.nhood, rings = ringsOf(f);
  const mix = await curbMix(rings);
  const garages = gpts.filter((g) => pip(g.c, rings))
    .sort((a, b) => (b.paid - a.paid) || (b.cap - a.cap)).slice(0, 4)
    .map((g) => ({ addr: g.addr, type: g.type, cap: g.cap, hr: g.hr > 0 ? g.hr : null }));
  out[slug(nh)] = { hood: nh, mix, garages };
  if (mix) withMix++; if (garages.length) withGar++;
  log(`  ${nh}: mix=${mix ? mix.rpp + '%rpp/' + mix.general + '%gen' : '—'} garages=${garages.length}`);
}
writeFileSync(new URL('../data/hood-enrich.json', import.meta.url),
  JSON.stringify({ _meta: { generated: new Date().toISOString(), source: 'SFMTA Digital Curb (ArcGIS) curb-mix by geometry + DataSF mizu-nf6z off-street parking' }, hoods: out }));
log(`done — ${Object.keys(out).length} hoods, ${withMix} with curb-mix, ${withGar} with garages`);
