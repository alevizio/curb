// The hill reminder: which way to turn the wheels on a steep SF block, in one place for the block sheet (index.html) and the
// iPhone's Parked alert (api/parked-ios.js). San Francisco tickets a car left on a grade over 3% with its wheels not curbed
// (Transportation Code 7.2.35). The moves are the California DMV's and SFMTA's.
//
// An entry is data/grades.json's b[cnn] = [grade in tenths of a percent, 1 the block rises along its line / -1 falls / 0 both,
// way: B both, F with the line, T against it, '' unknown] (scripts/build-grades.mjs). A car parks with traffic, so the way
// traffic runs on its side and the way the block climbs say which way it faces.
(function (root) {
  const RULE = 3;
  const DOWN = 'wheels toward the curb.';
  const UP = 'wheels away from the curb, then let the car roll back until the tire touches it.';
  const BRAKE = 'Set the parking brake.';
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  /** 'uphill', 'downhill', or null when we can't say: a block that climbs and drops, an unknown way, or a two way street
   *  with no side (lr: the sweeping data's cnnrightleft, 'L' or 'R'). On a one way street both sides face the same way. */
  function hillFacing(dir, way, lr) {
    if (!dir) return null;
    const withLine = way === 'B' ? { R: true, L: false }[lr] : { F: true, T: false }[way];
    if (withLine === undefined) return null;
    return (dir > 0) === withLine ? 'uphill' : 'downhill';
  }

  /** The hand the curb is on for a car parked with traffic: the right, except on the left side of a one way street. */
  const curbHand = (way, lr) => ((way === 'F' && lr === 'L') || (way === 'T' && lr === 'R') ? 'left' : 'right');

  const label = (pct) => (pct > RULE ? 'Steep' : 'Sloped') + ' block';

  /** The block sheet's card for one side → { title, main, other, rule, facing, curb }, or null with no entry. */
  function hillAdvice(entry, lr) {
    if (!entry) return null;
    const pct = entry[0] / 10, facing = hillFacing(entry[1], entry[2], lr);
    const main = facing === 'uphill' ? `Facing uphill on this side: ${UP} ${BRAKE}`
      : facing === 'downhill' ? `Facing downhill on this side: ${DOWN} ${BRAKE}`
      : `Facing downhill: ${DOWN} Facing uphill: ${UP} ${BRAKE}`;
    const other = facing === 'uphill' ? `Facing downhill? ${cap(DOWN)}` : facing === 'downhill' ? `Facing uphill? ${cap(UP)}` : '';
    const rule = (pct > RULE ? 'SF requires this on blocks steeper than 3%.' : "Close to SF's 3% limit, so curb them anyway.") + ' Ticket:\u00a0$48.';
    // The grade itself stays internal (owner, 2026-11-09: "they don't care much about the percentage of incline"); the card
    // names the block and the rule. strip/stripSub are the one-row strip at the top of the sheet and the car pill's line.
    const strip = facing === 'uphill' ? 'Turn wheels away from the\u00a0curb' : facing === 'downhill' ? 'Turn wheels toward the\u00a0curb' : 'Curb your wheels on this\u00a0block';
    const stripSub = (pct > RULE ? 'Steep block. SF rule over 3%,' : "Sloped block, close to SF's 3% rule,") + ' $48\u00a0ticket';
    return { title: label(pct), main, other, rule, strip, stripSub, facing, curb: curbHand(entry[2], lr) };
  }

  /** The Parked alert's sentence, or null with no entry. GPS can't tell which side of a two way street the car is on (the
   *  saved side is the one swept soonest), so one move only where both sides face the same way, a one way street. */
  function hillAlert(entry) {
    if (!entry) return null;
    const pct = entry[0] / 10, facing = hillFacing(entry[1], entry[2], '');
    if (facing === 'uphill') return `${label(pct)}: wheels away from the curb, tire touching it.`;
    if (facing === 'downhill') return `${label(pct)}: wheels toward the curb.`;
    return `${label(pct)}. Facing downhill: wheels toward the curb. Facing uphill: wheels away, tire touching it.`;
  }

  root.hillAdvice = hillAdvice;
  root.hillAlert = hillAlert;
})(globalThis);
