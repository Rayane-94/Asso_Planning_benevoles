/**
 * Réception des réponses (CLAUDE.md §4.3). Scénario de base : le samedi 21/11 à 18:00,
 * le bot annonce le BP du samedi 28/11 ; les bénévoles répondent en citant l'annonce.
 */
import { describe, expect, test } from 'vitest';
import { recevoirMessage } from '../../src/metier/reception.ts';
import type { MessageRecu } from '../../src/ports/messagerie.ts';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { ajouterLignesDeTest } from '../faux/sheetDeTest.ts';

const BOB = '33612345678';
const ALICE = '33611223344';
const DEMANDE_NOM = 'Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?';

/** Un environnement où le BP du samedi 28 vient d'être annoncé. Renvoie aussi l'ID de l'annonce. */
async function apresAnnonce(): Promise<EnvironnementDeTest & { annonce: string }> {
  const env = await contexteDeTest('2026-11-21 18:00');
  await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });
  await env.planificateur.tick();
  const annonce = env.messagerie.dernierEnvoi().id;
  env.messagerie.envoyes.length = 0; // on ne garde que ce qui suit
  env.horloge.avancer({ minutes: 5 });
  return { ...env, annonce };
}

/** Bob (ou un autre) répond dans le groupe en citant un message. */
function repondDansLeGroupe(env: EnvironnementDeTest, texte: string, cite: string, de = BOB, nom = 'Bob'): MessageRecu {
  return env.messagerie.recu({ de, nom, texte, groupe: GROUPE_TEST, cite });
}

const inscriptions = (env: EnvironnementDeTest) =>
  env.tableur.lignes('Inscriptions').map((l) => ({ telephone: l.Téléphone, nom: l.Nom, statut: l.Statut }));

describe('OUI dans le groupe, en citant l\'annonce', () => {
  test('nouveau bénévole : inscrit, ajouté aux Bénévoles, et on lui demande son nom en privé', async () => {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'Oui !', env.annonce));

    expect(env.tableur.lignes('Inscriptions')[0]).toMatchObject({
      ID: 'I-00001', 'Action ID': 'A-0001', Type: 'BP', Date: '2026-11-28', Heure: '14:00', Lieu: 'Entrepôt',
      Téléphone: '06 12 34 56 78', Nom: 'Bob', Statut: 'Inscrit',
    });
    expect(env.tableur.lignes('Bénévoles')[0]).toMatchObject({
      Téléphone: '06 12 34 56 78', 'Nom WhatsApp': 'Bob', 'Nom demandé le': '2026-11-21 18:05:00',
    });
    expect(env.messagerie.envoyes).toEqual([expect.objectContaining({ destinataire: BOB, texte: DEMANDE_NOM })]);
    expect(logsDeNiveau(env, 'INFO')).toContain('Inscription : Bob pour BP du samedi 28/11');
  });

  test('bénévole déjà connu avec son nom : inscrit sous « Nom Prénom », pas de message privé', async () => {
    const env = await apresAnnonce();
    await ajouterLignesDeTest(env.tableur, 'Bénévoles', [{ Téléphone: '06 12 34 56 78', Prénom: 'Bob', Nom: 'Durand' }]);
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, '👍', env.annonce));

    expect(inscriptions(env)).toEqual([{ telephone: '06 12 34 56 78', nom: 'Durand Bob', statut: 'Inscrit' }]);
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('OUI deux fois : une seule inscription, une seule demande de nom', async () => {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'oui', env.annonce));
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'ouiii je viens', env.annonce));
    expect(inscriptions(env)).toHaveLength(1);
    expect(env.messagerie.envoyes).toHaveLength(1);
  });

  test('deux bénévoles : deux inscriptions avec des ID différents', async () => {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'oui', env.annonce));
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'dispo', env.annonce, ALICE, 'Alice'));
    expect(env.tableur.lignes('Inscriptions').map((l) => [l.ID, l.Nom])).toEqual([['I-00001', 'Bob'], ['I-00002', 'Alice']]);
  });

  test('deux annonces : la réponse va à l\'action citée', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });
    await ajouterAction(env, { Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Lieu: 'Gare' });
    await env.planificateur.tick();
    const annonceMaraude = env.messagerie.envoyes.find((m) => m.texte.includes('Maraude'))?.id ?? '';

    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'oui', annonceMaraude));
    expect(env.tableur.lignes('Inscriptions')[0]).toMatchObject({ Type: 'Maraude', 'Action ID': 'A-0002' });
  });
});

describe('NON, et changements d\'avis', () => {
  test('NON après un OUI : « Retiré » ; puis OUI : de nouveau « Inscrit » (même ligne)', async () => {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'oui', env.annonce));
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'finalement je peux pas', env.annonce));
    expect(inscriptions(env)).toEqual([expect.objectContaining({ statut: 'Retiré' })]);

    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'ah si en fait oui', env.annonce));
    expect(inscriptions(env)).toEqual([expect.objectContaining({ statut: 'Inscrit' })]);
  });

  test('NON après la demande de confirmation (« En attente ») : « Désisté »', async () => {
    const env = await apresAnnonce();
    await ajouterLignesDeTest(env.tableur, 'Inscriptions', [{
      ID: 'I-00001', 'Action ID': 'A-0001', Date: '2026-11-28', Téléphone: '06 12 34 56 78', Nom: 'Bob', Statut: 'En attente',
    }]);
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'non', env.annonce));
    expect(inscriptions(env)[0].statut).toBe('Désisté');
  });

  test("NON sans avoir dit OUI avant : rien n'est créé", async () => {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'non', env.annonce));
    expect(inscriptions(env)).toEqual([]);
    expect(env.tableur.lignes('Bénévoles')).toEqual([]);
  });
});

