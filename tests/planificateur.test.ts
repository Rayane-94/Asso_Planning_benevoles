import { describe, expect, test } from 'vitest';
import { creerPlanificateur } from '../src/planificateur.ts';
import { creerLoggerJournalise, JournalSheet } from '../src/sheets/journal.ts';
import { creerLoggerSansRepetition } from '../src/utils/antiRepetition.ts';
import { creerLogger } from '../src/utils/logger.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau } from './faux/contexteDeTest.ts';
import { HorlogeDeTest } from './faux/horlogeDeTest.ts';

describe('planificateur', () => {
  test('donne un ID aux nouvelles actions et le note', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00' });
    await env.planificateur.tick();
    expect(env.tableur.lignes('Actions')[0].ID).toBe('A-0001');
    expect(logsDeNiveau(env, 'INFO')).toContain('Nouvelle action : A-0001 — BP du 2026-11-28 à 14:00');
  });

  test('Sheet inaccessible : erreur notée, aucune tâche lancée, pas de plantage', async () => {
    const env = await contexteDeTest();
    env.tableur.lireOnglet = async () => { throw new Error('Google injoignable'); };
    await expect(env.planificateur.tick()).resolves.toBeUndefined();
    expect(logsDeNiveau(env, 'ERREUR')[0]).toContain('Lecture du Google Sheet impossible : Google injoignable');
  });

  test('une tâche qui plante est isolée : erreur notée avec le nom de la tâche, le tick se termine', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    // L'action a déjà un ID : la lecture n'écrit rien, c'est bien la TÂCHE qui va planter.
    await ajouterAction(env, { ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00' });
    env.tableur.modifierLignes = async () => { throw new Error('écriture refusée'); };
    await expect(env.planificateur.tick()).resolves.toBeUndefined();
    expect(logsDeNiveau(env, 'ERREUR')).toContain('Tâche « Annonces » en échec : écriture refusée');
  });

  test("un seul tick à la fois : un 2e tick lancé pendant le 1er est sauté", async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00' });
    await Promise.all([env.planificateur.tick(), env.planificateur.tick()]);
    expect(env.messagerie.envoyes).toHaveLength(1);
    expect(logsDeNiveau(env, 'DEBUG')).toContain('Tick précédent encore en cours : tour sauté');
  });

  test('le Journal est écrit dans le Sheet à la fin de chaque tick', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    const journal = new JournalSheet(env.tableur, env.horloge);
    env.ctx.logger = creerLoggerJournalise(creerLogger('info', () => {}), journal); // terminal + Journal
    const planificateur = creerPlanificateur(env.ctx, journal);

    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });
    await planificateur.tick();
    expect(env.tableur.lignes('Journal').map((l) => l.Message)).toContain('Annonce publiée : BP du samedi 28/11 (A-0001)');
  });
});

describe('creerLoggerSansRepetition', () => {
  test('un même avertissement : une fois par heure ; un message différent passe toujours', () => {
    const horloge = new HorlogeDeTest('2026-11-21 18:00');
    const lignes: string[] = [];
    const logger = creerLoggerSansRepetition(creerLogger('debug', (l) => lignes.push(l)), horloge);

    logger.avertissement('ligne 5 incomplète');
    horloge.avancer({ minutes: 30 });
    logger.avertissement('ligne 5 incomplète'); // ignoré
    logger.avertissement('ligne 6 incomplète'); // différent : passe
    horloge.avancer({ minutes: 31 });
    logger.avertissement('ligne 5 incomplète'); // plus d'une heure après : repasse
    logger.info('info'); logger.info('info'); // les infos ne sont jamais filtrées

    expect(lignes.filter((l) => l.includes('ligne 5'))).toHaveLength(2);
    expect(lignes.filter((l) => l.includes('ligne 6'))).toHaveLength(1);
    expect(lignes.filter((l) => l.includes('[INFO]'))).toHaveLength(2);
  });
});
