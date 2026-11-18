import { describe, expect, test } from 'vitest';
import { creerLogger, decrireErreur } from '../../src/utils/logger.ts';

/** Logger de test : les lignes vont dans un tableau, l'heure est fixe. */
function loggerDeTest(niveau: 'debug' | 'info' | 'avertissement' | 'erreur' = 'info') {
  const lignes: string[] = [];
  const logger = creerLogger(niveau, (ligne) => lignes.push(ligne), () => new Date('2026-11-21T17:00:00Z'));
  return { logger, lignes };
}

describe('creerLogger', () => {
  test('format : heure ISO, niveau, message', () => {
    const { logger, lignes } = loggerDeTest();
    logger.info('Annonce publiée');
    expect(lignes).toEqual(['2026-11-21T17:00:00.000Z [INFO] Annonce publiée']);
  });

  test('les messages sous le niveau minimum sont ignorés', () => {
    const { logger, lignes } = loggerDeTest('avertissement');
    logger.debug('détail');
    logger.info('info');
    logger.avertissement('attention');
    logger.erreur('panne');
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toContain('[AVERTISSEMENT] attention');
    expect(lignes[1]).toContain('[ERREUR] panne');
  });

  test("erreur avec cause : le message de la cause est ajouté, la pile d'appels en debug", () => {
    const { logger, lignes } = loggerDeTest('debug');
    logger.erreur("Envoi de l'annonce impossible", new Error('WAHA ne répond pas'));
    expect(lignes[0]).toContain("[ERREUR] Envoi de l'annonce impossible : WAHA ne répond pas");
    expect(lignes[1]).toContain('[DEBUG] Error: WAHA ne répond pas');
  });
});

describe('decrireErreur', () => {
  test.each([
    [new Error('boum'), 'boum'],
    ['simple texte', 'simple texte'],
    [{ code: 500 }, '{"code":500}'],
  ])('%o → « %s »', (cause, attendu) => {
    expect(decrireErreur(cause)).toBe(attendu);
  });
});
