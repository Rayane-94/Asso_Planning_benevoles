/**
 * L'implémentation Google elle-même se teste en vrai (npm run installer-sheet sur un Sheet
 * de test). Ici, on teste ce qui ne demande pas Internet : les messages d'erreur et la clé.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { expliquerErreurGoogle, GoogleSheets, separateurPourLangue } from '../../src/sheets/googleSheets.ts';

const EMAIL = 'bot-benevoles@mon-projet.iam.gserviceaccount.com';

describe('expliquerErreurGoogle : des messages qui disent quoi faire', () => {
  test('403 → partager le Sheet avec le compte de service', () => {
    expect(expliquerErreurGoogle({ code: 403 }, 'Actions', EMAIL)).toContain(`avec ${EMAIL} en tant qu'Éditeur`);
  });

  test('404 → vérifier GOOGLE_SHEET_ID', () => {
    expect(expliquerErreurGoogle({ code: 404 }, 'Actions', EMAIL)).toContain('GOOGLE_SHEET_ID');
  });

  test('onglet absent → lancer l\'installation', () => {
    const erreur = new Error('Unable to parse range: Actions');
    expect(expliquerErreurGoogle(erreur, 'Actions', EMAIL)).toContain('installer-sheet');
  });

  test('autre erreur : le message d\'origine est conservé', () => {
    expect(expliquerErreurGoogle(new Error('socket hang up'), 'Journal', EMAIL)).toContain('socket hang up');
  });
});

describe('separateurPourLangue : « , » ou « ; » dans les formules selon la langue du Sheet', () => {
  test.each([
    ['fr_FR', ';'], ['de_DE', ';'], ['es_ES', ';'], ['pt_BR', ';'],
    ['en_US', ','], ['en_GB', ','], ['ja_JP', ','],
    ['langue_bizarre', ','],
  ])('%s → « %s »', (langue, attendu) => {
    expect(separateurPourLangue(langue)).toBe(attendu);
  });
});

describe('GoogleSheets : fichier de clé', () => {
  test('clé absente → message qui renvoie vers le guide', () => {
    expect(() => new GoogleSheets({ idSheet: 'x', fichierCle: './nexiste/pas.json' })).toThrow('docs/compte-service-google.md');
  });

  test("lit l'e-mail du compte de service (affiché dans les messages d'erreur)", () => {
    const dossier = mkdtempSync(join(tmpdir(), 'cle-'));
    const fichier = join(dossier, 'cle.json');
    writeFileSync(fichier, JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: 'fausse' }));
    expect(new GoogleSheets({ idSheet: 'x', fichierCle: fichier }).emailCompteService).toBe(EMAIL);
  });

  test('fichier qui n\'est pas une clé de compte de service → refusé', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'cle-'));
    const fichier = join(dossier, 'cle.json');
    writeFileSync(fichier, JSON.stringify({ autre: 'chose' }));
    expect(() => new GoogleSheets({ idSheet: 'x', fichierCle: fichier })).toThrow("n'est pas une clé de compte de service");
  });
});
