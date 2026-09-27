/* CURB sweep/time core — the launch-critical correctness layer, extracted so it can be
   unit-tested under frozen clocks and arbitrary device timezones (see lib/sweep-core.test.mjs).

   Dual-loaded with NO build step:
   - Browser: a classic <script src> before the main inline script; everything is attached to
     globalThis, so the app keeps calling nextSweep()/DAYLBL/etc. as bare globals.
   - Node/Vitest: imported for its side effects (`import './sweep-core.js'`), then read off
     globalThis. The file is export-free on purpose — an `export` keyword would make it an
     illegal classic script in the browser.

   Hard rule (unchanged from the inline version): instants come from sfWallToInstant (two-pass
   offset correction — handles both 2026 DST edges from any device TZ), calendar iteration uses
   UTC date arithmetic (timezone-free), and display strings come from the wall fields carried on
   the ns object — NEVER Date.getHours()/getDay() on a sweep instant. */
(function (root) {
  'use strict';

  const DAYIDX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const DAYLBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function normDay(s) {
    if (!s) return null;
    const k = s.trim().toLowerCase().slice(0, 3);
    return (k in DAYIDX) ? DAYIDX[k] : null;
  }
  function fmtHour(h) {
    h = parseInt(h, 10);
    if (isNaN(h)) return '';
    const ap = h >= 12 ? 'PM' : 'AM';
    let hh = h % 12;
    if (hh === 0) hh = 12;
    return hh + ap;
  }

  const SF_TZ = 'America/Los_Angeles';
  const sfDTF = new Intl.DateTimeFormat('en-US', { timeZone: SF_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  function sfParts(d) {
    const o = {};
    for (const p of sfDTF.formatToParts(d)) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, da: +o.day, h: (+o.hour) % 24, mi: +o.minute };
  }
  function sfWallToInstant(y, mo, da, h, mi = 0) {
    let t = Date.UTC(y, mo - 1, da, h, mi);
    for (let i = 0; i < 2; i++) {
      const p = sfParts(new Date(t));
      t += Date.UTC(y, mo - 1, da, h, mi) - Date.UTC(p.y, p.mo - 1, p.da, p.h, p.mi);
    }
    // spring-forward: a nonexistent wall hour (2am on the change night) resolves FORWARD
    const fp = sfParts(new Date(t));
    if (fp.h !== h % 24) t += 36e5;
    return new Date(t);
  }
  function sfTodayParts() { return sfParts(new Date()); }
  function todaySF() { const p = sfTodayParts(); return new Date(Date.UTC(p.y, p.mo - 1, p.da)).getUTCDay(); }

  /* Sweeping suspensions (SFMTA holiday enforcement schedule, re-verified 2026-06-18 against
     sfmta.com/holiday-enforcement-schedule — added Juneteenth, which was missing).
     Daytime rows suspend on every observed holiday; rows flagged holidays=1 (nightly /
     7-day commercial corridors) sweep straight through except the big three.
     2027-2028 are DERIVED (SFMTA had only posted through 2027-01-01 as of 2026-09-27) by the rule
     that reproduces the verified 2026 list exactly: New Year's, Juneteenth, Independence Day,
     Veterans Day and Christmas on their date PLUS the city's observed weekday when that date is a
     weekend (Sat → Fri before, Sun → Mon after — 2026 lists both 07-03 and 07-04); MLK = 3rd Mon Jan,
     Presidents' = 3rd Mon Feb, Memorial = last Mon May, Labor = 1st Mon Sep, Indigenous Peoples =
     2nd Mon Oct, Thanksgiving = 4th Thu Nov + the day after. HOL_NIGHT = New Year's, Thanksgiving,
     Christmas by the same rule. lib/sweep-core.test.mjs re-derives this and fails ~150 days before
     the table runs out (nextSweep's scan horizon). Re-check against sfmta.com when SFMTA posts.
     TABLE COVERS THROUGH 2029-01-01. */
  const HOL_DAY = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-07-04',
    '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01',
    '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-06-19', '2027-07-04', '2027-07-05', '2027-09-06',
    '2027-10-11', '2027-11-11', '2027-11-25', '2027-11-26', '2027-12-24', '2027-12-25', '2027-12-31', '2028-01-01',
    '2028-01-17', '2028-02-21', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-10-09', '2028-11-10',
    '2028-11-11', '2028-11-23', '2028-11-24', '2028-12-25', '2029-01-01']);
  const HOL_NIGHT = new Set(['2026-01-01', '2026-11-26', '2026-12-25', '2027-01-01', '2027-11-25', '2027-12-24', '2027-12-25',
    '2027-12-31', '2028-01-01', '2028-11-23', '2028-12-25', '2029-01-01']);
  const HOL_NAMES = { '2026-01-01': "New Year's Day", '2026-01-19': 'MLK Jr. Day', '2026-02-16': "Presidents' Day",
    '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day', '2026-07-04': 'Independence Day',
    '2026-09-07': 'Labor Day', '2026-10-12': 'Indigenous Peoples Day', '2026-11-11': 'Veterans Day',
    '2026-11-26': 'Thanksgiving', '2026-11-27': 'Day after Thanksgiving', '2026-12-25': 'Christmas', '2027-01-01': "New Year's Day",
    '2027-01-18': 'MLK Jr. Day', '2027-02-15': "Presidents' Day", '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth',
    '2027-06-19': 'Juneteenth', '2027-07-04': 'Independence Day', '2027-07-05': 'Independence Day', '2027-09-06': 'Labor Day',
    '2027-10-11': 'Indigenous Peoples Day', '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving',
    '2027-11-26': 'Day after Thanksgiving', '2027-12-24': 'Christmas', '2027-12-25': 'Christmas',
    '2027-12-31': "New Year's Day", '2028-01-01': "New Year's Day", '2028-01-17': 'MLK Jr. Day', '2028-02-21': "Presidents' Day",
    '2028-05-29': 'Memorial Day', '2028-06-19': 'Juneteenth', '2028-07-04': 'Independence Day', '2028-09-04': 'Labor Day',
    '2028-10-09': 'Indigenous Peoples Day', '2028-11-10': 'Veterans Day', '2028-11-11': 'Veterans Day',
    '2028-11-23': 'Thanksgiving', '2028-11-24': 'Day after Thanksgiving', '2028-12-25': 'Christmas', '2029-01-01': "New Year's Day" };
  function sweepSuspended(rec, iso) { return (String(rec.holidays) === '1' ? HOL_NIGHT : HOL_DAY).has(iso); }

  function nextSweep(rec) {
    const dow = normDay(rec.weekday); if (dow === null) return null;
    const weeks = [rec.week1, rec.week2, rec.week3, rec.week4, rec.week5].map(v => String(v) === '1');
    const fromH = parseInt(rec.fromhour, 10); if (isNaN(fromH)) return null;
    let toH = parseInt(rec.tohour, 10); if (isNaN(toH)) toH = fromH + 1;
    const now = new Date(), t0 = sfTodayParts();
    const base = Date.UTC(t0.y, t0.mo - 1, t0.da);          // today as an SF calendar day
    for (let i = 0; i < 150; i++) {  // 150d covers the 119-day max week5 gap
      const d = new Date(base + i * 864e5);
      if (d.getUTCDay() !== dow) continue;
      const occ = Math.ceil(d.getUTCDate() / 7);
      if (occ < 1 || occ > 5 || !weeks[occ - 1]) continue;
      const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
      const iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
      if (sweepSuspended(rec, iso)) continue;            // SFMTA holiday suspension
      const start = sfWallToInstant(y, mo, da, fromH);
      let end = sfWallToInstant(y, mo, da, toH);
      if (+end <= +start) end = new Date(+start + 36e5);  // DST spring-forward can collapse 2-3am windows
      if (i === 0 && now >= end) continue;
      return { start, end, fromH, toH, dow, y, mo, da };
    }
    return null;
  }

  /* Heads-up helper: if this side's NEXT scheduled sweep falls on a suspended holiday (so nextSweep
     rolled past it), return {iso,y,mo,da,name}; else null. Lets the UI say "no sweep — city holiday". */
  function holidaySkip(rec) {
    const dow = normDay(rec.weekday); if (dow === null) return null;
    const weeks = [rec.week1, rec.week2, rec.week3, rec.week4, rec.week5].map(v => String(v) === '1');
    const t0 = sfTodayParts(), base = Date.UTC(t0.y, t0.mo - 1, t0.da);
    for (let i = 0; i < 150; i++) {
      const d = new Date(base + i * 864e5);
      if (d.getUTCDay() !== dow) continue;
      const occ = Math.ceil(d.getUTCDate() / 7);
      if (occ < 1 || occ > 5 || !weeks[occ - 1]) continue;
      const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
      const iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
      return sweepSuspended(rec, iso) ? { iso, y, mo, da, name: HOL_NAMES[iso] || 'a holiday' } : null;
    }
    return null;
  }

  /* Push-alert anchors for ONE sweep occurrence — the single rule shared by the page (index.html
     openSheet), the cron re-arm (api/_schedule.js) and the send-time guard (lib/notify-core.js), so
     the first arm, every re-arm and every send agree. Instants in, instants out (DST-safe):
     - night:   the sweep starts before 07:00 SF. Those get ONE "move it tonight" push from 21:00 SF the
                evening before instead of eve/morn/lead (a 30-min lead would land 11:30pm-6:30am).
     - eve:     20:00 SF on the calendar day before the sweep (the calm night-before push).
     - tonight: 21:00 SF on that same evening.
     - morn:    start−2h, ONLY when that lands 06:00-21:59 SF on the sweep's own SF day — never a 4am
                ping, never "sweep today" at 10pm the evening before; null otherwise. */
  const NIGHT_SWEEP_BEFORE_H = 7;
  const MORN_OFFSET_MS = 2 * 36e5;
  function mornAllowed(morn, start) {
    const m = sfParts(new Date(morn)), s = sfParts(new Date(start));
    return m.h >= 6 && m.h < 22 && m.y === s.y && m.mo === s.mo && m.da === s.da;
  }
  function alertAnchors(start) {
    const s = sfParts(new Date(start));
    const prev = new Date(Date.UTC(s.y, s.mo - 1, s.da) - 864e5);
    const py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1, pd = prev.getUTCDate();
    const morn = new Date(+start - MORN_OFFSET_MS);
    return {
      night: s.h < NIGHT_SWEEP_BEFORE_H,
      eve: sfWallToInstant(py, pm, pd, 20),
      tonight: sfWallToInstant(py, pm, pd, 21),
      morn: mornAllowed(morn, start) ? morn : null,
    };
  }

  Object.assign(root, { DAYIDX, DAYLBL, normDay, fmtHour, SF_TZ, sfParts, sfWallToInstant, sfTodayParts, todaySF, HOL_DAY, HOL_NIGHT, HOL_NAMES, sweepSuspended, nextSweep, holidaySkip, mornAllowed, alertAnchors });
})(typeof globalThis !== 'undefined' ? globalThis : this);
