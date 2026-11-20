import { describe, expect, test } from 'vitest';
import { attribuerIdsActions, lireActions, modifierAction } from '../../src/sheets/actions.ts';
import { prochainId } from '../../src/sheets/ids.ts';
import { ajouterLignesDeTest, sheetInstalle } from '../faux/sheetDeTest.ts';

describe('lireActions', () => {
  test("convertit une ligne remplie par le référent", async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Actions', [{ Type: 'BP', Date: '28/11/2026', Heure: '14h', Lieu: ' Entrepôt ' }]);
    const { actions, ignorees } = await lireActions(tableur);
    expect(ignorees).toEqual([]);
    expect(actions).toEqual([{
      numero: 2, id: '', type: 'BP', date: '2026-11-28', heure: '14:00', lieu: 'Entrepôt',
      creneaux: [], places: '', statut: '', messageId: '',
    }]);
  });

  test.each([
    [{ Type: 'BP', Date: '28/11/2026' }, 'manque : Heure'],
    [{ Type: 'BP', Date: '31/02/2026', Heure: '14:00' }, 'date illisible'],
    [{ Type: 'BP', Date: '28/11/2026', Heure: 'midi' }, 'heure illisible'],
    [{ Type: 'BP', Date: '28/11/2026', Heure: '14:00', Statut: 'Anoncée' }, 'statut inconnu'],
  ])('ligne inutilisable mise de côté avec sa raison : %o', async (ligne, raison) => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Actions', [ligne]);
    const { actions, ignorees } = await lireActions(tableur);
    expect(actions).toEqual([]);
    expect(ignorees[0].numero).toBe(2);
    expect(ignorees[0].raison).toContain(raison);
  });
});

describe('lireActions : créneaux du sondage', () => {
  test('« Créneaux » séparés par des virgules → liste ; vide → aucun créneau', async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Actions', [
      { Type: 'Collecte', Date: '28/11/2026', Heure: '10:00', Créneaux: ' dispo de 10h à 13h ,dispo de 13h à 16h, ' },
      { Type: 'BP', Date: '28/11/2026', Heure: '14:00' },
    ]);
    const { actions } = await lireActions(tableur);
    expect(actions.map((a) => a.creneaux)).toEqual([['dispo de 10h à 13h', 'dispo de 13h à 16h'], []]);
  });

  test.each([
    [Array.from({ length: 12 }, (_, i) => `créneau ${i + 1}`).join(', '), 'trop de créneaux (12)'],
    ['10h-13h, 10h-13h', 'deux créneaux identiques'],
  ])('créneaux refusés par WhatsApp (« %s ») : action mise de côté avec la raison', async (creneaux, raison) => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Actions', [{ Type: 'BP', Date: '28/11/2026', Heure: '14:00', Créneaux: creneaux }]);
    const { actions, ignorees } = await lireActions(tableur);
    expect(actions).toEqual([]);
    expect(ignorees[0].raison).toContain(raison);
  });
});

describe('attribuerIdsActions', () => {
  test('donne un ID aux nouvelles actions, à la suite des ID existants', async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Actions', [
      { ID: 'A-0007', Type: 'BP', Date: '28/11/2026', Heure: '14:00' },
      { Type: 'Maraude', Date: '25/11/2026', Heure: '19:00' },
      { Type: 'Collecte', Date: '29/11/2026', Heure: '10:00' },
    ]);
    const { actions } = await lireActions(tableur);
    const nouvelles = await attribuerIdsActions(tableur, actions);

    expect(nouvelles.map((a) => a.id)).toEqual(['A-0008', 'A-0009']);
    expect(tableur.lignes('Actions').map((l) => l.ID)).toEqual(['A-0007', 'A-0008', 'A-0009']);
    expect(tableur.appels.ecritures).toBe(1); // une seule requête pour toutes
  });

  test("rien à faire : aucune écriture", async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Actions', [{ ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00' }]);
    const { actions } = await lireActions(tableur);
    expect(await attribuerIdsActions(tableur, actions)).toEqual([]);
    expect(tableur.appels.ecritures).toBe(0);
  });
});

describe('modifierAction', () => {
  test('met à jour le Sheet et l\'objet', async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Actions', [{ ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00' }]);
    const { actions: [action] } = await lireActions(tableur);
    await modifierAction(tableur, action, { statut: 'Annoncée', messageId: 'msg-42' });
    expect(action).toMatchObject({ statut: 'Annoncée', messageId: 'msg-42' });
    expect(tableur.lignes('Actions')[0]).toMatchObject({ Statut: 'Annoncée', 'Message ID': 'msg-42', Type: 'BP' });
  });
});

describe('prochainId', () => {
  test.each([
    [[], 'A-0001'],
    [['A-0001', 'A-0002'], 'A-0003'],
    [['A-0009', 'A-0003'], 'A-0010'], // pas forcément dans l'ordre
    [['', 'bidule', 'A-12'], 'A-0013'], // valeurs bizarres ignorées, format court accepté
    [['A-9999'], 'A-10000'], // dépasse 4 chiffres sans problème
  ])('%o → %s', (existants, attendu) => {
    expect(prochainId('A', existants, 4)).toBe(attendu);
  });
});
