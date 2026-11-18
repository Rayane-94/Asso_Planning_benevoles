import { describe, expect, test } from 'vitest';
import { PARAMETRES_DEFAUT } from '../../src/constantes.ts';
import { detecterReponse, normaliserPourDetection, remplirModele } from '../../src/utils/textes.ts';

describe('remplirModele', () => {
  test('remplace les variables connues', () => {
    const texte = remplirModele('📣 {type} – {date} à {heure} – {lieu}', {
      type: 'BP', date: 'samedi 28/11', heure: '14:00', lieu: 'Entrepôt',
    });
    expect(texte).toBe('📣 BP – samedi 28/11 à 14:00 – Entrepôt');
  });

  test('laisse visibles les variables inconnues ou vides', () => {
    expect(remplirModele('Bonjour {prenon} !', { prenom: 'Bob' })).toBe('Bonjour {prenon} !');
    expect(remplirModele('Bonjour {prenom} !', { prenom: null })).toBe('Bonjour {prenom} !');
  });

  test("fonctionne avec le modèle d'annonce par défaut", () => {
    const texte = remplirModele(PARAMETRES_DEFAUT.TEXTE_ANNONCE.valeur, {
      type: 'BP', date: 'samedi 28/11', heure: '14:00', lieu: 'Entrepôt',
    });
    expect(texte.startsWith('📣 BP – samedi 28/11 à 14:00 – Entrepôt\n')).toBe(true);
    expect(texte).not.toContain('{');
  });
});

describe('normaliserPourDetection', () => {
  test.each([
    ['Présente !!', 'presente'],
    ['OUIIII', 'oui'],
    ['Je  peux   plus...', 'je peux plus'],
  ])('« %s » → « %s »', (texte, attendu) => {
    expect(normaliserPourDetection(texte)).toBe(attendu);
  });
});

// Les cas sont rangés dans des tableaux : pour ajouter un cas, il suffit d'ajouter une ligne.
describe('detecterReponse', () => {
  test.each([
    'oui', 'Oui', 'OUI !', 'ouiiii', 'Ouais', 'ok', 'Okay', 'présent', 'Présente',
    'je viens', 'Dispo', 'partante', 'yes', 'Je serai là', 'oui je viens avec ma sœur',
    '👍', '👍🏽', '✅', 'Bien sûr !',
  ])('« %s » → OUI', (message) => {
    expect(detecterReponse(message)).toBe('OUI');
  });

  test.each([
    'non', 'Non', 'NON', 'nan', 'finalement non', 'je peux plus', 'je ne peux plus',
    'Je peux pas finalement', 'pas dispo', 'indispo', 'je viens pas', 'je ne viendrai pas',
    'absente', 'désolé je me désiste', 'ok finalement je peux pas', '👎', '❌',
  ])('« %s » → NON', (message) => {
    expect(detecterReponse(message)).toBe('NON');
  });

  test.each([
    '', 'peut-être', 'je sais pas encore', 'pas sûr', 'Bonjour à tous', 'Bob Durand',
    'à quelle heure ?', 'nonne', 'bookmark',
  ])('« %s » → rien (null)', (message) => {
    expect(detecterReponse(message)).toBeNull();
  });

  test('null ou undefined → rien', () => {
    expect(detecterReponse(null)).toBeNull();
    expect(detecterReponse(undefined)).toBeNull();
  });
});
