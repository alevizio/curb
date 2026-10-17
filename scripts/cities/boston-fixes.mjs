// Fixes to the City's data before it reaches the Boston map, applied by scripts/cities/boston.mjs and recorded,
// one by one, in data/boston/fixes.json (shown at /boston/fixes). Pure functions only: the basemap's streets are read
// by scripts/cities/boston-basemap-streets.mjs.
//
//   1. Street names: the schedule's own spelling is shown ("East Eighth St", not SAM's "E Eighth St"), except where
//      it is wrong: RENAME. Cross street names come from SAM, in capitals, so titleCase writes them for people.
//   2. Block lines: every block's line (a SAM centerline) is sampled every 3 m against the streets the basemap is drawn
//      from (OpenStreetMap). A block that runs along a pedestrian street, or mostly where the basemap has no street, is
//      left off the map (classify), unless the Curb Lab's signs post parking rules on it.
//   3. The zoomed out view (lib/city-boston.js overview) draws each block's real line: shortcut() measures how far the
//      old straight line from one end to the other strayed from it.

// The schedule's spelling → the street's name, for names that are wrong in the schedule (checked against SAM).
export const RENAME = {
  'Thonrdike St': ['Thorndike St', 'a typo in the schedule'],
  'Merill St': ['Merrill St', 'a typo in the schedule'],
  'Patson Ave': ['Payson Ave', 'a typo in the schedule'],
  'Wenoah St': ['Wenonah St', 'a typo in the schedule'],
  'Yawkey Way': ['Jersey St', 'renamed Jersey Street in 2018; the schedule still has the old name'],
  'REV R A BURKE ST': ['Rev Richard A Burke St', 'written in capitals with initials in the schedule'],
  'Martin Luther King Blvd': ['Martin Luther King Jr Blvd', 'the schedule leaves out "Jr"'],
  'Harborview St': ['Harbor View St', 'one word in the schedule, two in the City\'s street list'],
  'La Grange St': ['LaGrange St', 'two words in the schedule, one in the City\'s street list'],
  'Newcroft Cr': ['Newcroft Cir', 'the schedule abbreviates Circle as "Cr"'],
};

// "ALLEN'S ALY" → "Allen's Aly", "MCLELLAN ST" → "McLellan St", "E 9TH ST" → "E 9th St" (SAM names are capitals).
export const titleCase = (s) => String(s || '').toLowerCase()
  .replace(/\b([a-z])/g, (m) => m.toUpperCase())
  .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, n, x) => n + x.toLowerCase())
  .replace(/(\w)'S\b/g, "$1's")
  .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());

// Local meters around Boston (the build's projection).
const LAT0 = 42.33, LON0 = -71.07, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];

// One spelling for a street on both sides: "Essex Street" (OpenStreetMap) and "Essex St" (the schedule) match.
const WORD = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', PLACE: 'PL', TERRACE: 'TER', COURT: 'CT', SQUARE: 'SQ', BOULEVARD: 'BLVD',
  DRIVE: 'DR', LANE: 'LN', CIRCLE: 'CIR', PARKWAY: 'PKWY', HIGHWAY: 'HWY', WHARF: 'WHRF', PLAZA: 'PLZ', ALLEY: 'ALY', SAINT: 'ST',
  MOUNT: 'MT', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', GREEN: 'GRN' };
export const nameKey = (s) => String(s || '').toUpperCase().replace(/[.,'’"]/g, '').split(/\s+/).filter(Boolean).map((w) => WORD[w] || w).join(' ');

// The basemap's streets ({k: kind, d: detail, n: name, c: [[lng,lat]]}, Protomaps "roads") in a 40 m grid. A street for
// cars counts within 7 m of its centerline (10 m for a major road, which is wider); a pedestrian street within 5 m.
const CELL = 40;
const isCar = (r) => r.k === 'highway' || r.k === 'major_road' || r.k === 'minor_road' || (r.k === 'other' && /living_street|busway/.test(r.d));
const isWalk = (r) => r.k === 'path' && /pedestrian|footway|path|steps|corridor/.test(r.d) && !/sidewalk|crossing/.test(r.d);
export function streetIndex(streets) {
  const grid = new Map();
  for (const r of streets) {
    const car = isCar(r);
    if (!car && !isWalk(r)) continue;
    const s = { car, key: nameKey(r.n), tol: car ? (r.k === 'minor_road' || r.k === 'other' ? 7 : 10) : 5 };
    const p = r.c.map(xy);
    for (let i = 1; i < p.length; i++) {
      const [x1, y1] = p[i - 1], [x2, y2] = p[i];
      for (let cx = Math.floor(Math.min(x1, x2) / CELL); cx <= Math.floor(Math.max(x1, x2) / CELL); cx++)
        for (let cy = Math.floor(Math.min(y1, y2) / CELL); cy <= Math.floor(Math.max(y1, y2) / CELL); cy++) {
          const k = cx + ',' + cy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([x1, y1, x2, y2, s]);
        }
    }
  }
  return grid;
}

// How a block's line sits on the basemap: the share of its length on a street for cars (or within 15 m of one with
// its own name: SAM and OpenStreetMap draw some wide streets a few meters apart), the share on a pedestrian street
// only, and its farthest point from any street for cars (meters, capped at 60).
export function streetFit(g, grid, name) {
  const key = nameKey(name), p = g.map(xy);
  let n = 0, car = 0, walk = 0, worst = 0;
  const probe = (px, py) => {
    let onCar = false, onWalk = false, d0 = 60;
    for (let cx = Math.floor(px / CELL) - 1; cx <= Math.floor(px / CELL) + 1; cx++)
      for (let cy = Math.floor(py / CELL) - 1; cy <= Math.floor(py / CELL) + 1; cy++)
        for (const [x1, y1, x2, y2, s] of grid.get(cx + ',' + cy) || []) {
          const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
          const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
          const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
          if (s.car) { if (d <= s.tol || (d <= 15 && s.key === key)) onCar = true; if (d < d0) d0 = d; }
          else if (d <= s.tol) onWalk = true;
        }
    n++;
    if (onCar) car++; else if (onWalk) walk++;
    if (d0 > worst) worst = d0;
  };
  for (let i = 1; i < p.length; i++) {
    const [x1, y1] = p[i - 1], [x2, y2] = p[i], steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3));
    for (let s = 0; s < steps; s++) probe(x1 + (x2 - x1) * (s + 0.5) / steps, y1 + (y2 - y1) * (s + 0.5) / steps);
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  return { car: r2(car / n), walk: r2(walk / n), worst: Math.round(worst * 10) / 10 };
}

// 'pedestrian' (it runs along a pedestrian street), 'off-map' (most of it has no street under it on the basemap) or null.
export function classify(fit) {
  if (fit.walk >= 0.6 || (fit.car < 0.5 && fit.walk > fit.car)) return 'pedestrian';
  if (fit.car < 0.5) return 'off-map';
  return null;
}
// Curb Lab layers that mean people park on that curb (no stopping and snow emergency signs don't).
export const PARKING_LAYERS = ['paid', 'permit', 'loading', 'accessible', 'limit'];

// How far (meters) a block's line strays from the straight line between its ends: what the zoomed out view used to draw.
export function shortcut(g) {
  const p = g.map(xy), a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let m = 0;
  for (const q of p) {
    const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
    m = Math.max(m, Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy));
  }
  return Math.round(m * 10) / 10;
}
