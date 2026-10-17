/* CURB · Boston (prototype, 2026-10-16). Loaded by boston.html right after lib/sweep-core.js.

   1. Time: Boston's instance of makeTimeCore (Eastern time, the City's holidays), attached under the names the
      page already calls (sfParts, nextSweep, alertAnchors…), so the page's SF code runs on Boston time unchanged.
   2. Data: data/boston/segments.json (scripts/cities/boston.mjs) expanded into the row shape the page reads from
      DataSF in San Francisco (cnn, corridor, limits, blockside, cnnrightleft, weekday, fromhour, tohour,
      week1..week5, line), plus `months`, the sweeping season, which the time core already understands.

   Same loading pattern as sweep-core: a plain script that attaches to globalThis, imported after sweep-core in tests
   (lib/city-boston.test.mjs). Only a page (a document) gets the SF names switched to Boston time. */
(function (root) {
  'use strict';
  const { makeTimeCore, DAYLBL } = root;
  if (!makeTimeCore) throw new Error('lib/city-boston.js needs lib/sweep-core.js loaded first');

  const TZ = 'America/New_York';
  // City of Boston holidays (boston.gov/departments/311/city-boston-holidays, read 2026-10-16): daytime street
  // cleaning is canceled, overnight street cleaning runs as normal. Evacuation Day and Bunker Hill Day are normal
  // sweeping days, so they are not here. 2027 follows the same rules (observed dates); check the page once posted.
  const HOLIDAYS = {
    '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': 'Presidents Day',
    '2026-04-20': 'Patriots Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
    '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-10-12': 'Indigenous Peoples Day',
    '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
    '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': 'Presidents Day',
    '2027-04-19': 'Patriots Day', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
    '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-10-11': 'Indigenous Peoples Day',
    '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)',
  };
  // The overnight program (windows starting before 6 AM, most of them 12:01 to 7 AM) keeps running on holidays.
  const overnight = (rec) => parseInt(rec.fromhour, 10) < 6;
  const suspended = (rec, iso) => !overnight(rec) && Object.prototype.hasOwnProperty.call(HOLIDAYS, iso);
  const core = makeTimeCore({ tz: TZ, suspended, holidayName: (iso) => HOLIDAYS[iso] || null });

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthsOf = (mask) => { const m = []; for (let i = 0; i < 12; i++) if (mask & (1 << i)) m.push(i + 1); return m; };
  // "April to November", "March to December", or null for all year
  function seasonText(months) {
    if (!Array.isArray(months) || !months.length || months.length === 12) return null;
    return MONTHS[months[0] - 1] + ' to ' + MONTHS[months[months.length - 1] - 1];
  }

  // One block of segments.json → the DataSF row shape, one row per side and weekday.
  function rowsOf(b) {
    const line = { type: 'LineString', coordinates: b.g };
    const rows = [];
    for (const [side, label, rules] of b.d) for (const [dow, fromH, toH, weeks, months, flags] of rules) {
      const row = { cnn: b.c, corridor: b.s, limits: b.l, blockside: label, cnnrightleft: side,
        weekday: DAYLBL[dow], fromhour: String(fromH), tohour: String(toH), holidays: '0',
        tow: flags & 2 ? '1' : '0', line };
      for (let i = 0; i < 5; i++) row['week' + (i + 1)] = weeks & (1 << i) ? '1' : '0';
      if (months) row.months = monthsOf(months);
      rows.push(row);
    }
    return rows;
  }
  // bbox per block, once, so a viewport filter is a cheap compare
  function index(blocks) {
    for (const b of blocks) {
      let w = 180, s = 90, e = -180, n = -90;
      for (const [lo, la] of b.g) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
      b.bb = [w, s, e, n];
    }
    return blocks;
  }
  function rowsIn(blocks, w, s, e, n) {
    const out = [];
    for (const b of blocks) { const q = b.bb; if (q[2] >= w && q[0] <= e && q[3] >= s && q[1] <= n) out.push(...rowsOf(b)); }
    return out;
  }
  // The citywide overview the page draws below street zoom: endpoints + rules, like data/overview.json.
  function overview(blocks) {
    return blocks.map((b) => {
      const f = b.g[0], l = b.g[b.g.length - 1];
      return { a: [f[1], f[0]], z: [l[1], l[0]], rules: rowsOf(b) };
    });
  }
  // House number → block and curb side: the street's blocks whose number range holds it, on the odd or even side.
  const streetKey = (s) => String(s || '').toUpperCase().replace(/[.,'’"]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/ STREET$/, ' ST').replace(/ AVENUE$/, ' AVE').replace(/ ROAD$/, ' RD');
  function findAddress(blocks, number, street) {
    const k = streetKey(street), n = +number;
    const hits = blocks.filter((b) => { const s = streetKey(b.s); return s === k || s.startsWith(k + ' '); });
    if (!hits.length || !(n > 0)) return null;
    const inRange = hits.filter((b) => b.n && n >= b.n[0] && n <= b.n[1]);
    const pool = inRange.length ? inRange : hits;
    // the closest range when none holds it (a number between two swept blocks)
    const dist = (b) => (b.n ? Math.min(Math.abs(n - b.n[0]), Math.abs(n - b.n[1])) : 1e9);
    const block = pool.slice().sort((a, b) => dist(a) - dist(b))[0];
    const lr = block.o ? (n % 2 ? block.o : block.o === 'L' ? 'R' : 'L') : null;
    const side = lr && block.d.find((x) => x[0] === lr);
    return { block, side: side ? side[1] : '', at: midpoint(block.g) };
  }
  // Halfway along a block's line, where an address search drops its pin (longitude scaled to ground distance).
  function midpoint(g) {
    const kx = Math.cos((g[0][1] * Math.PI) / 180);
    const len = (i) => Math.hypot((g[i + 1][0] - g[i][0]) * kx, g[i + 1][1] - g[i][1]);
    let half = 0;
    for (let i = 0; i < g.length - 1; i++) half += len(i);
    half /= 2;
    for (let i = 0; i < g.length - 1; i++) {
      const d = len(i), t = half / d;
      if (d && t <= 1) return [g[i][0] + (g[i + 1][0] - g[i][0]) * t, g[i][1] + (g[i + 1][1] - g[i][1]) * t];
      half -= d;
    }
    return g[g.length - 1];
  }
  function streets(blocks) { return [...new Set(blocks.map((b) => b.s))].sort(); }

  let blocksP = null, curbsP = null;
  const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  const BOS = {
    CENTER: [42.3398, -71.0892], ZOOM: 15,
    TILE_BOUNDS: [[41.95, -71.55], [42.65, -70.60]],     // basemap/boston, see scripts/build-basemap.sh
    BOUNDS: [[42.22, -71.20], [42.40, -70.98]],          // the City's swept streets and street level tiles
    load() {
      return blocksP || (blocksP = getJSON('/data/boston/segments.json').then((d) => index(d.b))
        .catch((e) => { blocksP = null; throw e; }));
    },
    curbs() { return curbsP || (curbsP = getJSON('/data/boston/curbs.json').catch((e) => { curbsP = null; throw e; })); },
    rowsOf, rowsIn, overview, findAddress, midpoint, streets, seasonText, overnight, suspended, core,
  };

  root.BOS = BOS;
  if (typeof document === 'undefined') return;
  // The page calls San Francisco's names; on the Boston page they answer in Boston time.
  Object.assign(root, { sfParts: core.parts, sfWallToInstant: core.wallToInstant, sfTodayParts: core.todayParts,
    todaySF: core.today, sfDaysUntil: core.daysUntil, sweepCountdown: core.countdown, sweepWords: core.sweepWords,
    nextSweep: core.nextSweep, sweepsOnDay: core.onDay, holidaySkip: core.holidaySkip, holidayNote: core.holidayNote,
    mornAllowed: core.mornAllowed, alertAnchors: core.alertAnchors, sweepSuspended: suspended });
})(typeof globalThis !== 'undefined' ? globalThis : this);
