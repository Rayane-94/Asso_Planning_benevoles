/**
 * L'implémentation Google elle-même se teste en vrai (npm run installer-sheet sur un Sheet
 * de test). Ici, on teste ce qui ne demande pas Internet : les messages d'erreur et la clé.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  expliquerErreurGoogle, GoogleSheets, reessayerSiQuotaDepasse, separateurPourLangue,
} from '../../src/sheets/googleSheets.ts';

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

describe('reessayerSiQuotaDepasse : un « quota dépassé » de Google ne fait plus perdre de vote', () => {
  /** Faux appel Google : échoue avec les erreurs données, puis réussit. */
  function fauxAppel(...erreurs: unknown[]) {
    const appel = { nombre: 0 };
    const fonction = async () => {
      appel.nombre++;
      const erreur = erreurs.shift();
      if (erreur !== undefined) throw erreur;
      return 'données';
    };
    return { appel, fonction };
  }
  /** Note les attentes au lieu d'attendre vraiment (le test reste instantané). */
  function fausseAttente() {
    const attentes: number[] = [];
    return { attentes, attendre: async (ms: number) => { attentes.push(ms); } };
  }

  test('quota dépassé 2 fois → attend 15 s puis 30 s, et la 3e tentative réussit', async () => {
    const { appel, fonction } = fauxAppel({ code: 429 }, { status: 429 });
    const { attentes, attendre } = fausseAttente();
    await expect(reessayerSiQuotaDepasse(fonction, undefined, attendre)).resolves.toBe('données');
    expect(appel.nombre).toBe(3);
    expect(attentes).toEqual([15_000, 30_000]);
  });

  test('quota toujours dépassé → 4 tentatives (15 s, 30 s, 60 s), puis l\'erreur remonte', async () => {
    const { appel, fonction } = fauxAppel({ code: 429 }, { code: 429 }, { code: 429 }, { code: '429' });
    const { attentes, attendre } = fausseAttente();
    await expect(reessayerSiQuotaDepasse(fonction, undefined, attendre)).rejects.toEqual({ code: '429' });
    expect(appel.nombre).toBe(4);
    expect(attentes).toEqual([15_000, 30_000, 60_000]);
  });

  test('autre erreur (accès refusé…) → aucune nouvelle tentative, elle remonte tout de suite', async () => {
    const { appel, fonction } = fauxAppel({ code: 403 });
    const { attentes, attendre } = fausseAttente();
    await expect(reessayerSiQuotaDepasse(fonction, undefined, attendre)).rejects.toEqual({ code: 403 });
    expect(appel.nombre).toBe(1);
    expect(attentes).toEqual([]);
  });

  test('pas d\'erreur → un seul appel, aucune attente', async () => {
    const { appel, fonction } = fauxAppel();
    const { attentes, attendre } = fausseAttente();
    await expect(reessayerSiQuotaDepasse(fonction, undefined, attendre)).resolves.toBe('données');
    expect(appel.nombre).toBe(1);
    expect(attentes).toEqual([]);
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
