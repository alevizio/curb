// Tests for the weekly report window (week.mjs): Wednesday boundaries in San Francisco time, DST.
import { describe, it, expect } from 'vitest';
import { reportWeek, midnight, ymd, addDays } from './week.mjs';

describe('report week', () => {
  it('a Wednesday morning send covers the previous Wed to Tue', () => {
    const w = reportWeek(Date.parse('2026-10-07T15:07:00Z')); // Wed Oct 7, 8:07 AM PDT
    expect(w.days).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
    expect(w.prevDays[0]).toBe('2026-09-23');
    expect(w.start).toBe(Date.parse('2026-09-30T07:00:00Z'));
    expect(w.end).toBe(Date.parse('2026-10-07T07:00:00Z'));
    expect(w.prevStart).toBe(Date.parse('2026-09-23T07:00:00Z'));
    expect(w.prevEnd).toBe(w.start);
    expect(w.label).toBe('Sep 30 to Oct 6');
  });
  it('a late retry the same Wednesday gives the same week', () => {
    expect(reportWeek(Date.parse('2026-10-08T06:30:00Z')).days[0]).toBe('2026-09-30'); // Wed 11:30 PM PDT
  });
  it('an off-day preview reports the last full week', () => {
    const w = reportWeek(Date.parse('2026-10-05T19:00:00Z')); // Mon Oct 5
    expect(w.days[0]).toBe('2026-09-23');
    expect(w.days[6]).toBe('2026-09-29');
    expect(w.label).toBe('Sep 23 to 29');
  });
  it('the week that ends daylight saving time is 7 calendar days, one hour longer', () => {
    const w = reportWeek(Date.parse('2026-11-04T16:00:00Z')); // Wed Nov 4 (DST ended Sun Nov 1)
    expect(w.days).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
    expect(w.start).toBe(Date.parse('2026-10-28T07:00:00Z'));
    expect(w.end).toBe(Date.parse('2026-11-04T08:00:00Z'));
    expect(w.end - w.start).toBe(7 * 86400000 + 3600000);
  });
  it('midnight, ymd and addDays agree across the spring change', () => {
    expect(midnight('2027-03-14')).toBe(Date.parse('2027-03-14T08:00:00Z'));
    expect(midnight('2027-03-15')).toBe(Date.parse('2027-03-15T07:00:00Z'));
    expect(ymd(midnight('2027-03-15'))).toBe('2027-03-15');
    expect(addDays('2027-03-13', 2)).toBe('2027-03-15');
  });
});
