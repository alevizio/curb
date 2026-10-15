import { describe, it, expect } from 'vitest';
import { looksMisdated, sweepIndex, fixHour } from './midnight-hour.mjs';

// One east-west block through the projection origin, swept Tuesdays (jsDow 2) in the given hours.
const LAT = 37.7749, LON = -122.4194;
const block = (fromhour, tohour) => sweepIndex([{
  cnn: '100', weekday: 'Tues', fromhour, tohour,
  line: { type: 'LineString', coordinates: [[LON - 0.001, LAT], [LON + 0.001, LAT]] },
}]);
const TUE = 2, WED = 3;

describe('looksMisdated', () => {
  it('matches the feed pattern: the hour is the first digit of the minute', () => {
    for (const [hh, mi] of [[2, 24], [1, 10], [5, 59], [4, 43], [5, 5], [9, 9], [1, 1]]) expect(looksMisdated(hh, mi), `${hh}:${mi}`).toBe(true);
  });
  it('leaves every other time alone', () => {
    for (const [hh, mi] of [[0, 24], [0, 0], [2, 34], [6, 0], [8, 15], [10, 10], [12, 12], [6, 59]]) expect(looksMisdated(hh, mi), `${hh}:${mi}`).toBe(false);
  });
});

describe('fixHour', () => {
  it('moves a lookalike back to 12 AM when 00:MM is inside the block\'s posted window', () => {
    expect(fixHour(block('0', '2'), 2, 24, LAT, LON, TUE)).toBe(0);
    expect(fixHour(block('0', '2'), 5, 5, LAT, LON, TUE)).toBe(0);
  });
  it('keeps a real early-morning ticket on a block swept at that hour', () => {
    expect(fixHour(block('2', '4'), 2, 24, LAT, LON, TUE)).toBe(2);
  });
  it('picks 12 AM when both times fit the window (right for 89% of lookalikes in the test set)', () => {
    expect(fixHour(block('0', '6'), 3, 35, LAT, LON, TUE)).toBe(0);
  });
  it('needs the posted window on the ticket\'s own weekday', () => {
    expect(fixHour(block('0', '2'), 2, 24, LAT, LON, WED)).toBe(2);
  });
  it('needs a swept block within 40 m', () => {
    expect(fixHour(block('0', '2'), 2, 24, LAT + 0.0003, LON, TUE)).toBe(0);   // ~33 m
    expect(fixHour(block('0', '2'), 2, 24, LAT + 0.0009, LON, TUE)).toBe(2);   // ~100 m
  });
  it('leaves tickets without coordinates or without the pattern untouched', () => {
    expect(fixHour(block('0', '2'), 2, 24, undefined, undefined, TUE)).toBe(2);
    expect(fixHour(block('0', '2'), 2, 24, '', '', TUE)).toBe(2);
    expect(fixHour(block('8', '10'), 8, 15, LAT, LON, TUE)).toBe(8);
    expect(fixHour(block('0', '2'), 0, 24, LAT, LON, TUE)).toBe(0);
  });
  it('leaves a day alone once the feed has it right (DataSF fixing the bug)', () => {
    const idx = block('0', '2'); idx.fixedDays = new Set(['2026-11-03']);
    expect(fixHour(idx, 1, 13, LAT, LON, TUE, '2026-11-03')).toBe(1);   // a real 1:13 AM ticket
    expect(fixHour(idx, 1, 13, LAT, LON, TUE, '2026-10-27')).toBe(0);   // a day still from the old feed
  });
  it('reads the feed\'s string coordinates and DataSF\'s holiday rows without breaking', () => {
    const idx = sweepIndex([
      { cnn: '100', weekday: 'Holiday', fromhour: '0', tohour: '2' },
      { cnn: '100', weekday: 'Tues', fromhour: '0', tohour: '2', line: { coordinates: [[LON - 0.001, LAT], [LON + 0.001, LAT]] } },
    ]);
    expect(fixHour(idx, 2, 24, String(LAT), String(LON), TUE)).toBe(0);
    expect(idx.win.get('100').size).toBe(1);
  });
});
