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
  /* DataSF's weekday 'Holiday' rows (824 in 2026, one per curb side on ~590 blocks, posted as
     "HOLIDAYS 4 TO 6AM") are their own schedule: they sweep on the city's minor holidays only, at their
     own hours, whatever the side does on that weekday. normDay gives them this value, never a weekday,
     so DAYLBL[...] is undefined for them; the map's day filter counts one through onDay (sweepsOnDay). */
  const HOLIDAY_DOW = 7;

  function normDay(s) {
    if (!s) return null;
    const k = String(s).trim().toLowerCase().slice(0, 3);
    if (k === 'hol') return HOLIDAY_DOW;
    return (k in DAYIDX) ? DAYIDX[k] : null;
  }
  const isHolidayRow = (rec) => !!rec && normDay(rec.weekday) === HOLIDAY_DOW;
  function fmtHour(h) {
    h = parseInt(h, 10);
    if (isNaN(h)) return '';
    const ap = h >= 12 ? 'PM' : 'AM';
    let hh = h % 12;
    if (hh === 0) hh = 12;
    return hh + ap;
  }

  /* Night wording (owner decision 2026-10-05). A sweep that STARTS after midnight and before 6 AM is named
     by the night people think in, not by its calendar date: "TUE 12AM-2AM" seen on Monday evening read as
     "Tue 10/6, 12AM to 2AM" and people took it for Tuesday NIGHT and got ticketed. It now reads
       Mon night 10/5 → Tue 12 to 2 AM · tonight
     Why 6 and not the push rule's 7 (NIGHT_SWEEP_BEFORE_H): that one decides when a push may land (a
     30-min lead for a 6 AM sweep would ping at 5:30), this one decides what people call the hour. 6 AM is
     morning (it is also mornAllowed's earliest push hour), nobody reads "Mon 6AM" as Monday night, and
     "Sun night → Mon 6 to 8 AM" would call ~4,300 morning sweep rows night ones. Both rules agree on
     12 AM to 5 AM; a 6 AM sweep gets the 9 PM "move it tonight" push and reads "Mon 10/5, 6AM to 8AM" here,
     which says the same thing. */
  const NIGHT_WORDS_BEFORE_H = 6;
  const h12 = (h) => (h % 12) || 12;

  /* The reader-facing day + window of ONE sweep occurrence on the city wall date y-mo-da, hours fromH to
     toH. Pure and timezone free (UTC date arithmetic only), shared by the page, /b/ pages and tests:
       night   true when worded by the night before (start 12 AM to before 6 AM)
       day     'Tue 10/6'              | 'Mon night 10/5'                    the date alone (side rows, toasts)
       head    'Tue 9AM'               | 'Mon night'                         the sheet's big verdict line
       win     '9AM to 11AM'           | 'Tue 12 to 2 AM'                    a night window names the sign's day
       when    'Tue 10/6, 9AM to 11AM' | 'Mon night 10/5 → Tue 12 to 2 AM'
       nightOf null                    | { dow, y, mo, da } of that night
     The sign badges keep the sign's own wording (TUE 12 TO 2AM); only these sentences change. */
  function sweepDayWords(y, mo, da, fromH, toH) {
    fromH = parseInt(fromH, 10); toH = parseInt(toH, 10);
    const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
    const date = DAYLBL[dow] + ' ' + mo + '/' + da;
    if (!(fromH >= 0 && fromH < NIGHT_WORDS_BEFORE_H)) {
      const win = fmtHour(fromH) + ' to ' + fmtHour(toH);
      return { night: false, day: date, head: DAYLBL[dow] + ' ' + fmtHour(fromH), win, when: date + ', ' + win, nightOf: null };
    }
    const p = new Date(Date.UTC(y, mo - 1, da) - 864e5);
    const nightOf = { dow: p.getUTCDay(), y: p.getUTCFullYear(), mo: p.getUTCMonth() + 1, da: p.getUTCDate() };
    const day = DAYLBL[nightOf.dow] + ' night ' + nightOf.mo + '/' + nightOf.da;
    // both ends AM: say AM once ("12 to 2 AM", the owner's format); otherwise the usual fmtHour pair
    const win = DAYLBL[dow] + ' ' + (toH < 12 ? h12(fromH) + ' to ' + h12(toH) + ' AM' : fmtHour(fromH) + ' to ' + fmtHour(toH));
    return { night: true, day, head: DAYLBL[nightOf.dow] + ' night', win, when: day + ' → ' + win, nightOf };
  }

  const SCAN_DAYS = 150;          // covers the 119-day max week5 gap
  const SCAN_DAYS_SEASONAL = 400; // a rule with `months` can be off all winter (Boston: Dec to Mar)
  const NIGHT_SWEEP_BEFORE_H = 7;
  const MORN_OFFSET_MS = 2 * 36e5;

  /* The time + sweep core for ONE city.
     - tz:              IANA time zone of the city's posted signs.
     - suspended:       (rec, iso) → true when a weekday rule does not apply on the city date `iso` (holidays).
     - holidayName:     (iso) → the holiday's display name, if any.
     - holidaySchedule: (iso) → true on the dates a posted holiday schedule (a weekday 'Holiday' rule) sweeps.
                        Absent = never, so a city without such a table can't sweep a Holiday rule.
     A rule (`rec`) is today's row shape: weekday, week1..week5, fromhour, tohour, plus optional
     `months` ([4,5,…,11] = in season April to November; absent = all year). A weekday 'Holiday' rule
     ignores its week flags (DataSF sets all five): it runs on every holidaySchedule date. */
  function makeTimeCore({ tz, suspended = () => false, holidayName = () => null, holidaySchedule = () => false }) {
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
    /* sweepDayWords plus its countdown `rel`, for a nextSweep() result that has not started yet (callers
       say "Sweeping now" themselves). A night sweep counts to its NIGHT: "tonight", "tomorrow night", then
       "in N days" (Thu night seen on a Monday is in 3 days). Once that night's midnight has passed it counts
       hours ("in 2 hr"), as the push switches to its morning copy after SF midnight. Nights are counted from
       the night people are IN, and until 6 AM (NIGHT_WORDS_BEFORE_H, the same line the words use) that is the
       previous date's: at Mon 12:30 AM "tonight" is Sunday night, so a Tue 2 AM sweep (Monday night) is
       "tomorrow night" and 6 AM makes it "tonight". A day sweep's `rel` is countdown() unchanged. */
    function sweepWords(ns, now = new Date()) {
      const w = sweepDayWords(ns.y, ns.mo, ns.da, ns.fromH, ns.toH);
      if (!w.night) return { ...w, rel: countdown(ns, now) };
      const d = daysUntil(w.nightOf.y, w.nightOf.mo, w.nightOf.da, now);
      if (d < 0) return { ...w, rel: countdown(ns, now) };
      const n = d + (parts(new Date(now)).h < NIGHT_WORDS_BEFORE_H ? 1 : 0);
      return { ...w, rel: n === 0 ? 'tonight' : n === 1 ? 'tomorrow night' : 'in ' + n + ' days' };
    }
    const seasonOf = (rec) => (Array.isArray(rec.months) && rec.months.length ? rec.months.map(Number) : null);
    const isoOf = (y, mo, da) => y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
    // One occurrence of a rule's window on the city date y-mo-da (fromH must parse; toH defaults to fromH + 1).
    function windowOn(rec, y, mo, da) {
      const fromH = parseInt(rec.fromhour, 10); if (isNaN(fromH)) return null;
      let toH = parseInt(rec.tohour, 10); if (isNaN(toH)) toH = fromH + 1;
      const start = wallToInstant(y, mo, da, fromH);
      let end = wallToInstant(y, mo, da, toH);
      if (+end <= +start) end = new Date(+start + 36e5);    // DST spring-forward can collapse 2-3am windows
      return { start, end, fromH, toH };
    }
    // Does the rule sweep on the city date d (UTC midnight of y-mo-da)? A weekday rule: its weekday, its
    // week-of-month flag, its season, and not suspended that date. A Holiday rule: a holidaySchedule date
    // in its season, whatever the weekday.
    function sweepsOn(rec, dow, weeks, months, d) {
      const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
      if (months && !months.includes(mo)) return false;     // out of season
      if (dow === HOLIDAY_DOW) return !!holidaySchedule(isoOf(y, mo, da));
      if (d.getUTCDay() !== dow) return false;
      const occ = Math.ceil(da / 7);
      return occ >= 1 && occ <= 5 && weeks[occ - 1] && !suspended(rec, isoOf(y, mo, da));
    }

    // `after` (optional instant): the first sweep that ends after it instead of after now. The sheet passes
    // the end of the window being swept right now, so a driver who re-parks behind the sweeper can still
    // arm an alert or a calendar event, for the sweep after this one. A Holiday rule's occurrence carries
    // `holiday: true` (its `dow` is the real weekday of that date, so the night wording works unchanged).
    function nextSweep(rec, after) {
      const dow = normDay(rec.weekday); if (dow === null) return null;
      const weeks = [rec.week1, rec.week2, rec.week3, rec.week4, rec.week5].map(v => String(v) === '1');
      if (isNaN(parseInt(rec.fromhour, 10))) return null;
      const months = seasonOf(rec);
      const now = after == null ? new Date() : new Date(after), t0 = todayParts();
      const base = Date.UTC(t0.y, t0.mo - 1, t0.da);          // today as a city calendar day
      for (let i = 0; i < (months ? SCAN_DAYS_SEASONAL : SCAN_DAYS); i++) {
        const d = new Date(base + i * 864e5);
        if (!sweepsOn(rec, dow, weeks, months, d)) continue;  // other weekday, week, season, or a holiday
        const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
        const w = windowOn(rec, y, mo, da);
        if (now >= w.end) continue;                           // over already (only today's can be, unless `after`)
        return { ...w, dow: d.getUTCDay(), y, mo, da, ...(dow === HOLIDAY_DOW ? { holiday: true } : {}) };
      }
      return null;
    }

    /* The map's day filter (index.html dayFilter, a visibility lens): does this rule count for the weekday chip
       `dow` (0 to 6)? A weekday rule when it is that weekday. A Holiday rule (normDay 7, never a weekday) when its
       next occurrence falls on that weekday within the coming week: the MON chip the week of Indigenous Peoples
       Day shows the blocks swept by their holiday schedule that Monday, and any other week it doesn't. */
    function onDay(rec, dow) {
      const d = normDay(rec.weekday);
      if (d !== HOLIDAY_DOW) return d !== null && d === dow;
      const n = nextSweep(rec);
      return !!n && n.dow === dow && +n.start - Date.now() < 7 * 864e5;
    }

    // The earliest occurrence of the side's Holiday rules on the city date y-mo-da, or null (no Holiday rule,
    // or not a holiday-schedule date). Ignores the clock: the holiday sweep may already be over.
    function holidayOn(rows, y, mo, da) {
      let best = null;
      if (!Array.isArray(rows) || !holidaySchedule(isoOf(y, mo, da))) return null;
      for (const r of rows) {
        if (!isHolidayRow(r)) continue;
        const months = seasonOf(r);
        if (months && !months.includes(mo)) continue;
        const w = windowOn(r, y, mo, da);
        if (w && (!best || +w.start < +best.start)) best = { ...w, dow: new Date(Date.UTC(y, mo - 1, da)).getUTCDay(), y, mo, da, holiday: true };
      }
      return best;
    }

    /* Heads-up helper: if this weekday rule's NEXT scheduled sweep falls on a suspended holiday (so nextSweep
       rolled past it), return { iso, y, mo, da, name, start, fromH, toH, schedule }; else null.
       `schedule` = the side's posted holiday schedule that date (pass the side's rows), or null when nothing
       sweeps: only a null schedule lets the UI say "no sweep, city holiday". A Holiday rule is never
       skipped: null. */
    function holidaySkip(rec, after, rows) {
      const dow = normDay(rec.weekday); if (dow === null || dow === HOLIDAY_DOW) return null;
      const weeks = [rec.week1, rec.week2, rec.week3, rec.week4, rec.week5].map(v => String(v) === '1');
      const months = seasonOf(rec);
      const now = after == null ? new Date() : new Date(after), t0 = todayParts(), base = Date.UTC(t0.y, t0.mo - 1, t0.da);
      for (let i = 0; i < (months ? SCAN_DAYS_SEASONAL : SCAN_DAYS); i++) {
        const d = new Date(base + i * 864e5);
        if (d.getUTCDay() !== dow) continue;
        const occ = Math.ceil(d.getUTCDate() / 7);
        if (occ < 1 || occ > 5 || !weeks[occ - 1]) continue;
        const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
        if (months && !months.includes(mo)) continue;
        const iso = isoOf(y, mo, da);
        const w = windowOn(rec, y, mo, da);
        if (w && now >= w.end) continue;                     // today's window already over: not the next sweep
        if (!suspended(rec, iso)) return null;
        return { iso, y, mo, da, name: holidayName(iso) || 'a holiday', start: w ? w.start : new Date(Date.UTC(y, mo - 1, da)),
          fromH: w ? w.fromH : null, toH: w ? w.toH : null, schedule: holidayOn(rows, y, mo, da) };
      }
      return null;
    }

    /* The city-holiday note for ONE curb side: `rows` = all its rules (weekday and Holiday), `ns` = its next
       sweep (the earliest nextSweep across them, or null). Returns { iso, y, mo, da, name, schedule } or null:
       - ns is a holiday-schedule occurrence: that date, schedule = ns ("Holiday schedule").
       - else the earliest weekday sweep a holiday cancels BEFORE ns (any of the side's rules, not only the one
         behind ns), with schedule = the side's holiday schedule that date, or null ("No street sweeping": a
         side without a Holiday rule, or New Year's Day / Thanksgiving / Christmas, when nothing sweeps). */
    function holidayNote(rows, ns, after) {
      if (ns && ns.holiday) return { iso: isoOf(ns.y, ns.mo, ns.da), y: ns.y, mo: ns.mo, da: ns.da, name: holidayName(isoOf(ns.y, ns.mo, ns.da)) || 'a holiday', schedule: ns };
      let best = null;
      for (const r of rows || []) {
        const s = holidaySkip(r, after, rows);
        if (s && (!ns || +s.start < +ns.start) && (!best || +s.start < +best.start)) best = s;
      }
      return best;
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

    return { tz, parts, wallToInstant, todayParts, today, daysUntil, countdown, sweepWords, suspended, nextSweep, onDay, holidaySkip, holidayNote, mornAllowed, alertAnchors };
  }

  /* Sweeping suspensions (SFMTA holiday enforcement schedule,
     sfmta.com/getting-around/drive-park/holiday-enforcement-schedule; 2026 re-checked 2026-10-05 against
     the live page and its Wayback copies of 2026-06-08 and 2026-06-25).
     Which rows sweep on these dates is the street-cleaning ticket record's answer, not SFMTA's page
     (see sweepSuspended below): weekday rows stop on every listed date, and a side's posted holiday
     schedule (DataSF weekday 'Holiday') sweeps on every listed date except HOL_NIGHT.
     2027-2028 are DERIVED (SFMTA had only posted through 2027-01-01 as of 2026-10-05) by the rule that
     reproduces every table SFMTA posted that we have a copy of (2021, 2022, 2023, 2026):
     - MLK = 3rd Mon Jan, Presidents' = 3rd Mon Feb, Memorial = last Mon May, Labor = 1st Mon Sep,
       Indigenous Peoples = 2nd Mon Oct, Thanksgiving = 4th Thu Nov + the day after.
     - New Year's Day and Christmas: their own date even on a weekend, holiday schedules stopped too. On a
       Sunday the Monday after is also listed, daytime only (2022-12-26, 2023-01-02). On a Saturday
       nothing else is (no Fri 2021-12-24 or 2021-12-31), so no Fri 2027-12-24 or 2027-12-31.
     - Juneteenth and Independence Day on a weekend: only the observed weekday (Sat → Fri before,
       Sun → Mon after: 2026-07-03 without 07-04, 2021-07-05, 2022-06-20).
     - Veterans Day on a Saturday: the Friday AND the date (2023-11-10 and 11-11), so 2028-11-10/11.
       It is the one weekend case where SFMTA's tables disagree in spirit (2023 vs 2026), so re-check
       2028-11-11 first.
     HOL_NIGHT = New Year's Day, Thanksgiving and Christmas on their own dates. lib/sweep-core.test.mjs
     re-derives all of this from SFMTA's posted lists and fails ~150 days before the table runs out
     (nextSweep's scan horizon). Re-check against sfmta.com when SFMTA posts 2027.
     TABLE COVERS THROUGH 2029-01-01. */
  const HOL_DAY = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03',
    '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01',
    '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06',
    '2027-10-11', '2027-11-11', '2027-11-25', '2027-11-26', '2027-12-25', '2028-01-01',
    '2028-01-17', '2028-02-21', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-10-09', '2028-11-10',
    '2028-11-11', '2028-11-23', '2028-11-24', '2028-12-25', '2029-01-01']);
  const HOL_NIGHT = new Set(['2026-01-01', '2026-11-26', '2026-12-25', '2027-01-01', '2027-11-25', '2027-12-25',
    '2028-01-01', '2028-11-23', '2028-12-25', '2029-01-01']);
  const HOL_NAMES = { '2026-01-01': "New Year's Day", '2026-01-19': 'MLK Jr. Day', '2026-02-16': "Presidents' Day",
    '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day',
    '2026-09-07': 'Labor Day', '2026-10-12': 'Indigenous Peoples Day', '2026-11-11': 'Veterans Day',
    '2026-11-26': 'Thanksgiving', '2026-11-27': 'Day after Thanksgiving', '2026-12-25': 'Christmas', '2027-01-01': "New Year's Day",
    '2027-01-18': 'MLK Jr. Day', '2027-02-15': "Presidents' Day", '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth',
    '2027-07-05': 'Independence Day', '2027-09-06': 'Labor Day',
    '2027-10-11': 'Indigenous Peoples Day', '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving',
    '2027-11-26': 'Day after Thanksgiving', '2027-12-25': 'Christmas',
    '2028-01-01': "New Year's Day", '2028-01-17': 'MLK Jr. Day', '2028-02-21': "Presidents' Day",
    '2028-05-29': 'Memorial Day', '2028-06-19': 'Juneteenth', '2028-07-04': 'Independence Day', '2028-09-04': 'Labor Day',
    '2028-10-09': 'Indigenous Peoples Day', '2028-11-10': 'Veterans Day', '2028-11-11': 'Veterans Day',
    '2028-11-23': 'Thanksgiving', '2028-11-24': 'Day after Thanksgiving', '2028-12-25': 'Christmas', '2029-01-01': "New Year's Day" };
  /* Which rows sweep on a holiday (evidence of 2026-10-05: every street-cleaning ticket written 12 AM to 9 AM on
     8 minor holidays from Oct 2025 to Sep 2026, matched to its block side, against the same weekday a week later):
     1. Weekday rows (Mon to Sun) stop on EVERY HOL_DAY date, whatever their hours or DataSF's holidays flag.
        Sides without a 'Holiday' row were ticketed on 5 of 19,684 row-dates on those holidays (1,979 a week
        later), overnight and flagged rows included.
     2. A weekday 'Holiday' row (one per side on ~590 blocks, posted "HOLIDAYS 4 TO 6AM") sweeps on the minor
        holidays, HOL_DAY dates that are not HOL_NIGHT, at its own hours: 98% of the holiday tickets fell on a
        side with one, inside its window (the day after Thanksgiving behaves the same). It applies whatever
        the side does on that weekday: it is its own schedule.
     3. On HOL_NIGHT (New Year's Day, Thanksgiving, Christmas) nothing sweeps: zero tickets, Holiday rows
        included.
     This replaced a night-route rule (any window inside 12 to 6 AM, or flagged holidays=1, swept through
     minor holidays) that was wrong both ways: on Oct 12 2026 it showed 1,241 blocks swept that are not (1,461
     curb sides), missed 77 that are (140 sides), and gave 246 more the wrong side or hours. It covered 68% of
     the holiday tickets; this model covers 98%. Needs `weekday`: every caller passes the whole row. */
  const holidayScheduleDay = (iso) => HOL_DAY.has(iso) && !HOL_NIGHT.has(iso);
  function sweepSuspended(rec, iso) { return isHolidayRow(rec) ? !holidayScheduleDay(iso) : HOL_DAY.has(iso); }

  // San Francisco: the instance every existing caller uses, under the global names they already call.
  const SF_TZ = 'America/Los_Angeles';
  const sf = makeTimeCore({ tz: SF_TZ, suspended: sweepSuspended, holidayName: (iso) => HOL_NAMES[iso], holidaySchedule: holidayScheduleDay });

  Object.assign(root, { DAYIDX, DAYLBL, normDay, fmtHour, makeTimeCore, SF_TZ, sfParts: sf.parts, sfWallToInstant: sf.wallToInstant, sfTodayParts: sf.todayParts, todaySF: sf.today, sfDaysUntil: sf.daysUntil, sweepCountdown: sf.countdown, NIGHT_WORDS_BEFORE_H, sweepDayWords, sweepWords: sf.sweepWords, HOL_DAY, HOL_NIGHT, HOL_NAMES, HOLIDAY_DOW, isHolidayRow, holidayScheduleDay, sweepSuspended, nextSweep: sf.nextSweep, sweepsOnDay: sf.onDay, holidaySkip: sf.holidaySkip, holidayNote: sf.holidayNote, mornAllowed: sf.mornAllowed, alertAnchors: sf.alertAnchors });
})(typeof globalThis !== 'undefined' ? globalThis : this);
