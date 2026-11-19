/**
 * Tests des faux eux-mêmes : si un faux ment, tous les tests du bot mentent avec lui.
 */
import { describe, expect, test } from 'vitest';
import { valeursVersTableau } from '../../src/ports/tableur.ts';
import { FausseMessagerie, GROUPE_TEST, NUMERO_BOT } from './fausseMessagerie.ts';
import { FauxTableur } from './fauxTableur.ts';
import { HorlogeDeTest } from './horlogeDeTest.ts';

describe('HorlogeDeTest', () => {
  test("donne l'heure réglée, à Paris", () => {
    const horloge = new HorlogeDeTest('2026-11-21 18:00');
    expect(horloge.texte()).toBe('2026-11-21 18:00');
    expect(horloge.maintenant().toISOString()).toBe('2026-11-21T17:00:00.000Z'); // hiver : UTC+1
  });

  test("avance de jours, d'heures et de minutes", () => {
    const horloge = new HorlogeDeTest('2026-11-21 18:00');
    horloge.avancer({ jours: 2, heures: 1, minutes: 30 });
    expect(horloge.texte()).toBe('2026-11-23 19:30');
  });

  test("« 1 jour » garde la même heure lors du passage à l'heure d'hiver", () => {
    const horloge = new HorlogeDeTest('2026-10-24 18:00'); // nuit du 24 au 25/10 : on recule d'1 h
    horloge.avancer({ jours: 1 });
    expect(horloge.texte()).toBe('2026-10-25 18:00');
  });

  test('attendre() avance l\'horloge sans faire attendre le test, et note la pause', async () => {
    const horloge = new HorlogeDeTest('2026-11-21 18:00');
    await horloge.attendre(90_000);
    expect(horloge.texte()).toBe('2026-11-21 18:01');
    expect(horloge.pauses).toEqual([90_000]);
  });

  test('maintenant() renvoie une copie (on ne peut pas dérégler l\'horloge par accident)', () => {
    const horloge = new HorlogeDeTest('2026-11-21 18:00');
    horloge.maintenant().setFullYear(2000);
    expect(horloge.texte()).toBe('2026-11-21 18:00');
  });
});

describe('FausseMessagerie', () => {
  test('note les messages envoyés, avec un ID et l\'heure', async () => {
    const horloge = new HorlogeDeTest('2026-11-21 18:00');
    const messagerie = new FausseMessagerie(horloge);
    const id = await messagerie.envoyerTexte(GROUPE_TEST, 'Bonjour', { citeId: 'abc' });
    expect(messagerie.dernierEnvoi()).toEqual({
      id, destinataire: GROUPE_TEST, texte: 'Bonjour', citeId: 'abc', date: horloge.maintenant(),
    });
  });

  test('envoyesA filtre par destinataire', async () => {
    const messagerie = new FausseMessagerie(new HorlogeDeTest());
    await messagerie.envoyerTexte(GROUPE_TEST, 'annonce');
    await messagerie.envoyerTexte('33612345678', 'privé');
    expect(messagerie.envoyesA('33612345678').map((m) => m.texte)).toEqual(['privé']);
  });

  test('fabrique un message reçu dans le groupe', () => {
    const messagerie = new FausseMessagerie(new HorlogeDeTest());
    const message = messagerie.recu({ de: '33612345678', nom: 'Bob', texte: 'oui', groupe: GROUPE_TEST, cite: 'envoye-1' });
    expect(message).toMatchObject({
      discussionId: GROUPE_TEST, estGroupe: true, telephone: '33612345678',
      nomWhatsApp: 'Bob', texte: 'oui', citeId: 'envoye-1',
    });
  });

  test('fabrique un message privé, et un message à numéro masqué (LID)', () => {
    const messagerie = new FausseMessagerie(new HorlogeDeTest());
    const prive = messagerie.recu({ de: '33612345678', texte: 'OUI' });
    expect(prive).toMatchObject({ discussionId: '33612345678', estGroupe: false, citeId: null });

    const masque = messagerie.recu({ de: null, texte: 'oui', groupe: GROUPE_TEST });
    expect(masque.telephone).toBeNull();
    expect(masque.idBrut).toMatch(/^lid-/);
  });

  test('deux messages reçus ont des ID différents, sauf doublon voulu', () => {
    const messagerie = new FausseMessagerie(new HorlogeDeTest());
    const a = messagerie.recu({ de: '33612345678', texte: 'oui' });
    const b = messagerie.recu({ de: '33612345678', texte: 'oui' });
    const doublon = messagerie.recu({ de: '33612345678', texte: 'oui', id: a.id });
    expect(a.id).not.toBe(b.id);
    expect(doublon.id).toBe(a.id);
  });

  test('un envoi vers un numéro en échec lève une erreur', async () => {
    const messagerie = new FausseMessagerie(new HorlogeDeTest());
    messagerie.faireEchouerEnvoisVers('33699999999');
    await expect(messagerie.envoyerTexte('33699999999', 'coucou')).rejects.toThrow('Envoi impossible');
  });

  test('déconnectée : les envois échouent et verifierConnexion le signale', async () => {
    const messagerie = new FausseMessagerie(new HorlogeDeTest());
    expect(await messagerie.verifierConnexion()).toEqual({ ok: true, numero: NUMERO_BOT });
    messagerie.deconnecter();
    expect((await messagerie.verifierConnexion()).ok).toBe(false);
    await expect(messagerie.envoyerTexte(GROUPE_TEST, 'x')).rejects.toThrow('déconnecté');
  });

  test("dernierEnvoi sans aucun envoi : erreur claire plutôt qu'undefined", () => {
    expect(() => new FausseMessagerie(new HorlogeDeTest()).dernierEnvoi()).toThrow("n'a encore rien envoyé");
  });
});

