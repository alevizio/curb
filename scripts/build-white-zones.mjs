#!/usr/bin/env node
// Snapshot SF passenger-loading (white curb) zones → data/white-zones.json
// Primary: SFMTA Digital Curb policies (ArcGIS, actively maintained, anonymous access) —
//   the inventory DataSF's hi6h-neyh explicitly excludes ("except non-metered color curb").
// Enrichment: MTA.colorcurb points (ZONE_SPECS text, ~2021 snapshot) + schools (7e7j-59qk)
//   for school tagging. Build-time snapshot insulates the app from this undocumented feed.
// Run: npm run build:whitezones   (Node 18+, no deps; ~30s)

const CURBS = 'https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Curb_Zones_with_All_Policies/FeatureServer/0/query';
const COLOR = 'https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Curb_Color_Locations_WFL1/FeatureServer/0/query';
const SCHOOLS = 'https://data.sfgov.org/resource/7e7j-59qk.json';
const log = (...a) => console.error('[white-zones]', ...a);

async function getJSON(base, params) {
  const u = new URL(base);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'curb-guide-build' } });
      if (r.ok) return await r.json();
    } catch (e) { /* retry */ }
    await new Promise(s => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error('fetch failed: ' + u);
}

// ---- 1) page through Digital Curb passenger/accessible-loading policies ----
log('fetching Digital Curb loading policies…');
const FIELDS = 'CZ_ID,ST_NAME,X_STREET_1,X_STREET_2,SIDE_ST,LENGTH_FT,PCY_CAT,DAYS_WEEK,TOD_ST_STR,TOD_ED_STR,MX_STAY,MX_STAY_UN,NHOOD';
const feats = [];
for (let off = 0; ; off += 2000) {
  const d = await getJSON(CURBS, {
    where: "PCY_CAT IN ('Passenger Loading','Accessible Loading')",
    outFields: FIELDS, f: 'geojson', resultRecordCount: 2000, resultOffset: off,
  });
  feats.push(...(d.features || []));
  log(`  +${(d.features || []).length} (${feats.length})`);
  if (!(d.features || []).length || !d.properties?.exceededTransferLimit && (d.features || []).length < 2000) break;
}

// ---- 2) group policy rows by curb zone; merge identical time windows across days ----
const DOW_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const dayLabel = days => {
  const idx = days.map(d => DOW_ORDER.indexOf(d)).filter(i => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return 'daily';
  if (idx.length === 7) return 'daily';
  const consec = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  const cap = s => s[0].toUpperCase() + s.slice(1);
  if (consec && idx.length > 2) return `${cap(DOW_ORDER[idx[0]])}–${cap(DOW_ORDER[idx[idx.length - 1]])}`;
  return idx.map(i => cap(DOW_ORDER[i])).join(', ');
};
const fmtT = s => { // "07:30" -> "7:30am"
  if (!s || !s.includes(':')) return s || '';
  let [h, m] = s.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
};
const zones = new Map();
for (const f of feats) {
  const p = f.properties;
  if (!f.geometry || !p.CZ_ID) continue;
  let z = zones.get(p.CZ_ID);
  if (!z) {
    const coords = (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.flat() : f.geometry.coordinates)
      .map(c => [+c[1].toFixed(6), +c[0].toFixed(6)]);
    z = { st: p.ST_NAME, x1: p.X_STREET_1, x2: p.X_STREET_2, side: p.SIDE_ST,
      ft: Math.round(p.LENGTH_FT || 0), cat: p.PCY_CAT === 'Accessible Loading' ? 'A' : 'P',
      nh: p.NHOOD, line: coords, wins: new Map() };
    zones.set(p.CZ_ID, z);
  }
  const mx = p.MX_STAY ? `${+p.MX_STAY}${(p.MX_STAY_UN || 'min').trim().toLowerCase().startsWith('h') ? 'hr' : 'min'}` : '';
  const key = `${p.TOD_ST_STR}|${p.TOD_ED_STR}|${mx}`;
  const w = z.wins.get(key) || { f: p.TOD_ST_STR, t: p.TOD_ED_STR, mx, days: new Set() };
  String(p.DAYS_WEEK || '').trim().toLowerCase().split(/[,\s]+/).filter(Boolean).forEach(d => w.days.add(d));
  z.wins.set(key, w);
}
log(`${zones.size} distinct zones from ${feats.length} policy rows`);

// ---- 3) enrichment: school proximity + colorcurb ZONE_SPECS text ----
log('fetching schools + colorcurb white points…');
const schools = (await getJSON(SCHOOLS, { $select: 'school,latitude,longitude', $where: 'latitude IS NOT NULL', $limit: 1000 }))
  .map(s => ({ n: s.school, la: +s.latitude, lo: +s.longitude })).filter(s => s.la && s.lo);
const pts = [];
for (let off = 0; ; off += 2000) {
  const d = await getJSON(COLOR, {
    where: "UPPER(ZONE_TYPE) LIKE '%WHITE%'", outFields: 'ZONE_SPECS', f: 'geojson',
    resultRecordCount: 2000, resultOffset: off,
  });
  (d.features || []).forEach(f => {
    const c = f.geometry?.coordinates; if (!c) return;
    const [lo, la] = Array.isArray(c[0]) ? c[0] : c;
    pts.push({ la, lo, spec: f.properties.ZONE_SPECS || '' });
  });
  if (!(d.features || []).length || (d.features || []).length < 2000) break;
}
log(`${schools.length} schools, ${pts.length} white colorcurb points`);
const dist2 = (a, b, la, lo) => { const kx = 111320 * Math.cos(a * Math.PI / 180); const dy = (a - la) * 110540, dx = (b - lo) * kx; return dy * dy + dx * dx; };

const out = [];
for (const z of zones.values()) {
  const mid = z.line[Math.floor(z.line.length / 2)];
  let school = null, best = 150 * 150;
  for (const s of schools) { const d = dist2(mid[0], mid[1], s.la, s.lo); if (d < best) { best = d; school = s.n; } }
  let spec = null; best = 25 * 25;
  for (const pt of pts) { const d = dist2(mid[0], mid[1], pt.la, pt.lo); if (d < best) { best = d; spec = pt.spec; } }
  const sched = [...z.wins.values()].map(w => ({ d: dayLabel([...w.days]), f: fmtT(w.f), t: fmtT(w.t), mx: w.mx }))
    .sort((a, b) => (a.f || '').localeCompare(b.f || ''));
  const schoolish = !!school || /school/i.test(spec || '') || sched.some(w => /school/i.test(w.d));
  out.push({ st: z.st, x1: z.x1, x2: z.x2, side: z.side, ft: z.ft, cat: z.cat, nh: z.nh,
    sch: schoolish ? (school || 'school zone') : null, spec, sched, line: z.line });
}

const fs = await import('node:fs');
const url = new URL('../data/white-zones.json', import.meta.url);
const doc = { _meta: { generated: new Date().toISOString(),
  source: 'SFMTA Digital Curb (ArcGIS Curb_Zones_with_All_Policies) + MTA.colorcurb + DataSF schools',
  note: 'Passenger + accessible loading curb zones. Snapshot of an undocumented public feed — signs govern.' },
  zones: out };
fs.writeFileSync(url, JSON.stringify(doc));
log(`done — ${(fs.statSync(url).size / 1024).toFixed(0)}KB, ${out.length} zones, ${out.filter(z => z.sch).length} school-tagged`);
