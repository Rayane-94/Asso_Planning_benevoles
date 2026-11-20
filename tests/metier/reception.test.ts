/**
 * Réception des MESSAGES (les inscriptions, elles, passent par les votes : votes.test.ts).
 * - Les messages texte du groupe sont ignorés (sondage seul, décision du 20/11/2026).
 * - En privé : la réponse à la demande de nom.
 */
import { describe, expect, test } from 'vitest';
import { recevoirMessage } from '../../src/metier/reception.ts';
import { recevoirVote } from '../../src/metier/votes.ts';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';

const BOB = '33612345678';
const ALICE = '33611223344';

/** BP annoncé ; Bob a voté « dispo » (nouveau bénévole : on lui a demandé son nom). */
async function bobAttendSonNom(): Promise<EnvironnementDeTest> {
  const env = await contexteDeTest('2026-11-21 18:00');
  await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });
  await env.planificateur.tick();
  const sondage = env.messagerie.sondages()[0].id;
  await recevoirVote(env.ctx, env.messagerie.vote({ de: BOB, nom: 'Bob', sondage, choix: ['dispo !!'] }));
  env.messagerie.envoyes.length = 0;
  return env;
}

const inscriptions = (env: EnvironnementDeTest) =>
  env.tableur.lignes('Inscriptions').map((l) => ({ nom: l.Nom, statut: l.Statut }));

describe('messages texte du groupe : ignorés (on s\'inscrit avec le sondage)', () => {
  test.each(['oui', 'dispo 👍', 'oui je viens'])('« %s » dans le groupe, même en citant l\'annonce : rien', async (texte) => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00' });
    await env.planificateur.tick();
    const sondage = env.messagerie.sondages()[0].id;
    env.messagerie.envoyes.length = 0;

    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, nom: 'Bob', texte, groupe: GROUPE_TEST, cite: sondage }));
    expect(inscriptions(env)).toEqual([]);
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('un message du groupe ne déclenche même pas de lecture du Sheet', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    env.tableur.appels.lectures = 0;
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'Bonjour à tous !', groupe: GROUPE_TEST }));
    expect(env.tableur.appels.lectures).toBe(0);
  });
});

describe('réponse en privé à la demande de nom', () => {
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
    const env = await bobAttendSonNom();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: ALICE, texte: 'Alice Martin' }));
    expect(env.tableur.lignes('Bénévoles')).toHaveLength(1); // seulement Bob
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('le même message privé reçu deux fois : traité une seule fois', async () => {
    const env = await bobAttendSonNom();
    const message = env.messagerie.recu({ de: BOB, texte: 'bob durand' });
    await recevoirMessage(env.ctx, message);
    await recevoirMessage(env.ctx, message);
    expect(env.messagerie.envoyes).toHaveLength(1); // un seul « Merci »
  });
});
