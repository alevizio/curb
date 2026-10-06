// Tests for the forever-watch re-arm (api/_schedule.js) under frozen clocks.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { recomputeSpot, watchDead, withHolidayRules, MAX_WATCH_AGE } from './_schedule.js';
import { sanitizeSpot } from './_spot.js';

afterEach(() => { vi.useRealTimers(); });

const RULE = { weekday: 'Wed', fromhour: '8', tohour: '10', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
// 2026-06-17 is a Wednesday; 8am PDT === 15:00 UTC.
const THIS_WED = Date.UTC(2026, 5, 17, 15, 0);
const NEXT_WED = Date.UTC(2026, 5, 24, 15, 0);

describe('recomputeSpot — forever-watch re-arm', () => {
  it('returns null while the stored occurrence is still upcoming (no early advance)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 19, 0))); // Mon before
    const spot = { nextSweepISO: new Date(THIS_WED).toISOString(), rule: RULE, leadMinutes: 30 };
    expect(recomputeSpot(spot)).toBe(null);
  });

  it('returns null DURING the sweep window (must not advance mid-sweep)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 17, 15, 30))); // Wed 8:30am PDT
    const spot = { nextSweepISO: new Date(THIS_WED).toISOString(), rule: RULE, leadMinutes: 30 };
    expect(recomputeSpot(spot)).toBe(null);
  });

  it('advances to the next occurrence once the window has ended', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 17, 18, 0))); // Wed 11am PDT (after 10am end)
    const spot = { nextSweepISO: new Date(THIS_WED).toISOString(), rule: RULE, leadMinutes: 30, corridor: 'Haight St' };
    const out = recomputeSpot(spot);
    expect(out).not.toBe(null);
    expect(out.nextSweepISO).toBe(new Date(NEXT_WED).toISOString());
    expect(out.corridor).toBe('Haight St');                 // carries the rest of the spot
    // eveningISO recomputed = 8pm PDT the night before next Wed (2026-06-23) = 2026-06-24T03:00Z
    expect(out.eveningISO).toBe(new Date(Date.UTC(2026, 5, 24, 3, 0)).toISOString());
  });

  it('skips a minor holiday for an overnight watch without a holiday schedule (Mon Oct 12 2026)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 19, 0))); // Mon Oct 5, after the 12-2 AM window
    const NIGHT = { ...RULE, weekday: 'Mon', fromhour: '0', tohour: '2', holidays: '1' };
    const out = recomputeSpot({ nextSweepISO: '2026-10-05T07:00:00.000Z', rule: NIGHT, rules: [NIGHT], leadMinutes: 30 });
    expect(out.nextSweepISO).toBe('2026-10-19T07:00:00.000Z');
  });

  it('advances through the side\'s holiday schedule: onto the minor holiday at its own hours, then back to the weekly rule', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 19, 0))); // Mon Oct 5, after the 2-6 AM window
    const MON = { ...RULE, weekday: 'mon', fromhour: '2', tohour: '6' }, HOL = { ...RULE, weekday: 'holiday', fromhour: '4', tohour: '6', holidays: '1' };
    const out = recomputeSpot({ nextSweepISO: '2026-10-05T09:00:00.000Z', rule: MON, rules: [MON, HOL], leadMinutes: 30 });
    expect(out.nextSweepISO).toBe('2026-10-12T11:00:00.000Z'); // Mon Oct 12 4 AM PDT, the holiday hours
    expect(out.eveningISO).toBe(undefined);                   // a night sweep: the 9 PM "move it tonight" push
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 13, 30))); // Mon Oct 12 6:30 AM, its window over
    expect(recomputeSpot(out).nextSweepISO).toBe('2026-10-19T09:00:00.000Z');
    // Thanksgiving sweeps nothing; the day after does, by the holiday schedule
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 24, 20, 0))); // Tue Nov 24
    const THU = { ...MON, weekday: 'thu' };
    expect(recomputeSpot({ nextSweepISO: '2026-11-19T10:00:00.000Z', rule: THU, rules: [THU, HOL] }).nextSweepISO).toBe('2026-11-27T12:00:00.000Z');
  });

  it('returns null for a spot without a rule (legacy one-shot, never auto-advances)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 17, 18, 0)));
    expect(recomputeSpot({ nextSweepISO: new Date(THIS_WED).toISOString() })).toBe(null);
  });
});

