/**
 * etat/memoireMessages.ts — Se souvenir des messages déjà traités.
 *
 * WAHA peut envoyer deux fois le même message (webhook renvoyé après une coupure…).
 * On retient les derniers ID traités pour ignorer les doublons.
 *
 * Si un état local est fourni (data/etat.json), la mémoire survit aux redémarrages du bot.
 */
import type { EtatLocal } from './etatLocal.ts';

const CLE_ETAT = 'messages-traites';

export interface MemoireMessages {
  /** Ce message a-t-il déjà été traité ? */
  dejaVu(id: string): boolean;
  /** Note le message comme traité. */
  noter(id: string): void;
}

/**
 * @param taille nombre d'ID retenus (les plus anciens sont oubliés)
 * @param etat si fourni, les ID y sont sauvegardés (et relus au démarrage)
 */
export function creerMemoireMessages(taille = 1000, etat?: EtatLocal): MemoireMessages {
  // Un Set garde l'ordre d'ajout : le premier est le plus ancien.
  const ids = new Set<string>(lireSauvegarde(etat));

  return {
    dejaVu: (id) => ids.has(id),
    noter(id) {
      ids.add(id);
      if (ids.size > taille) {
        const plusAncien = ids.values().next().value;
        if (plusAncien !== undefined) ids.delete(plusAncien);
      }
      etat?.ecrire(CLE_ETAT, JSON.stringify([...ids]));
    },
  };
}

function lireSauvegarde(etat: EtatLocal | undefined): string[] {
  try {
    const sauvegarde: unknown = JSON.parse(etat?.lire(CLE_ETAT) ?? '[]');
    return Array.isArray(sauvegarde) ? sauvegarde.map(String) : [];
  } catch {
    return []; // sauvegarde abîmée : on repart de zéro (au pire, un doublon traité deux fois)
  }
}
