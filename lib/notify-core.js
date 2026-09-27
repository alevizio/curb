// CURB notification cadence + copy — the single source of truth for WHICH push fires WHEN and WHAT
// it says. Pure + side-effect-free (no clock, no store, no transport) so it can be unit-tested under
// frozen clocks and reused identically by web-push and APNs. Imported by api/send-notifications.js
// (delivery) and api/test-notification.js (the user-facing "send me a test").
//
// Two user dials, both stored on the spot:
//   spot.level : 'light' | 'normal' | 'intense'  — HOW MANY pushes (the cadence)
//   spot.voice : 'cheeky' | 'drill' | 'deadpan'   — the personality of the copy
// Plus optional spot.tip (e.g. "9:11am") = the block's real average ticket time, woven in when present.
//
// Night sweeps (start before 07:00 SF) override the level: ONE "move it tonight" push from 21:00 SF the
// evening before replaces eve/morn/lead at every level — a 30-min lead would land 11:30pm-6:30am.

// Side-effect import: the SF time core (alertAnchors/mornAllowed — the anchor rule shared with the
// page and the cron re-arm) attaches to globalThis.
import './sweep-core.js';
const { alertAnchors, mornAllowed } = globalThis;

// ---- cadence: which touchpoints each intensity level fires ----
// A touchpoint fires at most ONCE per sweep (de-duped by the store) on the first scheduler tick inside
// its window. Every window is >= 15 min wide so a tick on the QStash 15-min schedule can't skip it — eve
// via its 20:00-23:00 span, morn via its grace tail, lead via the leadMinutes floor of 15. That only
// holds while the scheduler really runs every 15 min; the sparse GitHub backup can still miss windows.
export const LEVELS = {
  light:   { label: 'Light',   blurb: 'Just the 30-min heads-up',            touchpoints: ['lead'] },
  normal:  { label: 'Normal',  blurb: 'Night before + 30 min before',        touchpoints: ['eve', 'lead'] },
  intense: { label: 'Intense', blurb: 'Night before, morning-of, + 30 min',  touchpoints: ['eve', 'morn', 'lead'] },
};

export const VOICES = {
  cheeky:  { label: 'Cheeky',  blurb: 'Warm, funny, on your side' },
  drill:   { label: 'Drill',   blurb: 'Loud. Urgent. MOVE THE CAR.' },
  deadpan: { label: 'Deadpan', blurb: 'Dry — the receipts do the talking' },
};

export const VALID_LEVELS = Object.keys(LEVELS);
export const VALID_VOICES = Object.keys(VOICES);
export const DEFAULT_LEVEL = 'normal';
export const DEFAULT_VOICE = 'cheeky';

/** Coerce an untrusted value to a known level/voice (used by sanitizeSpot + the cron). */
export const normLevel = (v) => (LEVELS[v] ? v : DEFAULT_LEVEL);
export const normVoice = (v) => (VOICES[v] ? v : DEFAULT_VOICE);

// Window grace: once an anchor time passes, the push stays eligible for this long (must exceed the
// 15-min tick so none is skipped). eve stays eligible 20:00 → min(23:00, sweep − lead) so a late tick
// still delivers it; eveningISO is always 20:00 SF and 20:00→23:00 is 3 real hours (DST flips at 2am).
const EVE_SPAN = 3 * 3600000;
const MORN_GRACE = 50 * 60000;
// A lead (or tonight) push with less than this left is skipped: too late to act on.
const MIN_LEFT = 5 * 60000;
// A queued eve push expires at SF midnight (20:00 + 4h) so an offline phone never shows "Sweep day
// tomorrow" on the sweep day itself.
const EVE_EXPIRE = 4 * 3600000;

// Tags drive collapse/replace on both transports — one id per touchpoint; the SAME touchpoint replaces
// its previous push (e.g. last week's lead), while eve/morn/lead for one sweep stack. `tonight` shares
// the lead's tag: it is the night sweep's "move your car" push.
const TAGS = { eve: 'curb-sweep-eve', morn: 'curb-sweep-morn', lead: 'curb-sweep', tonight: 'curb-sweep' };
// The act-now pushes: sent at high urgency (Android Doze) and kept on screen until dismissed.
const URGENT = { lead: true, tonight: true };

