/**
 * etat/verrouInstance.ts — Empêche de lancer DEUX bots en même temps.
 *
 * Deux bots = chaque annonce, chaque demande de confirmation envoyée deux fois. Ça arrive
 * vite en local (un vieux terminal oublié avec « npm start »).
 *
 * Principe : au démarrage, le bot écrit son numéro de processus (PID) dans data/bot.lock.
 * Si ce fichier existe déjà ET que ce processus tourne encore, le nouveau bot refuse de
 * démarrer. Si le processus n'existe plus (bot planté sans nettoyer), on reprend le verrou.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Prend le verrou, ou lève une erreur si un autre bot tourne déjà.
 * @return une fonction à appeler à l'arrêt du bot pour libérer le verrou
 */
export function prendreVerrouInstance(chemin: string): () => void {
  if (existsSync(chemin)) {
    const autre = Number(readFileSync(chemin, 'utf8').trim());
    if (Number.isInteger(autre) && autre > 0 && autre !== process.pid && processusVivant(autre)) {
      throw new Error(
        `Un autre bot tourne déjà (processus ${autre}). Deux bots enverraient chaque message en double !\n` +
        `→ Arrêter l'autre (Ctrl+C dans son terminal, ou : Stop-Process -Id ${autre}) puis relancer.`,
      );
    }
  }
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, String(process.pid));

  return () => {
    try {
      // On ne supprime que NOTRE verrou (pas celui d'un autre bot lancé entre-temps)
      if (readFileSync(chemin, 'utf8').trim() === String(process.pid)) unlinkSync(chemin);
    } catch {
      // déjà supprimé : rien à faire
    }
  };
}

/** Le processus `pid` existe-t-il encore ? (process.kill(pid, 0) ne tue rien : il vérifie seulement) */
function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erreur) {
    // EPERM = le processus existe mais appartient à un autre utilisateur
    return (erreur as NodeJS.ErrnoException).code === 'EPERM';
  }
}
