// scripts/cities/winter.mjs: the switch for a city's winter rule (data/<id>/winter.json).
import { describe, it, expect } from 'vitest';
import { comingNight, switchTo } from './winter.mjs';
import '../../lib/city-configs.js';

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

describe('the switch for a declared rule (Toronto\'s snow routes: all day while the City declares it)', () => {
  const toronto = { tz: 'America/Toronto', winter: { from: '2026-11-01', to: '2027-04-30', start: 0, end: 24, declared: true } };
  it('turns on from the day it is switched, and off when the City ends it', () => {
    const now = Date.parse('2027-01-26T23:30:00Z');   // 6:30 PM Jan 26 in Toronto
    expect(comingNight(now, toronto)).toBe('2027-01-26');
    expect(switchTo('on', { now, city: toronto, reason: 'Toronto declared a Major Snowstorm Condition.' }))
      .toEqual({ state: 'on', from: '2027-01-26', at: '2027-01-26T23:30:00.000Z', reason: 'Toronto declared a Major Snowstorm Condition.' });
    expect(switchTo('on', { now, city: toronto, from: '2027-01-27' }).from).toBe('2027-01-27');   // declared from tomorrow
    expect(switchTo('waiting', { now, city: toronto })).toEqual({ state: 'waiting' });
    expect(() => switchTo('on', { now, city: toronto, from: '2027-05-02' })).toThrow(/outside the season/);
  });
});

// A city's side-switching nights are listed ahead (Madison's season, Milwaukee's year), so a rebuild must come before they
// run out: this fails in time to rebuild, 60 days before a year's list ends, or by mid-September after a season ends.
describe('the listed nights', () => {
  for (const cfg of Object.values(globalThis.CITY_CONFIGS).filter((c) => c.winter)) {
    it(`${cfg.id}: rebuild before its nights run out (${cfg.winter.from} to ${cfg.winter.to})`, () => {
      const from = Date.parse(cfg.winter.from), to = Date.parse(cfg.winter.to), day = 864e5;
      const yearRound = to - from > 300 * day;
      const due = yearRound ? to - 60 * day : to + 180 * day;
      expect(Date.now(), `node scripts/cities/${cfg.id}.mjs for the next nights, then configs, city-page, check-city`).toBeLessThan(due);
    });
  }
});
