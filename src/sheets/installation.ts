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
import { ANCIENNES_VALEURS_PAR_DEFAUT, COMMANDES, ONGLETS, PARAMETRES_DEFAUT, type NomParametre } from '../constantes.ts';
import type { AdministrationTableur, Tableur } from '../ports/tableur.ts';
import {
  COLONNES_COMMANDES, COLONNES_ETAT, COLONNES_PARAMETRES, definitionsOnglets, ELEMENTS_ETAT, formulesVues,
} from './schema.ts';

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
      // Le tableau de bord « État du bot » en premier : c'est ce que l'équipe voit en ouvrant le Sheet.
      await admin.creerOnglet(definition.nom, definition.nom === ONGLETS.ETAT ? 0 : undefined);
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

  // 3) Lignes de l'onglet Commandes et du tableau de bord
  await completerCommandes(tableur, rapport);
  await completerEtat(tableur, rapport);

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

  // Anciennes valeurs par défaut devenues fausses : remplacées SEULEMENT si l'équipe ne les a
  // jamais personnalisées (valeur identique à l'ancienne valeur par défaut).
  const aMettreAJour = lignes.flatMap((ligne) => {
    const nom = ligne.valeurs[P.PARAMETRE].trim() as NomParametre;
    const anciennes = ANCIENNES_VALEURS_PAR_DEFAUT[nom];
    if (!anciennes?.includes(ligne.valeurs[P.VALEUR])) return [];
    return [{ numero: ligne.numero, nom, valeurs: { [P.VALEUR]: PARAMETRES_DEFAUT[nom].valeur, [P.DESCRIPTION]: PARAMETRES_DEFAUT[nom].description } }];
  });
  if (aMettreAJour.length > 0) {
    await tableur.modifierLignes(ONGLETS.PARAMETRES, aMettreAJour.map(({ numero, valeurs }) => ({ numero, valeurs })));
    rapport.push(`Paramètres mis à jour (ancienne valeur par défaut) : ${aMettreAJour.map((m) => m.nom).join(', ')}`);
  }

  const types = presents.get('TYPES_ACTIONS') ?? PARAMETRES_DEFAUT.TYPES_ACTIONS.valeur;
  return types.split(',').map((type) => type.trim()).filter((type) => type !== '');
}

/** Ajoute les lignes manquantes du tableau de bord « État du bot ». */
async function completerEtat(tableur: Tableur, rapport: string[]): Promise<void> {
  const E = COLONNES_ETAT;
  const { lignes } = await tableur.lireOnglet(ONGLETS.ETAT);
  const presents = new Set(lignes.map((ligne) => ligne.valeurs[E.ELEMENT].trim()));
  const aAjouter = Object.values(ELEMENTS_ETAT)
    .filter((element) => !presents.has(element))
    .map((element) => ({ [E.ELEMENT]: element, [E.ETAT]: '❔ Pas encore vérifié' }));
  if (aAjouter.length > 0) {
    await tableur.ajouterLignes(ONGLETS.ETAT, aAjouter);
    rapport.push(`Tableau de bord : ${aAjouter.map((ligne) => ligne[E.ELEMENT]).join(', ')}`);
  }
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
