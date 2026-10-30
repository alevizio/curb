// The auto-park core shared by api/parked.js (a web-push Shortcut) and api/parked-ios.js (the iPhone app's Save Parking
// Spot): the swept block nearest a parked point, as the watch to arm. No store and no push here.
import { polygonAround, pickParkedSpot } from './_geo.js';
import { sanitizeRules } from './_spot.js';
import '../lib/sweep-core.js';
const { sfWallToInstant, fmtHour, DAYLBL } = globalThis;

const SWEEP = 'https://data.sf.gov/resource/yhqp-riqs.json';

/** The swept block nearest (la, lo), which the caller has already checked is in SF → { spot (pickParkedSpot's), watch
 *  (the spot to save: it carries the side's recurring rules, so the watch re-arms itself), line ("Haight St: next sweep
 *  Wed 8AM."), body (line + " Alerts armed.", the confirmation) }, or null when no block is within reach or DataSF didn't
 *  answer. Numbers-only POLYGON, fixed trusted host (no SSRF). */
export async function parkedWatchAt(la, lo) {
  const where = `intersects(line,'${polygonAround(la, lo, 60)}')`;
  const url = `${SWEEP}?$select=cnn,corridor,limits,blockside,cnnrightleft,weekday,fromhour,tohour,week1,week2,week3,week4,week5,holidays,line&$where=${encodeURIComponent(where)}&$limit=200`;
  let rows = [];
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'curb-parked' } });
    if (r.ok) rows = await r.json();
  } catch { /* fall through → no block found */ }

  const spot = pickParkedSpot(rows, la, lo);
  if (!spot) return null;
  const ns = spot.ns;
  const prev = new Date(Date.UTC(ns.y, ns.mo - 1, ns.da) - 864e5);
  const eve = sfWallToInstant(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 20);
  const watch = {
    corridor: spot.corridor, limits: spot.limits, blockside: spot.blockside,
    nextSweepISO: ns.start.toISOString(), leadMinutes: 30,
    rule: spot.rule, rules: sanitizeRules(spot.rules), cnn: spot.cnn, sideKey: spot.sideKey,
    ...(+eve < +ns.start ? { eveningISO: eve.toISOString() } : {}),
  };
  const line = `${spot.corridor || 'This block'}: next sweep ${DAYLBL[ns.dow]} ${fmtHour(ns.fromH)}.`;
  return { spot, watch, line, body: line + ' Alerts armed.' };
}
