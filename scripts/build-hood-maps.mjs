#!/usr/bin/env node
// Build per-neighborhood map snapshots for the SEO hood pages.
//   data/neighborhoods.geojson — cached snapshot of SF's 41 Analysis Neighborhood polygons
//   data/hood-maps.json        — { <slug>: { vb, d, blocks } }  amber-on-paper street network
//
// Each block in data/overview.json (a swept-street centerline) is assigned to a neighborhood
// by point-in-polygon on its midpoint, then that hood's network is projected + drawn as one
// amber path on paper. build-hood-pages.mjs inlines these in the index grid + page heroes.
//
// Source: DataSF "Analysis Neighborhoods" j2bu-swwd (canonical, plain SODA geojson). The
// Map-type p5b7-5n3h export is dead; ArcGIS Analysis_Neighborhoods/0 is the fallback. Per the
// white-zones note, we SNAPSHOT at build time (never query live from clients).
//
// Run: node scripts/build-hood-maps.mjs            (uses cached geojson if present)
//      node scripts/build-hood-maps.mjs --refresh  (re-fetch boundaries)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const GEO = new URL('data/neighborhoods.geojson', ROOT);
const SOURCES = [
  'https://data.sfgov.org/resource/j2bu-swwd.geojson?$limit=100',
  'https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Analysis_Neighborhoods/FeatureServer/0/query?where=1=1&outFields=nhood&f=geojson&returnGeometry=true',
];

const slug = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.ok) return await r.json();
    } catch (_) { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error('fetch failed after retries: ' + url);
}

async function loadNeighborhoods() {
  if (existsSync(GEO) && !process.argv.includes('--refresh')) {
    const gj = JSON.parse(readFileSync(GEO, 'utf8'));
    if (gj.features?.length >= 30) { console.log(`[hood-maps] using cached ${GEO.pathname.split('/').pop()} (${gj.features.length})`); return gj; }
  }
  for (const url of SOURCES) {
    try {
      const gj = await getJSON(url);
      const feats = (gj.features || []).filter((f) => f.geometry && f.geometry.coordinates && f.properties?.nhood);
      if (feats.length >= 30) {
        const out = { type: 'FeatureCollection', features: feats };
        writeFileSync(GEO, JSON.stringify(out));
        console.log(`[hood-maps] fetched ${feats.length} neighborhoods from ${new URL(url).host} → cached`);
        return out;
      }
    } catch (e) { console.log('[hood-maps] source failed:', e.message); }
  }
  throw new Error('no working neighborhood-boundary source');
}

// ---- point-in-polygon ----
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPoly = (x, y, rings) => {                   // rings[0]=outer, rest=holes
  if (!inRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false;
  return true;
};

// normalize a GeoJSON feature to { name, polys:[rings...], bbox:[mnLng,mnLat,mxLng,mxLat] }
const toHood = (f) => {
  const g = f.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  let mnLng = 180, mnLat = 90, mxLng = -180, mxLat = -90;
  for (const p of polys) for (const [lng, lat] of p[0]) {
    if (lng < mnLng) mnLng = lng; if (lng > mxLng) mxLng = lng;
    if (lat < mnLat) mnLat = lat; if (lat > mxLat) mxLat = lat;
  }
  return { name: f.properties.nhood, polys, bbox: [mnLng, mnLat, mxLng, mxLat] };
};

const hoodAt = (lng, lat, hoods) => {
  for (const h of hoods) {
    const [a, b, c, d] = h.bbox;
    if (lng < a || lng > c || lat < b || lat > d) continue;
    for (const rings of h.polys) if (inPoly(lng, lat, rings)) return h.name;
  }
  return null;
};

// ---- projection + amber-on-paper render (the chosen style) ----
const W = 300, H = 130, PAD = 9, STROKE = 1.7, PAPER = '#F2ECDF', AMBER = '#E08A1E';
const renderAmber = (segs) => {
  let mnLng = 180, mxLng = -180, mnLat = 90, mxLat = -90;
  for (const s of segs) for (const p of [s.a, s.b]) {
    if (p[0] < mnLng) mnLng = p[0]; if (p[0] > mxLng) mxLng = p[0];
    if (p[1] < mnLat) mnLat = p[1]; if (p[1] > mxLat) mxLat = p[1];
  }
  const midLat = (mnLat + mxLat) / 2, kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((mxLng - mnLng) * kx, 1e-6), spanY = Math.max(mxLat - mnLat, 1e-6);
  const iw = W - PAD * 2, ih = H - PAD * 2;
  const scale = Math.min(iw / spanX, ih / spanY);
  const offX = PAD + (iw - spanX * scale) / 2, offY = PAD + (ih - spanY * scale) / 2;
  const px = (lng, lat) => [
    +(offX + (lng - mnLng) * kx * scale).toFixed(1),
    +(offY + (mxLat - lat) * scale).toFixed(1),
  ];
  const d = segs.map((s) => { const [x1, y1] = px(s.a[0], s.a[1]); const [x2, y2] = px(s.b[0], s.b[1]); return `M${x1} ${y1}L${x2} ${y2}`; }).join('');
  return { vb: `0 0 ${W} ${H}`, d };
};

// ---- main ----
const gj = await loadNeighborhoods();
const hoods = gj.features.map(toHood);
const ov = JSON.parse(readFileSync(new URL('data/overview.json', ROOT), 'utf8'));

const segsByHood = new Map();
let assigned = 0;
for (const b of ov.b) {
  const mLng = (b[0] + b[2]) / 2, mLat = (b[1] + b[3]) / 2;
  const name = hoodAt(mLng, mLat, hoods);
  if (!name) continue;
  assigned++;
  (segsByHood.get(name) || segsByHood.set(name, []).get(name)).push({ a: [b[0], b[1]], b: [b[2], b[3]] });
}

const maps = {};
const thin = [];
for (const h of hoods) {
  const segs = segsByHood.get(h.name) || [];
  if (segs.length < 8) { thin.push(`${h.name} (${segs.length})`); }
  maps[slug(h.name)] = { ...renderAmber(segs.length ? segs : [{ a: [h.bbox[0], h.bbox[1]], b: [h.bbox[2], h.bbox[3]] }]), blocks: segs.length, bbox: h.bbox.map((n) => +n.toFixed(5)) };
}
writeFileSync(new URL('data/hood-maps.json', ROOT), JSON.stringify(maps));
console.log(`[hood-maps] assigned ${assigned}/${ov.b.length} blocks → ${Object.keys(maps).length} hood snapshots`);
if (thin.length) console.log(`[hood-maps] sparse hoods (parks/islands): ${thin.join(', ')}`);
