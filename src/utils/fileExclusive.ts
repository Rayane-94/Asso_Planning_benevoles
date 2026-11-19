/**
 * utils/fileExclusive.ts — Une file d'attente : une seule tâche à la fois.
 *
 * Pourquoi ? Le tick (toutes les minutes) et les messages WhatsApp (à tout moment)
 * lisent et écrivent le même Google Sheet. S'ils le faisaient en même temps, ils
 * pourraient se marcher dessus (deux inscriptions avec le même ID, écriture sur la
 * mauvaise ligne…). Avec la file, chacun attend son tour ; personne n'est oublié.
 *
 *   const file = creerFileExclusive();
 *   await file.executer(() => traiterMessage(...)); // attend que la tâche précédente soit finie
 */
export interface FileExclusive {
  /** Lance la tâche quand les précédentes sont terminées, et renvoie son résultat. */
  executer<T>(tache: () => Promise<T>): Promise<T>;
}

export function creerFileExclusive(): FileExclusive {
  // La « queue » est une chaîne de promesses : chaque tâche démarre à la fin de la précédente.
  let derniere: Promise<unknown> = Promise.resolve();

  return {
    executer<T>(tache: () => Promise<T>): Promise<T> {
      const resultat = derniere.then(tache);
      // Si une tâche échoue, la suivante doit quand même pouvoir démarrer.
      derniere = resultat.catch(() => undefined);
      return resultat;
    },
  };
}
