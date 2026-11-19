import { describe, expect, test } from 'vitest';
import {
  ajouterJours, cleDate, dateCourte, dateLongue, ecartJours, heureDe, horodatage,
  instantDeParis, jourSemaine, lireDate, parseDateFr, parseHeure,
} from '../../src/utils/dates.ts';

describe('cleDate et heureDe : toujours vus depuis Paris', () => {
  test("23:30 UTC le 28/11 = 00:30 le 29/11 à Paris (hiver, UTC+1)", () => {
    const instant = new Date('2026-11-28T23:30:00Z');
    expect(cleDate(instant)).toBe('2026-11-29');
    expect(heureDe(instant)).toBe('00:30');
  });

  test("l'heure d'été est prise en compte (UTC+2)", () => {
    expect(heureDe(new Date('2026-07-10T16:00:00Z'))).toBe('18:00');
  });
});

describe('instantDeParis : de « samedi 18:00 à Paris » vers l\'instant exact', () => {
  test('hiver : Paris = UTC+1', () => {
    expect(instantDeParis('2026-11-28', '18:00').toISOString()).toBe('2026-11-28T17:00:00.000Z');
  });

  test('été : Paris = UTC+2', () => {
    expect(instantDeParis('2026-07-10', '18:00').toISOString()).toBe('2026-07-10T16:00:00.000Z');
  });

  test('sans heure : minuit', () => {
    expect(instantDeParis('2026-11-28').toISOString()).toBe('2026-11-27T23:00:00.000Z');
  });

  test('aller-retour avec cleDate et heureDe, y compris les jours de changement d\'heure', () => {
    for (const [cle, heure] of [['2026-03-29', '10:00'], ['2026-10-25', '18:00'], ['2026-12-31', '23:59']]) {
      const instant = instantDeParis(cle, heure);
      expect(cleDate(instant)).toBe(cle);
      expect(heureDe(instant)).toBe(heure);
    }
  });
});

describe('calculs sur les clés de date', () => {
  test("ajouterJours : J-7, J+3, changement de mois et d'année", () => {
    expect(ajouterJours('2026-11-29', -7)).toBe('2026-11-22');
    expect(ajouterJours('2026-11-29', 3)).toBe('2026-12-02');
    expect(ajouterJours('2026-12-30', 2)).toBe('2027-01-01');
    expect(ajouterJours('2026-03-28', 1)).toBe('2026-03-29'); // week-end du changement d'heure
  });

  test('ecartJours : nombre de jours entre deux dates', () => {
    expect(ecartJours('2026-11-22', '2026-11-29')).toBe(7);
    expect(ecartJours('2026-11-29', '2026-11-22')).toBe(-7);
    expect(ecartJours('2026-10-24', '2026-10-26')).toBe(2); // passage à l'heure d'hiver
  });

  test('jourSemaine, dateCourte, dateLongue', () => {
    expect(jourSemaine('2026-11-28')).toBe('samedi');
    expect(dateCourte('2026-11-28')).toBe('28/11');
    expect(dateLongue('2026-11-28')).toBe('samedi 28/11');
  });
});

describe('parseDateFr', () => {
  test.each([
    ['28/11/2026', '2026-11-28'],
    ['1/2/26', '2026-02-01'],
    [' 28-11-2026 ', '2026-11-28'],
    ['28.11.2026', '2026-11-28'],
  ])('« %s » → %s', (texte, attendu) => {
    expect(parseDateFr(texte)).toBe(attendu);
  });

  test.each(['31/02/2026', '2026-11-28', 'demain', ''])('« %s » → null (invalide)', (texte) => {
    expect(parseDateFr(texte)).toBeNull();
  });
});

describe('lireDate : les deux formats du Sheet', () => {
  test.each([
    ['28/11/2026', '2026-11-28'], // tapée par l'équipe
    ['2026-11-28', '2026-11-28'], // écrite par le bot
    [' 2026-11-28 ', '2026-11-28'],
  ])('« %s » → %s', (texte, attendu) => {
    expect(lireDate(texte)).toBe(attendu);
  });

  test.each(['2026-02-31', '', '28-11', '2026/11/28'])('« %s » → null', (texte) => {
    expect(lireDate(texte)).toBeNull();
  });
});

describe('horodatage', () => {
  test("date et heure de Paris, à la seconde", () => {
    expect(horodatage(new Date('2026-11-21T17:00:05Z'))).toBe('2026-11-21 18:00:05');
  });
});

describe('parseHeure', () => {
  test.each([
    ['19:00', '19:00'],
    ['19h', '19:00'],
    ['19h30', '19:30'],
    ['9H05', '09:05'],
    ['19 h 30', '19:30'],
    ['19:00:00', '19:00'], // affichage Sheets avec secondes
    ['19', '19:00'],
  ])('« %s » → %s', (texte, attendu) => {
    expect(parseHeure(texte)).toBe(attendu);
  });

  test.each(['25h', '19h75', '19h5', 'midi', ''])('« %s » → null (invalide)', (texte) => {
    expect(parseHeure(texte)).toBeNull();
  });
});
