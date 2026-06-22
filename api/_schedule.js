// Re-arm logic for the push "forever-watch" — kept pure (a helper, not a routed function) so it
// can be unit-tested under frozen clocks without touching the store or web-push.
//
// Side-effect import: the SF time core attaches nextSweep/sfWallToInstant to globalThis.
import '../lib/sweep-core.js';
const { nextSweep, sfWallToInstant } = globalThis;

/** Given a stored spot carrying a recurring `rule`, return an ADVANCED spot when the sweep has
 *  rolled to a new occurrence (i.e. nextSweep() no longer matches spot.nextSweepISO), else null.
 *  Pure w.r.t. the clock: nextSweep() reads the current time, so freeze it in tests.
 *
 *  Correctness note (the trap): at ~30-min-lead time nextSweep() still returns the SAME instant,
 *  so this returns null then — the advance only happens on the first tick AFTER the window ends,
 *  when nextSweep() skips today and rolls forward. Re-arm must therefore be its own pass, never
 *  coupled to "right after the lead push fired". */
export function recomputeSpot(spot) {
  if (!spot || !spot.rule) return null;
  const ns = nextSweep(spot.rule);
  if (!ns) return null; // rule no longer yields an occurrence (e.g. holiday table exhausted)
  const iso = ns.start.toISOString();
  if (iso === spot.nextSweepISO) return null; // unchanged — nothing to advance
  // night-before (~8pm SF the previous calendar day) recomputed for the new occurrence
  const prev = new Date(Date.UTC(ns.y, ns.mo - 1, ns.da) - 864e5);
  const eve = sfWallToInstant(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 20);
  const out = { ...spot, nextSweepISO: iso };
  if (+eve < +ns.start) out.eveningISO = eve.toISOString();
  else delete out.eveningISO;
  // morning-of (~2h before the sweep) — the Intense level's extra ping. A fixed offset, so DST-safe.
  const morn = new Date(+ns.start - 2 * 3600 * 1000);
  if (+morn < +ns.start && +morn > +eve) out.morningISO = morn.toISOString();
  else delete out.morningISO;
  return out;
}
