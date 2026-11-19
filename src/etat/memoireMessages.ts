/**
 * etat/memoireMessages.ts — Se souvenir des messages déjà traités.
 *
 * WAHA peut envoyer deux fois le même message (webhook renvoyé après une coupure…).
 * On retient les derniers ID traités pour ignorer les doublons.
 *
 * Pour l'instant, la mémoire est perdue au redémarrage du bot. À l'étape 5 (bloc 3),
 * elle sera sauvegardée dans data/etat.json pour survivre aux redémarrages.
 */
export interface MemoireMessages {
  /** Ce message a-t-il déjà été traité ? */
  dejaVu(id: string): boolean;
  /** Note le message comme traité. */
  noter(id: string): void;
}

/** @param taille nombre d'ID retenus (les plus anciens sont oubliés) */
export function creerMemoireMessages(taille = 1000): MemoireMessages {
  const ids = new Set<string>(); // un Set garde l'ordre d'ajout : le premier est le plus ancien

  return {
    dejaVu: (id) => ids.has(id),
    noter(id) {
      ids.add(id);
      if (ids.size > taille) {
        const plusAncien = ids.values().next().value;
        if (plusAncien !== undefined) ids.delete(plusAncien);
      }
    },
  };
}
