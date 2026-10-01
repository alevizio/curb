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
   the ns object — NEVER Date.getHours()/getDay() on a sweep instant.

   Multi-city (docs/multi-city/): the logic lives in makeTimeCore({ tz, suspended, holidayName }),
   one instance per city. San Francisco's instance is built at the bottom and attached under the
   same global names as always (sfParts, nextSweep, alertAnchors, …), so SF callers are unchanged. */
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

  const SCAN_DAYS = 150;          // covers the 119-day max week5 gap
  const SCAN_DAYS_SEASONAL = 400; // a rule with `months` can be off all winter (Boston: Dec to Mar)
  const NIGHT_SWEEP_BEFORE_H = 7;
  const MORN_OFFSET_MS = 2 * 36e5;

  /* The time + sweep core for ONE city.
     - tz:          IANA time zone of the city's posted signs.
     - suspended:   (rec, iso) → true when that rule does not apply on the city date `iso` (holidays).
     - holidayName: (iso) → the holiday's display name, if any.
     A rule (`rec`) is today's row shape: weekday, week1..week5, fromhour, tohour, plus optional
     `months` ([4,5,…,11] = in season April to November; absent = all year). */
  function makeTimeCore({ tz, suspended = () => false, holidayName = () => null }) {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    function parts(d) {
      const o = {};
      for (const p of dtf.formatToParts(d)) o[p.type] = p.value;
      return { y: +o.year, mo: +o.month, da: +o.day, h: (+o.hour) % 24, mi: +o.minute };
    }
    function wallToInstant(y, mo, da, h, mi = 0) {
      let t = Date.UTC(y, mo - 1, da, h, mi);
      for (let i = 0; i < 2; i++) {
        const p = parts(new Date(t));
        t += Date.UTC(y, mo - 1, da, h, mi) - Date.UTC(p.y, p.mo - 1, p.da, p.h, p.mi);
      }
      // spring-forward: a nonexistent wall hour (2am on the change night) resolves FORWARD
      const fp = parts(new Date(t));
      if (fp.h !== h % 24) t += 36e5;
      return new Date(t);
    }
    function todayParts() { return parts(new Date()); }
    function today() { const p = todayParts(); return new Date(Date.UTC(p.y, p.mo - 1, p.da)).getUTCDay(); }
    /* City calendar days from the city date of `now` to the city date y-mo-da: 0 = today, 1 = tomorrow.
       Counted on calendar dates (UTC date arithmetic), never hours/24: a sweep 30 hours away on
       Sunday evening is Tuesday, not "tomorrow", and 23/25-hour DST days can't shift the count. */
    function daysUntil(y, mo, da, now = new Date()) {
      const t = parts(new Date(now));
      return Math.round((Date.UTC(y, mo - 1, da) - Date.UTC(t.y, t.mo - 1, t.da)) / 864e5);
    }
    /* The countdown words for a nextSweep() result: hours while under a day away (always true),
       then city calendar days ("tomorrow" only for the next city date). */
    function countdown(ns, now = new Date()) {
      const hrs = (ns.start - now) / 36e5, days = daysUntil(ns.y, ns.mo, ns.da, now);
      if (hrs < 1) return 'in <1 hr';
      if (hrs < 24) return 'in ' + Math.round(hrs) + ' hr';
      return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
    }
    const seasonOf = (rec) => (Array.isArray(rec.months) && rec.months.length ? rec.months.map(Number) : null);

    // `after` (optional instant): the first sweep that ends after it instead of after now. The sheet passes
    // the end of the window being swept right now, so a driver who re-parks behind the sweeper can still
    // arm an alert or a calendar event, for the sweep after this one.
    function nextSweep(rec, after) {
      const dow = normDay(rec.weekday); if (dow === null) return null;
      const weeks = [rec.week1, rec.week2, rec.week3, rec.week4, rec.week5].map(v => String(v) === '1');
      const fromH = parseInt(rec.fromhour, 10); if (isNaN(fromH)) return null;
      let toH = parseInt(rec.tohour, 10); if (isNaN(toH)) toH = fromH + 1;
      const months = seasonOf(rec);
      const now = after == null ? new Date() : new Date(after), t0 = todayParts();
      const base = Date.UTC(t0.y, t0.mo - 1, t0.da);          // today as a city calendar day
      for (let i = 0; i < (months ? SCAN_DAYS_SEASONAL : SCAN_DAYS); i++) {
        const d = new Date(base + i * 864e5);
        if (d.getUTCDay() !== dow) continue;
        const occ = Math.ceil(d.getUTCDate() / 7);
        if (occ < 1 || occ > 5 || !weeks[occ - 1]) continue;
        const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
        if (months && !months.includes(mo)) continue;      // out of season
        const iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
        if (suspended(rec, iso)) continue;                 // holiday suspension
        const start = wallToInstant(y, mo, da, fromH);
        let end = wallToInstant(y, mo, da, toH);
        if (+end <= +start) end = new Date(+start + 36e5);  // DST spring-forward can collapse 2-3am windows
        if (now >= end) continue;                           // over already (only today's can be, unless `after`)
        return { start, end, fromH, toH, dow, y, mo, da };
      }
      return null;
    }

    /* Heads-up helper: if this side's NEXT scheduled sweep falls on a suspended holiday (so nextSweep
       rolled past it), return {iso,y,mo,da,name}; else null. Lets the UI say "no sweep — city holiday". */
    function holidaySkip(rec) {
      const dow = normDay(rec.weekday); if (dow === null) return null;
      const weeks = [rec.week1, rec.week2, rec.week3, rec.week4, rec.week5].map(v => String(v) === '1');
      const months = seasonOf(rec);
      const t0 = todayParts(), base = Date.UTC(t0.y, t0.mo - 1, t0.da);
      for (let i = 0; i < (months ? SCAN_DAYS_SEASONAL : SCAN_DAYS); i++) {
        const d = new Date(base + i * 864e5);
        if (d.getUTCDay() !== dow) continue;
        const occ = Math.ceil(d.getUTCDate() / 7);
        if (occ < 1 || occ > 5 || !weeks[occ - 1]) continue;
        const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
        if (months && !months.includes(mo)) continue;
        const iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
        return suspended(rec, iso) ? { iso, y, mo, da, name: holidayName(iso) || 'a holiday' } : null;
      }
      return null;
    }

    /* Push-alert anchors for ONE sweep occurrence — the single rule shared by the page (index.html
       openSheet), the cron re-arm (api/_schedule.js) and the send-time guard (lib/notify-core.js), so
       the first arm, every re-arm and every send agree. Instants in, instants out (DST-safe). All hours
       are the city's wall time:
       - night:   the sweep starts before 07:00. Those get ONE "move it tonight" push from 21:00 the
                  evening before instead of eve/morn/lead (a 30-min lead would land 11:30pm-6:30am).
       - eve:     20:00 on the calendar day before the sweep (the calm night-before push).
       - tonight: 21:00 on that same evening.
       - morn:    start−2h, ONLY when that lands 06:00-21:59 on the sweep's own city day — never a 4am
                  ping, never "sweep today" at 10pm the evening before; null otherwise. */
    function mornAllowed(morn, start) {
      const m = parts(new Date(morn)), s = parts(new Date(start));
      return m.h >= 6 && m.h < 22 && m.y === s.y && m.mo === s.mo && m.da === s.da;
    }
    function alertAnchors(start) {
      const s = parts(new Date(start));
      const prev = new Date(Date.UTC(s.y, s.mo - 1, s.da) - 864e5);
      const py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1, pd = prev.getUTCDate();
      const morn = new Date(+start - MORN_OFFSET_MS);
      return {
        night: s.h < NIGHT_SWEEP_BEFORE_H,
        eve: wallToInstant(py, pm, pd, 20),
        tonight: wallToInstant(py, pm, pd, 21),
        morn: mornAllowed(morn, start) ? morn : null,
      };
    }

    return { tz, parts, wallToInstant, todayParts, today, daysUntil, countdown, suspended, nextSweep, holidaySkip, mornAllowed, alertAnchors };
  }

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

  // San Francisco: the instance every existing caller uses, under the global names they already call.
  const SF_TZ = 'America/Los_Angeles';
  const sf = makeTimeCore({ tz: SF_TZ, suspended: sweepSuspended, holidayName: (iso) => HOL_NAMES[iso] });

  Object.assign(root, { DAYIDX, DAYLBL, normDay, fmtHour, makeTimeCore, SF_TZ, sfParts: sf.parts, sfWallToInstant: sf.wallToInstant, sfTodayParts: sf.todayParts, todaySF: sf.today, sfDaysUntil: sf.daysUntil, sweepCountdown: sf.countdown, HOL_DAY, HOL_NIGHT, HOL_NAMES, sweepSuspended, nextSweep: sf.nextSweep, holidaySkip: sf.holidaySkip, mornAllowed: sf.mornAllowed, alertAnchors: sf.alertAnchors });
})(typeof globalThis !== 'undefined' ? globalThis : this);
