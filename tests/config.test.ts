import { describe, expect, test } from 'vitest';
import { chargerConfig, ErreurConfig, masquer, resumerConfig } from '../src/config.ts';

/** Un environnement minimal valide : seules les variables obligatoires. */
const ENV_MINIMAL = {
  WAHA_API_KEY: 'cle-secrete-de-test-1234567890',
  GOOGLE_SHEET_ID: 'id-du-sheet',
};

/** Récupère l'ErreurConfig levée par chargerConfig (ou échoue si rien n'est levé). */
function erreurPour(env: Record<string, string | undefined>): ErreurConfig {
  try {
    chargerConfig(env);
  } catch (erreur) {
    if (erreur instanceof ErreurConfig) return erreur;
    throw erreur;
  }
  throw new Error("chargerConfig aurait dû lever une ErreurConfig");
}

describe('chargerConfig : valeurs par défaut', () => {
  test('seules les variables obligatoires suffisent', () => {
    const config = chargerConfig(ENV_MINIMAL);
    expect(config.waha).toEqual({ url: 'http://waha:3000', cleApi: 'cle-secrete-de-test-1234567890', session: 'default' });
    expect(config.google).toEqual({ idSheet: 'id-du-sheet', fichierCle: './secrets/compte-service.json' });
    expect(config.groupeId).toBeNull();
    expect(config.port).toBe(3000);
    expect(config.dossierDonnees).toBe('./data');
    expect(config.niveauLog).toBe('info');
  });

  test('les valeurs fournies remplacent les défauts (et les espaces sont retirés)', () => {
    const config = chargerConfig({
      ...ENV_MINIMAL,
      WAHA_URL: 'http://localhost:3001/',
      GROUPE_ID: '  120363000000000000@g.us ',
      PORT: '8080',
      NIVEAU_LOG: 'debug',
    });
    expect(config.waha.url).toBe('http://localhost:3001'); // « / » final retiré
    expect(config.groupeId).toBe('120363000000000000@g.us');
    expect(config.port).toBe(8080);
    expect(config.niveauLog).toBe('debug');
  });

  test('une variable vide compte comme absente', () => {
    const config = chargerConfig({ ...ENV_MINIMAL, GROUPE_ID: '', PORT: '' });
    expect(config.groupeId).toBeNull();
    expect(config.port).toBe(3000);
  });
});

describe('chargerConfig : erreurs claires', () => {
  test('liste TOUTES les variables obligatoires manquantes en une fois', () => {
    const erreur = erreurPour({});
    expect(erreur.problemes).toHaveLength(2);
    expect(erreur.message).toContain('WAHA_API_KEY');
    expect(erreur.message).toContain('GOOGLE_SHEET_ID');
    expect(erreur.message).toContain('.env.example');
  });

  test('une variable remplie d\'espaces est refusée', () => {
    expect(erreurPour({ ...ENV_MINIMAL, WAHA_API_KEY: '   ' }).message).toContain('WAHA_API_KEY');
  });

  test.each([
    ['WAHA_URL', 'pas-une-url'],
    ['WAHA_URL', 'ftp://waha:3000'],
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['NIVEAU_LOG', 'bavard'],
  ])('%s = « %s » est refusé', (nom, valeur) => {
    expect(erreurPour({ ...ENV_MINIMAL, [nom]: valeur }).message).toContain(nom);
  });
});

describe('secrets jamais affichés en clair', () => {
  test('masquer garde seulement le début', () => {
    expect(masquer('abcdef1234567890')).toBe('abcd…');
    expect(masquer('court')).toBe('••••');
  });

  test('resumerConfig ne contient pas la clé WAHA', () => {
    const config = chargerConfig(ENV_MINIMAL);
    const texte = JSON.stringify(resumerConfig(config));
    expect(texte).not.toContain(ENV_MINIMAL.WAHA_API_KEY);
    expect(texte).toContain('lister-groupes'); // rappelle comment choisir le groupe
  });
});
