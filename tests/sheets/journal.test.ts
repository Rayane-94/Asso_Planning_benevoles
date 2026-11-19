import { describe, expect, test } from 'vitest';
import { creerLoggerJournalise, JournalSheet } from '../../src/sheets/journal.ts';
import { creerLogger } from '../../src/utils/logger.ts';
import { HorlogeDeTest } from '../faux/horlogeDeTest.ts';
import { sheetInstalle } from '../faux/sheetDeTest.ts';

describe('JournalSheet', () => {
  test("les messages sont écrits en UNE fois à l'enregistrement, avec date et niveau", async () => {
    const tableur = await sheetInstalle();
    const journal = new JournalSheet(tableur, new HorlogeDeTest('2026-11-21 18:00'));
    journal.ajouter('info', 'Annonce publiée : BP 28/11');
    journal.ajouter('erreur', 'Envoi impossible');
    expect(tableur.lignes('Journal')).toEqual([]); // rien tant qu'on n'enregistre pas

    await journal.enregistrer();
    expect(tableur.lignes('Journal')).toEqual([
      { Date: '2026-11-21 18:00:00', Niveau: 'INFO', Message: 'Annonce publiée : BP 28/11' },
      { Date: '2026-11-21 18:00:00', Niveau: 'ERREUR', Message: 'Envoi impossible' },
    ]);
    expect(journal.nombreEnAttente).toBe(0);
  });

  test('ne garde que les N dernières lignes (les plus anciennes sont supprimées)', async () => {
    const tableur = await sheetInstalle();
    const journal = new JournalSheet(tableur, new HorlogeDeTest(), 3);
    for (const n of [1, 2, 3, 4, 5]) journal.ajouter('info', `message ${n}`);
    await journal.enregistrer();
    expect(tableur.lignes('Journal').map((l) => l.Message)).toEqual(['message 3', 'message 4', 'message 5']);
  });

  test('un message très long est coupé', async () => {
    const tableur = await sheetInstalle();
    const journal = new JournalSheet(tableur, new HorlogeDeTest());
    journal.ajouter('info', 'x'.repeat(5000));
    await journal.enregistrer();
    expect(tableur.lignes('Journal')[0].Message.length).toBe(1001);
  });

  test('si Google est injoignable, les messages sont gardés pour la prochaine fois', async () => {
    const tableur = await sheetInstalle();
    const journal = new JournalSheet(tableur, new HorlogeDeTest());
    journal.ajouter('info', 'important');
    const ajoutNormal = tableur.ajouterLignes.bind(tableur);
    tableur.ajouterLignes = async () => { throw new Error('Google injoignable'); };

    await expect(journal.enregistrer()).rejects.toThrow('Google injoignable');
    expect(journal.nombreEnAttente).toBe(1);

    tableur.ajouterLignes = ajoutNormal; // Google revient
    await journal.enregistrer();
    expect(tableur.lignes('Journal')[0].Message).toBe('important');
  });
});

describe('creerLoggerJournalise', () => {
  test('écrit dans le terminal ET dans le Journal (sauf le debug, terminal seulement)', async () => {
    const tableur = await sheetInstalle();
    const journal = new JournalSheet(tableur, new HorlogeDeTest());
    const terminal: string[] = [];
    const logger = creerLoggerJournalise(creerLogger('debug', (ligne) => terminal.push(ligne)), journal);

    logger.debug('détail technique');
    logger.info('Annonce publiée');
    logger.erreur('Envoi impossible', new Error('WAHA ne répond pas'));
    await journal.enregistrer();

    expect(terminal.length).toBeGreaterThanOrEqual(3);
    expect(tableur.lignes('Journal').map((l) => l.Message)).toEqual([
      'Annonce publiée',
      'Envoi impossible : WAHA ne répond pas',
    ]);
  });
});
