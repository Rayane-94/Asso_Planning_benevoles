/**
 * ports/tableur.ts — Le contrat « Google Sheet ».
 *
 * Volontairement très simple : lire un onglet, ajouter, modifier, supprimer des lignes.
 * Les colonnes sont TOUJOURS désignées par leur en-tête (ligne 1), jamais par leur
 * position : l'équipe peut réordonner les colonnes sans casser le bot.
 *
 * Toutes les valeurs sont du TEXTE :
 *   - à la lecture : la valeur affichée dans la cellule ('28/11/2026', '19:00', '06 12…') ;
 *   - à l'écriture : le texte est écrit tel quel (pas de conversion en nombre ou en date).
 * C'est ce qui évite les pièges des Sheets (0 perdu, heures de 1899… voir CLAUDE.md §6).
 *
 * Implémentations : Google Sheets (src/sheets/, étape 4) et un faux en mémoire (tests).
 */

/** Valeurs d'une ligne, par nom de colonne. */
export type Valeurs = Record<string, string>;

/** Une ligne lue dans un onglet. */
export interface LigneLue {
  /** Numéro de la ligne dans le Sheet (la 1re ligne de données est la ligne 2). */
  numero: number;
  valeurs: Valeurs;
}

export interface ContenuOnglet {
  entetes: string[];
  lignes: LigneLue[];
}

export interface Tableur {
  /** Lit tout l'onglet. Les lignes entièrement vides sont ignorées. */
  lireOnglet(onglet: string): Promise<ContenuOnglet>;

  /**
   * Ajoute des lignes à la fin de l'onglet. Les colonnes absentes restent vides.
   * @throws si une colonne n'existe pas (faute de frappe dans le code)
   */
  ajouterLignes(onglet: string, lignes: Valeurs[]): Promise<void>;

  /**
   * Modifie certaines cellules de certaines lignes ; les autres cellules ne bougent pas.
   * @throws si une colonne n'existe pas
   */
  modifierLignes(onglet: string, modifications: { numero: number; valeurs: Valeurs }[]): Promise<void>;

  /** Supprime `nombre` lignes à partir de la ligne `debut` (≥ 2 : on ne supprime jamais les en-têtes). */
  supprimerLignes(onglet: string, debut: number, nombre: number): Promise<void>;
}

/**
 * Opérations d'administration du Sheet, utilisées UNIQUEMENT par l'installation
 * (`npm run installer-sheet`), jamais par le bot en fonctionnement normal.
 */
export interface AdministrationTableur {
  listerOnglets(): Promise<string[]>;
  creerOnglet(nom: string): Promise<void>;
  /** En-têtes de la ligne 1 (tableau vide si l'onglet est vide). */
  lireEntetes(onglet: string): Promise<string[]>;
  /** Remplace toute la ligne 1 par ces en-têtes. */
  ecrireEntetes(onglet: string, entetes: string[]): Promise<void>;
  /**
   * Applique formats, listes déroulantes, cases à cocher et colonnes masquées.
   * Fige aussi la ligne d'en-têtes et la met en gras. Les colonnes sont désignées par leur nom.
   */
  configurerColonnes(onglet: string, colonnes: ConfigColonne[]): Promise<void>;
  /**
   * Séparateur d'arguments des formules, qui dépend de la langue du Sheet :
   * ',' en anglais (=QUERY(A:K, "…", 1)), ';' en français (=QUERY(A:K; "…"; 1)).
   */
  separateurArguments(): Promise<SeparateurArguments>;
  /** Écrit une formule dans la cellule A1 (vues Présents / Absents), telle qu'un humain la taperait. */
  ecrireFormule(onglet: string, formule: string): Promise<void>;
}

export type SeparateurArguments = ',' | ';';

/** Comment présenter une colonne dans le Sheet (voir sheets/schema.ts). */
export interface ConfigColonne {
  nom: string;
  format: 'texte' | 'date' | 'case';
  /** Liste déroulante : valeurs autorisées. */
  choix?: string[];
  /** Colonne technique cachée à l'équipe. */
  masquee?: boolean;
}

// ---------------------------------------------------------------------------
// Aides partagées par toutes les implémentations (Google et faux)
// ---------------------------------------------------------------------------

/**
 * Transforme des valeurs par nom de colonne en tableau rangé dans l'ordre des en-têtes.
 * ex. entetes ['ID', 'Type', 'Lieu'], valeurs { Type: 'BP', ID: 'A1' } → ['A1', 'BP', '']
 * @throws si une colonne n'existe pas dans l'onglet
 */
export function valeursVersTableau(onglet: string, entetes: string[], valeurs: Valeurs): string[] {
  verifierColonnes(onglet, entetes, valeurs);
  return entetes.map((entete) => valeurs[entete] ?? '');
}

/**
 * Vérifie que toutes les colonnes demandées existent.
 * @throws avec un message qui liste les colonnes disponibles
 */
export function verifierColonnes(onglet: string, entetes: string[], valeurs: Valeurs): void {
  const inconnues = Object.keys(valeurs).filter((colonne) => !entetes.includes(colonne));
  if (inconnues.length > 0) {
    throw new Error(
      `Onglet « ${onglet} » : colonne(s) inconnue(s) ${inconnues.map((c) => `« ${c} »`).join(', ')}. ` +
      `Colonnes disponibles : ${entetes.join(', ')}. (Lancer « npm run installer-sheet » pour réparer.)`,
    );
  }
}
