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
  it('reads the card\'s facts: one AM or PM for both hours, and a countdown alone', () => {
    expect(fr('Tue 7 to 8AM')).toBe('mar. 7 h à 8 h');
    expect(fr('Mon 5 to 6PM')).toBe('lun. 17 h à 18 h');
    expect(fr('Wed 7:30 to 8:30PM')).toBe('mer. 19 h 30 à 20 h 30');
    expect(fr('Thu 11:30AM to 12:30PM')).toBe('jeu. 11 h 30 à 12 h 30');
    expect(fr('8AM TO 12PM')).toBe('8 H À 12 H');
    expect(fr('6 days')).toBe('6 jours');
    expect(fr('21 hr')).toBe('21 h');
    expect(fr('<1 hr')).toBe('moins d’une heure');
    expect(fr('2 hr 5 min')).toBe('2 h 5 min');
    expect(fr('12 min')).toBe('12 min');
    for (const [en, f] of [['Sweeps', 'Nettoyage'], ['In', 'Dans'], ['When', 'Quand'], ['Ends in', 'Fin dans'], ['Other sides', 'Autres côtés'],
      ['Schedule', 'Horaire'], [' Share this block', ' Partager ce tronçon']]) expect(fr(en)).toBe(f);
  });
  it('reads the bottom bar and the menu\'s Android item', () => {
    expect(fr('Any day')).toBe('Tous les jours');
    expect(fr('Wed Nov 11 · 35° · Tap a curb for its rules')).toBe('mer. 11 nov. · 35° · Touchez une bordure pour voir ses règles');
    expect(fr('Android beta')).toBe('Android bêta');
    expect(fr('Join on Google Play')).toBe('S’inscrire sur Google Play');
  });
  it('reads a sweep that ends at midnight, and the data notes\' line about alerts', () => {
    expect(fr('Thu 7PM to 12AM')).toBe('jeu. 19 h à 0 h');
    expect(fr('7PM TO 12AM')).toBe('19 H À 0 H');
    expect(fr('The City\'s notes. Sweep alerts and calendar reminders run on Montréal time: an overnight sweep gets one alert around 9 PM the evening before.'))
      .toBe('The City\'s notes. Les alertes et les rappels du calendrier suivent l’heure de Montréal : un nettoyage de nuit donne une seule alerte, vers 21 h la veille.');
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
