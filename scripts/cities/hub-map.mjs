#!/usr/bin/env node
// The North America outlines behind curb.guide/cities and under every map's zoomed out view, drawn from Natural Earth
// (public domain, naturalearthdata.com), self-hosted: no tile service.
//   basemap/north-america.svg   the /cities map (scripts/cities/city-pages.mjs puts a pin on it per city): land, the Great
//                               Lakes, country and state lines in the parchment style, an Albers projection of the
//                               contiguous US and southern Canada
//   basemap/north-america.json  the same outlines in longitude and latitude, simplified, for the maps' zoomed out view
//                               (index.html loads it once a map is zoomed out past its city)
// The Natural Earth files are cached in private/cache/natural-earth/ (gitignored): fetched when missing, again with --refresh.
// Run: node scripts/cities/hub-map.mjs [--refresh], then scripts/cities/city-pages.mjs (the hub's ?v= follows the SVG).
// When north-america.json changes, bump its ?v= in index.html (basemap/ is cached for 30 days) and rebuild the city pages.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CACHE = ROOT + 'private/cache/natural-earth/';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const FILES = { land: 'ne_50m_admin_0_countries_lakes', states: 'ne_50m_admin_1_states_provinces_lines' };

// ---- the /cities map: Albers equal area (the USGS parallels), framed on the contiguous US and southern Canada ----
const D = Math.PI / 180, P1 = 29.5 * D, P2 = 45.5 * D, LAT0 = 37.5 * D, LNG0 = -96 * D;
const N = (Math.sin(P1) + Math.sin(P2)) / 2, C = Math.cos(P1) ** 2 + 2 * N * Math.sin(P1), RHO0 = Math.sqrt(C - 2 * N * Math.sin(LAT0)) / N;
function albers(lng, lat) {
  const rho = Math.sqrt(C - 2 * N * Math.sin(lat * D)) / N, t = N * (lng * D - LNG0);
  return [rho * Math.sin(t), RHO0 - rho * Math.cos(t)];
}
// The frame: every point of this box of longitude and latitude, projected, fits the picture.
const BOX = { west: -125.5, east: -65.5, south: 23.5, north: 50.5 };
export const W = 1000;
const edge = [];
for (let i = 0; i <= 60; i++) {
  const lng = BOX.west + ((BOX.east - BOX.west) * i) / 60, lat = BOX.south + ((BOX.north - BOX.south) * i) / 60;
  edge.push(albers(lng, BOX.south), albers(lng, BOX.north), albers(BOX.west, lat), albers(BOX.east, lat));
}
const X0 = Math.min(...edge.map((p) => p[0])), X1 = Math.max(...edge.map((p) => p[0]));
const Y0 = Math.min(...edge.map((p) => p[1])), Y1 = Math.max(...edge.map((p) => p[1]));
const K = W / (X1 - X0);
export const H = Math.round((Y1 - Y0) * K);
/** Longitude and latitude to a point of the /cities map, in its pixels (0..W, 0..H; north is up). */
export function project(lng, lat) {
  const [x, y] = albers(lng, lat);
  return [(x - X0) * K, H - (y - Y0) * K];
}

// ---- geometry helpers ----------------------------------------------------------------------------------------------
// Douglas-Peucker on [x, y] points (any units), keeping both ends.
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let far = -1, fd = t2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      const d = (px - ax - u * dx) ** 2 + (py - ay - u * dy) ** 2;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// A closed ring clipped to the rectangle [x0, y0, x1, y1] (Sutherland-Hodgman: right for any ring, the window is convex).
export function clipRing(ring, [x0, y0, x1, y1]) {
  let out = ring;
  const sides = [[(p) => p[0] >= x0, (a, b) => cut(a, b, 0, x0)], [(p) => p[0] <= x1, (a, b) => cut(a, b, 0, x1)],
    [(p) => p[1] >= y0, (a, b) => cut(a, b, 1, y0)], [(p) => p[1] <= y1, (a, b) => cut(a, b, 1, y1)]];
  for (const [inside, at] of sides) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) out.push(at(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(at(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}
function cut(a, b, k, v) { const t = (v - a[k]) / (b[k] - a[k]); return k === 0 ? [v, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), v]; }
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; s += x1 * y2 - x2 * y1; } return s / 2; };
// A line clipped to a rectangle: the runs of points inside it (each run keeps one point past each end, so it reaches the edge).
function clipLine(pts, [x0, y0, x1, y1]) {
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const runs = []; let run = null;
  pts.forEach((p, i) => {
    if (inside(p)) { if (!run) { run = i ? [pts[i - 1]] : []; runs.push(run); } run.push(p); }
    else if (run) { run.push(p); run = null; }
  });
  return runs.filter((r) => r.length > 1);
}
const rings = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const lines = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

