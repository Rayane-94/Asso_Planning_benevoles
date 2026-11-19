/**
 * sheets/installation.ts — Crée ou répare la structure du Google Sheet.
 *
 * IDEMPOTENT : on peut le relancer autant de fois qu'on veut, sans rien casser.
 *   - un onglet manquant est créé ; un onglet existant est gardé ;
 *   - une colonne manquante est ajoutée À LA FIN ; les colonnes existantes (même en plus,
 *     même déplacées par l'équipe) ne sont ni supprimées ni réordonnées ;
 *   - un paramètre manquant est ajouté ; un paramètre existant garde la valeur de l'équipe ;
 *   - les formats, listes déroulantes et vues sont réappliqués à chaque fois.
 *
 * Lancement : npm run installer-sheet (voir scripts/installer-sheet.ts).
 */
import { COMMANDES, ONGLETS, PARAMETRES_DEFAUT } from '../constantes.ts';
import type { AdministrationTableur, Tableur } from '../ports/tableur.ts';
import { COLONNES_COMMANDES, COLONNES_PARAMETRES, definitionsOnglets, formulesVues } from './schema.ts';

export interface DependancesInstallation {
  tableur: Tableur;
  admin: AdministrationTableur;
}

/**
 * @return le rapport : la liste de ce qui a été fait (vide = tout était déjà en place)
 */
export async function installerSheet({ tableur, admin }: DependancesInstallation): Promise<string[]> {
  const rapport: string[] = [];
  const definitions = definitionsOnglets([]); // les types d'actions sont lus plus bas
  const existants = await admin.listerOnglets();

  // 1) Onglets de données et leurs en-têtes
  for (const definition of definitions) {
    if (!existants.includes(definition.nom)) {
      await admin.creerOnglet(definition.nom);
      rapport.push(`Onglet « ${definition.nom} » créé`);
    }
    const entetes = await admin.lireEntetes(definition.nom);
    const manquantes = definition.colonnes.map((c) => c.nom).filter((nom) => !entetes.includes(nom));
    if (manquantes.length > 0) {
      await admin.ecrireEntetes(definition.nom, [...entetes, ...manquantes]);
      rapport.push(`Onglet « ${definition.nom} » : colonne(s) ajoutée(s) ${manquantes.join(', ')}`);
    }
  }

  // 2) Paramètres par défaut (sans écraser ceux que l'équipe a modifiés)
  const typesActions = await completerParametres(tableur, rapport);

  // 3) Lignes de l'onglet Commandes
  await completerCommandes(tableur, rapport);

  // 4) Formats, listes déroulantes, cases à cocher, colonnes masquées
  for (const definition of definitionsOnglets(typesActions)) {
    await admin.configurerColonnes(definition.nom, definition.colonnes);
  }

  // 5) Vues Présents et Absents (formules recalculées à partir des en-têtes actuels)
  const formules = formulesVues(await admin.lireEntetes(ONGLETS.INSCRIPTIONS), await admin.separateurArguments());
  for (const [nom, formule] of [[ONGLETS.PRESENTS, formules.presents], [ONGLETS.ABSENTS, formules.absents]]) {
    if (!existants.includes(nom)) {
      await admin.creerOnglet(nom);
      rapport.push(`Onglet « ${nom} » créé`);
    }
    await admin.ecrireFormule(nom, formule);
  }

  return rapport;
}

/**
 * Ajoute les paramètres absents de l'onglet Paramètres.
 * @return les types d'actions (valeur actuelle de TYPES_ACTIONS), pour la liste déroulante
 */
async function completerParametres(tableur: Tableur, rapport: string[]): Promise<string[]> {
  const P = COLONNES_PARAMETRES;
  const { lignes } = await tableur.lireOnglet(ONGLETS.PARAMETRES);
  const presents = new Map(lignes.map((ligne) => [ligne.valeurs[P.PARAMETRE].trim(), ligne.valeurs[P.VALEUR]]));

  const aAjouter = Object.entries(PARAMETRES_DEFAUT)
    .filter(([nom]) => !presents.has(nom))
    .map(([nom, { valeur, description }]) => ({ [P.PARAMETRE]: nom, [P.VALEUR]: valeur, [P.DESCRIPTION]: description }));
  if (aAjouter.length > 0) {
    await tableur.ajouterLignes(ONGLETS.PARAMETRES, aAjouter);
    rapport.push(`Paramètres ajoutés : ${aAjouter.map((ligne) => ligne[P.PARAMETRE]).join(', ')}`);
  }

  const types = presents.get('TYPES_ACTIONS') ?? PARAMETRES_DEFAUT.TYPES_ACTIONS.valeur;
  return types.split(',').map((type) => type.trim()).filter((type) => type !== '');
}

/** Ajoute les commandes absentes de l'onglet Commandes (case « Lancer » décochée = vide). */
async function completerCommandes(tableur: Tableur, rapport: string[]): Promise<void> {
  const C = COLONNES_COMMANDES;
  const { lignes } = await tableur.lireOnglet(ONGLETS.COMMANDES);
  const presentes = new Set(lignes.map((ligne) => ligne.valeurs[C.COMMANDE].trim()));

  const aAjouter = Object.values(COMMANDES)
    .filter((commande) => !presentes.has(commande))
    .map((commande) => ({ [C.COMMANDE]: commande }));
  if (aAjouter.length > 0) {
    await tableur.ajouterLignes(ONGLETS.COMMANDES, aAjouter);
    rapport.push(`Commandes ajoutées : ${aAjouter.map((ligne) => ligne[C.COMMANDE]).join(', ')}`);
  }
}
