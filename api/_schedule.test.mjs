// Tests for the forever-watch re-arm (api/_schedule.js) under frozen clocks.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { recomputeSpot } from './_schedule.js';

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