// ---- copy matrix: COPY[voice][touchpoint](ctx, loud) -> { title, body } ----
// ctx = { block, side, time, mins, tip }. `loud` is true at the Intense level (escalates the lead).
// "12 AM" reads as noon-or-midnight at a glance; the tonight copy says midnight.
const night = (c) => (c.time === '12 AM' ? 'midnight' : c.time);
const COPY = {
  cheeky: {
    eve:  (c) => ({ title: '🧹 Sweep day tomorrow',     body: `${c.block}${c.side} gets cleaned at ${c.time} — move tonight and skip the scramble.` }),
    morn: (c) => ({ title: '☀️ Heads up — sweep today', body: `${c.block}${c.side} sweeps at ${c.time}, a couple hours out. Don't fund the city today.` }),
    lead: (c, loud) => loud
      ? ({ title: `🚗 Move it — ~${c.mins} min`, body: `${c.block}${c.side} sweeps at ${c.time}. Last easy chance before a $108 ticket.` })
      : ({ title: '🚗 Move the car',             body: `${c.block}${c.side} sweeps in ~${c.mins} min.${c.tip ? ` Tickets here land ~${c.tip}.` : ' Tickets here come quick.'}` }),
    tonight: (c) => ({ title: '🌙 Move it tonight', body: `${c.block}${c.side} gets swept at ${night(c)} — move it before bed and wake up ticket-free.` }),
  },
  drill: {
    eve:  (c) => ({ title: '🧹 SWEEP DAY TOMORROW',  body: `${c.block}${c.side}, ${c.time} sharp. Consider yourself warned.` }),
    morn: (c) => ({ title: '⏰ T-MINUS A FEW HOURS', body: `${c.block}${c.side} sweeps at ${c.time}. Move the vehicle.` }),
    lead: (c, loud) => loud
      ? ({ title: `🚨 ${c.mins} MIN — NOT A DRILL`,  body: `MOVE THE CAR. ${c.block}${c.side} sweeps at ${c.time}. NOW.` })
      : ({ title: `🚨 ${c.mins} min — move the car`, body: `${c.block}${c.side} sweeps at ${c.time}. Go.` }),
    tonight: (c) => ({ title: '🌙 MOVE THE CAR TONIGHT', body: `${c.block}${c.side} sweeps at ${night(c)}. Do it before you sleep.` }),
  },
  deadpan: {
    eve:  (c) => ({ title: 'Street cleaning tomorrow',  body: `${c.block}${c.side}, ${c.time}.${c.tip ? ` Tickets here usually land ~${c.tip}.` : ''} Plan accordingly.` }),
    morn: (c) => ({ title: `The truck comes at ${c.time}`, body: `${c.block}${c.side} sweeps today.${c.tip ? ` Most tickets hit ~${c.tip}.` : ' 87% of tickets land in the first 45 min.'} Just saying.` }),
    lead: (c) => ({ title: `${c.block} sweeps in ~${c.mins} min`, body: `${c.tip ? `Tickets here land ~${c.tip}. ` : ''}The truck is punctual. Are you?` }),
    tonight: (c) => ({ title: `Street cleaning at ${night(c)}`, body: `${c.block}${c.side}, overnight.${c.tip ? ` Tickets here usually land ~${c.tip}.` : ''} Move it tonight.` }),
  },
};

/** Format an ISO instant as an SF wall-clock hour: "9 AM", "9:30 AM", "12 PM". */
export function sfHour(iso) {
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return s.replace(':00', ''); // "9:00 AM" -> "9 AM"; "9:30 AM" stays
}

function buildCtx(spot, now) {
  const sweep = Date.parse(spot.nextSweepISO);
  return {
    block: (spot.corridor && String(spot.corridor).trim()) || 'Your block',
    side: spot.blockside ? ` (${spot.blockside})` : '',
    time: sfHour(spot.nextSweepISO),
    mins: Math.max(1, Math.round((sweep - now) / 60000)),
    tip: (typeof spot.tip === 'string' && spot.tip.trim()) ? spot.tip.trim().slice(0, 14) : '',
  };
}

function render(touchpoint, voice, level, ctx) {
  const fn = (COPY[normVoice(voice)] || COPY[DEFAULT_VOICE])[touchpoint];
  return fn(ctx, level === 'intense');
}

/** The touchpoints a sweep will get: the level's cadence (minus a morning-of the SF-hour rule drops,
 *  e.g. a 7 AM sweep's 5 AM one), or just `tonight` for a night sweep. */
export function touchpointsFor(level, nextSweepISO) {
  const sweep = Date.parse(nextSweepISO);
  const tps = LEVELS[normLevel(level)].touchpoints;
  if (!Number.isFinite(sweep)) return tps;
  const a = alertAnchors(sweep);
  if (a.night) return ['tonight'];
  return a.morn ? tps : tps.filter((t) => t !== 'morn');
}

// Everything a transport needs: copy, collapse tag, when the push stops being worth delivering
// (web TTL / apns-expiration) and whether it is urgent (web Urgency: high + stays on screen).
const pack = (key, voice, level, ctx, expiresAt) =>
  ({ key, tag: TAGS[key], ...render(key, voice, level, ctx), expiresAt, urgent: Boolean(URGENT[key]) });

/** Which push (if any) is due for this spot right now, or null.
 *  @param notified  { eve?, morn?, lead?, tonight? } — each holds the nextSweepISO it last fired for (de-dupe)
 *  Priority order lead > morn > eve, but the windows are mutually exclusive in time, so at most one
 *  is ever due on a given tick. Returns { key, tag, title, body, expiresAt, urgent }. */
