// How one City sign becomes a Parking mode policy (scripts/cities/boston-zones.mjs).
import { describe, it, expect } from 'vitest';
import { compactPolicy, spanWindow, buildZones } from './boston-zones.mjs';

const rule = (activity, o = {}) => ({ activity, user_classes: null, user_classes_except: null, purposes: null, max_stay: null, max_stay_unit: null, ...o });
const span = (o = {}) => ({ days_of_week: null, time_of_day_start: null, time_of_day_end: null, months: null, weeks_of_month: null, designated_period: null, ...o });
const policy = (rules, o = {}) => ({ name: null, description: null, priority: 50, rules, time_spans: null, rates: null, ...o });

describe('spanWindow', () => {
  it('turns days, hours, weeks and months into masks and minutes', () => {
    expect(spanWindow(span({ days_of_week: ['mon', 'tue'], time_of_day_start: '08:00:00', time_of_day_end: '12:30:00', weeks_of_month: [1, 3], months: [4, 11] })))
      .toEqual([0b0000110, 480, 750, 0b101, (1 << 3) | (1 << 10)]);
  });
  it('reads no days as every day and no hours as all day', () => {
    expect(spanWindow(span())).toEqual([127, 0, 0, 0, 0]);
  });
});

describe('compactPolicy', () => {
  it('drops an unreadable photo and a motorcycle meter', () => {
    expect(compactPolicy(policy([rule('unusable image')]))).toBe(null);
    expect(compactPolicy(policy([rule('parking', { user_classes: ['motorcycle'] })], { rates: [{ rate: 50, rate_unit: 'hour' }] }))).toBe(null);
  });
  it('marks a meter, with its dollars and limit', () => {
    const p = compactPolicy(policy([rule('parking', { max_stay: 2, max_stay_unit: 'hour' })], { rates: [{ rate: 375, rate_unit: 'hour' }] }));
    expect(p).toMatchObject({ st: 'paid', m: 1, rate: 3.75, max: 120 });
  });
  it('marks signs that cover a car or two as notes', () => {
    expect(compactPolicy(policy([rule('no stopping', { purposes: ['fire_hydrant'] })]))).toMatchObject({ st: 'no', n: 1, r: ['hydrant', {}] });
    expect(compactPolicy(policy([rule('no stopping', { purposes: ['bus_stop'] })])).n).toBe(1);
    expect(compactPolicy(policy([rule('parking', { user_classes: ['accessible'] })]))).toMatchObject({ st: 'restricted', n: 1 });
  });
  it('tells a plain No Parking from a No Stopping', () => {
    expect(compactPolicy(policy([rule('no parking')], { description: '* No Parking' }))).toMatchObject({ st: 'no', pl: 1 });
    const stop = compactPolicy(policy([rule('no stopping')], { description: '* No Stopping' }));
    expect(stop).toMatchObject({ st: 'no', stop: 1 });
    expect(stop.pl).toBeUndefined();
    expect(compactPolicy(policy([rule('no parking')], { description: '* No Parking 8:00 AM-6:00 PM' })).pl).toBeUndefined();
  });
  it('sorts permit signs by whether others can park', () => {
    expect(compactPolicy(policy([rule('no parking', { user_classes_except: ['resident_permit'] })])).st).toBe('restricted');
    expect(compactPolicy(policy([rule('parking', { user_classes: ['resident_permit'] }), rule('parking', { max_stay: 2, max_stay_unit: 'hour' })]))).toMatchObject({ st: 'limit', max: 120 });
  });
  it('keeps a named period out of the clock', () => {
    const p = compactPolicy(policy([rule('no parking')], { time_spans: [span({ designated_period: '{"snow emergency"}' })] }));
    expect(p.per).toBe('snow emergency');
    expect(p.w).toBeUndefined();
  });
  it('marks a street cleaning sign', () => {
    expect(compactPolicy(policy([rule('no parking')], { time_spans: [span({ weeks_of_month: [1, 3], time_of_day_start: '08:00', time_of_day_end: '12:00' })] })).sw).toBe(1);
  });
  it('says nothing about a sign that does nothing to a car', () => {
    expect(compactPolicy(policy([rule('no loading')])).st).toBe(null);
  });
});

describe('buildZones', () => {
  const line = (x0, y0, x1, y1) => ({ type: 'LineString', coordinates: [[x0, y0], [x1, y1]] });
  const policies = [
    { curb_policy_id: 'a', priority: 1, description: '* No Stopping', rules: [rule('no stopping')] },
    { curb_policy_id: 'u', priority: 98, description: '* Unusable Image', rules: [rule('unusable image')] },
  ];
  const zones = [
    { curb_policy_ids: ['a', 'u'], published_date: Date.UTC(2026, 4, 7), geometry: line(-71, 42, -71.001, 42) },
    { curb_policy_ids: ['u'], geometry: line(-71.1, 42.1, -71.10001, 42.1) },
    { curb_policy_ids: [], geometry: line(-71.2, 42.2, -71.201, 42.2) },
  ];
  const built = buildZones({ zones, policies, generated: 'g', source: 's', sideOf: (g) => (g[0][0] === -71 ? { c: 7, side: 'L' } : null), streetOf: () => 'Heron St · West Roxbury' });
  it('records whether a sign on the record could not be read', () => {
    expect(built.rs).toEqual([[[0], 1]]);
  });
  it('gives an unreadable or empty record no ruleset', () => {
    expect(built.z.map((z) => z[1])).toEqual([0, -1, -1]);
  });
  it('marks short stretches and swept sides', () => {
    expect(built.z[0].slice(2, 5)).toEqual([0, 7, 'L']);
    expect(built.z[1].slice(2, 5)).toEqual([1, 0, '']);
  });
  it('stores each step from the last point', () => {
    expect(built.z[0][0]).toEqual([-7100000, 4200000, -100, 0]);
  });
  it('states when the City published', () => {
    expect(built._meta.published).toBe('2026-05-07');
  });
});
