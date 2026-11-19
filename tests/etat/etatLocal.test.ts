import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { creerEtatEnMemoire, creerEtatFichier } from '../../src/etat/etatLocal.ts';

const dossierTemporaire = () => mkdtempSync(join(tmpdir(), 'etat-'));

describe('creerEtatFichier', () => {
  test('ce qui est écrit survit à un « redémarrage » (nouvelle lecture du fichier)', () => {
    const chemin = join(dossierTemporaire(), 'data', 'etat.json'); // le dossier data/ n'existe pas encore
    creerEtatFichier(chemin).ecrire('recap:2026-11-27', '2026-11-27 20:30:00');

    const apresRedemarrage = creerEtatFichier(chemin);
    expect(apresRedemarrage.lire('recap:2026-11-27')).toBe('2026-11-27 20:30:00');
  });

  test('ecrire(cle, null) efface la clé', () => {
    const chemin = join(dossierTemporaire(), 'etat.json');
    const etat = creerEtatFichier(chemin);
    etat.ecrire('a', '1');
    etat.ecrire('a', null);
    expect(creerEtatFichier(chemin).lire('a')).toBeNull();
  });

  test('le fichier est du JSON lisible (pratique pour vérifier à la main sur le VPS)', () => {
    const chemin = join(dossierTemporaire(), 'etat.json');
    creerEtatFichier(chemin).ecrire('recap:2026-11-27', 'ok');
    expect(JSON.parse(readFileSync(chemin, 'utf8'))).toEqual({ 'recap:2026-11-27': 'ok' });
  });

  test('fichier abîmé : on repart d\'un état vide au lieu de planter', () => {
    const chemin = join(dossierTemporaire(), 'etat.json');
    writeFileSync(chemin, '{ ceci n\'est pas du JSON');
    expect(creerEtatFichier(chemin).lire('x')).toBeNull();
  });
});

describe('creerEtatEnMemoire', () => {
  test('lire / écrire / effacer', () => {
    const etat = creerEtatEnMemoire();
    expect(etat.lire('a')).toBeNull();
    etat.ecrire('a', '1');
    expect(etat.lire('a')).toBe('1');
    etat.ecrire('a', null);
    expect(etat.lire('a')).toBeNull();
  });
});
