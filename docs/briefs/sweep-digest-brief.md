# Design Brief — Sweep-Day Digest ("Your Car" loop)

_Shaped 2026-06-09 via /impeccable-shape. Decisions: single-spot (the parked car) ·
evening push + in-app strip · primary action = "help me move it" · pin arms everything._

## 1. Feature Summary
CURB learns where your car is from the existing "tap where you parked" gesture and then
watches that one spot: a persistent in-app status strip answers "is my car safe?" the
moment the app opens, and an evening-before push warns about tomorrow's sweep while
there's still time to move — then helps you actually find a safe block. This turns CURB
from a lookup tool into a loop: pin → warned → moved → re-pinned.

## 2. Primary User Action
**Re-pin the car on a safe block.** Every surface funnels to it: the warning push opens
the map in "find a safe spot" mode (clear-through-tomorrow curbs highlighted, everything
else dimmed); parking and tapping the new curb re-pins and silently re-arms both alerts.
The warning is only the trigger — the *job* is the move.

## 3. Design Direction
Per `.impeccable.md`: civic-notice tone, signage system (paper/ink, Anton + Hanken, hard
offset shadows, AA `-text` status tokens). The strip is a small official notice pinned to
the map — calm green by default, never shouty until the data says so. Push copy is
precise and time-anchored, hedged exactly like the sheet ("posted sign is the source of
truth"). No celebration animations; the reward is quiet: a green strip.

## 4. Layout Strategy
- **Strip**: docks under the top cluster (left-aligned, same width rhythm as the search
  field on desktop; full-width chip on mobile). One line: 📍 + block name + verdict +
  chevron. Tapping opens the sheet for the pinned block. It is the *only* persistent
  element that may use a status background tint.
- **Safe-spot mode**: not a new screen — the existing map with a mode banner ("Finding a
  spot safe through Wed 9am · [exit]"), non-qualifying curbs at ~25% opacity, qualifying
  ones full. Your car stays visible as the anchor.
- **Sheet addition**: when the tapped block == pinned block, the sheet's verdict region
  gains the car context ("Your car has been here since Mon 6pm") and 🔔 becomes
  "Watching · mute".

## 5. Key States
| State | Behavior |
|---|---|
| No pin (first run) | Strip teaches: "📍 Tap the curb where you parked — CURB watches it for you." Dismissible, returns after 7 days. |
| Pinned, clear | Green strip: "Your car · 214 Steiner · clear until Wed 9am". |
| Pinned, sweep <24h | Amber/red strip: "⚠ Sweeps tomorrow 9–11am · 🎯 usually 9:11" + "Find a safe spot →". |
| Sweeping NOW | Red strip, pulses once on open (reduced-motion safe): "Sweeping now until 11am". |
| Stale pin (>7 days) | Strip asks: "Still parked on Steiner? [Yes] [Re-pin]" — keeps data honest. |
| Push permission denied / unsupported | Strip fully functional; small "alerts off" affix links to browser settings / iOS install hint (existing). |
| No 🎯 data for block | Omit the ticket-time line everywhere; never show empty stats. |
| Block with no upcoming sweep | "No sweeping scheduled — check the posted sign." |
| Loading/offline | Strip renders from localStorage immediately (pin + last verdict cached); recomputes when data arrives. |

## 6. Interaction Model
- **Pin** (existing tap) → persists `{cnn, sideKey, latlng, rules, pinnedAt}` to
  localStorage → subscribes push (one permission ask ever; iOS keeps the install-hint
  divert) → toast: "Watching 214 Steiner — Wed & Fri. We'll warn you the night before."
- **Evening push** (~8:30pm SF time, only if the pinned block sweeps in the next ~14h):
  "🧹 Car on Steiner — sweeps tomorrow 9–11am (🎯 usually 9:11). Move it tonight?"
  → tap opens `/?move=1` → safe-spot mode.
- **30-min push**: unchanged, last line of defense.
- **Re-pin in move mode**: tap a highlighted curb → pin transfers, alerts re-arm, mode
  exits, toast confirms next watch date. No confirmation dialog — undo via re-tap.
- **Mute**: sheet "Watching · mute" toggles server sub off but keeps the strip.

## 7. Content Requirements
- Strip verdicts (≤42 chars): clear / tomorrow / today / now / stale / teach.
- Push title+body pairs: warn-with-🎯, warn-without-🎯, sweeping-now fallback. Body must
  carry block + window + action in ≤120 chars.
- Mode banner copy + exit. Re-pin toast with next sweep day. Mute/unmute microcopy.
- All times in the block's local wall-clock; never "in X hours" in pushes (they can sit unread).

## 8. Recommended References
- Tokens/components: `.impeccable.md`; strip reuses `.toggle`/chip idiom; verdict colors
  via `--*-text` tokens on paper tints.
- Code: `placeYou()` (pin gesture — note it resets dayFilter; move-mode must coexist),
  `onAlertTap()` (subscription flow to absorb), `api/_store.js` + `api/send-notifications.js`
  (extend: spot gains `rules` for recurrence + a `digest` flag; cron gains the evening pass),
  `enforcement.json`/`enfFor()` (🎯 lines), `sw.js` (`notificationclick` already routes `url`).
- Precedent in-app: the iOS install hint pattern for permission diverts.

## 9. Open Questions
1. **Server recurrence** — the store today holds one `nextSweepISO` (one-shot by design).
   Digest wants forever-watching: ship the pin's sweep `rules` to the server and compute
   next occurrences there (real fix), or keep one-shot and re-arm client-side whenever the
   app opens (ships sooner, silently lapses for users who never reopen)?
2. **Cron timing** — evening pass needs an ~8:30pm SF run; Vercel Hobby throttles the
   15-min cron (existing known issue). Same external-scheduler workaround, or move both
   passes to one daily + one 15-min job?
3. **"Safe through" definition** — clear until after tomorrow's window, or a flat 24h?
   (Recommend: clear until tomorrow 11:59pm; flat 24h windows mislead on 2x/week blocks.)
4. **Pin staleness expiry** — auto-expire the watch after N quiet days, or only the
   "still parked?" nudge? (Recommend: nudge at 7d, never silent expiry.)
5. **Snooze** — does the evening push need "remind me at 8am", or is the 30-min alert
   enough of a second touch? (Recommend: ship without; add if users ask.)