describe('messages ignorés', () => {
  test.each([
    ['« peut-être »', { texte: 'peut-être' }],
    // (« oui » sans citation : désormais accepté sous conditions, voir « OUI sans citation » plus bas)
    ["citant un message qui n'est pas une annonce", { texte: 'oui', cite: 'autre-message' }],
    ['dans un autre groupe', { texte: 'oui', groupe: 'autre-groupe' }],
  ])('%s', async (_cas, variante) => {
    const env = await apresAnnonce();
    const message = env.messagerie.recu({ de: BOB, nom: 'Bob', groupe: GROUPE_TEST, cite: env.annonce, ...variante });
    await recevoirMessage(env.ctx, message);
    expect(inscriptions(env)).toEqual([]);
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('un message banal du groupe ne déclenche même pas de lecture du Sheet', async () => {
    const env = await apresAnnonce();
    env.tableur.appels.lectures = 0;
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'Bonjour à tous !', groupe: GROUPE_TEST }));
    expect(env.tableur.appels.lectures).toBe(0);
  });

  test.each(['Annulée', 'Liste publiée'])('réponse à une action « %s » : ignorée', async (statut) => {
    const env = await apresAnnonce();
    await env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: statut } }]);
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'oui', env.annonce));
    expect(inscriptions(env)).toEqual([]);
  });

  test('numéro masqué par WhatsApp (LID) : rien d\'inscrit, avertissement pour l\'équipe', async () => {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: null, nom: 'Bob', texte: 'oui', groupe: GROUPE_TEST, cite: env.annonce }));
    expect(inscriptions(env)).toEqual([]);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('Bob a répondu OUI pour BP du samedi 28/11, mais WhatsApp masque son numéro');
  });

  test('le même message reçu deux fois (webhook renvoyé) : traité une seule fois', async () => {
    const env = await apresAnnonce();
    const message = repondDansLeGroupe(env, 'oui', env.annonce);
    await recevoirMessage(env.ctx, message);
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 2, valeurs: { Statut: 'Retiré' } }]); // l'équipe corrige
    await recevoirMessage(env.ctx, message); // doublon : ne doit PAS réinscrire
    expect(inscriptions(env)[0].statut).toBe('Retiré');
  });
});

describe('réponse en privé à la demande de nom', () => {
  async function bobAttendSonNom(): Promise<EnvironnementDeTest & { annonce: string }> {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, repondDansLeGroupe(env, 'oui', env.annonce));
    env.messagerie.envoyes.length = 0;
    return env;
  }

  test('« bob durand » : prénom et nom enregistrés, recopiés dans les inscriptions, remerciement', async () => {
    const env = await bobAttendSonNom();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'bob durand' }));

    expect(env.tableur.lignes('Bénévoles')[0]).toMatchObject({ Prénom: 'Bob', Nom: 'Durand' });
    expect(inscriptions(env)[0].nom).toBe('Durand Bob');
    expect(env.messagerie.envoyes).toEqual([expect.objectContaining({ destinataire: BOB, texte: "Merci Bob, c'est noté !" })]);
  });

  test("un message qui n'est pas un nom : rien n'est enregistré, info pour l'équipe", async () => {
    const env = await bobAttendSonNom();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: "c'est à quelle heure samedi ?" }));
    expect(env.tableur.lignes('Bénévoles')[0]).toMatchObject({ Prénom: '', Nom: '' });
    expect(env.messagerie.envoyes).toEqual([]);
    expect(logsDeNiveau(env, 'INFO').some((l) => l.includes('non compris comme un nom'))).toBe(true);
  });

  test('une fois le nom connu, les messages privés suivants ne le changent plus', async () => {
    const env = await bobAttendSonNom();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'Bob Durand' }));
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'Merci beaucoup' }));
    expect(env.tableur.lignes('Bénévoles')[0]).toMatchObject({ Prénom: 'Bob', Nom: 'Durand' });
  });

  test("message privé d'un inconnu : ignoré", async () => {
    const env = await apresAnnonce();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: ALICE, texte: 'Alice Martin' }));
    expect(env.tableur.lignes('Bénévoles')).toEqual([]);
    expect(env.messagerie.envoyes).toEqual([]);
  });
});

describe('file d\'attente partagée avec le tick', () => {
  test('un message arrivé pendant un tick est traité après, sans conflit', async () => {
    const env = await apresAnnonce();
    // Le tick et le message démarrent « en même temps »
    await Promise.all([
      env.planificateur.tick(),
      recevoirMessage(env.ctx, repondDansLeGroupe(env, 'oui', env.annonce)),
    ]);
    expect(inscriptions(env)).toHaveLength(1);
  });
});
