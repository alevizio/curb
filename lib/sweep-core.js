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

  /* Sweeping suspensions (SFMTA holiday enforcement schedule, verified 2026-06-13).
     Daytime rows suspend on every observed holiday; rows flagged holidays=1 (nightly /
     7-day commercial corridors) sweep straight through except the big three.
     TABLE COVERS THROUGH 2027-01-01 — refresh when SFMTA posts the next calendar. */
  const HOL_DAY = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-07-03', '2026-07-04',
    '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01']);
  const HOL_NIGHT = new Set(['2026-01-01', '2026-11-26', '2026-12-25', '2027-01-01']);
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

  Object.assign(root, { DAYIDX, DAYLBL, normDay, fmtHour, SF_TZ, sfParts, sfWallToInstant, sfTodayParts, todaySF, HOL_DAY, HOL_NIGHT, sweepSuspended, nextSweep });
})(typeof globalThis !== 'undefined' ? globalThis : this);