// Kansas St West (cnn 7735000) is swept Tue AND Fri 6-8; DataSF lists the Fri row first. A single
// `rule` alerted on only one of the two days forever. 2026-10-02 is a Friday.
const TUE = { ...RULE, weekday: 'Tue', fromhour: '9', tohour: '11' };
const FRI = { ...RULE, weekday: 'Fri', fromhour: '9', tohour: '11' };

describe('recomputeSpot — multi-rule sides', () => {
  it('advances to the EARLIEST next sweep across rules (Tue after the Fri window, then Fri again)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 2, 19, 0))); // Fri Oct 2, 12pm PDT (after 9-11)
    const spot = { nextSweepISO: '2026-10-02T16:00:00.000Z', rule: FRI, rules: [FRI, TUE], leadMinutes: 30 };
    const out = recomputeSpot(spot);
    expect(out.nextSweepISO).toBe('2026-10-06T16:00:00.000Z'); // Tue Oct 6 9am PDT, not Fri Oct 9
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 6, 19, 0)));   // Tue after its window
    expect(recomputeSpot(out).nextSweepISO).toBe('2026-10-09T16:00:00.000Z');
  });

  it('a legacy watch that stored the later day is corrected to the earlier one', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 17, 0))); // Sat Oct 3
    const out = recomputeSpot({ nextSweepISO: '2026-10-09T16:00:00.000Z', rule: FRI, rules: [FRI, TUE] });
    expect(out.nextSweepISO).toBe('2026-10-06T16:00:00.000Z');
  });

  it('a rule-only (legacy) record still re-arms off its single rule', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 2, 19, 0)));
    expect(recomputeSpot({ nextSweepISO: '2026-10-02T16:00:00.000Z', rule: FRI }).nextSweepISO).toBe('2026-10-09T16:00:00.000Z');
  });

  it('overlapping windows (Mon 7-8 then 8-10): advances to the already-started second window, which then gets no lead push', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 15, 1))); // Mon Oct 5 8:01am PDT
    const A = { ...RULE, weekday: 'Mon', fromhour: '7', tohour: '8' }, B = { ...RULE, weekday: 'Mon', fromhour: '8', tohour: '10' };
    const out = recomputeSpot({ nextSweepISO: '2026-10-05T14:00:00.000Z', rules: [A, B], rule: A });
    expect(out.nextSweepISO).toBe('2026-10-05T15:00:00.000Z');
  });
});

describe('a side\'s holiday schedule, end to end: page rules → saved spot → cron re-arm', () => {
  it('round-trips the DataSF Holiday row and re-arms onto the minor holiday, then off it', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 9, 19, 0))); // Fri Oct 9 noon PDT
    // the rows as the page holds them (DataSF yhqp-riqs), through its ruleOf (index.html openSheet)
    const row = (weekday, f, t, h = '0') => ({ weekday, fromhour: f, tohour: t, week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: h });
    const rows = [row('Mon', '4', '6'), row('Fri', '4', '6'), row('Holiday', '4', '6')];
    const spot = sanitizeSpot({ corridor: 'Columbus Ave', blockside: 'SouthWest', nextSweepISO: '2026-10-16T11:00:00.000Z', leadMinutes: 30,
      rule: rows[1], rules: rows, cnn: '4301000', sideKey: 'SouthWest' });
    expect(spot.rules.map((r) => r.weekday)).toEqual(['mon', 'fri', 'holiday']);
    expect(sanitizeSpot(spot).rules).toEqual(spot.rules); // the stored shape re-sanitizes to itself
    // the cron corrects it to the earliest sweep: Mon Oct 12 4 AM by the holiday schedule (the Mon row is off)
    const out = recomputeSpot(spot);
    expect(out.nextSweepISO).toBe('2026-10-12T11:00:00.000Z');
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 13, 5)));                       // Mon 6:05 AM, over
    expect(recomputeSpot(out).nextSweepISO).toBe('2026-10-16T11:00:00.000Z');       // Fri Oct 16 4 AM
  });
});

