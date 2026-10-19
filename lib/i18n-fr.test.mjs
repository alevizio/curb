// lib/i18n-fr.js: the French a city page shows (Montréal), from the English the page builds.
import { describe, it, expect, beforeAll } from 'vitest';

let fr;
beforeAll(async () => { await import('./i18n-fr.js'); fr = globalThis.CURB_FR.fr; });

describe('French', () => {
  it('translates the fixed strings, keeping the spaces around them', () => {
    expect(fr('Park until')).toBe('Stationnez jusqu’à');
    expect(fr('  Show me the map ')).toBe('  Voir la carte ');
    expect(fr('Even side')).toBe('Côté pair');
  });
  it('writes times on a 24 hour clock, and windows with "à"', () => {
    expect(fr('Tue 7AM')).toBe('mar. 7 h');
    expect(fr('Thu 7:30PM')).toBe('jeu. 19 h 30');
    expect(fr('12:30PM to 1:30PM · every week · in 4 days')).toBe('12 h 30 à 13 h 30 · chaque semaine · dans 4 jours');
    expect(fr('8 TO 9AM')).toBe('8 H À 9 H');
    expect(fr('Mon night 10/5 → Tue 12 to 2 AM · tonight')).toBe('lun. soir 5/10 → mar. 0 h à 2 h · ce soir');
  });
  it('writes dates day first, and the days and months in French', () => {
    expect(fr('Today · Sun Oct 18')).toBe('Aujourd’hui · dim. 18 oct.');
    expect(fr('Tue 10/20 · in 2 days')).toBe('mar. 20/10 · dans 2 jours');
    expect(fr('WED')).toBe('MER');
    expect(fr('Swept April to November. ')).toBe('Nettoyage d’avril à novembre. ');
  });
  it('names the sides and the blocks', () => {
    expect(fr('East · every week')).toBe('Est · chaque semaine');
    expect(fr('Switch to the Northwest side')).toBe('Passer au côté nord-ouest');
    expect(fr('500 to 555')).toBe('500 à 555');
    expect(fr('· rue De Saint-Vallier to avenue De Chateaubriand')).toBe('· rue De Saint-Vallier à avenue De Chateaubriand');
    expect(fr('1st & 3rd')).toBe('1re et 3e');
  });
  it('leaves proper names and French alone', () => {
    expect(fr('rue Saint-Denis')).toBe('rue Saint-Denis');
    expect(fr('Rosemont–La Petite-Patrie')).toBe('Rosemont–La Petite-Patrie');
    expect(fr('Stationnez jusqu’à')).toBe('Stationnez jusqu’à');
  });
});
