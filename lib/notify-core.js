// CURB notification cadence + copy — the single source of truth for WHICH push fires WHEN and WHAT
// it says. Pure + side-effect-free (no clock, no store, no transport) so it can be unit-tested under
// frozen clocks and reused identically by web-push and APNs. Imported by api/send-notifications.js
// (delivery) and api/test-notification.js (the user-facing "send me a test").
//
// Two user dials, both stored on the spot:
//   spot.level : 'light' | 'normal' | 'intense'  — HOW MANY pushes (the cadence)
//   spot.voice : 'cheeky' | 'drill' | 'deadpan'   — the personality of the copy
// Plus optional spot.tip (e.g. "9:14am") = the block's real average ticket time, woven in when present.

// ---- cadence: which touchpoints each intensity level fires ----
// A touchpoint fires at most ONCE per sweep (de-duped by the store) on the first 15-min cron tick
// inside its window. Every window is >= 15 min wide (the cron interval) so a tick can never fall
// between and skip it — eve/morn via explicit grace tails, lead via the leadMinutes floor of 15.
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
// 15-min cron interval so no tick is ever skipped). The lead push uses a delta window instead.
const EVE_GRACE = 45 * 60000;
const MORN_GRACE = 50 * 60000;

// Tags drive collapse/replace on both transports — one id per touchpoint so a newer push for the
// same sweep replaces an older one rather than stacking.
const TAGS = { eve: 'curb-sweep-eve', morn: 'curb-sweep-morn', lead: 'curb-sweep' };

// ---- copy matrix: COPY[voice][touchpoint](ctx, loud) -> { title, body } ----
// ctx = { block, side, time, mins, tip }. `loud` is true at the Intense level (escalates the lead).
const COPY = {
  cheeky: {
    eve:  (c) => ({ title: '🧹 Sweep day tomorrow',     body: `${c.block}${c.side} gets cleaned at ${c.time} — move tonight and skip the scramble.` }),
    morn: (c) => ({ title: '☀️ Heads up — sweep today', body: `${c.block}${c.side} sweeps at ${c.time}, a couple hours out. Don't fund the city today.` }),
    lead: (c, loud) => loud
      ? ({ title: `🚗 Move it — ~${c.mins} min`, body: `${c.block}${c.side} sweeps at ${c.time}. Last easy chance before a $108 ticket.` })
      : ({ title: '🚗 Move the car',             body: `${c.block}${c.side} sweeps in ~${c.mins} min.${c.tip ? ` Tickets here land ~${c.tip}.` : ' Tickets here come quick.'}` }),
  },
  drill: {
    eve:  (c) => ({ title: '🧹 SWEEP DAY TOMORROW',  body: `${c.block}${c.side}, ${c.time} sharp. Consider yourself warned.` }),
    morn: (c) => ({ title: '⏰ T-MINUS A FEW HOURS', body: `${c.block}${c.side} sweeps at ${c.time}. Move the vehicle.` }),
    lead: (c, loud) => loud
      ? ({ title: `🚨 ${c.mins} MIN — NOT A DRILL`,  body: `MOVE THE CAR. ${c.block}${c.side} sweeps at ${c.time}. NOW.` })
      : ({ title: `🚨 ${c.mins} min — move the car`, body: `${c.block}${c.side} sweeps at ${c.time}. Go.` }),
  },
  deadpan: {
    eve:  (c) => ({ title: 'Street cleaning tomorrow',  body: `${c.block}${c.side}, ${c.time}.${c.tip ? ` Tickets here usually land ~${c.tip}.` : ''} Plan accordingly.` }),
    morn: (c) => ({ title: `The truck comes at ${c.time}`, body: `${c.block}${c.side} sweeps today.${c.tip ? ` Most tickets hit ~${c.tip}.` : ' 87% of tickets land in the first 45 min.'} Just saying.` }),
    lead: (c) => ({ title: `${c.block} sweeps in ~${c.mins} min`, body: `${c.tip ? `Tickets here land ~${c.tip}. ` : ''}The truck is punctual. Are you?` }),
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

/** Which push (if any) is due for this spot right now, or null.
 *  @param notified  { eve?, morn?, lead? } — each holds the nextSweepISO it last fired for (de-dupe)
 *  Priority order lead > morn > eve, but the windows are mutually exclusive in time, so at most one
 *  is ever due on a given tick. Returns { key, tag, title, body }. */
export function dueAlert(spot, notified, now) {
  if (!spot || !spot.nextSweepISO) return null;
  const n = notified || {};
  const level = normLevel(spot.level);
  const voice = normVoice(spot.voice);
  const fires = LEVELS[level].touchpoints;
  const leadMs = Math.min(60, Math.max(15, Number(spot.leadMinutes) || 30)) * 60000;
  const sweep = Date.parse(spot.nextSweepISO);
  if (!Number.isFinite(sweep)) return null;
  const delta = sweep - now;
  const ctx = buildCtx(spot, now);

  // 1) lead — the final ~30-min "move your car", at every level
  if (fires.includes('lead') && delta > 0 && delta <= leadMs && n.lead !== spot.nextSweepISO) {
    return { key: 'lead', tag: TAGS.lead, ...render('lead', voice, level, ctx) };
  }
  // 2) morn — the morning-of heads-up (Intense), anchored ~2h before via spot.morningISO
  if (fires.includes('morn') && spot.morningISO) {
    const m = Date.parse(spot.morningISO);
    if (Number.isFinite(m) && now >= m && now < m + MORN_GRACE && delta > leadMs && n.morn !== spot.nextSweepISO) {
      return { key: 'morn', tag: TAGS.morn, ...render('morn', voice, level, ctx) };
    }
  }
  // 3) eve — the calm night-before (~8pm SF), anchored via spot.eveningISO
  if (fires.includes('eve') && spot.eveningISO) {
    const e = Date.parse(spot.eveningISO);
    if (Number.isFinite(e) && now >= e && now < e + EVE_GRACE && delta > leadMs && n.eve !== spot.nextSweepISO) {
      return { key: 'eve', tag: TAGS.eve, ...render('eve', voice, level, ctx) };
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
  const out = [];
  if (fires.includes('eve') && spot.eveningISO) {
    const at = Date.parse(spot.eveningISO);
    out.push({ key: 'eve', tag: TAGS.eve, fireAtISO: spot.eveningISO, ...render('eve', voice, level, buildCtx(spot, at)) });
  }
  if (fires.includes('morn') && spot.morningISO) {
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
  const tp = ['eve', 'morn', 'lead'].includes(touchpoint) ? touchpoint : 'lead';
  return { key: tp, tag: TAGS[tp], ...render(tp, voice, level, ctx) };
}
