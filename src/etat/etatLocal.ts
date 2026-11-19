/**
 * etat/etatLocal.ts — La petite mémoire du bot, qui survit aux redémarrages.
 *
 * Certaines choses n'ont pas de « statut » dans le Sheet : par exemple, « le récap de
 * cette semaine est-il déjà parti ? ». On les note ici, sous forme clé → valeur :
 *   'recap:2026-11-27' → '2026-11-27 20:30:00'
 *
 * Deux versions :
 *   - creerEtatEnMemoire() : pour les tests (oublié à la fin du test) ;
 *   - creerEtatFichier()   : en production, dans data/etat.json (volume Docker).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface EtatLocal {
  lire(cle: string): string | null;
  /** Écrit (ou remplace) une valeur. null efface la clé. */
  ecrire(cle: string, valeur: string | null): void;
}

export function creerEtatEnMemoire(): EtatLocal {
  const valeurs = new Map<string, string>();
  return {
    lire: (cle) => valeurs.get(cle) ?? null,
    ecrire(cle, valeur) {
      if (valeur === null) valeurs.delete(cle);
      else valeurs.set(cle, valeur);
    },
  };
}

/**
 * État enregistré dans un fichier JSON.
 * L'écriture est « atomique » : on écrit d'abord un fichier temporaire, puis on le renomme.
 * Ainsi, une coupure de courant pendant l'écriture ne laisse jamais un fichier à moitié écrit.
 */
export function creerEtatFichier(chemin: string): EtatLocal {
  let valeurs: Record<string, string> = {};
  try {
    valeurs = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    // Fichier absent (premier démarrage) ou illisible : on repart d'un état vide.
    valeurs = {};
  }

  const enregistrer = (): void => {
    mkdirSync(dirname(chemin), { recursive: true });
    const temporaire = `${chemin}.tmp`;
    writeFileSync(temporaire, JSON.stringify(valeurs, null, 2));
    renameSync(temporaire, chemin);
  };

  return {
    lire: (cle) => valeurs[cle] ?? null,
    ecrire(cle, valeur) {
      if (valeur === null) delete valeurs[cle];
      else valeurs[cle] = valeur;
      enregistrer();
    },
  };
}
