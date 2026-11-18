import { describe, expect, test } from 'vitest';
import { formaterTelephone, normaliserTelephone } from '../../src/utils/telephones.ts';

describe('normaliserTelephone', () => {
  test.each([
    '06 12 34 56 78',
    '06.12.34.56.78',
    '+33 6 12 34 56 78',
    '+33 (0)6 12 34 56 78',
    '0033612345678',
    '33612345678',
    612345678, // nombre : le Sheet a mangé le 0
  ])('numéro français « %s » → 33612345678', (brut) => {
    expect(normaliserTelephone(brut)).toBe('33612345678');
  });

  test.each([
    ['+32 470 12 34 56', '32470123456'],
    ['0032470123456', '32470123456'],
  ])('numéro étranger « %s » → %s', (brut, attendu) => {
    expect(normaliserTelephone(brut)).toBe(attendu);
  });

  test.each(['', null, undefined, '123', 'pas de numéro'])('valeur invalide « %s » → null', (brut) => {
    expect(normaliserTelephone(brut)).toBeNull();
  });
});

describe('formaterTelephone', () => {
  test('affichage lisible', () => {
    expect(formaterTelephone('33612345678')).toBe('06 12 34 56 78');
    expect(formaterTelephone('32470123456')).toBe('+32470123456');
  });

  test('aller-retour : normaliser puis formater redonne le numéro lisible', () => {
    expect(formaterTelephone(normaliserTelephone('+33612345678') ?? '')).toBe('06 12 34 56 78');
  });
});
