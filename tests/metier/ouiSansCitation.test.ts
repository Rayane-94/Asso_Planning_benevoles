/**
 * Étape 7b — « oui » écrit dans le groupe SANS citer l'annonce (compromis du 19/11/2026).
 * Calendrier : samedi 21/11/2026, 18:05 ; le BP du samedi 28/11 vient d'être annoncé.
 */
import { describe, expect, test } from 'vitest';
import { recevoirMessage } from '../../src/metier/reception.ts';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { ajouterLignesDeTest } from '../faux/sheetDeTest.ts';

const BOB = '33612345678';
const ACCUSE_BP = "✅ C'est noté, tu es inscrit(e) pour : BP – samedi 28/11 à 14:00 – Entrepôt. Si ce n'était pas pour ça, réponds NON.";

/** BP annoncé ; Bob est déjà connu (avec son nom) pour ne pas mélanger avec la demande de nom. */
async function unSeulBpAnnonce(): Promise<EnvironnementDeTest> {
  const env = await contexteDeTest('2026-11-21 18:00');
  await ajouterLignesDeTest(env.tableur, 'Bénévoles', [{ Téléphone: '06 12 34 56 78', Prénom: 'Bob', Nom: 'Durand' }]);
  await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });
  await env.planificateur.tick(); // annonce
  env.messagerie.envoyes.length = 0;
  env.horloge.avancer({ minutes: 5 });
  return env;
}

/** Bob écrit dans le groupe, sans citer. */
const ecritDansLeGroupe = (env: EnvironnementDeTest, texte: string, de = BOB, nom = 'Bob') =>
  recevoirMessage(env.ctx, env.messagerie.recu({ de, nom, texte, groupe: GROUPE_TEST }));

const statuts = (env: EnvironnementDeTest) => env.tableur.lignes('Inscriptions').map((l) => `${l.Type} ${l.Nom} : ${l.Statut}`);

describe('une seule action ouverte', () => {
  test('« oui » sans citer : inscrit, et confirmation en privé de l\'action concernée', async () => {
    const env = await unSeulBpAnnonce();
    await ecritDansLeGroupe(env, 'oui');
    expect(statuts(env)).toEqual(['BP Durand Bob : Inscrit']);
    expect(env.messagerie.envoyesA(BOB).map((m) => m.texte)).toEqual([ACCUSE_BP]);
    expect(env.messagerie.envoyesA(GROUPE_TEST)).toEqual([]); // rien dans le groupe
  });

  test.each(['oui', 'Ok je viens', 'dispo 👍', '👍', 'Présente !'])('« %s » (court) : accepté', async (texte) => {
    const env = await unSeulBpAnnonce();
    await ecritDansLeGroupe(env, texte);
    expect(statuts(env)).toHaveLength(1);
  });

  test.each([
    "oui je suis d'accord avec toi",
    'oui il fait froid aujourd\'hui',
  ])('« %s » (phrase de conversation) : ignoré', async (texte) => {
    const env = await unSeulBpAnnonce();
    await ecritDansLeGroupe(env, texte);
    expect(statuts(env)).toEqual([]);
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('« non » sans citer dans le groupe : ignoré (trop ambigu en conversation)', async () => {
    const env = await unSeulBpAnnonce();
    await ecritDansLeGroupe(env, 'oui');
    await ecritDansLeGroupe(env, 'non');
    expect(statuts(env)).toEqual(['BP Durand Bob : Inscrit']);
  });

  test('« si ce n\'était pas pour ça, réponds NON » : un NON en privé le retire', async () => {
    const env = await unSeulBpAnnonce();
    await ecritDansLeGroupe(env, 'oui');
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non' }));
    expect(statuts(env)).toEqual(['BP Durand Bob : Retiré']);
    expect(env.messagerie.dernierEnvoi().texte).toBe("C'est noté, merci !");
  });

  test('nouveau bénévole : confirmation de l\'action puis demande de nom', async () => {
    const env = await unSeulBpAnnonce();
    const CHLOE = '33633333333';
    await ecritDansLeGroupe(env, 'oui', CHLOE, 'Chloé');
    const recus = env.messagerie.envoyesA(CHLOE).map((m) => m.texte);
    expect(recus).toHaveLength(2);
    expect(recus[0].startsWith("✅ C'est noté, tu es inscrit(e) pour : BP")).toBe(true);
    expect(recus[1].startsWith('Bienvenue !')).toBe(true);
  });

  test('confirmations déjà envoyées : la demande de confirmation part directement (pas de double message)', async () => {
    const env = await unSeulBpAnnonce();
    await env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: 'Confirmations envoyées' } }]);
    await ecritDansLeGroupe(env, 'oui');
    const recus = env.messagerie.envoyesA(BOB).map((m) => m.texte);
    expect(recus).toHaveLength(1);
    expect(recus[0]).toContain('Tu confirmes ta présence ?');
  });
});

describe('plusieurs actions ouvertes', () => {
  test('« oui » sans citer : pas d\'inscription, explication en privé', async () => {
    const env = await unSeulBpAnnonce();
    await ajouterAction(env, { ID: 'A-0002', Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Statut: 'Annoncée', 'Message ID': 'm' });
    await ecritDansLeGroupe(env, 'oui');
    expect(statuts(env)).toEqual([]);
    expect(env.messagerie.envoyesA(BOB).map((m) => m.texte)).toEqual([
      "Plusieurs actions sont ouvertes : pour t'inscrire, réponds OUI dans le groupe en citant l'annonce de ton choix (appui long → Répondre).",
    ]);
  });

  test('en citant l\'annonce, ça marche toujours (et sans message privé de plus)', async () => {
    const env = await unSeulBpAnnonce();
    await ajouterAction(env, { ID: 'A-0002', Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Statut: 'Annoncée', 'Message ID': 'm' });
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, nom: 'Bob', texte: 'oui', groupe: GROUPE_TEST, cite: 'm' }));
    expect(statuts(env)).toEqual(['Maraude Durand Bob : Inscrit']);
    expect(env.messagerie.envoyesA(BOB)).toEqual([]);
  });

  test('NON en privé alors qu\'il est inscrit à deux actions : on lui explique comment faire', async () => {
    const env = await unSeulBpAnnonce();
    await ajouterAction(env, { ID: 'A-0002', Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Statut: 'Annoncée', 'Message ID': 'm' });
    const bp = env.tableur.lignes('Actions')[0]['Message ID'];
    for (const cite of [bp, 'm']) {
      await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, nom: 'Bob', texte: 'oui', groupe: GROUPE_TEST, cite }));
    }
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non' }));
    expect(statuts(env)).toEqual(['BP Durand Bob : Inscrit', 'Maraude Durand Bob : Inscrit']);
    expect(env.messagerie.dernierEnvoi().texte).toContain('pour te retirer, réponds NON dans le groupe en citant');
  });
});

describe('aucune action ouverte', () => {
  test('« oui » sans citer : ignoré, aucun message (une conversation normale du groupe)', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ecritDansLeGroupe(env, 'oui');
    expect(env.messagerie.envoyes).toEqual([]);
    expect(env.tableur.lignes('Inscriptions')).toEqual([]);
  });

  test('une action annoncée mais déjà passée ne compte pas', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { ID: 'A-0001', Type: 'BP', Date: '20/11/2026', Heure: '14:00', Statut: 'Annoncée', 'Message ID': 'x' });
    await ecritDansLeGroupe(env, 'oui');
    expect(env.messagerie.envoyes).toEqual([]);
  });
});
