// Tests for the shared spot/rule sanitizers (api/_spot.js) — the multi-rule forever-watch shape.
import { describe, it, expect } from 'vitest';
import { sanitizeSpot, sanitizeRules, sanitizeSide, MAX_RULES } from './_spot.js';

const R = (o = {}) => ({ weekday: 'Tue', fromhour: '6', tohour: '8', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0', ...o });
const SPOT = { corridor: 'Kansas St', limits: '16th St - 17th St', blockside: 'West', nextSweepISO: '2026-10-06T13:00:00.000Z', leadMinutes: 30, cnn: '7735000', sideKey: 'West' };

describe('sanitizeRules', () => {
  it('drops invalid rows one by one (a bad row must not sink the whole list)', () => {
    const out = sanitizeRules([R(), R({ weekday: 'Someday' }), R({ weekday: 'Fri' }), null, 'x', R({ fromhour: 'zz' })]);
    expect(out.map((r) => r.weekday)).toEqual(['tue', 'fri']);
  });
  it('keeps the side\'s weekday "Holiday" row (its posted holiday schedule) as a canonical "holiday" rule', () => {
    const out = sanitizeRules([R(), R({ weekday: 'Holiday', fromhour: '4', tohour: '6', holidays: '1' }), R({ weekday: 'HOLIDAY', fromhour: '4', tohour: '6', holidays: '1' })]);
    expect(out).toEqual([R({ weekday: 'tue' }), R({ weekday: 'holiday', fromhour: '4', tohour: '6', holidays: '1' })]); // duplicates collapse
    expect(sanitizeRules([R({ weekday: 'holiday' })])[0].weekday).toBe('holiday'); // a stored rule re-sanitizes to itself
  });
  it('collapses duplicates after canonicalizing', () => {
    expect(sanitizeRules([R(), R({ weekday: 'Tues' }), R({ week1: 1 })]).length).toBe(1);
  });
  it(`caps at ${MAX_RULES} distinct rules (30 real sides have 12)`, () => {
    const many = [];
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) for (const h of [0, 2, 4]) many.push(R({ weekday: d, fromhour: String(h), tohour: String(h + 2) }));
    expect(sanitizeRules(many).length).toBe(MAX_RULES);
    expect(sanitizeRules('nope')).toEqual([]);
  });
});

describe('sanitizeSpot — rules[] with rule kept for back-compat', () => {
  it('keeps every valid rule of the side and the soonest row as `rule`', () => {
    const s = sanitizeSpot({ ...SPOT, rule: R(), rules: [R({ weekday: 'Fri' }), R(), R({ weekday: 'Holiday' })] });
    expect(s.rule.weekday).toBe('tue');
    expect(s.rules.map((r) => r.weekday)).toEqual(['fri', 'tue', 'holiday']);
    expect(s.cnn).toBe('7735000');
    expect(s.sideKey).toBe('West');
  });
  it('a legacy client sending only `rule` still works (no rules field)', () => {
    const s = sanitizeSpot({ ...SPOT, rule: R() });
    expect(s.rule.weekday).toBe('tue');
    expect('rules' in s).toBe(false);
  });
  it('the holiday schedule can be the spot\'s `rule` (the sheet arms it the night before a minor holiday)', () => {
    const s = sanitizeSpot({ ...SPOT, rule: R({ weekday: 'Holiday', fromhour: '4', tohour: '6' }), rules: [R({ weekday: 'Mon', fromhour: '4', tohour: '6' }), R({ weekday: 'Holiday', fromhour: '4', tohour: '6' })] });
    expect(s.rule.weekday).toBe('holiday');
    expect(s.rules.map((r) => r.weekday)).toEqual(['mon', 'holiday']);
  });
  it('rules without a valid rule: rule falls back to the first rule, cnn/sideKey still kept', () => {
    const s = sanitizeSpot({ ...SPOT, rule: R({ weekday: 'Someday' }), rules: [R({ weekday: 'Fri' })] });
    expect(s.rule.weekday).toBe('fri');
    expect(s.cnn).toBe('7735000');
  });
  it('no valid rule at all degrades to a one-shot (no cnn/sideKey)', () => {
    const s = sanitizeSpot({ ...SPOT, rules: [R({ weekday: 'Someday' })] });
    expect(s.rule).toBe(undefined);
    expect(s.cnn).toBe(undefined);
  });
});

describe('sanitizeSide (which watch a Turn off names)', () => {
  it('clamps the side exactly like sanitizeSpot, so it compares equal to the stored spot', () => {
    const stored = sanitizeSpot({ ...SPOT, sideKey: 'Southwest', rule: R() });
    const side = sanitizeSide({ off: true, cnn: 'x7735000', sideKey: 'Southwest', corridor: SPOT.corridor, limits: SPOT.limits, blockside: SPOT.blockside });
    expect(side).toEqual({ cnn: stored.cnn, sideKey: stored.sideKey, corridor: stored.corridor, limits: stored.limits, blockside: stored.blockside });
    expect(side.sideKey).toBe('Southwes');                       // 8 chars, as stored
  });
  it('names nothing for a pre-multi-watch Turn off ({off:true}) or junk', () => {
    expect(sanitizeSide({ off: true })).toBe(null);
    expect(sanitizeSide({ off: true, sideKey: 'L' })).toBe(null); // a side key alone names no block
    expect(sanitizeSide(null)).toBe(null);
    expect(sanitizeSide('North')).toBe(null);
  });
});