describe('FauxTableur', () => {
  function tableurAvecActions(): FauxTableur {
    const tableur = new FauxTableur();
    tableur.preparerOnglet('Actions', ['ID', 'Type', 'Date', 'Statut'], [
      { ID: 'A-1', Type: 'BP', Date: '28/11/2026' },
      { ID: 'A-2', Type: 'Maraude', Date: '25/11/2026', Statut: 'Annoncée' },
    ]);
    return tableur;
  }

  test('lireOnglet : valeurs par nom de colonne et numéro de ligne du Sheet', async () => {
    const contenu = await tableurAvecActions().lireOnglet('Actions');
    expect(contenu.entetes).toEqual(['ID', 'Type', 'Date', 'Statut']);
    expect(contenu.lignes[0]).toEqual({ numero: 2, valeurs: { ID: 'A-1', Type: 'BP', Date: '28/11/2026', Statut: '' } });
    expect(contenu.lignes[1].numero).toBe(3);
  });

  test('ajouterLignes : à la fin, colonnes absentes laissées vides', async () => {
    const tableur = tableurAvecActions();
    await tableur.ajouterLignes('Actions', [{ ID: 'A-3', Type: 'Collecte' }]);
    expect(tableur.lignes('Actions')[2]).toEqual({ ID: 'A-3', Type: 'Collecte', Date: '', Statut: '' });
  });

  test('modifierLignes : seules les cellules indiquées changent', async () => {
    const tableur = tableurAvecActions();
    await tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: 'Annoncée' } }]);
    expect(tableur.lignes('Actions')[0]).toEqual({ ID: 'A-1', Type: 'BP', Date: '28/11/2026', Statut: 'Annoncée' });
  });

  test('les lignes vides sont ignorées à la lecture, sans décaler les numéros', async () => {
    const tableur = tableurAvecActions();
    await tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { ID: '', Type: '', Date: '', Statut: '' } }]);
    const contenu = await tableur.lireOnglet('Actions');
    expect(contenu.lignes).toHaveLength(1);
    expect(contenu.lignes[0].numero).toBe(3);
  });

  test('supprimerLignes : les lignes du dessous remontent ; les en-têtes sont protégés', async () => {
    const tableur = tableurAvecActions();
    await tableur.supprimerLignes('Actions', 2, 1);
    expect(tableur.lignes('Actions').map((l) => l.ID)).toEqual(['A-2']);
    await expect(tableur.supprimerLignes('Actions', 1, 1)).rejects.toThrow('en-têtes');
  });

  test('une colonne inconnue (faute de frappe) est refusée avec la liste des colonnes', async () => {
    const tableur = tableurAvecActions();
    await expect(tableur.ajouterLignes('Actions', [{ Statu: 'x' }])).rejects.toThrow(/« Statu ».*Colonnes disponibles : ID, Type, Date, Statut/);
  });

  test('un onglet absent donne une erreur qui explique quoi faire', async () => {
    await expect(new FauxTableur().lireOnglet('Actions')).rejects.toThrow('installer-sheet');
  });

  test('compte les lectures et les écritures (pour surveiller les quotas Google)', async () => {
    const tableur = tableurAvecActions();
    await tableur.lireOnglet('Actions');
    await tableur.ajouterLignes('Actions', [{ ID: 'A-3' }]);
    expect(tableur.appels).toEqual({ lectures: 1, ecritures: 1 });
  });
});

describe('valeursVersTableau (partagé avec la future implémentation Google)', () => {
  test("range les valeurs dans l'ordre des en-têtes", () => {
    expect(valeursVersTableau('Actions', ['ID', 'Type', 'Lieu'], { Type: 'BP', ID: 'A-1' })).toEqual(['A-1', 'BP', '']);
  });
});
