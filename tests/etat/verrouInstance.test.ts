import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { prendreVerrouInstance } from '../../src/etat/verrouInstance.ts';

const cheminVerrou = () => join(mkdtempSync(join(tmpdir(), 'verrou-')), 'data', 'bot.lock');

describe('prendreVerrouInstance : jamais deux bots en même temps', () => {
  test('premier bot : le verrou est pris (PID écrit), puis libéré à l\'arrêt', () => {
    const chemin = cheminVerrou();
    const liberer = prendreVerrouInstance(chemin);
    expect(readFileSync(chemin, 'utf8')).toBe(String(process.pid));
    liberer();
    expect(existsSync(chemin)).toBe(false);
  });

  test('un autre bot tourne encore : refus de démarrer, avec la marche à suivre', () => {
    const chemin = cheminVerrou();
    prendreVerrouInstance(chemin);
    // On simule un autre bot vivant : le processus parent de Vitest existe forcément.
    writeFileSync(chemin, String(process.ppid));
    expect(() => prendreVerrouInstance(chemin)).toThrow(`Un autre bot tourne déjà (processus ${process.ppid})`);
  });

  test('verrou laissé par un bot planté (processus disparu) : on le reprend', () => {
    const chemin = cheminVerrou();
    prendreVerrouInstance(chemin);
    writeFileSync(chemin, '999999'); // PID qui n'existe pas
    expect(() => prendreVerrouInstance(chemin)).not.toThrow();
    expect(readFileSync(chemin, 'utf8')).toBe(String(process.pid));
  });

  test('libérer ne supprime pas le verrou d\'un AUTRE bot', () => {
    const chemin = cheminVerrou();
    const liberer = prendreVerrouInstance(chemin);
    writeFileSync(chemin, '12345'); // un autre bot a pris la place entre-temps
    liberer();
    expect(readFileSync(chemin, 'utf8')).toBe('12345');
  });
});
