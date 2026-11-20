/**
 * Liste finale J-1 (CLAUDE.md §4.5). Scénario : BP du samedi 28/11, demandes de confirmation
 * parties le jeudi. Vendredi 27/11 à 20:00 : Bob et Alice ont confirmé, Chloé n'a pas
 * répondu, David s'est désisté.
 */
import { describe, expect, test } from 'vitest';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { ajouterLignesDeTest } from '../faux/sheetDeTest.ts';

const BOB = '33612345678';
const ALICE = '33611223344';
const CHLOE = '33655555555';

const inscription = (id: string, telephone: string, nom: string, statut: string) => ({
  ID: id, 'Action ID': 'A-0001', Type: 'BP', Date: '2026-11-28', Heure: '14:00', Lieu: 'Entrepôt',
  Téléphone: telephone, Nom: nom, Statut: statut, 'Demande ID': `demande-${id}`,
});

async function preparer(depart = '2026-11-27 20:00', statutAction = 'Confirmations envoyées'): Promise<EnvironnementDeTest> {
  const env = await contexteDeTest(depart);
  await ajouterAction(env, {
    ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt', Statut: statutAction, 'Message ID': 'annonce-bp',
  });
  await ajouterLignesDeTest(env.tableur, 'Bénévoles', [
    { Téléphone: '06 12 34 56 78', Prénom: 'Bob', Nom: 'Durand' },
    { Téléphone: '06 11 22 33 44', Prénom: 'Alice', Nom: 'Martin' },
  ]);
  await ajouterLignesDeTest(env.tableur, 'Inscriptions', [
    inscription('I-00001', '06 11 22 33 44', 'Martin Alice', 'Confirmé'),
    inscription('I-00002', '06 55 55 55 55', 'Petit Chloé', 'En attente'),
    inscription('I-00003', '06 12 34 56 78', 'Durand Bob', 'Confirmé'),
    inscription('I-00004', '06 99 99 99 99', 'Roux David', 'Désisté'),
  ]);
  return env;
}

const statuts = (env: EnvironnementDeTest) => env.tableur.lignes('Inscriptions').map((l) => `${l.Nom} : ${l.Statut}`);
const statutAction = (env: EnvironnementDeTest) => env.tableur.lignes('Actions')[0].Statut;

describe('vendredi 20:00 : liste finale du BP de samedi', () => {
  test('la liste des confirmés est publiée dans le groupe, triée par nom', async () => {
    const env = await preparer();
    await env.planificateur.tick();
    expect(env.messagerie.envoyesA(GROUPE_TEST).map((m) => m.texte)).toEqual([
      '📋 BP – samedi 28/11 à 14:00 – Entrepôt\n' +
      '• Durand Bob – 06 12 34 56 78\n' +
      '• Martin Alice – 06 11 22 33 44',
    ]);
  });

  test('« En attente » → « Sans réponse » ; les autres statuts ne bougent pas', async () => {
    const env = await preparer();
    await env.planificateur.tick();
    expect(statuts(env)).toEqual([
      'Martin Alice : Confirmé', 'Petit Chloé : Sans réponse', 'Durand Bob : Confirmé', 'Roux David : Désisté',
    ]);
  });

  test('chaque confirmé reçoit « ✅ Nous vous confirmons… » en privé ; pas les autres', async () => {
    const env = await preparer();
    await env.planificateur.tick();
    const attendu = '✅ Nous vous confirmons votre participation à : BP – samedi 28/11 à 14:00 – Entrepôt. Merci et à demain !';
    expect(env.messagerie.envoyesA(BOB).map((m) => m.texte)).toEqual([attendu]);
    expect(env.messagerie.envoyesA(ALICE).map((m) => m.texte)).toEqual([attendu]);
    expect(env.messagerie.envoyesA(CHLOE)).toEqual([]);
  });

  test('l\'action passe à « Liste publiée », et un résumé va dans le Journal', async () => {
    const env = await preparer();
    await env.planificateur.tick();
    expect(statutAction(env)).toBe('Liste publiée');
    expect(logsDeNiveau(env, 'INFO')).toContain('Liste finale publiée : BP du samedi 28/11 — 2 confirmé(s), 1 sans réponse');
  });

  test('ticks suivants : rien n\'est renvoyé', async () => {
    const env = await preparer();
    for (let i = 0; i < 5; i++) {
      await env.planificateur.tick();
      env.horloge.avancer({ minutes: 1 });
    }
    expect(env.messagerie.envoyesA(GROUPE_TEST)).toHaveLength(1);
    expect(env.messagerie.envoyesA(BOB)).toHaveLength(1);
  });

  test('messages espacés de 2 secondes (liste, puis 2 messages privés)', async () => {
    const env = await preparer();
    await env.planificateur.tick();
    expect(env.horloge.pauses).toEqual([2000, 2000]);
  });

  test('aucun confirmé : message d\'alerte dans le groupe', async () => {
    const env = await contexteDeTest('2026-11-24 20:00');
    await ajouterAction(env, {
      ID: 'A-0001', Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Lieu: 'Gare', Statut: 'Confirmations envoyées', 'Message ID': 'x',
    });
    await env.planificateur.tick();
    expect(env.messagerie.dernierEnvoi().texte).toBe(
      "⚠️ Maraude – 25/11 : personne n'a confirmé. Si tu peux venir, contacte le référent.",
    );
  });
});

