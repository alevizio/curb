// Boston's time rules and data helpers (lib/city-boston.js) on their own, outside the page.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

let BOS;
beforeAll(async () => { await import('./sweep-core.js'); await import('./city-boston.js'); BOS = globalThis.BOS; });
afterEach(() => { vi.useRealTimers(); });

const at = (iso) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };
const rule = (o = {}) => ({ weekday: 'Wed', fromhour: '8', tohour: '12', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1',
  months: [4, 5, 6, 7, 8, 9, 10, 11], ...o });

describe('Boston time', () => {
  it('reads the wall clock in Eastern time', () => {
    expect(BOS.core.parts(new Date(Date.UTC(2026, 9, 16, 16, 0)))).toMatchObject({ y: 2026, mo: 10, da: 16, h: 12, mi: 0 });
    expect(BOS.core.parts(new Date(Date.UTC(2026, 11, 1, 17, 30)))).toMatchObject({ h: 12, mi: 30 });   // EST in December
  });
  it('gives a sweep its Boston instant', () => {
    at('2026-10-19T12:00:00Z');                                          // Mon 8 AM in Boston
    const ns = BOS.core.nextSweep(rule());
    expect(ns.start.toISOString()).toBe('2026-10-21T12:00:00.000Z');     // Wed 8 AM EDT
  });
});

describe('Boston holidays', () => {
  it('skips daytime sweeping on a City holiday (Veterans Day, the 2nd Wednesday of November 2026)', () => {
    at('2026-11-10T17:00:00Z');
    const ns = BOS.core.nextSweep(rule({ week1: '0', week3: '0', week4: '0', week5: '0' }));   // 2nd Wednesday only
    expect(ns.y).toBe(2027);                                             // Nov 11 is off and December is out of season
    expect([ns.mo, ns.da]).toEqual([4, 14]);
  });
  it('keeps the overnight program on holidays', () => {
    at('2026-11-10T17:00:00Z');
    const ns = BOS.core.nextSweep(rule({ fromhour: '0', tohour: '7', months: undefined }));
    expect([ns.mo, ns.da, ns.fromH]).toEqual([11, 11, 0]);
  });
  it('treats Evacuation Day and Bunker Hill Day as normal days', () => {
    expect(BOS.suspended(rule(), '2026-03-17')).toBe(false);
    expect(BOS.suspended(rule(), '2026-06-17')).toBe(false);
    expect(BOS.suspended(rule(), '2026-11-26')).toBe(true);
  });
});

describe('the season', () => {
  it('stops after November and starts again in April', () => {
    at('2026-11-30T20:00:00Z');                                          // Mon Nov 30, 3 PM
    const ns = BOS.core.nextSweep(rule({ weekday: 'Tue' }));
    expect([ns.y, ns.mo, ns.da]).toEqual([2027, 4, 6]);                  // first Tuesday of April
  });
  it('says the season in words', () => {
    expect(BOS.seasonText([4, 5, 6, 7, 8, 9, 10, 11])).toBe('April to November');
    expect(BOS.seasonText([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('March to December');
    expect(BOS.seasonText(undefined)).toBeNull();
  });
});

const block = { c: '5082', s: 'Marlborough St', l: 'Arlington St - Berkeley St', h: 'Back Bay', n: [1, 52], o: 'R',
  g: [[-71.07206, 42.35466], [-71.07441, 42.35402]],
  d: [['L', 'South', [[1, 8, 12, 10, 2040, 2]]], ['R', 'North', [[1, 8, 12, 5, 2040, 2]]]] };

describe('rows for the page', () => {
  it('expands a block into one DataSF-shaped row per side and weekday', () => {
    const rows = BOS.rowsOf(block);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ cnn: '5082', corridor: 'Marlborough St', limits: 'Arlington St - Berkeley St', blockside: 'South',
      cnnrightleft: 'L', weekday: 'Mon', fromhour: '8', tohour: '12', week1: '0', week2: '1', week3: '0', week4: '1', week5: '0',
      months: [4, 5, 6, 7, 8, 9, 10, 11], tow: '1' });
    expect(rows[0].line.coordinates).toBe(block.g);
  });
  it('finds the blocks in a viewport and leaves a year-round rule without months', () => {
    const blocks = [{ ...block }, { ...block, c: '9', g: [[-71.0, 42.30], [-71.001, 42.30]], d: [['L', 'East', [[2, 0, 7, 31, 0, 1]]]] }];
    BOS.overview(blocks);                                               // no throw on raw blocks
    const idx = blocks.map((b) => { let w = 180, s = 90, e = -180, n = -90; for (const [lo, la] of b.g) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); } return { ...b, bb: [w, s, e, n] }; });
    expect(BOS.rowsIn(idx, -71.08, 42.35, -71.07, 42.36).map((r) => r.cnn)).toEqual(['5082', '5082']);
    expect(BOS.rowsOf(blocks[1])[0].months).toBeUndefined();
  });
});

describe('posted rules for a curb side', () => {
  it('lists the rules indexed for a block side (rules.json), and nothing for a side without any', () => {
    const R = { t: [['permit', { max: null, only: true, when: 'Every day, all day' }], ['snow', {}]], s: { '5082|L': [0, 1] } };
    expect(BOS.sideRules(R, '5082', 'L')).toEqual([R.t[0], R.t[1]]);
    expect(BOS.sideRules(R, 5082, 'R')).toEqual([]);
    expect(BOS.sideRules(null, '5082', 'L')).toEqual([]);
  });
});

describe('address search', () => {
  it('picks the block that holds the number and the side with its parity', () => {
    const other = { ...block, c: '5083', l: 'Berkeley St - Clarendon St', n: [53, 120] };
    expect(BOS.findAddress([block, other], 21, 'Marlborough Street')).toMatchObject({ block: { c: '5082' }, side: 'North' });   // odd → R
    expect(BOS.findAddress([block, other], 64, 'marlborough st')).toMatchObject({ block: { c: '5083' }, side: 'South' });     // even → L
    expect(BOS.findAddress([block], 10, 'Beacon St')).toBeNull();
  });
  it('puts the pin halfway along the block, not on its last point', () => {
    const [lo, la] = BOS.findAddress([block], 21, 'Marlborough St').at;                 // a two point line
    expect(lo).toBeCloseTo(-71.073235, 6); expect(la).toBeCloseTo(42.35434, 6);
    const bent = { ...block, g: [[-71.07, 42.35], [-71.07, 42.351], [-71.07, 42.354]] };  // middle vertex a quarter of the way
    expect(BOS.findAddress([bent], 21, 'Marlborough St').at[1]).toBeCloseTo(42.352, 6);
  });
});
