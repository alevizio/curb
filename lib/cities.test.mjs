// The server's city registry for Sweep alerts (lib/cities.js): a spot without a city is San Francisco.
import { describe, it, expect } from 'vitest';
import { CITIES, cityOf } from './cities.js';

describe('cityOf', () => {
  it('reads a spot with no city, or any other value, as San Francisco', () => {
    expect(cityOf({}).id).toBe('sf');
    expect(cityOf(null).id).toBe('sf');
    expect(cityOf({ city: 'nyc' }).id).toBe('sf');
    expect(cityOf({ city: 'boston' }).id).toBe('boston');
  });
  it('gives each city its own clock', () => {
    const noonUTC = new Date(Date.UTC(2026, 9, 16, 16, 0));
    expect(CITIES.sf.core.parts(noonUTC).h).toBe(9);        // 9 AM in San Francisco
    expect(CITIES.boston.core.parts(noonUTC).h).toBe(12);   // noon in Boston
  });
  it('links a push to the city\'s own block page', () => {
    expect(CITIES.sf.blockLink('7735000', 'West')).toBe('/b/7735000?side=West');
    expect(CITIES.boston.blockLink('5084', 'South')).toBe('/boston?b=5084&side=South');
    expect(CITIES.boston.blockLink('5084', '')).toBe('/boston?b=5084');
  });
  it('keeps a Boston watch re-arming across the December to March break', () => {
    expect(CITIES.boston.watchAge).toBeGreaterThan(Date.UTC(2027, 3, 10) - Date.UTC(2026, 10, 30));
    expect(CITIES.sf.watchAge).toBe(120 * 864e5);
  });
});
