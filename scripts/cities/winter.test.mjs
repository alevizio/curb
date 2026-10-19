// scripts/cities/winter.mjs: the switch for a city's winter rule (data/<id>/winter.json).
import { describe, it, expect } from 'vitest';
import { comingNight, switchTo } from './winter.mjs';

const city = { tz: 'America/Chicago', winter: { from: '2026-11-15', to: '2027-03-15', start: 1, end: 7 } };

describe('the winter switch', () => {
  it('turns it on from the coming night: tonight\'s window, or this morning\'s while it is open', () => {
    expect(comingNight(Date.parse('2026-11-30T22:00:00Z'), city)).toBe('2026-12-01');   // 4 PM: tonight's window is Dec 1
    expect(comingNight(Date.parse('2026-12-01T09:00:00Z'), city)).toBe('2026-12-01');   // 3 AM: still that night
    expect(comingNight(Date.parse('2026-12-01T13:30:00Z'), city)).toBe('2026-12-02');   // 7:30 AM: the next one
  });
  it('writes the state, the first night, when and why', () => {
    const now = Date.parse('2026-11-30T22:10:00Z');
    expect(switchTo('on', { now, city, reason: 'Madison called its first plowing.' }))
      .toEqual({ state: 'on', from: '2026-12-01', at: '2026-11-30T22:10:00.000Z', reason: 'Madison called its first plowing.' });
    expect(switchTo('paused', { now, city })).toEqual({ state: 'paused', at: '2026-11-30T22:10:00.000Z' });
    expect(switchTo('waiting', { now, city })).toEqual({ state: 'waiting' });
    expect(switchTo('on', { now: Date.parse('2026-11-10T18:00:00Z'), city }).from).toBe('2026-11-15');   // switched on early
  });
  it('refuses a first night outside the season, a bad state, or a city without the rule', () => {
    expect(() => switchTo('on', { from: '2026-11-01', city })).toThrow(/outside the season/);
    expect(() => switchTo('on', { from: 'tomorrow', city })).toThrow(/YYYY-MM-DD/);
    expect(() => switchTo('enforced', { city })).toThrow(/state must be/);
    expect(() => switchTo('on', { city: { tz: 'America/Chicago' } })).toThrow(/no winter rule/);
  });
});
