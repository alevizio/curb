// What lib/sweep-core.js reads for the other cities (docs/multi-city/city-build.md): hours with minutes, rules on
// listed dates, and windows that end the next morning. San Francisco's whole-hour, weekday rows must read exactly
// as before: the last block compares the new formatting with the old one for every whole hour.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

beforeAll(async () => { await import('./sweep-core.js'); });
afterEach(() => { vi.useRealTimers(); });

const G = globalThis;
const weekly = (o = {}) => ({ weekday: 'Tue', fromhour: '9:30', tohour: '11:30', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', ...o });

describe('hours with minutes', () => {
  it('reads whole hours as before and "H:MM" as a fraction', () => {
    expect(G.toHours('8')).toBe(8);
    expect(G.toHours(8)).toBe(8);
    expect(G.toHours('9:30')).toBe(9.5);
    expect(G.toHours('13:45')).toBe(13.75);
    expect(G.toHours('')).toBeNaN();
  });
  it('writes minutes only when there are some', () => {
    expect(G.fmtHour('9:30')).toBe('9:30AM');
    expect(G.fmtHour(13.5)).toBe('1:30PM');
    expect(G.fmtHour('0:15')).toBe('12:15AM');
    expect(G.fmtHour('12')).toBe('12PM');
  });
  it('words a window with minutes, day and night', () => {
    const day = G.sweepDayWords(2026, 10, 20, '9:30', '11:30');
    expect(day.win).toBe('9:30AM to 11:30AM');
    expect(day.head).toBe('Tue 9:30AM');
    const night = G.sweepDayWords(2026, 10, 20, '0:30', '2:30');
    expect(night.win).toBe('Tue 12:30 to 2:30 AM');
  });
  it('starts and ends a window on the minute, in the city\'s time zone', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 19, 12, 0)));   // Mon 2026-10-19, 8 AM in New York
    const ny = G.makeTimeCore({ tz: 'America/New_York' });
    const ns = ny.nextSweep(weekly());
    expect(ns.start.getTime()).toBe(Date.UTC(2026, 9, 20, 13, 30));   // Tue 9:30 AM EDT
    expect(ns.end.getTime()).toBe(Date.UTC(2026, 9, 20, 15, 30));
    expect(ns.fromH).toBe(9.5);
  });
});

describe('rules on listed dates', () => {
  const listed = (o = {}) => ({ dates: ['2026-11-02', '2026-10-19'], fromhour: '8', tohour: '18', ...o });
  it('gives the first listed date whose window has not ended, in any order', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 18, 19, 0)));   // Sun 2026-10-18, noon in Saint Paul
    const core = G.makeTimeCore({ tz: 'America/Chicago' });
    const ns = core.nextSweep(listed());
    expect([ns.y, ns.mo, ns.da, ns.dow]).toEqual([2026, 10, 19, 1]);
    expect(ns.start.getTime()).toBe(Date.UTC(2026, 9, 19, 13, 0));     // 8 AM CDT
    expect(core.nextSweep(listed(), ns.end).da).toBe(2);              // after that window: Nov 2
  });
  it('skips a listed date the city suspends', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 18, 19, 0)));
    const core = G.makeTimeCore({ tz: 'America/Chicago', suspended: (rec, iso) => iso === '2026-10-19' });
    expect(core.nextSweep(listed()).mo).toBe(11);
  });
  it('is gone once every date has passed', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 11, 1, 19, 0)));
    expect(G.makeTimeCore({ tz: 'America/Chicago' }).nextSweep(listed())).toBeNull();
  });
  it('counts for a day chip when its next date is that weekday this coming week', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 18, 19, 0)));
    const core = G.makeTimeCore({ tz: 'America/Chicago' });
    expect(core.onDay(listed(), 1)).toBe(true);    // Mon Oct 19
    expect(core.onDay(listed(), 2)).toBe(false);
  });
  it('never offers a holiday skip', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 18, 19, 0)));
    expect(G.makeTimeCore({ tz: 'America/Chicago' }).holidaySkip(listed())).toBeNull();
  });
});

describe('windows that end the next morning', () => {
  const overnight = { weekday: 'Mon', fromhour: '22', tohour: '6', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1' };
  it('run to the next morning when the city turns it on', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 18, 19, 0)));
    const ns = G.makeTimeCore({ tz: 'America/New_York', crossMidnight: true }).nextSweep(overnight);
    expect(ns.start.getTime()).toBe(Date.UTC(2026, 9, 20, 2, 0));     // Mon 10 PM EDT
    expect(ns.end.getTime()).toBe(Date.UTC(2026, 9, 20, 10, 0));      // Tue 6 AM EDT
  });
  it('keep the old one-hour window otherwise (San Francisco)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 18, 19, 0)));
    const ns = G.makeTimeCore({ tz: 'America/New_York' }).nextSweep(overnight);
    expect(+ns.end - +ns.start).toBe(36e5);
  });
});

describe('San Francisco\'s whole hours read as before', () => {
  const oldFmtHour = (h) => { h = parseInt(h, 10); if (isNaN(h)) return ''; const ap = h >= 12 ? 'PM' : 'AM'; let hh = h % 12; if (hh === 0) hh = 12; return hh + ap; };
  it('formats every whole hour, as a number and as DataSF\'s string, exactly as the old code', () => {
    for (let h = 0; h <= 24; h++) {
      expect(G.fmtHour(h)).toBe(oldFmtHour(h));
      expect(G.fmtHour(String(h))).toBe(oldFmtHour(String(h)));
    }
    expect(G.fmtHour('')).toBe(oldFmtHour(''));
  });
  it('words every whole-hour window as before', () => {
    const oldWin = (from, to) => (from >= 0 && from < 6 ? null : oldFmtHour(from) + ' to ' + oldFmtHour(to));
    for (let from = 6; from <= 22; from++) for (const to of [from + 1, from + 2]) {
      expect(G.sweepDayWords(2026, 10, 20, String(from), String(to)).win).toBe(oldWin(from, to));
    }
    expect(G.sweepDayWords(2026, 10, 20, '0', '2').win).toBe('Tue 12 to 2 AM');
  });
});