// A watch saved before 2026-10-05 has no Holiday rule (the page and server of the time dropped it); the cron adds its
// side's rows from data/schedules.json (here: Columbus Ave, Lombard to Taylor, as baked) before it re-arms.
describe('withHolidayRules — an old watch gets its side\'s posted holiday schedule', () => {
  const row = (weekday, f = '4', t = '6') => ({ weekday, fromhour: f, tohour: t, week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' });
  const BAKED = { 4301000: [['Southwest', 7, 4, 6, 31, 0]], 227102: [['', 7, 2, 6, 31, 1]] };
  const rowsOf = (cnn) => BAKED[cnn] || null;
  const old = (o = {}) => sanitizeSpot({ corridor: 'Columbus Ave', blockside: 'SouthWest', nextSweepISO: '2026-10-12T11:00:00.000Z', leadMinutes: 30,
    rule: row('Mon'), rules: ['Mon', 'Wed', 'Fri', 'Sat'].map((d) => row(d)), cnn: '4301000', sideKey: 'SouthWest', ...o });
  const HOL = { weekday: 'holiday', fromhour: '4', tohour: '6', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };

  it('adds the side\'s Holiday rule (blockside, any case), in the shape a new page saves', () => {
    const out = withHolidayRules(old(), rowsOf);
    expect(out.rules.map((r) => r.weekday)).toEqual(['mon', 'wed', 'fri', 'sat', 'holiday']);
    expect(out.rules[4]).toEqual(HOL);
    expect(out.rules[4]).toEqual(sanitizeSpot({ ...old(), rules: [row('Holiday')] }).rules[0]);
    expect(out.rule).toEqual(old().rule);                                  // the back-compat rule stays
    expect(withHolidayRules(old({ blockside: 'southwest' }), rowsOf).rules).toEqual(out.rules);
    // no blockside: the sideKey, clamped to 8 ('Southwes'), names the side
    expect(withHolidayRules(old({ blockside: '' }), rowsOf).rules).toEqual(out.rules);
    // a side-less block keyed only by L/R/C is never filled: the bake merges both directions, and on 12 such
    // blocks (e.g. The Embarcadero 12553102, Market St 8746102) only one direction posts a holiday schedule
    const lr = old({ cnn: '227102', blockside: '', sideKey: 'R' });
    expect(withHolidayRules(lr, rowsOf)).toBe(lr);
    const emb = old({ cnn: '12553102', blockside: '', sideKey: 'R' });
    expect(withHolidayRules(emb, () => [['', 7, 1, 6, 31, 1]])).toBe(emb);
    // a legacy record with only `rule`
    expect(withHolidayRules({ ...old(), rules: undefined }, rowsOf).rules.map((r) => r.weekday)).toEqual(['mon', 'holiday']);
  });

  it('and re-arms it onto Indigenous Peoples Day at its holiday hours, where the old rules skip the holiday', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 10, 14, 0))); // Sat Oct 10 7 AM PDT, Sat's sweep over
    const spot = old({ nextSweepISO: '2026-10-10T11:00:00.000Z' });
    expect(recomputeSpot(spot).nextSweepISO).toBe('2026-10-14T11:00:00.000Z');   // without it: Wed, the holiday skipped
    expect(recomputeSpot(withHolidayRules(spot, rowsOf)).nextSweepISO).toBe('2026-10-12T11:00:00.000Z');
  });

  it('leaves every other watch exactly as stored (the same object)', () => {
    const ne = old({ blockside: 'Northeast', sideKey: 'Northeas', rules: ['Tue', 'Thu', 'Sun'].map((d) => row(d)), rule: row('Tue') });
    const has = old({ rules: [row('Mon'), row('Holiday')] });
    const oneShot = sanitizeSpot({ corridor: 'Columbus Ave', blockside: 'Southwest', nextSweepISO: '2026-10-12T11:00:00.000Z' });
    for (const s of [ne, has, oneShot, old({ cnn: '999' }), old({ blockside: 'North' }), null]) expect(withHolidayRules(s, rowsOf)).toBe(s);
  });
});

