// Saved rules from the other cities (docs/multi-city/city-build.md): windows with minutes, rules on listed dates and
// rules that run on holidays store as they come; San Francisco's and Boston's rules store exactly as before.
import { describe, it, expect } from 'vitest';
import { sanitizeRule, sanitizeSpot, sanitizeSide } from './_spot.js';
import { CITIES } from '../lib/cities.js';

const sf = { weekday: 'Tue', fromhour: '8', tohour: '10', week1: '1', week2: '0', week3: '1', week4: '0', week5: '0', holidays: '0' };

describe('saved rules', () => {
  it('keep San Francisco\'s whole-hour rules exactly as before', () => {
    expect(sanitizeRule(sf)).toEqual({ weekday: 'tue', fromhour: '8', tohour: '10', week1: '1', week2: '0', week3: '1', week4: '0', week5: '0', holidays: '0' });
    expect(sanitizeRule({ ...sf, tohour: '0' }).tohour).toBe('9');     // an end of 0: an hour after the start, as always
    expect(sanitizeRule({ ...sf, tohour: '' }).tohour).toBe('9');
    expect(sanitizeRule({ ...sf, fromhour: '08' }).fromhour).toBe('8');
  });
  it('keep a window\'s minutes', () => {
    expect(sanitizeRule({ ...sf, fromhour: '9:30', tohour: '11:30' })).toMatchObject({ fromhour: '9:30', tohour: '11:30' });
  });
  it('store a rule on listed dates without a weekday, dates valid, unique and in order', () => {
    const r = sanitizeRule({ dates: ['2026-11-12', 'nope', '2026-11-11', '2026-11-12'], fromhour: '8', tohour: '18' });
    expect(r.dates).toEqual(['2026-11-11', '2026-11-12']);
    expect(r.weekday).toBeUndefined();
    expect(sanitizeRule({ dates: ['bad'], fromhour: '8' })).toBeNull();
  });
  it('mark a rule that runs on holidays, and only then', () => {
    expect(sanitizeRule({ ...sf, flags: 3 }).flags).toBe(1);
    expect(sanitizeRule({ ...sf, flags: 2 }).flags).toBeUndefined();
  });
});

// any city built from lib/city-configs.js (not SF, not Boston), when one is built
const other = Object.keys(CITIES).find((id) => id !== 'sf' && id !== 'boston');
const spotOf = (extra) => ({ nextSweepISO: '2026-11-03T16:00:00.000Z', corridor: 'A St', blockside: 'North', sideKey: 'L',
  rule: { weekday: 'Tue', fromhour: '8', tohour: '10', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' }, ...extra });

describe('block ids', () => {
  it('keep San Francisco\'s and Boston\'s ids digits only, as before', () => {
    expect(sanitizeSpot(spotOf({ cnn: '1234-5' })).cnn).toBe('12345');
    expect(sanitizeSpot(spotOf({ cnn: '1234-5', city: 'boston' })).cnn).toBe('12345');
    expect(sanitizeSide({ cnn: 'ab12', city: 'boston' }).cnn).toBe('12');
  });
  it.skipIf(!other)('keep another city\'s own ids, letters and dashes included, and nothing else', () => {
    expect(sanitizeSpot(spotOf({ cnn: 'SS-018818', city: other })).cnn).toBe('SS-018818');
    expect(sanitizeSide({ cnn: '395510630-1', city: other }).cnn).toBe('395510630-1');
    expect(sanitizeSpot(spotOf({ cnn: 'SS-0188<script>18', city: other })).cnn).toBe('SS-0188script18');
    expect(sanitizeSpot(spotOf({ cnn: 'x'.repeat(60), city: other })).cnn).toHaveLength(40);
  });
});