export function dueAlert(spot, notified, now) {
  if (!spot || !spot.nextSweepISO) return null;
  const n = notified || {};
  const iso = spot.nextSweepISO;
  const level = normLevel(spot.level);
  const voice = normVoice(spot.voice);
  const fires = LEVELS[level].touchpoints;
  const leadMs = Math.min(60, Math.max(15, Number(spot.leadMinutes) || 30)) * 60000;
  const sweep = Date.parse(iso);
  if (!Number.isFinite(sweep)) return null;
  const delta = sweep - now;
  const ctx = buildCtx(spot, now);
  const a = alertAnchors(sweep);

  // 0) night sweep — ONE "move it tonight" push, every level, computed from the sweep itself (not a
  //    stored anchor) so stored spots, cached old clients and late arming all get it: eligible from
  //    21:00 SF the evening before until shortly before the sweep. Any push already sent for this
  //    sweep (e.g. the old 8pm eve, before this rule shipped) counts — never a second one.
  if (a.night) {
    const sent = ['tonight', 'eve', 'morn', 'lead'].some((k) => n[k] === iso);
    if (!sent && now >= +a.tonight && delta >= MIN_LEFT) return pack('tonight', voice, level, ctx, sweep);
    return null;
  }
  // 1) lead — the final ~30-min "move your car", at every level (skipped with < MIN_LEFT to go)
  if (fires.includes('lead') && delta >= MIN_LEFT && delta <= leadMs && n.lead !== iso) {
    return pack('lead', voice, level, ctx, sweep);
  }
  // 2) morn — the morning-of heads-up (Intense), anchored ~2h before via spot.morningISO. Re-checked
  //    against the SF-hour rule here too: spots stored (or armed by a cached page) before the rule
  //    shipped can still carry a 4am / previous-evening anchor.
  if (fires.includes('morn') && spot.morningISO) {
    const m = Date.parse(spot.morningISO);
    if (Number.isFinite(m) && mornAllowed(m, sweep) && now >= m && now < m + MORN_GRACE && delta > leadMs && n.morn !== iso) {
      return pack('morn', voice, level, ctx, sweep - leadMs);
    }
  }
  // 3) eve — the calm night-before (~8pm SF), anchored via spot.eveningISO, eligible until
  //    min(23:00, sweep − lead)
  if (fires.includes('eve') && spot.eveningISO) {
    const e = Date.parse(spot.eveningISO);
    if (Number.isFinite(e) && now >= e && now < Math.min(e + EVE_SPAN, sweep - leadMs) && n.eve !== iso) {
      return pack('eve', voice, level, ctx, Math.min(e + EVE_EXPIRE, sweep - leadMs));
    }
  }
  return null;
}

/** The full planned cadence for a spot (no clock) — every push it WILL fire, with rendered copy and
 *  fire time. Powers ?dryRun QA, the in-app "preview all", and the unit tests. */
export function plannedTimeline(spot) {
  if (!spot || !spot.nextSweepISO) return [];
  const level = normLevel(spot.level);
  const voice = normVoice(spot.voice);
  const fires = LEVELS[level].touchpoints;
  const leadMs = Math.min(60, Math.max(15, Number(spot.leadMinutes) || 30)) * 60000;
  const sweep = Date.parse(spot.nextSweepISO);
  if (!Number.isFinite(sweep)) return [];
  const a = alertAnchors(sweep);
  if (a.night) {
    return [{ key: 'tonight', tag: TAGS.tonight, fireAtISO: a.tonight.toISOString(), ...render('tonight', voice, level, buildCtx(spot, +a.tonight)) }];
  }
  const out = [];
  if (fires.includes('eve') && spot.eveningISO) {
    const at = Date.parse(spot.eveningISO);
    out.push({ key: 'eve', tag: TAGS.eve, fireAtISO: spot.eveningISO, ...render('eve', voice, level, buildCtx(spot, at)) });
  }
  if (fires.includes('morn') && spot.morningISO && mornAllowed(Date.parse(spot.morningISO), sweep)) {
    const at = Date.parse(spot.morningISO);
    out.push({ key: 'morn', tag: TAGS.morn, fireAtISO: spot.morningISO, ...render('morn', voice, level, buildCtx(spot, at)) });
  }
  if (fires.includes('lead')) {
    const at = sweep - leadMs;
    out.push({ key: 'lead', tag: TAGS.lead, fireAtISO: new Date(at).toISOString(), ...render('lead', voice, level, buildCtx(spot, at)) });
  }
  return out.sort((a, b) => Date.parse(a.fireAtISO) - Date.parse(b.fireAtISO));
}

/** Render one specific touchpoint's copy on demand — used by the "send me a test" endpoint to push a
 *  single sample at a chosen level/voice. `mins` overrides the computed countdown for the lead sample. */
export function renderOne(spot, touchpoint, opts = {}) {
  const level = normLevel(opts.level ?? spot.level);
  const voice = normVoice(opts.voice ?? spot.voice);
  const now = Date.parse(spot.nextSweepISO) - (opts.mins != null ? opts.mins * 60000 : 30 * 60000);
  const ctx = buildCtx(spot, now);
  if (opts.mins != null) ctx.mins = opts.mins;
  const tp = ['eve', 'morn', 'lead', 'tonight'].includes(touchpoint) ? touchpoint : 'lead';
  return { key: tp, tag: TAGS[tp], ...render(tp, voice, level, ctx) };
}