describe('le bon moment', () => {
  test.each([
    ['2026-11-27 19:59', 'vendredi 19:59', false],
    ['2026-11-27 20:00', 'vendredi 20:00', true],
    ['2026-11-27 22:00', 'vendredi 22:00 (trop tard le soir)', false],
    ['2026-11-28 07:59', 'samedi 07:59 (trop tôt)', false],
    ['2026-11-28 08:00', 'samedi 08:00 (rattrapage)', true],
    ['2026-11-28 14:00', "samedi 14:00 (l'action commence)", false],
    ['2026-11-26 20:00', 'jeudi 20:00 (J-2)', false],
  ])('%s (%s) → liste publiée : %s', async (depart, _description, publiee) => {
    const env = await preparer(depart);
    await env.planificateur.tick();
    expect(env.messagerie.envoyesA(GROUPE_TEST).length > 0).toBe(publiee);
  });

  test('HEURE_LISTE modifiée dans les Paramètres : respectée', async () => {
    const env = await preparer('2026-11-27 20:00');
    const { lignes } = await env.tableur.lireOnglet('Paramètres');
    const ligne = lignes.find((l) => l.valeurs.Paramètre === 'HEURE_LISTE');
    await env.tableur.modifierLignes('Paramètres', [{ numero: ligne?.numero ?? 0, valeurs: { Valeur: '21:00' } }]);
    // À 21:00 le récap du vendredi (20:30) part aussi : on ne compte que la liste.
    const listes = () => env.messagerie.envoyesA(GROUPE_TEST).filter((m) => m.texte.startsWith('📋 BP'));
    await env.planificateur.tick();
    expect(listes()).toEqual([]);
    env.horloge.regler('2026-11-27 21:00');
    await env.planificateur.tick();
    expect(listes()).toHaveLength(1);
  });
});

describe('problèmes', () => {
  test('envoi de la liste impossible : statut remis, nouvel essai au tick suivant', async () => {
    const env = await preparer();
    env.messagerie.deconnecter();
    await env.planificateur.tick();
    expect(statutAction(env)).toBe('Confirmations envoyées');
    expect(logsDeNiveau(env, 'ERREUR')[0]).toContain('Liste finale non publiée : BP du samedi 28/11');

    env.messagerie.reconnecter();
    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();
    expect(statutAction(env)).toBe('Liste publiée');
    expect(env.messagerie.envoyesA(GROUPE_TEST)).toHaveLength(1);
  });

  test('un confirmé injoignable en privé : la liste et les autres messages partent quand même', async () => {
    const env = await preparer();
    env.messagerie.faireEchouerEnvoisVers(BOB);
    await env.planificateur.tick();
    expect(env.messagerie.envoyesA(GROUPE_TEST)).toHaveLength(1);
    expect(env.messagerie.envoyesA(ALICE)).toHaveLength(1);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('Confirmation finale non envoyée à Durand Bob');
  });

  test('confirmations jamais envoyées (action encore « Annoncée ») : pas de liste trompeuse, avertissement', async () => {
    const env = await preparer('2026-11-27 20:00', 'Annoncée');
    await env.tableur.modifierLignes('Inscriptions', [2, 3, 4, 5].map((numero) => ({ numero, valeurs: { Statut: 'Inscrit', 'Demande ID': '' } })));
    await env.planificateur.tick();
    expect(env.messagerie.envoyesA(GROUPE_TEST)).toEqual([]);
    expect(logsDeNiveau(env, 'AVERTISSEMENT').some((l) => l.includes('les demandes de confirmation ne sont jamais parties'))).toBe(true);
  });
});
