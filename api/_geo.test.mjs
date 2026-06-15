// Tests for the pure geo core of /api/parked (api/_geo.js).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { inSfBbox, polygonAround, pickParkedSpot } from './_geo.js';

afterEach(() => { vi.useRealTimers(); });

describe('inSfBbox', () => {
  it('accepts a point in SF', () => { expect(inSfBbox(37.7749, -122.4194)).toBe(true); });
  it('rejects points outside SF (Oakland, NYC, junk)', () => {
    expect(inSfBbox(37.8044, -122.2712)).toBe(false); // Oakland (east of bbox)
    expect(inSfBbox(40.7128, -74.006)).toBe(false);   // NYC
    expect(inSfBbox(NaN, -122.4)).toBe(false);
    expect(inSfBbox('37.77', '-122.4')).toBe(false);  // non-numeric
  });
});

describe('polygonAround', () => {
  it('builds a closed lng-lat ring of numbers only (no injectable text)', () => {
    const p = polygonAround(37.7749, -122.4194, 60);
    expect(p).toMatch(/^POLYGON\(\(([-\d. ,]+)\)\)$/);
    const ring = p.slice(9, -2).split(', ');
    expect(ring.length).toBe(5);
    expect(ring[0]).toBe(ring[4]); // closed
  });
});

describe('pickParkedSpot', () => {
  // A Wednesday 8–10 segment whose centreline passes ~through the point.
  const rowsAt = (lat, lng) => ([{
    cnn: '111', corridor: 'Haight St', limits: 'Cole St → Clayton St', blockside: 'North',
    cnnrightleft: 'R', weekday: 'Wed', fromhour: '8', tohour: '10',
    week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0',
    line: { type: 'LineString', coordinates: [[lng - 0.001, lat], [lng + 0.001, lat]] },
  }]);

  it('returns the spot for a nearby segment', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 19, 0)));
    const out = pickParkedSpot(rowsAt(37.77, -122.45), 37.77, -122.45);
    expect(out).not.toBe(null);
    expect(out.cnn).toBe('111');
    expect(out.corridor).toBe('Haight St');
    expect(out.rule.weekday).toBe('Wed');
    expect(out.ns.start.toISOString()).toBe(new Date(Date.UTC(2026, 5, 17, 15, 0)).toISOString());
  });

  it('returns null when the nearest segment is too far (>35m)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 19, 0)));
    // segment ~300m north of the point
    const rows = rowsAt(37.773, -122.45);
    expect(pickParkedSpot(rows, 37.77, -122.45)).toBe(null);
  });

  it('returns null for empty input', () => {
    expect(pickParkedSpot([], 37.77, -122.45)).toBe(null);
    expect(pickParkedSpot(null, 37.77, -122.45)).toBe(null);
  });

  it('chooses the side whose next sweep is soonest', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 19, 0))); // Mon
    const base = rowsAt(37.77, -122.45)[0];
    const wed = { ...base, cnnrightleft: 'R', weekday: 'Wed' };   // next: 2026-06-17
    const tue = { ...base, cnnrightleft: 'L', blockside: 'South', weekday: 'Tues' }; // next: 2026-06-16 (sooner)
    const out = pickParkedSpot([wed, tue], 37.77, -122.45);
    expect(out.rule.weekday).toBe('Tues');
    expect(out.sideKey).toBe('L');
  });
});
