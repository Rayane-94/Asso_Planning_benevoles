/**
 * utils/logger.ts — Messages de suivi dans le terminal (visibles avec `docker compose logs`).
 *
 * Quatre niveaux, du plus bavard au plus grave : debug < info < avertissement < erreur.
 * Avec NIVEAU_LOG=info, les messages « debug » sont ignorés.
 *
 * À l'étape 4, les messages importants seront AUSSI écrits dans l'onglet Journal du
 * Sheet, pour que l'équipe les voie sans accès au serveur.
 *
 * ⚠️ Ne jamais logger de secret (clé d'API, contenu du fichier de clé Google).
 */

export const NIVEAUX_LOG = ['debug', 'info', 'avertissement', 'erreur'] as const;
export type NiveauLog = (typeof NIVEAUX_LOG)[number];

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  avertissement(message: string): void;
  /** `erreur` peut recevoir l'erreur attrapée : sa pile d'appels est affichée en debug. */
  erreur(message: string, cause?: unknown): void;
}

/** Où écrire les lignes. Par défaut la console ; dans les tests, un tableau. */
export type Sortie = (ligne: string) => void;

/**
 * @param niveauMinimum les messages en dessous de ce niveau sont ignorés
 * @param sortie fonction qui écrit une ligne (console par défaut)
 * @param maintenant heure à afficher (remplaçable dans les tests)
 */
export function creerLogger(
  niveauMinimum: NiveauLog = 'info',
  sortie: Sortie = (ligne) => console.log(ligne),
  maintenant: () => Date = () => new Date(),
): Logger {
  const rangMinimum = NIVEAUX_LOG.indexOf(niveauMinimum);

  const ecrire = (niveau: NiveauLog, message: string): void => {
    if (NIVEAUX_LOG.indexOf(niveau) < rangMinimum) return;
    // Heure en UTC (format ISO) : c'est la convention des logs serveur.
    sortie(`${maintenant().toISOString()} [${niveau.toUpperCase()}] ${message}`);
  };

  return {
    debug: (message) => ecrire('debug', message),
    info: (message) => ecrire('info', message),
    avertissement: (message) => ecrire('avertissement', message),
    erreur: (message, cause) => {
      ecrire('erreur', cause === undefined ? message : `${message} : ${decrireErreur(cause)}`);
      if (cause instanceof Error && cause.stack) ecrire('debug', cause.stack);
    },
  };
}

/** Texte lisible pour n'importe quelle erreur attrapée (Error, texte, objet…). */
export function decrireErreur(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}