async function load(name, refresh) {
  const file = CACHE + name + '.geojson';
  if (refresh || !fs.existsSync(file)) {
    const r = await fetch(NE + name + '.geojson');
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---- the parchment style: the map's own colors (an <img> can't read the page's CSS) ---------------------------------
const STYLE = { water: '#E3D8C2', land: '#FBF7EF', other: '#F3EDE0', coast: 'rgba(23,21,15,.5)', state: 'rgba(23,21,15,.2)' };
const MAIN = new Set(['USA', 'CAN']);   // the two countries CURB maps; their neighbors are drawn a shade darker

/** The /cities map as an SVG document. */
export function mapSvg(land, states) {
  const win = [-4, -4, W + 4, H + 4], fmt = (v) => Math.round(v * 10) / 10;
  // relative steps between the ROUNDED points, so rounding never adds up along a long coastline
  const path = (rs, closed) => rs.map((r) => 'M' + r.map(([x, y], i) => {
    if (!i) return fmt(x) + ' ' + fmt(y);
    const [px, py] = r[i - 1];
    return 'l' + fmt(fmt(x) - fmt(px)) + ' ' + fmt(fmt(y) - fmt(py));
  }).join('') + (closed ? 'z' : '')).join('');
  const groups = { main: [], other: [] };
  for (const f of land.features) {
    const own = MAIN.has(f.properties.ADM0_A3) ? 'main' : 'other';
    for (const poly of rings(f.geometry)) for (const ring of poly) {
      const r = simplify(clipRing(ring.map(([lo, la]) => project(lo, la)), win), 0.45);
      if (r.length > 2 && Math.abs(area(r)) > 1.5) groups[own].push(r);
    }
  }
  const stateRuns = [];
  for (const f of states.features) {
    if (!MAIN.has(f.properties.ADM0_A3)) continue;
    for (const l of lines(f.geometry)) for (const run of clipLine(l.map(([lo, la]) => project(lo, la)), win)) {
      const r = simplify(run, 0.45);
      if (r.length > 1) stateRuns.push(r);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<!-- GENERATED by scripts/cities/hub-map.mjs from Natural Earth (public domain). Do not edit. -->
<rect width="${W}" height="${H}" fill="${STYLE.water}"/>
<path d="${path(groups.other, true)}" fill="${STYLE.other}" fill-rule="evenodd" stroke="${STYLE.coast}" stroke-width="1" stroke-linejoin="round"/>
<path d="${path(groups.main, true)}" fill="${STYLE.land}" fill-rule="evenodd" stroke="${STYLE.coast}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="${path(stateRuns, false)}" fill="none" stroke="${STYLE.state}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/>
</svg>
`;
}

// ---- the maps' zoomed out view: longitude and latitude, rounded, simplified -----------------------------------------
// The window the zoomed out view can show (North America and its seas) and how far a simplified line may stray: 0.02°
// is about 2 px at zoom 7, the closest the view is drawn.
const GEO_WIN = [-140, 5, -50, 66], GEO_TOL = 0.02;
/** { land: [[ring, hole...], ...], states: [line, ...] } with [lng, lat] rounded to 3 decimals. */
export function mapGeo(land, states) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const fix = (r) => r.map(([x, y]) => [r3(x), r3(y)]);
  const out = { land: [], states: [] };
  for (const f of land.features) for (const poly of rings(f.geometry)) {
    const kept = [];
    for (const ring of poly) {
      const r = simplify(clipRing(ring.map((p) => [p[0], p[1]]), GEO_WIN), GEO_TOL);
      if (r.length > 2 && Math.abs(area(r)) > 0.02) kept.push(fix(r));
      else if (!kept.length) break;   // an outer ring too small (or outside) takes its holes with it
    }
    if (kept.length) out.land.push(kept);
  }
  for (const f of states.features) {
    if (!MAIN.has(f.properties.ADM0_A3)) continue;
    for (const l of lines(f.geometry)) for (const run of clipLine(l, GEO_WIN)) {
      const r = simplify(run, GEO_TOL);
      if (r.length > 1) out.states.push(fix(r));
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const refresh = process.argv.includes('--refresh');
  const land = await load(FILES.land, refresh), states = await load(FILES.states, refresh);
  const svg = mapSvg(land, states), geo = mapGeo(land, states);
  fs.writeFileSync(ROOT + 'basemap/north-america.svg', svg);
  fs.writeFileSync(ROOT + 'basemap/north-america.json', JSON.stringify({
    _meta: { source: 'Natural Earth 1:50m (public domain): admin 0 countries without boundary lakes, admin 1 state and province lines', by: 'scripts/cities/hub-map.mjs' },
    ...geo }) + '\n');
  console.error(`[hub-map] wrote basemap/north-america.svg (${W}x${H}, ${Math.round(svg.length / 1024)} KB) and basemap/north-america.json (${Math.round(fs.statSync(ROOT + 'basemap/north-america.json').size / 1024)} KB)`);
}
