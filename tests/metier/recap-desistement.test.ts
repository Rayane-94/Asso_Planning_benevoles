/**
 * Récap du vendredi (CLAUDE.md §4.7) et désistement de dernière minute (§4.6).
 * Calendrier : vendredi 27/11/2026 = jour du récap ; semaine couverte = samedi 28/11 → vendredi 04/12.
 */
import { describe, expect, test } from 'vitest';
import { recevoirMessage } from '../../src/metier/reception.ts';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { ajouterLignesDeTest, changerParametre } from '../faux/sheetDeTest.ts';

const inscription = (id: string, actionId: string, telephone: string, nom: string, statut: string) => ({
  ID: id, 'Action ID': actionId, Date: '2026-11-28', Téléphone: telephone, Nom: nom, Statut: statut, 'Demande ID': `demande-${id}`,
});

describe('récap du vendredi', () => {
  /** Une semaine variée : liste publiée, annoncée, pas encore annoncée, annulée, hors période. */
  async function semaineChargee(depart = '2026-11-27 20:30'): Promise<EnvironnementDeTest> {
    const env = await contexteDeTest(depart);
    await ajouterAction(env, { ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt', Statut: 'Liste publiée', 'Message ID': 'a1' });
    await ajouterAction(env, { ID: 'A-0002', Type: 'Maraude', Date: '01/12/2026', Heure: '19:00', Lieu: 'Gare', Statut: 'Annoncée', 'Message ID': 'a2' });
    // Collecte à J+6 : pas encore annoncée, mais le tick de 20:30 l'annonce juste avant le récap
    await ajouterAction(env, { ID: 'A-0003', Type: 'Collecte', Date: '03/12/2026', Heure: '10:00', Lieu: 'Supermarché' });
    // Distribution à J+2 : trop proche pour l'annonce automatique → « pas encore annoncée »
    await ajouterAction(env, { ID: 'A-0006', Type: 'Distribution', Date: '29/11/2026', Heure: '10:00', Lieu: 'Local' });
    await ajouterAction(env, { ID: 'A-0004', Type: 'Ménage', Date: '02/12/2026', Heure: '09:00', Statut: 'Annulée' });
    await ajouterAction(env, { ID: 'A-0005', Type: 'BP', Date: '05/12/2026', Heure: '14:00' }); // samedi suivant : hors période
    await ajouterLignesDeTest(env.tableur, 'Inscriptions', [
      inscription('I-00001', 'A-0001', '0611111111', 'A', 'Confirmé'),
      inscription('I-00002', 'A-0001', '0622222222', 'B', 'Confirmé'),
      inscription('I-00003', 'A-0001', '0633333333', 'C', 'Désisté'),
      inscription('I-00004', 'A-0002', '0644444444', 'D', 'Inscrit'),
      inscription('I-00005', 'A-0002', '0655555555', 'E', 'Retiré'),
    ]);
    return env;
  }

  const recaps = (env: EnvironnementDeTest) => env.messagerie.envoyesA(GROUPE_TEST).filter((m) => m.texte.startsWith('📅'));

  test('vendredi 20:30 : le récap de la semaine est publié dans le groupe', async () => {
    const env = await semaineChargee();
    await env.planificateur.tick();
    expect(recaps(env).map((m) => m.texte)).toEqual([
      '📅 Récap de la semaine (samedi 28/11 → vendredi 04/12)\n' +
      '• BP – samedi 28/11 à 14:00 – Entrepôt : 2 confirmés\n' +
      '• Distribution – dimanche 29/11 à 10:00 – Local : pas encore annoncée\n' +
      '• Maraude – mardi 01/12 à 19:00 – Gare : 1 inscrit\n' +
      '• Collecte – jeudi 03/12 à 10:00 – Supermarché : 0 inscrit',
    ]);
  });

  test('un seul récap, même si le bot redémarre (mémoire persistante)', async () => {
    const env = await semaineChargee();
    await env.planificateur.tick();
    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();
    expect(recaps(env)).toHaveLength(1);
    expect(env.ctx.etat.lire('recap:2026-11-27')).toMatch(/^2026-11-27 20:30/);
  });

  test.each([
    ['2026-11-27 20:29', 'vendredi 20:29'],
    ['2026-11-27 22:00', 'vendredi 22:00'],
    ['2026-11-26 20:30', 'jeudi 20:30'],
  ])('%s (%s) : pas de récap', async (depart) => {
    const env = await semaineChargee(depart);
    await env.planificateur.tick();
    expect(recaps(env)).toEqual([]);
  });

  test('RECAP_ACTIF = non : pas de récap', async () => {
    const env = await semaineChargee();
    await changerParametre(env.tableur, 'RECAP_ACTIF', 'non');
    await env.planificateur.tick();
    expect(recaps(env)).toEqual([]);
  });

  test('JOUR_RECAP et HEURE_RECAP modifiés : respectés', async () => {
    const env = await semaineChargee('2026-11-28 10:00'); // samedi
    await changerParametre(env.tableur, 'JOUR_RECAP', 'samedi');
    await changerParametre(env.tableur, 'HEURE_RECAP', '10:00');
    await env.planificateur.tick();
    expect(recaps(env)).toHaveLength(1);
  });

  test("semaine sans action : pas de message (juste une info dans le Journal)", async () => {
    const env = await contexteDeTest('2026-11-27 20:30');
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toEqual([]);
    expect(logsDeNiveau(env, 'INFO').some((l) => l.includes('Récap : aucune action'))).toBe(true);
  });

  test('envoi impossible : nouvel essai au tick suivant', async () => {
    const env = await semaineChargee();
    env.messagerie.deconnecter();
    await env.planificateur.tick();
    env.messagerie.reconnecter();
    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();
    expect(recaps(env)).toHaveLength(1);
  });
});

describe('désistement de dernière minute (après la liste)', () => {
  const BOB = '33612345678';
  const REFERENT = '33699999999';

  /** Liste du BP publiée vendredi soir ; Bob est confirmé. */
  async function apresLaListe(): Promise<EnvironnementDeTest> {
    const env = await contexteDeTest('2026-11-27 22:30');
    await ajouterAction(env, { ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt', Statut: 'Liste publiée', 'Message ID': 'a1' });
    await ajouterLignesDeTest(env.tableur, 'Inscriptions', [inscription('I-00001', 'A-0001', '06 12 34 56 78', 'Durand Bob', 'Confirmé')]);
    await changerParametre(env.tableur, 'NUMERO_REFERENT', '06 99 99 99 99');
    return env;
  }

  test('NON en privé : « Désisté », accusé de réception, et le référent est prévenu', async () => {
    const env = await apresLaListe();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'finalement je peux pas demain désolé' }));

    expect(env.tableur.lignes('Inscriptions')[0].Statut).toBe('Désisté');
    expect(env.messagerie.envoyesA(BOB).map((m) => m.texte)).toEqual(["C'est noté, merci !"]);
    expect(env.messagerie.envoyesA(REFERENT).map((m) => m.texte)).toEqual([
      '⚠️ Désistement de dernière minute : Durand Bob (06 12 34 56 78) ne viendra pas à BP – samedi 28/11 à 14:00 – Entrepôt.',
    ]);
  });

  test('pas de NUMERO_REFERENT : le désistement est enregistré, avertissement dans le Journal', async () => {
    const env = await apresLaListe();
    await changerParametre(env.tableur, 'NUMERO_REFERENT', '');
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non' }));
    expect(env.tableur.lignes('Inscriptions')[0].Statut).toBe('Désisté');
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('Aucun NUMERO_REFERENT');
  });

  test("OUI après la liste : rien ne change (c'est au référent de gérer)", async () => {
    const env = await apresLaListe();
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 2, valeurs: { Statut: 'Désisté' } }]);
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'oui finalement je viens' }));
    expect(env.tableur.lignes('Inscriptions')[0].Statut).toBe('Désisté');
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test("action déjà passée : le NON n'est plus pris en compte", async () => {
    const env = await apresLaListe();
    env.horloge.regler('2026-11-29 10:00'); // dimanche, le BP était samedi
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non' }));
    expect(env.tableur.lignes('Inscriptions')[0].Statut).toBe('Confirmé');
    expect(env.messagerie.envoyesA(REFERENT)).toEqual([]);
  });
});
