// The city's citation feed (DataSF ab4h-6ztd) gets the hour wrong for every ticket written between
// 12:00 and 12:59 AM: the hour becomes the first digit of the minute (00:24 shows as 02:24, 00:05 as
// 05:05). Checked 11 Oct 2026 against the SFMTA records file (#26-5453), which has the right times:
// 50,447 of the 50,464 midnight tickets in both show that exact pattern in the feed.
//
// A feed time alone can't tell a wrong 00:24 from a real 02:24, so look at the ticket's block: if
// 00:MM falls inside a posted sweeping window there that weekday, the ticket was written at midnight.
// Tested on the 78,472 lookalike tickets with a known true hour: 89% get the right hour, vs 36% as-is.

const TOL_M = 40;   // ticket -> block tolerance, same as build-enforcement-records.py
const CELL = 100;   // grid cell (meters) for the nearest-block lookup
const LAT0 = 37.7749, LON0 = -122.4194;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110540;
const DAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const xy = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const cell = (v) => Math.floor(v / CELL);

// True when a feed time hh:mi could be a midnight ticket shown at the wrong hour.
export const looksMisdated = (hh, mi) => hh !== 0 && hh === (mi >= 10 ? Math.floor(mi / 10) : mi);

// rows: DataSF yhqp-riqs {cnn, weekday, fromhour, tohour, line} -> posted windows + a segment grid.
export function sweepIndex(rows) {
  const win = new Map();    // cnn -> Map(jsDow -> [[fromMin, toMin], ...])
  const grid = new Map();   // "cx,cy" -> [[x1, y1, x2, y2, cnn], ...]
  const drawn = new Set();
  for (const r of rows) {
    const cnn = r.cnn; if (!cnn) continue;
    const dow = DAY[String(r.weekday || '').trim().toLowerCase().slice(0, 3)];
    const fr = Math.trunc(parseFloat(r.fromhour)), to = Math.trunc(parseFloat(r.tohour));
    if (dow !== undefined && Number.isFinite(fr) && Number.isFinite(to)) {
      const byDow = win.get(cnn) || win.set(cnn, new Map()).get(cnn);
      (byDow.get(dow) || byDow.set(dow, []).get(dow)).push([fr * 60, (to > fr ? to : to + 24) * 60]);
    }
    if (drawn.has(cnn) || !r.line?.coordinates?.length) continue;
    drawn.add(cnn);
    const pts = r.line.coordinates.map(([lon, lat]) => xy(lon, lat));
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      for (let cx = cell(Math.min(x1, x2) - TOL_M); cx <= cell(Math.max(x1, x2) + TOL_M); cx++)
        for (let cy = cell(Math.min(y1, y2) - TOL_M); cy <= cell(Math.max(y1, y2) + TOL_M); cy++) {
          const k = `${cx},${cy}`;
          (grid.get(k) || grid.set(k, []).get(k)).push([x1, y1, x2, y2, cnn]);
        }
    }
  }
  return { win, grid };
}

function nearestCnn(grid, lon, lat) {
  const [px, py] = xy(lon, lat);
  let best = null, bestD = TOL_M;
  for (const [x1, y1, x2, y2, cnn] of grid.get(`${cell(px)},${cell(py)}`) || []) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const d = Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    if (d <= bestD) { bestD = d; best = cnn; }
  }
  return best;
}

// The hour to count for a feed ticket at hh:mi on jsDow and day (YYYY-MM-DD): 0 for a misdated midnight
// ticket, else hh. Days in index.fixedDays (set by build-stats) come from a fixed feed and keep their hours.
export function fixHour(index, hh, mi, lat, lon, dow, day) {
  if (!looksMisdated(hh, mi) || index.fixedDays?.has(day)) return hh;
  const la = parseFloat(lat), lo = parseFloat(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return hh;
  const cnn = nearestCnn(index.grid, lo, la);
  const windows = cnn && index.win.get(cnn)?.get(dow);
  return windows && windows.some(([a, b]) => a <= mi && mi < b) ? 0 : hh;
}
