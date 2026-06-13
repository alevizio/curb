// Pure geo helpers for the /api/parked auto-park endpoint — no I/O, so unit-testable.
// Mirrors the client's equirectangular distance math (index.html offsetLine/distSqToLineMeters).
import '../lib/sweep-core.js';
const { nextSweep } = globalThis;

// SF bounding box (padded a touch past the city limits). Coords outside this are rejected before
// any Socrata fetch — a Shortcut firing from elsewhere must never arm a watch.
const SF = { latMin: 37.69, latMax: 37.85, lngMin: -122.53, lngMax: -122.34 };
export function inSfBbox(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= SF.latMin && lat <= SF.latMax && lng >= SF.lngMin && lng <= SF.lngMax;
}

// A small closed POLYGON (lng lat ring) around a point for the Socrata intersects() query.
// `m` metres in every direction. Numbers only — never string-interpolated user text → no injection.
export function polygonAround(lat, lng, m = 60) {
  const dLat = m / 111320;
  const dLng = m / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  const a1 = lat - dLat, a2 = lat + dLat, o1 = lng - dLng, o2 = lng + dLng;
  return `POLYGON((${o1} ${a1}, ${o2} ${a1}, ${o2} ${a2}, ${o1} ${a2}, ${o1} ${a1}))`;
}

// Perpendicular distance (metres) from a point to a GeoJSON LineString (coords are [lng,lat]).
function distToLine(lat, lng, coords) {
  if (!Array.isArray(coords) || coords.length === 0) return Infinity;
  const cos = Math.cos(lat * Math.PI / 180) || 1;
  const X = (lo, la) => [(lo - lng) * cos * 111320, (la - lat) * 111320]; // metres from the point
  if (coords.length === 1) { const [x, y] = X(coords[0][0], coords[0][1]); return Math.hypot(x, y); }
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const a = X(coords[i - 1][0], coords[i - 1][1]);
    const b = X(coords[i][0], coords[i][1]);
    const vx = b[0] - a[0], vy = b[1] - a[1], len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, (-a[0] * vx - a[1] * vy) / len2));
    const px = a[0] + t * vx, py = a[1] + t * vy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

// Given yhqp-riqs rows near a point, choose the spot to watch:
//  1. nearest segment by centreline distance (must be within `maxM`, default 35m — else null),
//  2. among that segment's sides/schedules, the one whose NEXT sweep is soonest (conservative:
//     warn for the nearest upcoming sweep when we can't resolve which curb side the car is on).
// Returns { corridor, limits, blockside, cnn, sideKey, rule, ns } or null. Pure given the clock.
export function pickParkedSpot(rows, lat, lng, maxM = 35) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let bestCnn = null, bestDist = Infinity;
  for (const r of rows) {
    const coords = r.line && r.line.coordinates;
    const d = distToLine(lat, lng, coords);
    if (d < bestDist) { bestDist = d; bestCnn = r.cnn; }
  }
  if (bestCnn == null || bestDist > maxM) return null;
  const sideRows = rows.filter((r) => r.cnn === bestCnn);
  let chosen = null, chosenNs = null;
  for (const r of sideRows) {
    const ns = nextSweep(r);
    if (ns && (!chosenNs || ns.start < chosenNs.start)) { chosen = r; chosenNs = ns; }
  }
  if (!chosen || !chosenNs) return null;
  const bit = (v) => (String(v) === '1' ? '1' : '0');
  return {
    corridor: chosen.corridor || '', limits: chosen.limits || '', blockside: chosen.blockside || '',
    cnn: String(bestCnn), sideKey: String(chosen.cnnrightleft || ''),
    rule: {
      weekday: chosen.weekday, fromhour: chosen.fromhour, tohour: chosen.tohour,
      week1: bit(chosen.week1), week2: bit(chosen.week2), week3: bit(chosen.week3),
      week4: bit(chosen.week4), week5: bit(chosen.week5), holidays: bit(chosen.holidays),
    },
    ns: chosenNs,
  };
}
