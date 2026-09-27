// Re-arm logic for the push "forever-watch" — kept pure (a helper, not a routed function) so it
// can be unit-tested under frozen clocks without touching the store or web-push.
//
// Side-effect import: the SF time core attaches nextSweep/alertAnchors to globalThis.
import '../lib/sweep-core.js';
const { nextSweep, alertAnchors } = globalThis;

/** Given a stored spot carrying its recurring `rules` (or a legacy single `rule`), return an ADVANCED
 *  spot when the sweep has rolled to a new occurrence — the EARLIEST next sweep across the rules no
 *  longer matches spot.nextSweepISO — else null. The earliest next occurrence never moves earlier, so
 *  this can't flap; an overlapping second window that has already started gets no lead push.
 *  Pure w.r.t. the clock: nextSweep() reads the current time, so freeze it in tests.
 *
 *  Correctness note (the trap): at ~30-min-lead time nextSweep() still returns the SAME instant,
 *  so this returns null then — the advance only happens on the first tick AFTER the window ends,
 *  when nextSweep() skips today and rolls forward. Re-arm must therefore be its own pass, never
 *  coupled to "right after the lead push fired". */
export function recomputeSpot(spot) {
  if (!spot) return null;
  const rules = Array.isArray(spot.rules) && spot.rules.length ? spot.rules : spot.rule ? [spot.rule] : [];
  let ns = null;
  for (const r of rules) {
    const n = nextSweep(r);
    if (n && (!ns || +n.start < +ns.start)) ns = n;
  }
  if (!ns) return null; // no occurrence within nextSweep's 150-day scan (e.g. a rule the city dropped)
  const iso = ns.start.toISOString();
  if (iso === spot.nextSweepISO) return null; // unchanged — nothing to advance
  // Anchors from the ONE rule the page also uses (lib/sweep-core.js alertAnchors): eve = 8pm SF the
  // evening before; morn only when start−2h lands 06:00-21:59 SF on the sweep day. A night sweep
  // (before 7am) carries neither — it gets the "tonight" push, derived at send time.
  const a = alertAnchors(ns.start);
  const out = { ...spot, nextSweepISO: iso };
  if (!a.night && +a.eve < +ns.start) out.eveningISO = a.eve.toISOString();
  else delete out.eveningISO;
  if (!a.night && a.morn) out.morningISO = a.morn.toISOString();
  else delete out.morningISO;
  return out;
}
