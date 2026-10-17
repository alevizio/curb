// The Curb Lab policy classifier behind the Boston map's layers (scripts/cities/boston-curbs.mjs).
import { describe, it, expect } from 'vitest';
import { classifyPolicy } from './boston-curbs.mjs';

const ALL = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], WEEK = ['mon', 'tue', 'wed', 'thu', 'fri'];
const rule = (activity, o = {}) => ({ activity, user_classes: null, user_classes_except: null, purposes: null, max_stay: null, max_stay_unit: null, ...o });
const span = (o = {}) => ({ days_of_week: ALL, time_of_day_start: null, time_of_day_end: null, months: null, weeks_of_month: null, designated_period: null, ...o });
const policy = (rules, time_spans = [span()], o = {}) => ({ name: null, rules, time_spans, rates: null, ...o });

describe('resident permit curbs', () => {
  it('reads "no parking except resident permit" as residents only', () => {
    expect(classifyPolicy(policy([rule('no parking', { user_classes_except: ['resident_permit'] })])))
      .toEqual([['permit', { max: null, only: true, when: 'Every day, all day' }]]);
  });
  it('keeps the time limit for everyone else on a residents exempt sign', () => {
    const p = policy([rule('parking', { user_classes: ['resident_permit'] }), rule('parking', { max_stay: 2, max_stay_unit: 'hour' })],
      [span({ days_of_week: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], time_of_day_start: '08:00', time_of_day_end: '18:00' })]);
    expect(classifyPolicy(p)).toEqual([['permit', { max: 120, only: false, when: 'Mon to Sat, 8 AM to 6 PM' }]]);
  });
  it('reads the other encoding, "parking 2 hours except resident permit", the same way', () => {
    const p = policy([rule('parking', { max_stay: 2, max_stay_unit: 'hour', user_classes_except: ['resident_permit'] })]);
    expect(classifyPolicy(p)[0]).toEqual(['permit', { max: 120, only: false, when: 'Every day, all day' }]);
  });
});

describe('accessible, loading and short term curbs', () => {
  it('reads "no parking except accessible" as accessible parking', () => {
    expect(classifyPolicy(policy([rule('no parking', { user_classes_except: ['accessible'] }), rule('parking', { user_classes: ['accessible'] })])))
      .toEqual([['accessible', { when: 'Every day, all day' }]]);
  });
  it('sorts loading zones by who may use them', () => {
    const who = (users) => classifyPolicy(policy([rule('loading', { user_classes: users, max_stay: 15, max_stay_unit: 'minute' })]))[0][1].who;
    expect([who(['commercial_vehicle']), who(['truck']), who(['bus']), who(['rideshare']), who(null)]).toEqual(['commercial', 'commercial', 'bus', 'rideshare', 'passenger']);
  });
  it('reads "no parking except commercial vehicles" or "except buses" as their loading zones', () => {
    expect(classifyPolicy(policy([rule('no parking', { user_classes_except: ['commercial_vehicle'] })]))[0]).toEqual(['loading', { who: 'commercial', when: 'Every day, all day' }]);
    const school = policy([rule('no parking', { user_classes_except: ['bus'] })],
      [span({ days_of_week: WEEK, time_of_day_start: '07:00', time_of_day_end: '16:00', designated_period: 'school days' })]);
    expect(classifyPolicy(school)).toEqual([['loading', { who: 'bus', when: 'School days: Mon to Fri, 7 AM to 4 PM' }]]);
  });
  it('puts valet curbs with loading', () => {
    expect(classifyPolicy(policy([rule('no parking', { user_classes_except: ['valet'] }), rule('parking', { user_classes: ['valet'], max_stay: 10, max_stay_unit: 'minute' })])))
      .toEqual([['loading', { who: 'valet', when: 'Every day, all day' }]]);
  });
  it('splits free time limited parking: 30 minutes or less is short term, longer is a time limit', () => {
    const free = (n, unit) => classifyPolicy(policy([rule('parking', { max_stay: n, max_stay_unit: unit })]))[0];
    expect(free(30, 'minute')).toEqual(['loading', { who: 'short', max: 30, when: 'Every day, all day' }]);
    expect(free(2, 'hour')).toEqual(['limit', { max: 120, when: 'Every day, all day' }]);
  });
});

describe('paid parking', () => {
  it('keeps the hourly rate, the time limit and the ParkBoston zone', () => {
    const p = policy([rule('parking', { max_stay: 2, max_stay_unit: 'hour' })], [span({ time_of_day_start: '08:00', time_of_day_end: '20:00' })],
      { name: 'Park Boston Zone ID 4123', rates: [{ rate: 200, rate_unit: 'hour' }] });
    expect(classifyPolicy(p)).toEqual([['paid', { rate: 2, max: 120, when: 'Every day, 8 AM to 8 PM', zone: '4123' }]]);
  });
});

describe('no stopping, snow emergency, and what is left out', () => {
  it('reads a bus stop as no stopping at any time', () => {
    expect(classifyPolicy(policy([rule('no stopping', { purposes: ['bus_stop'] })], null)))
      .toEqual([['nostop', { stop: true, why: 'bus stop', when: '' }]]);
  });
  it('says "any time" (an empty when) for a rule posted every day, all day', () => {
    expect(classifyPolicy(policy([rule('no stopping')]))).toEqual([['nostop', { stop: true, when: '' }]]);
  });
  it('keeps the hours of a rush hour rule', () => {
    const p = policy([rule('no stopping')], [span({ days_of_week: WEEK, time_of_day_start: '07:00', time_of_day_end: '09:00' })]);
    expect(classifyPolicy(p)).toEqual([['nostop', { stop: true, when: 'Mon to Fri, 7 AM to 9 AM' }]]);
  });
  it('puts snow emergency signs on their own layer', () => {
    expect(classifyPolicy(policy([rule('no parking')], [span({ designated_period: 'snow emergency' })]))).toEqual([['snow', {}]]);
  });
  it('leaves street cleaning signs to the schedule, and skips hydrants and unreadable signs', () => {
    expect(classifyPolicy(policy([rule('no parking')], [span({ weeks_of_month: [1, 3], time_of_day_start: '08:00', time_of_day_end: '12:00' })]))).toEqual([]);
    expect(classifyPolicy(policy([rule('no stopping', { purposes: ['fire_hydrant'] })], null))).toEqual([]);
    expect(classifyPolicy(policy([rule('unusable image')]))).toEqual([]);
  });
});
