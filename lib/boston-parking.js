/* CURB · Boston Parking mode: what a curb says at a chosen time. Pure, so the tests can run it without a page; the map and
   sheet are in lib/boston-parking-ui.js. The data is data/boston/zones.json (scripts/cities/boston-zones.mjs).

   The order below comes from a street check on 5 Nov 2026 (private/boston-parking-mode/stage0/results.md, 56 stretches against
   Street View). One City record often lists every sign on a block, without saying where each one stands, and many have a photo
   nobody could read. So on a long stretch a hydrant, bus stop or accessible sign is a note. A plain "No Parking" looked wrong on
   8 of 13 long stretches (cars parked along the block: often one sign near a corner), so it says Check the sign. No Stopping
   held up on 8 of 10. Clear needs every sign read: both wrong Clears in the check had an unreadable photo on the record.
   Times are Boston wall clock, whatever the phone's time zone. Export-free, like lib/city-boston.js. */
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STEP = 5, WEEK = 8 * 24 * 60;  // minutes: how finely, and how far ahead, to look for the next change

  // A wall clock moment. Minutes can run past midnight: Date.UTC carries them over.
  function at(y, mo, da, h = 0, mi = 0) {
    const d = new Date(Date.UTC(y, mo - 1, da, h, mi));
    const yy = d.getUTCFullYear(), mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return { y: yy, mo: mm, da: dd, dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), week: Math.ceil(dd / 7), iso: `${yy}-${pad(mm)}-${pad(dd)}` };
  }
  const later = (T, minutes) => at(T.y, T.mo, T.da, 0, T.min + minutes);

  function windowOn([days, from, to, weeks, months], T) {
    if (months && !((months >> (T.mo - 1)) & 1)) return false;
    if (weeks && !((weeks >> (T.week - 1)) & 1)) return false;
    if (from === to) return !!((days >> T.dow) & 1);
    if (from < to) return !!((days >> T.dow) & 1) && T.min >= from && T.min < to;
    // past midnight: the small hours belong to the day before
    if (T.min >= from) return !!((days >> T.dow) & 1);
    return T.min < to && !!((days >> ((T.dow + 6) % 7)) & 1);
  }
  // The City's parking clerk: meters are free on Sundays (the signs say so) and City holidays; other rules still apply.
  function inForce(p, T, holidays = {}) {
    if (p.per) return false;
    if (p.m && Object.prototype.hasOwnProperty.call(holidays, T.iso)) return false;
    return !p.w || p.w.some((w) => windowOn(w, T));
  }

  // A swept side's rules from segments.json: [jsDow, fromH, toH, weeks, months, flags]. Daytime sweeping stops on City holidays;
  // the overnight program, starting before 6 AM, keeps running (lib/city-boston.js).
  function sweepOn(rules, T, holidays = {}) {
    const h = T.min / 60;
    return (rules || []).some(([dow, from, to, weeks, months]) => {
      if (months && !((months >> (T.mo - 1)) & 1)) return false;
      if (weeks && !((weeks >> (T.week - 1)) & 1)) return false;
      if (from >= 6 && Object.prototype.hasOwnProperty.call(holidays, T.iso)) return false;
      if (from < to) return dow === T.dow && h >= from && h < to;
      return (dow === T.dow && h >= from) || (dow === (T.dow + 6) % 7 && h < to);
    });
  }

  /** What a set of signs says at T, with no sweeping schedule considered: {st, why, top}. st is clear, paid, limit, restricted,
   *  no, sweep (a street cleaning sign, on a curb with no schedule), check, or unknown. */
  function gradeSigns(D, rs, short, onSchedule, T, holidays) {
    if (rs < 0) return { st: 'unknown', why: 'no-sign' };
    const [ids, unread] = D.rs[rs], ps = ids.map((i) => D.p[i]);
    const inForceNow = ps.filter((p) => inForce(p, T, holidays));
    if (!onSchedule && inForceNow.some((p) => p.sw)) return { st: 'sweep', why: 'sign' };
    const active = inForceNow.filter((p) => !p.sw && p.st).sort((a, b) => a.pr - b.pr);
    const none = () => (unread ? { st: 'check', why: 'unread' } : { st: 'clear', why: 'none-in-force' });
    if (short) return active.length ? { st: active[0].st === 'clear' && unread ? 'check' : active[0].st, why: 'short', top: active[0] } : none();
    const painted = active.filter((p) => !p.n);
    if (!painted.length) return none();
    const meter = painted.find((p) => p.m);
    if (meter) return { st: 'paid', why: 'metered', top: meter };
    const can = painted.some((p) => ['paid', 'limit', 'clear'].includes(p.st)), cant = painted.some((p) => ['no', 'restricted'].includes(p.st));
    if (can && cant) return { st: 'check', why: 'conflict' };
    const top = painted[0];
    if (top.st === 'no' && top.pl) return { st: 'check', why: 'long-no-parking', top };
    if (top.st === 'clear' && unread) return { st: 'check', why: 'unread' };
    return { st: top.st, why: 'single', top };
  }

  /** The zone's answer at T. rulesOf(c, side) gives a swept side's rules. */
  function grade(D, zone, T, rulesOf, holidays) {
    const rules = zone.c ? rulesOf(zone.c, zone.side) : null;
    if (rules && sweepOn(rules, T, holidays)) return { st: 'sweep', why: 'schedule' };
    return gradeSigns(D, zone.rs, zone.short, !!rules, T, holidays);
  }

  /** The first moment within about a week that the answer changes: {T, st}, or null when it holds. */
  function nextChange(answerAt, T) {
    const now = answerAt(T).st;
    for (let m = STEP - (T.min % STEP); m <= WEEK; m += STEP) {
      const t = later(T, m), a = answerAt(t);
      if (a.st !== now) return { T: t, st: a.st };
    }
    return null;
  }

  /** The day as bar segments: [{from, to, st}], minutes after midnight. */
  function dayBar(answerAt, T) {
    const out = [];
    for (let m = 0; m < 1440; m += STEP) {
      const st = answerAt(at(T.y, T.mo, T.da, 0, m)).st, last = out[out.length - 1];
      if (last && last.st === st) last.to = m + STEP; else out.push({ from: m, to: m + STEP, st });
    }
    return out;
  }

  const clock = (min) => { const h = Math.floor(min / 60) % 24, m = min % 60; return (h % 12 || 12) + (m ? ':' + pad(m) : '') + (h < 12 ? ' AM' : ' PM'); };
  const dayTime = (T) => `${DAYS[T.dow]} ${clock(T.min)}`;
  const untilWords = (next, T) => (next.T.iso === T.iso ? clock(next.T.min) : dayTime(next.T));
  const maxWords = (min) => (min >= 60 ? `${Math.round(min / 6) / 10} hr` : `${min} min`);

  /** The sheet's words for an answer: {head, sub, rate}. next comes from nextChange. */
  function words(answer, next, T) {
    const { st, why, top } = answer, until = next ? ` until ${untilWords(next, T)}` : '';
    const max = top && top.max ? maxWords(top.max) : '';
    if (st === 'clear') return { head: `Clear${until}`, sub: 'No rule on record applies at this time.' };
    if (st === 'paid') return { head: `Pay${until}`, rate: top.rate || null, sub: [max && `${max} max.`, next && next.st !== 'paid' ? `No meter after ${untilWords(next, T)}.` : ''].filter(Boolean).join(' ') };
    if (st === 'limit') return { head: `${max || 'Time'} limit${until}`, sub: top.r && top.r[0] === 'permit' ? 'Residents with a permit are exempt.' : '' };
    if (st === 'restricted') return { head: `${top.r && top.r[0] === 'accessible' ? 'Placard' : 'Permit'} only${until}`, sub: '' };
    if (st === 'no') {
      const kind = top.r && top.r[0] === 'loading' ? 'Loading only' : top.stop ? 'No stopping' : 'No parking';
      return { head: `${kind}${until}`, sub: why === 'short' ? '' : 'On record along this stretch. It may cover only part of it.' };
    }
    if (st === 'sweep') return { head: `Sweeping${until}`, sub: why === 'sign' ? 'From a posted sign. The City lists no schedule here.' : '' };
    if (st === 'check') {
      const sub = why === 'conflict' ? 'The signs on record here disagree. Read the one by your car.'
        : why === 'long-no-parking' ? 'A no parking sign is on record along this stretch. It may cover only part of it.'
          : "One sign here couldn't be read, so we can't say it's clear.";
      return { head: 'Check the sign', sub };
    }
    return { head: 'No sign on record', sub: 'The City has no readable sign here.' };
  }

  // zones.json → drawable zones: {g: [[lat, lng]], rs, short, c, side, name}
  function decode(D) {
    D.zones = D.z.map(([flat, rs, short, c, side, name]) => {
      const g = []; let x = 0, y = 0;
      for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; g.push([y / 1e5, x / 1e5]); }
      return { g, rs, short, c, side, name: name >= 0 ? D.n[name] : '' };
    });
    return D;
  }

  root.BOS_PARK = { at, later, inForce, sweepOn, gradeSigns, grade, nextChange, dayBar, words, clock, dayTime, decode };
})(typeof globalThis !== 'undefined' ? globalThis : this);
