import { describe, expect, test } from 'vitest';
import { lireParametres } from '../../src/sheets/parametres.ts';
import { FauxTableur } from '../faux/fauxTableur.ts';
import { changerParametre, sheetInstalle } from '../faux/sheetDeTest.ts';

describe('lireParametres', () => {
  test('valeurs par défaut, converties dans le bon type', async () => {
    const { parametres, avertissements } = await lireParametres(await sheetInstalle());
    expect(avertissements).toEqual([]);
    expect(parametres).toMatchObject({
      joursAvantAnnonce: 7,
      heureAnnonce: '18:00',
      joursAvantConfirmation: 2,
      heureConfirmation: '10:00',
      heureListe: '20:00',
      recapActif: true,
      jourRecap: 5, // vendredi
      heureRecap: '20:30',
      numeroReferent: null,
      typesActions: ['Maraude', 'BP', 'Paniers anti-gaspi', 'Collecte', 'Événement', 'Ménage'],
    });
    expect(parametres.textes.annonce).toContain('{type}');
  });

  test("valeurs tapées librement par l'équipe : acceptées si elles sont compréhensibles", async () => {
    const tableur = await sheetInstalle();
    await changerParametre(tableur, 'HEURE_ANNONCE', '19h30');
    await changerParametre(tableur, 'RECAP_ACTIF', 'Non');
    await changerParametre(tableur, 'JOUR_RECAP', 'Jeudi');
    await changerParametre(tableur, 'NUMERO_REFERENT', '06 12 34 56 78');
    await changerParametre(tableur, 'TYPES_ACTIONS', ' Maraude ,  BP,');

    const { parametres, avertissements } = await lireParametres(tableur);
    expect(avertissements).toEqual([]);
    expect(parametres.heureAnnonce).toBe('19:30');
    expect(parametres.recapActif).toBe(false);
    expect(parametres.jourRecap).toBe(4);
    expect(parametres.numeroReferent).toBe('33612345678');
    expect(parametres.typesActions).toEqual(['Maraude', 'BP']);
  });

  test.each([
    ['HEURE_ANNONCE', 'dix-huit heures', 'heureAnnonce', '18:00'],
    ['JOURS_AVANT_ANNONCE', 'sept', 'joursAvantAnnonce', 7],
    ['JOURS_AVANT_ANNONCE', '0', 'joursAvantAnnonce', 7],
    ['RECAP_ACTIF', 'peut-être', 'recapActif', true],
    ['JOUR_RECAP', 'vendredie', 'jourRecap', 5],
    ['NUMERO_REFERENT', '123', 'numeroReferent', null],
  ])('%s = « %s » → avertissement, et valeur par défaut', async (nom, valeur, champ, attendu) => {
    const tableur = await sheetInstalle();
    await changerParametre(tableur, nom, valeur);
    const { parametres, avertissements } = await lireParametres(tableur);
    expect(parametres[champ as keyof typeof parametres]).toEqual(attendu);
    expect(avertissements).toHaveLength(1);
    expect(avertissements[0]).toContain(nom);
  });

  test('NUMERO_REFERENT vide : normal, aucun avertissement', async () => {
    const { avertissements } = await lireParametres(await sheetInstalle());
    expect(avertissements).toEqual([]);
  });

  test('un texte de message vidé par erreur → texte par défaut', async () => {
    const tableur = await sheetInstalle();
    await changerParametre(tableur, 'TEXTE_ANNONCE', '');
    const { parametres, avertissements } = await lireParametres(tableur);
    expect(parametres.textes.annonce).toContain('📣');
    expect(avertissements[0]).toContain('TEXTE_ANNONCE');
  });

  test('paramètre supprimé du Sheet → valeur par défaut et conseil de réinstaller', async () => {
    const tableur = new FauxTableur();
    tableur.preparerOnglet('Paramètres', ['Paramètre', 'Valeur', 'Description']);
    const { parametres, avertissements } = await lireParametres(tableur);
    expect(parametres.heureAnnonce).toBe('18:00');
    expect(avertissements.some((a) => a.includes('installer-sheet'))).toBe(true);
  });
});
