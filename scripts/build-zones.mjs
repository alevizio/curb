#!/usr/bin/env node
// Precompute the meter/loading-zone asset for CURB: every active on-street meter's
// coordinates plus the color-curb zones with their operating rules — so the Layers
// toggles load one cached static file instead of ~3MB of live Socrata rows.
//
//   data/zones.json = { "_meta": {...},
//     "meters": [[lat,lng], ...],                      // 4-decimal (~11m) precision
//     "zones":  [[lat,lng,color,days,from,to,limit], ...] }
//
// Run: npm run build:zones   (Node 18+, no deps)

const METER = 'https://data.sfgov.org/resource/8vzz-qzz9.json';
const RULES = 'https://data.sfgov.org/resource/6cqg-dxku.json';
const log = (...a) => console.error('[zones]', ...a);

async function getAll(base, params) {
  const PAGE = 25000, rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const u = new URL(base);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    u.searchParams.set('$limit', PAGE);
    u.searchParams.set('$offset', offset);
    const r = await fetch(u, { headers: { 'User-Agent': 'curb-zones-build' } });
    if (!r.ok) throw new Error(r.status);
    const page = await r.json();
    rows.push(...page);
    log(`  ${base.split('/').pop()} +${page.length} (${rows.length})`);
    if (page.length < PAGE) break;
  }
  return rows;
}

const [meters, rules] = await Promise.all([
  getAll(METER, { '$select': 'post_id,latitude,longitude', '$where': "latitude IS NOT NULL AND on_offstreet_type='ON'", '$order': 'post_id' }),
  getAll(RULES, { '$select': 'post_id,applied_color_rule,days_applied,from_time,to_time,time_limit,priority',
    '$where': "applied_color_rule like 'White%' OR applied_color_rule like 'Yellow%' OR applied_color_rule like 'Red%' OR applied_color_rule like 'Green%' OR applied_color_rule like 'Orange%'",
    '$order': 'post_id' }),
]);

const loc = {};
meters.forEach(m => { if (m.post_id && m.latitude) loc[m.post_id] = [+(+m.latitude).toFixed(4), +(+m.longitude).toFixed(4)]; });

const best = {};
rules.forEach(x => {
  const ll = loc[x.post_id]; if (!ll) return;
  const pr = parseInt(x.priority, 10) || 9;
  if (best[x.post_id] && best[x.post_id]._pr <= pr) return;
  best[x.post_id] = { _pr: pr, row: [ll[0], ll[1], (x.applied_color_rule || '').split(' ')[0],
    x.days_applied || '', x.from_time || '', x.to_time || '', x.time_limit || ''] };
});

const out = {
  _meta: { generated: new Date().toISOString(), meters: Object.keys(loc).length, zones: Object.keys(best).length,
    source: 'DataSF 8vzz-qzz9 (meters) ⋈ 6cqg-dxku (operating schedules)' },
  meters: Object.values(loc),
  zones: Object.values(best).map(b => b.row),
};
const fs = await import('node:fs');
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const url = new URL('../data/zones.json', import.meta.url);
fs.writeFileSync(url, JSON.stringify(out));
log(`done — ${out._meta.meters} meters, ${out._meta.zones} zones, ${(fs.statSync(url).size / 1024).toFixed(0)}KB`);
