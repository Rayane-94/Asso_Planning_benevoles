/**
 * sheets/actions.ts — Lecture et mise à jour de l'onglet Actions.
 *
 * Le référent remplit Type, Date, Heure, Lieu (en-têtes verts). Le bot remplit ID,
 * Statut et Message ID. Une ligne incomplète (le référent est peut-être en train de
 * la taper) n'est pas une erreur : elle est simplement mise de côté avec sa raison.
 */
import { CRENEAUX_MAX, ONGLETS, STATUT_ACTION, type StatutAction } from '../constantes.ts';
import type { Tableur, Valeurs } from '../ports/tableur.ts';
import { lireDate, parseHeure, type CleDate, type Heure } from '../utils/dates.ts';
import { prochainId } from './ids.ts';
import { COLONNES_ACTIONS } from './schema.ts';

const A = COLONNES_ACTIONS;

export interface Action {
  /** Numéro de ligne dans le Sheet (pour la mise à jour). */
  numero: number;
  /** Identifiant unique, ex. 'A-0001' (vide tant que le bot ne l'a pas attribué). */
  id: string;
  type: string;
  date: CleDate;
  heure: Heure;
  lieu: string;
  /**
   * Créneaux proposés dans le sondage (ex. ['dispo de 10h à 13h', 'dispo de 13h à 16h']).
   * Vide = sondage simple « dispo » / « pas dispo ».
   */
  creneaux: string[];
  /** Nombre de places, facultatif (texte libre, non utilisé pour l'instant). */
  places: string;
  statut: StatutAction;
  /** ID du message d'annonce WhatsApp (vide tant que l'action n'est pas annoncée). */
  messageId: string;
}

/** Une ligne mise de côté, et pourquoi (pour le Journal). */
export interface LigneIgnoree {
  numero: number;
  raison: string;
}

export interface LectureActions {
  actions: Action[];
  ignorees: LigneIgnoree[];
}

export async function lireActions(tableur: Tableur): Promise<LectureActions> {
  const { lignes } = await tableur.lireOnglet(ONGLETS.ACTIONS);
  const actions: Action[] = [];
  const ignorees: LigneIgnoree[] = [];

  for (const { numero, valeurs } of lignes) {
    const probleme = verifierLigne(valeurs);
    if (probleme) {
      ignorees.push({ numero, raison: probleme });
      continue;
    }
    actions.push({
      numero,
      id: valeurs[A.ID].trim(),
      type: valeurs[A.TYPE].trim(),
      date: lireDate(valeurs[A.DATE]) as CleDate, // vérifié par verifierLigne
      heure: parseHeure(valeurs[A.HEURE]) as Heure, // idem
      lieu: valeurs[A.LIEU].trim(),
      creneaux: lireCreneaux(valeurs[A.CRENEAUX] ?? ''), // ?? '' : colonne absente si le Sheet n'est pas réinstallé
      places: valeurs[A.PLACES].trim(),
      statut: valeurs[A.STATUT].trim() as StatutAction, // idem
      messageId: valeurs[A.MESSAGE_ID].trim(),
    });
  }
  return { actions, ignorees };
}

/** @return la raison pour laquelle la ligne est inutilisable, ou null si elle est correcte */
function verifierLigne(valeurs: Valeurs): string | null {
  const manquantes = [A.TYPE, A.DATE, A.HEURE].filter((colonne) => valeurs[colonne].trim() === '');
  if (manquantes.length > 0) return `incomplète (manque : ${manquantes.join(', ')})`;
  if (lireDate(valeurs[A.DATE]) === null) return `date illisible « ${valeurs[A.DATE]} » (attendu : 28/11/2026)`;
  if (parseHeure(valeurs[A.HEURE]) === null) return `heure illisible « ${valeurs[A.HEURE]} » (attendu : 14:00 ou 14h)`;
  const statuts: string[] = Object.values(STATUT_ACTION);
  if (!statuts.includes(valeurs[A.STATUT].trim())) return `statut inconnu « ${valeurs[A.STATUT]} »`;
  const creneaux = lireCreneaux(valeurs[A.CRENEAUX] ?? '');
  if (creneaux.length > CRENEAUX_MAX) {
    return `trop de créneaux (${creneaux.length}) : WhatsApp accepte ${CRENEAUX_MAX} créneaux maximum dans un sondage`;
  }
  if (new Set(creneaux).size !== creneaux.length) return 'deux créneaux identiques (WhatsApp refuse les choix en double)';
  return null;
}

/** « dispo de 10h à 13h, dispo de 13h à 16h » → ['dispo de 10h à 13h', 'dispo de 13h à 16h'] (vide → []) */
export function lireCreneaux(texte: string): string[] {
  return texte.split(',').map((creneau) => creneau.trim()).filter((creneau) => creneau !== '');
}

/**
 * Donne un ID (A-0001, A-0002…) aux actions qui n'en ont pas encore, et l'écrit dans le Sheet.
 * Modifie aussi les objets `actions` reçus.
 * @return les actions qui viennent de recevoir un ID
 */
export async function attribuerIdsActions(tableur: Tableur, actions: Action[]): Promise<Action[]> {
  const sansId = actions.filter((action) => action.id === '');
  if (sansId.length === 0) return [];

  const existants = actions.map((action) => action.id);
  for (const action of sansId) {
    action.id = prochainId('A', existants, 4);
    existants.push(action.id);
  }
  await tableur.modifierLignes(ONGLETS.ACTIONS, sansId.map((action) => ({ numero: action.numero, valeurs: { [A.ID]: action.id } })));
  return sansId;
}

/** Ce que le bot peut changer dans une action. */
export interface ChangementsAction {
  statut?: StatutAction;
  messageId?: string;
}

/** Met à jour une action dans le Sheet (et dans l'objet reçu). */
export async function modifierAction(tableur: Tableur, action: Action, changements: ChangementsAction): Promise<void> {
  const valeurs: Valeurs = {};
  if (changements.statut !== undefined) valeurs[A.STATUT] = changements.statut;
  if (changements.messageId !== undefined) valeurs[A.MESSAGE_ID] = changements.messageId;
  await tableur.modifierLignes(ONGLETS.ACTIONS, [{ numero: action.numero, valeurs }]);
  Object.assign(action, changements);
}
