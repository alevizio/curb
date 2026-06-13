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
