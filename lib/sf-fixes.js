// Fixes to San Francisco's published street sweeping schedule (DataSF yhqp-riqs) for block sides where the City's own
// street cleaning tickets, and where we have one the posted sign, show the published rows are wrong. Every path that
// reads the schedule runs its rows through applySweepFixes: the map (index.html), the Parked alert (api/_park.js), the
// share image (api/og.js) and the baked files (scripts/build-schedules.mjs, build-overview.mjs, build-stats.mjs).
//
// A fix replaces one side's rows only while the City still publishes exactly the rows it was written against (`was`).
// Once the City changes that side, the City's rows win again and the fix goes quiet; staleSweepFixes lists those so
// they can be reviewed and removed. Fixed rows keep DataSF's own shape (strings, the side's line and cnnrightleft), so
// nothing downstream can tell them apart.
(function (root) {
  // Each schedule row is [weekday as DataSF spells it, from hour, to hour, weeks of the month as week1..week5 flags].
  const EVERY = '11111';
  const FIXES = [
    { cnn: '11834000', side: 'East', was: [['Wed', 12, 14, EVERY]], now: [['Thu', 8, 10, EVERY]],
      why: 'Shotwell St, 16th to 17th St. Posted sign "No parking 8 AM to 10 AM Thursday, street sweeping" (issue #66, '
        + 'photo 12-Nov-2026); 2026 tickets on the odd numbers every Thursday about 8 AM, none on a Wednesday.' },
    { cnn: '11833000', side: 'East', was: [['Wed', 12, 14, EVERY]], now: [['Mon', 8, 10, EVERY], ['Thu', 8, 10, EVERY]],
      why: 'Shotwell St, 15th to 16th St. Tickets on the odd numbers, Nov 2025 to Nov 2026: Mondays (75 on 32 dates) and '
        + 'Thursdays (46 on 30 dates), every week of the month, 8:04 to 8:26 AM; none on a Wednesday.' },
    { cnn: '11835000', side: 'East', was: [['Wed', 12, 14, EVERY]], now: [['Thu', 8, 10, EVERY]],
      why: 'Shotwell St, 17th to 18th St. Tickets on the odd numbers, Nov 2025 to Nov 2026: Thursdays (32 on 23 dates), '
        + 'every week of the month, about 8:13 AM; none on a Wednesday.' },
  ];

  const WEEKS = ['week1', 'week2', 'week3', 'week4', 'week5'];
  const rowSig = (weekday, from, to, weeks) => [weekday, +from, +to, weeks].join('|');
  const sigOf = (rows) => rows.map((r) => rowSig(r.weekday, r.fromhour, r.tohour, WEEKS.map((k) => r[k]).join(''))).sort().join(';');
  const wasSig = (f) => f.was.map((w) => rowSig(w[0], w[1], w[2], w[3])).sort().join(';');
  const onSide = (f) => (r) => String(r.cnn) === f.cnn && r.blockside === f.side;

  /** The City's rows with every fix that still applies. Rows must carry cnn, blockside, weekday, fromhour, tohour and
   *  week1..week5; a side whose rows differ from `was` in any way (or are missing) is left exactly as the City has it. */
  function applySweepFixes(rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    let out = rows;
    for (const f of FIXES) {
      const mine = onSide(f);
      const cur = rows.filter(mine);
      if (!cur.length || sigOf(cur) !== wasSig(f)) continue;
      const t = cur[0];
      const fixed = f.now.map((n) => {
        const r = Object.assign({}, t, { weekday: n[0], fromhour: String(n[1]), tohour: String(n[2]) });
        WEEKS.forEach((k, i) => { r[k] = n[3][i]; });
        return r;
      });
      out = out.filter((r) => !mine(r)).concat(fixed);
    }
    return out;
  }

  /** Fixes the City's current rows no longer match: the City changed that side, so the fix is off and needs a look.
   *  `rows` must hold every City row for the fixes' cnns. */
  function staleSweepFixes(rows) {
    return FIXES.filter((f) => sigOf((rows || []).filter(onSide(f))) !== wasSig(f));
  }

  root.SF_SWEEP_FIXES = FIXES;
  root.applySweepFixes = applySweepFixes;
  root.staleSweepFixes = staleSweepFixes;
})(globalThis);
