import { describe, expect, test } from 'vitest';
import {
  ajouterBenevole, lireBenevoles, modifierBenevole, nomPourListe, prenomPourMessage,
} from '../../src/sheets/benevoles.ts';
import { ajouterInscription, lireInscriptions, modifierInscriptions } from '../../src/sheets/inscriptions.ts';
import { ajouterLignesDeTest, sheetInstalle } from '../faux/sheetDeTest.ts';

const MAINTENANT = new Date('2026-11-21T17:00:05Z'); // 18:00:05 à Paris

describe('Bénévoles', () => {
  test("ajout : téléphone au format lisible, date d'inscription", async () => {
    const tableur = await sheetInstalle();
    await ajouterBenevole(tableur, { telephone: '33612345678', nomWhatsApp: 'Bob 🌸' }, MAINTENANT);
    expect(tableur.lignes('Bénévoles')[0]).toMatchObject({
      Téléphone: '06 12 34 56 78', 'Nom WhatsApp': 'Bob 🌸', 'Inscrit le': '2026-11-21 18:00:05',
    });
  });

  test("lecture : retrouvé par son numéro, quelle que soit la façon dont l'équipe l'a tapé", async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Bénévoles', [
      { Téléphone: '+33 6 12 34 56 78', Prénom: 'Bob', Nom: 'Durand' },
      { Téléphone: '612345679', Prénom: 'Alice' }, // 0 mangé par le Sheet
    ]);
    const { parTelephone, ignorees } = await lireBenevoles(tableur);
    expect(ignorees).toEqual([]);
    expect(parTelephone.get('33612345678')?.nom).toBe('Durand');
    expect(parTelephone.get('33612345679')?.prenom).toBe('Alice');
  });

  test('numéro illisible ou doublon : mis de côté avec la raison', async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Bénévoles', [
      { Téléphone: '06 12 34 56 78', Prénom: 'Bob' },
      { Téléphone: '0612345678', Prénom: 'Bob bis' },
      { Téléphone: 'inconnu', Prénom: 'X' },
    ]);
    const { parTelephone, ignorees } = await lireBenevoles(tableur);
    expect(parTelephone.size).toBe(1);
    expect(ignorees.map((i) => i.raison)).toEqual([
      'doublon : le 06 12 34 56 78 est déjà à la ligne 2',
      'téléphone illisible « inconnu »',
    ]);
  });

  test('modification du prénom et du nom', async () => {
    const tableur = await sheetInstalle();
    await ajouterBenevole(tableur, { telephone: '33612345678', nomWhatsApp: 'Bob' }, MAINTENANT);
    const { parTelephone } = await lireBenevoles(tableur);
    const bob = parTelephone.get('33612345678');
    if (!bob) throw new Error('Bob introuvable');
    await modifierBenevole(tableur, bob, { prenom: 'Bob', nom: 'Durand' });
    expect(tableur.lignes('Bénévoles')[0]).toMatchObject({ Prénom: 'Bob', Nom: 'Durand', 'Nom WhatsApp': 'Bob' });
  });

  test.each([
    [{ prenom: 'Bob', nom: 'Durand', nomWhatsApp: 'Bobby', telephone: '33612345678' }, 'Durand Bob', 'Bob'],
    [{ prenom: '', nom: '', nomWhatsApp: 'Bobby D', telephone: '33612345678' }, 'Bobby D', 'Bobby'],
    [{ prenom: '', nom: '', nomWhatsApp: '', telephone: '33612345678' }, '06 12 34 56 78', ''],
  ])('noms affichés pour %o : liste « %s », message « %s »', (benevole, liste, prenom) => {
    expect(nomPourListe(benevole)).toBe(liste);
    expect(prenomPourMessage(benevole)).toBe(prenom);
  });
});

describe('Inscriptions', () => {
  const NOUVELLE = {
    actionId: 'A-0001', type: 'BP', date: '2026-11-28', heure: '14:00', lieu: 'Entrepôt',
    telephone: '33612345678', nom: 'Durand Bob', statut: 'Inscrit',
  } as const;

  test('ajout : nouvel ID, date au format triable, téléphone lisible', async () => {
    const tableur = await sheetInstalle();
    const id = await ajouterInscription(tableur, NOUVELLE, [{ id: 'I-00041' }], MAINTENANT);
    expect(id).toBe('I-00042');
    expect(tableur.lignes('Inscriptions')[0]).toMatchObject({
      ID: 'I-00042', 'Action ID': 'A-0001', Date: '2026-11-28', Téléphone: '06 12 34 56 78',
      Statut: 'Inscrit', 'Mis à jour': '2026-11-21 18:00:05',
    });
  });

  test('lecture : relit ce qui a été écrit', async () => {
    const tableur = await sheetInstalle();
    await ajouterInscription(tableur, NOUVELLE, [], MAINTENANT);
    const { inscriptions, ignorees } = await lireInscriptions(tableur);
    expect(ignorees).toEqual([]);
    expect(inscriptions[0]).toMatchObject({ ...NOUVELLE, id: 'I-00001', demandeId: '' });
  });

  test("lecture : une date retapée par l'équipe au format 28/11/2026 est comprise", async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Inscriptions', [{
      ID: 'I-00001', 'Action ID': 'A-0001', Date: '28/11/2026', Téléphone: '06 12 34 56 78', Statut: 'Confirmé',
    }]);
    expect((await lireInscriptions(tableur)).inscriptions[0].date).toBe('2026-11-28');
  });

  test('statut corrigé à la main avec une faute → mis de côté', async () => {
    const tableur = await sheetInstalle();
    await ajouterLignesDeTest(tableur, 'Inscriptions', [{
      ID: 'I-00001', 'Action ID': 'A-0001', Date: '2026-11-28', Téléphone: '06 12 34 56 78', Statut: 'confirme',
    }]);
    const { inscriptions, ignorees } = await lireInscriptions(tableur);
    expect(inscriptions).toEqual([]);
    expect(ignorees[0].raison).toContain('statut inconnu');
  });

  test('modification de plusieurs inscriptions en une seule requête', async () => {
    const tableur = await sheetInstalle();
    await ajouterInscription(tableur, NOUVELLE, [], MAINTENANT);
    await ajouterInscription(tableur, { ...NOUVELLE, telephone: '33611223344', nom: 'Martin Alice' }, [{ id: 'I-00001' }], MAINTENANT);
    const { inscriptions } = await lireInscriptions(tableur);
    tableur.appels.ecritures = 0;

    const plusTard = new Date('2026-11-26T09:00:00Z'); // 10:00 à Paris
    await modifierInscriptions(tableur, inscriptions.map((inscription) => ({
      inscription, changements: { statut: 'En attente', demandeId: `demande-${inscription.id}` },
    })), plusTard);

    expect(tableur.appels.ecritures).toBe(1);
    expect(tableur.lignes('Inscriptions').map((l) => [l.Statut, l['Demande ID'], l['Mis à jour']])).toEqual([
      ['En attente', 'demande-I-00001', '2026-11-26 10:00:00'],
      ['En attente', 'demande-I-00002', '2026-11-26 10:00:00'],
    ]);
    expect(inscriptions[0].statut).toBe('En attente'); // l'objet est aussi à jour
  });
});
