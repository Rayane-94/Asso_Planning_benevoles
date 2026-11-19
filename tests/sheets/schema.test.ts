import { describe, expect, test } from 'vitest';
import { COLONNES_INSCRIPTIONS, formulesVues, lettreColonne } from '../../src/sheets/schema.ts';

describe('lettreColonne', () => {
  test.each([
    [0, 'A'], [1, 'B'], [25, 'Z'], [26, 'AA'], [27, 'AB'], [51, 'AZ'], [52, 'BA'], [701, 'ZZ'], [702, 'AAA'],
  ])('index %i → %s', (index, lettres) => {
    expect(lettreColonne(index)).toBe(lettres);
  });
});

describe('formulesVues', () => {
  const formules = formulesVues(Object.values(COLONNES_INSCRIPTIONS));

  test('Présents : seulement les confirmés, triés par date, heure, nom', () => {
    expect(formules.presents).toBe(
      "=QUERY('Inscriptions'!A:K, \"select C, D, E, F, H, G where I = 'Confirmé' order by D, E, H\", 1)",
    );
  });

  test('Absents : désistés, sans réponse et non joignables, avec le statut (la raison)', () => {
    expect(formules.absents).toBe(
      "=QUERY('Inscriptions'!A:K, \"select C, D, E, F, H, G, I where " +
      "I = 'Désisté' or I = 'Sans réponse' or I = 'Non joignable' order by D, E, H\", 1)",
    );
  });

  test('Sheet en français : arguments séparés par « ; », virgules de la requête inchangées', () => {
    const enFrancais = formulesVues(Object.values(COLONNES_INSCRIPTIONS), ';');
    expect(enFrancais.presents).toBe(
      "=QUERY('Inscriptions'!A:K; \"select C, D, E, F, H, G where I = 'Confirmé' order by D, E, H\"; 1)",
    );
  });

  test('une colonne indispensable manquante donne une erreur claire', () => {
    expect(() => formulesVues(['ID', 'Type'])).toThrow(/Onglet Inscriptions : colonne « .+ » introuvable/);
  });
});