describe('recomputeSpot — anchors follow the shared SF-hour rule', () => {
  const advanceTo = (fromhour) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 17, 21, 0))); // Wed 2pm PDT, all windows over
    const r = { ...RULE, fromhour: String(fromhour), tohour: String(fromhour + 2) };
    return recomputeSpot({ nextSweepISO: '2026-06-17T00:00:00.000Z', rule: r, eveningISO: 'x', morningISO: 'y' });
  };
  it('8 AM: eve 8pm the night before + morn 6am', () => {
    const out = advanceTo(8);
    expect(out.eveningISO).toBe('2026-06-24T03:00:00.000Z');
    expect(out.morningISO).toBe('2026-06-24T13:00:00.000Z');
  });
  it('7 AM: eve but no 5am morning-of', () => {
    const out = advanceTo(7);
    expect(out.eveningISO).toBe('2026-06-24T03:00:00.000Z');
    expect('morningISO' in out).toBe(false);
  });
  it('midnight / 2 AM (night sweeps): neither anchor — the send-time "tonight" push covers them', () => {
    for (const h of [0, 2]) {
      const out = advanceTo(h);
      expect('eveningISO' in out, `${h}`).toBe(false);
      expect('morningISO' in out, `${h}`).toBe(false);
    }
  });
});

describe('watchDead — a watch that can never push again (it may give up its slot)', () => {
  const end = THIS_WED + 2 * 36e5;          // the 8-10am window
  const spot = { nextSweepISO: new Date(THIS_WED).toISOString(), rule: RULE, rules: [RULE], leadMinutes: 30 };
  const stale = end - MAX_WATCH_AGE - 864e5, fresh = end - 864e5;
  it('stale (past MAX_WATCH_AGE, the cron no longer re-arms it): dead only once its window is over', () => {
    expect(MAX_WATCH_AGE).toBe(120 * 864e5);
    expect(watchDead({ spot, savedAt: stale }, end - 60000)).toBe(false);   // mid-sweep: never
    expect(watchDead({ spot, savedAt: stale }, end)).toBe(true);
  });
  it('fresh: never dead (the cron re-arms it on its next tick), and neither is a turned-off watch', () => {
    expect(watchDead({ spot, savedAt: fresh }, end + 30 * 864e5)).toBe(false);
    expect(watchDead({ spot, savedAt: undefined }, end + 30 * 864e5)).toBe(false); // no savedAt = not stale, as the cron reads it
    expect(watchDead({ spot: null, savedAt: stale }, end + 864e5)).toBe(false);
  });
  it('a one-shot spot (no rule): dead a day after its sweep started, however fresh', () => {
    const one = { nextSweepISO: spot.nextSweepISO, leadMinutes: 30 };
    expect(watchDead({ spot: one, savedAt: fresh }, THIS_WED + 864e5 - 60000)).toBe(false);
    expect(watchDead({ spot: one, savedAt: fresh }, THIS_WED + 864e5)).toBe(true);
  });
  it('the longest window among the side\'s rules counts', () => {
    const long = { ...RULE, weekday: 'Wed', fromhour: '8', tohour: '14' };
    const both = { ...spot, rules: [RULE, long] };
    expect(watchDead({ spot: both, savedAt: stale }, end + 36e5)).toBe(false);
    expect(watchDead({ spot: both, savedAt: stale }, THIS_WED + 6 * 36e5)).toBe(true);
  });
});
