import { describe, expect, test } from 'vitest';
import { creerMemoireMessages } from '../../src/etat/memoireMessages.ts';
import { creerFileExclusive } from '../../src/utils/fileExclusive.ts';

describe('creerFileExclusive', () => {
  test('les tâches s\'exécutent une par une, dans l\'ordre d\'arrivée', async () => {
    const file = creerFileExclusive();
    const journal: string[] = [];
    const tache = (nom: string, dureeMs: number) => file.executer(async () => {
      journal.push(`début ${nom}`);
      await new Promise((resolve) => setTimeout(resolve, dureeMs));
      journal.push(`fin ${nom}`);
      return nom;
    });

    const resultats = await Promise.all([tache('A', 20), tache('B', 1), tache('C', 5)]);
    expect(resultats).toEqual(['A', 'B', 'C']);
    // Jamais deux « début » de suite : chaque tâche finit avant que la suivante commence
    expect(journal).toEqual(['début A', 'fin A', 'début B', 'fin B', 'début C', 'fin C']);
  });

  test('une tâche qui échoue ne bloque pas les suivantes', async () => {
    const file = creerFileExclusive();
    const echec = file.executer(async () => { throw new Error('boum'); });
    const suivante = file.executer(async () => 'ok');
    await expect(echec).rejects.toThrow('boum');
    await expect(suivante).resolves.toBe('ok');
  });
});

describe('creerMemoireMessages', () => {
  test('se souvient des ID notés', () => {
    const memoire = creerMemoireMessages();
    expect(memoire.dejaVu('m1')).toBe(false);
    memoire.noter('m1');
    expect(memoire.dejaVu('m1')).toBe(true);
  });

  test('oublie les plus anciens au-delà de sa taille', () => {
    const memoire = creerMemoireMessages(2);
    memoire.noter('m1');
    memoire.noter('m2');
    memoire.noter('m3');
    expect([memoire.dejaVu('m1'), memoire.dejaVu('m2'), memoire.dejaVu('m3')]).toEqual([false, true, true]);
  });
});
