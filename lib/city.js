/* CURB · any city built by docs/multi-city/city-build.md, for its generated page (scripts/cities/city-page.mjs) and
   the alert server (lib/cities.js). Loaded after lib/sweep-core.js and lib/city-configs.js.

   makeCity(config) gives the same names lib/city-boston.js gives Boston (load, rowsIn, overview, findAddress, …), so
   the page's code reads every city the same way:
   1. Time: the city's instance of makeTimeCore, from city.json (time zone, holidays and which sweeps a holiday stops,
      `holidayRule`). Windows may have minutes, may end the next morning, and may be listed dates.
   2. Data: data/<id>/segments.json expanded into the row shape the page reads from DataSF in San Francisco.

   A plain script that attaches to globalThis, like sweep-core; on a page, useCity(place) answers SF's names in the
   city's time, as lib/city-boston.js does for Boston. */
(function (root) {
  'use strict';
  const { makeTimeCore, DAYLBL, toHours } = root;
  if (!makeTimeCore) throw new Error('lib/city.js needs lib/sweep-core.js loaded first');

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthsOf = (mask) => { const m = []; for (let i = 0; i < 12; i++) if (mask & (1 << i)) m.push(i + 1); return m; };
  // "April to November", "November to March", "in odd months" (San Diego's every other month), or the months named;
  // null for all year
  function seasonText(months) {
    if (!Array.isArray(months) || !months.length || months.length === 12) return null;
    const m = [...months].sort((a, b) => a - b), key = m.join(',');
    if (key === '1,3,5,7,9,11') return 'in odd months';
    if (key === '2,4,6,8,10,12') return 'in even months';
    // one run of months, perhaps through the new year: start where the month before isn't swept
    const start = m.find((x) => !m.includes(x === 1 ? 12 : x - 1));
    if (start == null) return null;
    const run = [];
    for (let x = start; m.includes(x) && run.length < 12; x = x === 12 ? 1 : x + 1) run.push(x);
    if (run.length === m.length) return run.length === 1 ? 'in ' + MONTHS[start - 1] : MONTHS[start - 1] + ' to ' + MONTHS[run[run.length - 1] - 1];
    return 'in ' + m.map((x) => MONTHS[x - 1]).join(', ').replace(/, ([^,]*)$/, ' and $1');
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
  // A street as people type it and as the data writes it, in one form: "West 82nd Street" and "W 82nd St" → "W 82 ST".
  const SHORT = { STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', ROAD: 'RD', BOULEVARD: 'BLVD', PLACE: 'PL', DRIVE: 'DR', COURT: 'CT',
    LANE: 'LN', TERRACE: 'TER', PARKWAY: 'PKWY', HIGHWAY: 'HWY', SQUARE: 'SQ', CIRCLE: 'CIR', SAINT: 'ST', MOUNT: 'MT',
    NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
  const streetKey = (s) => String(s || '').toUpperCase().replace(/[.,'’"]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => SHORT[w] || w.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1')).join(' ');

  function makeCity(cfg) {
    const HOLIDAYS = cfg.holidays || {};
    // Which sweeps a city holiday stops: all of them, or (holidayRule 'daytime') only those starting at 6 AM or later.
    // A rule flagged 1 runs on holidays anyway.
    const suspended = (rec, iso) => {
      if (!Object.prototype.hasOwnProperty.call(HOLIDAYS, iso) || (rec.flags & 1)) return false;
      return !(cfg.holidayRule === 'daytime' && toHours(rec.fromhour) < 6);
    };
    const core = makeTimeCore({ tz: cfg.tz, suspended, holidayName: (iso) => HOLIDAYS[iso] || null, crossMidnight: true });

    // One block of segments.json → the DataSF row shape, one row per side and rule.
    function rowsOf(b) {
      const line = { type: 'LineString', coordinates: b.g };
      const rows = [];
      for (const [side, label, rules] of b.d) for (const [dow, fromH, toH, weeks, months, flags, dates] of rules) {
        const row = { cnn: b.c, corridor: b.s, limits: b.l, blockside: label, cnnrightleft: side,
          weekday: dow >= 0 ? DAYLBL[dow] : '', fromhour: String(fromH), tohour: String(toH), holidays: '0',
          tow: flags & 2 ? '1' : '0', flags: flags || 0, line };
        for (let i = 0; i < 5; i++) row['week' + (i + 1)] = weeks & (1 << i) ? '1' : '0';
        if (months) row.months = monthsOf(months);
        if (Array.isArray(dates)) row.dates = dates;
        rows.push(row);
      }
      return rows;
    }
    function rowsIn(blocks, w, s, e, n) {
      const out = [];
      for (const b of blocks) { const q = b.bb; if (q[2] >= w && q[0] <= e && q[3] >= s && q[1] <= n) out.push(...rowsOf(b)); }
      return out;
    }
    // The citywide view below street zoom: each block's ends, its whole line (latlngs), its box and its rules.
    function overview(blocks) {
      return blocks.map((b) => {
        const f = b.g[0], l = b.g[b.g.length - 1];
        if (!b.bb) index([b]);
        return { a: [f[1], f[0]], z: [l[1], l[0]], g: b.g.map(([lo, la]) => [la, lo]), bb: b.bb, rules: rowsOf(b) };
      });
    }
    // House number → block and curb side: the street's blocks whose number range holds it, on the odd or even side.
    function findAddress(blocks, number, street) {
      const k = streetKey(street), n = +number;
      const hits = blocks.filter((b) => { const s = streetKey(b.s); return s === k || s.startsWith(k + ' '); });
      if (!hits.length || !(n > 0)) return null;
      const inRange = hits.filter((b) => b.n && n >= b.n[0] && n <= b.n[1]);
      const pool = inRange.length ? inRange : hits;
      const dist = (b) => (b.n ? Math.min(Math.abs(n - b.n[0]), Math.abs(n - b.n[1])) : 1e9);
      const block = pool.slice().sort((a, b) => dist(a) - dist(b))[0];
      const lr = block.o ? (n % 2 ? block.o : block.o === 'L' ? 'R' : 'L') : null;
      const side = lr && block.d.find((x) => x[0] === lr);
      return { block, side: side ? side[1] : '', at: midpoint(block.g) };
    }
    const streets = (blocks) => [...new Set(blocks.map((b) => b.s))].sort();

    let blocksP = null;
    const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    return {
      id: cfg.id, cfg, CENTER: cfg.center, ZOOM: cfg.zoom, BOUNDS: cfg.bounds,
      load() {
        return blocksP || (blocksP = getJSON('/data/' + cfg.id + '/segments.json').then((d) => index(d.b))
          .catch((e) => { blocksP = null; throw e; }));
      },
      rowsOf, rowsIn, overview, findAddress, midpoint, streets, streetKey, seasonText, suspended, core, HOLIDAYS,
    };
  }

  // On the city's page, San Francisco's names answer in the city's time (lib/city-boston.js does this for Boston).
  function useCity(place) {
    const c = place.core;
    Object.assign(root, { sfParts: c.parts, sfWallToInstant: c.wallToInstant, sfTodayParts: c.todayParts,
      todaySF: c.today, sfDaysUntil: c.daysUntil, sweepCountdown: c.countdown, sweepWords: c.sweepWords,
      nextSweep: c.nextSweep, sweepsOnDay: c.onDay, holidaySkip: c.holidaySkip, holidayNote: c.holidayNote,
      mornAllowed: c.mornAllowed, alertAnchors: c.alertAnchors, sweepSuspended: place.suspended });
  }

  Object.assign(root, { makeCity, useCity });
  // A city's page names its city (window.CURB_CITY, scripts/cities/city-page.mjs) before this loads.
  if (typeof document !== 'undefined' && root.CURB_CITY && root.CITY_CONFIGS && root.CITY_CONFIGS[root.CURB_CITY]) {
    root.PLACE = makeCity(root.CITY_CONFIGS[root.CURB_CITY]);
    useCity(root.PLACE);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
