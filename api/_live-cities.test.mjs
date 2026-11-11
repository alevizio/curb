// Tests for the live-city lookup behind "Request a city" (api/_live-cities.js): which names count as a city CURB already
// has, and that its list and name folding stay in step with the public list and the issue filer.
import { describe, it, expect } from 'vitest';
import { LIVE, liveCity } from './_live-cities.js';
import { PUBLIC } from '../scripts/cities/public.mjs';
import { regionCode, cityKey } from '../scripts/cities/city-requests.mjs';

const id = (city, region) => liveCity(city, region)?.id ?? null;

describe('the live list', () => {
  it('is San Francisco plus exactly the public cities', () => {
    expect(LIVE.map((c) => c.id).sort()).toEqual(['sf', ...PUBLIC].sort());
  });
  it('knows every live city\'s state or province by the code the issue filer uses', () => {
    for (const c of LIVE) expect(c.code, c.id).toBe(regionCode(c.region));
  });
  it('folds a name the way the issue filer does', () => {
    for (const c of LIVE) expect(c.keys.has(cityKey(c.name)), c.id).toBe(true);
    expect(id('St. Paul', 'Minnesota')).toBe('saint-paul');
  });
});

describe('liveCity', () => {
  it('finds a live city by its name and state, however they are typed', () => {
    expect(liveCity('Paterson', 'New jersey')).toEqual({ id: 'paterson', name: 'Paterson', url: '/paterson' });
    for (const [city, region] of [['paterson', 'NJ'], ['PATERSON', 'N.J.'], ['Paterson, NJ', ''], ['Paterson NJ', ''],
      ['Paterson, New Jersey, USA', ''], ['Paterson', 'USA'], ['Paterson', 'New Jersey, United States']]) {
      expect(id(city, region), `${city} | ${region}`).toBe('paterson');
    }
    expect(id('Montreal', 'Québec')).toBe('montreal');
    expect(id('Montréal', 'Canada')).toBe('montreal');
    expect(id('Toronto', 'Ontario, Canada')).toBe('toronto');
  });
  it('San Francisco is the home page', () => {
    expect(liveCity('San Francisco', 'CA')).toEqual({ id: 'sf', name: 'San Francisco', url: '/' });
    expect(id('SF')).toBe('sf');
  });
  it('knows the short names people type', () => {
    expect(id('NYC')).toBe('new-york');
    expect(id('New York', 'New York')).toBe('new-york');
    expect(id('Philly', 'PA')).toBe('philadelphia');
    expect(id('LA')).toBe('los-angeles');
    expect(id('LA County', 'California')).toBe('la-county');
    expect(id('Washington, DC')).toBe('washington-dc');
    expect(id('Washington', 'D.C.')).toBe('washington-dc');
  });
  it('a name with no state is the live city', () => {
    expect(id('Glendale')).toBe('glendale');
    expect(id('Oakland', '')).toBe('oakland');
  });
  it('the same name in another state, or a longer name, is a request like any other', () => {
    expect(id('Glendale', 'Arizona')).toBeNull();
    expect(id('Glendale, AZ')).toBeNull();
    expect(id('Washington', 'Pennsylvania')).toBeNull();
    expect(id('Paterson', 'Canada')).toBeNull();
    expect(id('Oakland Park', 'Florida')).toBeNull();
    expect(id('Oakland Park')).toBeNull();
    expect(id('West Sacramento', 'CA')).toBeNull();
    expect(id('Portland', 'Oregon')).toBeNull();
    expect(id('')).toBeNull();
  });
});
