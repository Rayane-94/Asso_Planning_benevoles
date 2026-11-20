/**
 * sheets/inscriptions.ts — Lecture et mise à jour de l'onglet Inscriptions.
 *
 * C'est la SOURCE DE VÉRITÉ : une ligne par (bénévole, action). Les vues Présents et
 * Absents en sont calculées. Le bot remplit tout ; l'équipe peut corriger un Statut.
 *
 * Type, Date, Heure, Lieu sont recopiés depuis l'action, pour que les vues soient
 * lisibles sans aller voir l'onglet Actions.
 */
import { ONGLETS, STATUT_INSCRIPTION, type StatutInscription } from '../constantes.ts';
import type { Tableur, Valeurs } from '../ports/tableur.ts';
import { horodatage, lireDate, type CleDate } from '../utils/dates.ts';
import { formaterTelephone, normaliserTelephone } from '../utils/telephones.ts';
import type { LigneIgnoree } from './actions.ts';
import { prochainId } from './ids.ts';
import { COLONNES_INSCRIPTIONS } from './schema.ts';

const I = COLONNES_INSCRIPTIONS;

export interface Inscription {
  numero: number;
  /** ex. 'I-00042' */
  id: string;
  actionId: string;
  type: string;
  date: CleDate;
  heure: string;
  lieu: string;
  /** Clé : E.164 sans « + ». */
  telephone: string;
  nom: string;
  /** Créneau(x) coché(s) dans le sondage, ex. 'dispo de 10h à 13h, dispo de 13h à 16h' ('' si l'action n'a pas de créneaux). */
  creneau: string;
  statut: StatutInscription;
  /** ID du message privé de demande de confirmation (J-2). */
  demandeId: string;
  misAJour: string;
}

export interface LectureInscriptions {
  inscriptions: Inscription[];
  ignorees: LigneIgnoree[];
}

export async function lireInscriptions(tableur: Tableur): Promise<LectureInscriptions> {
  const { lignes } = await tableur.lireOnglet(ONGLETS.INSCRIPTIONS);
  const inscriptions: Inscription[] = [];
  const ignorees: LigneIgnoree[] = [];
  const statuts: string[] = Object.values(STATUT_INSCRIPTION);

  for (const { numero, valeurs } of lignes) {
    const telephone = normaliserTelephone(valeurs[I.TELEPHONE]);
    const date = lireDate(valeurs[I.DATE]);
    const statut = valeurs[I.STATUT].trim();
    let raison: string | null = null;
    if (valeurs[I.ACTION_ID].trim() === '') raison = 'Action ID manquant';
    else if (telephone === null) raison = `téléphone illisible « ${valeurs[I.TELEPHONE]} »`;
    else if (date === null) raison = `date illisible « ${valeurs[I.DATE]} »`;
    else if (!statuts.includes(statut)) raison = `statut inconnu « ${valeurs[I.STATUT]} »`;
    if (raison !== null || telephone === null || date === null) {
      ignorees.push({ numero, raison: raison ?? 'ligne invalide' });
      continue;
    }

    inscriptions.push({
      numero,
      id: valeurs[I.ID].trim(),
      actionId: valeurs[I.ACTION_ID].trim(),
      type: valeurs[I.TYPE].trim(),
      date,
      heure: valeurs[I.HEURE].trim(),
      lieu: valeurs[I.LIEU].trim(),
      telephone,
      nom: valeurs[I.NOM].trim(),
      creneau: (valeurs[I.CRENEAU] ?? '').trim(), // ?? '' : colonne absente si le Sheet n'est pas réinstallé
      statut: statut as StatutInscription,
      demandeId: valeurs[I.DEMANDE_ID].trim(),
      misAJour: valeurs[I.MIS_A_JOUR].trim(),
    });
  }
  return { inscriptions, ignorees };
}

/** Données d'une nouvelle inscription (le reste est calculé). */
export interface NouvelleInscription {
  actionId: string;
  type: string;
  date: CleDate;
  heure: string;
  lieu: string;
  telephone: string;
  nom: string;
  /** Créneau(x) choisi(s) ; absent ou '' si l'action n'a pas de créneaux. */
  creneau?: string;
  statut: StatutInscription;
}

/**
 * Ajoute une inscription avec un nouvel ID.
 * @param existantes les inscriptions déjà lues (pour calculer le prochain ID)
 * @return l'ID attribué
 */
export async function ajouterInscription(
  tableur: Tableur,
  nouvelle: NouvelleInscription,
  existantes: Pick<Inscription, 'id'>[],
  maintenant: Date,
): Promise<string> {
  const id = prochainId('I', existantes.map((inscription) => inscription.id), 5);
  await tableur.ajouterLignes(ONGLETS.INSCRIPTIONS, [{
    [I.ID]: id,
    [I.ACTION_ID]: nouvelle.actionId,
    [I.TYPE]: nouvelle.type,
    [I.DATE]: nouvelle.date, // format '2026-11-28' : se trie bien dans les vues
    [I.HEURE]: nouvelle.heure,
    [I.LIEU]: nouvelle.lieu,
    [I.TELEPHONE]: formaterTelephone(nouvelle.telephone),
    [I.NOM]: nouvelle.nom,
    [I.CRENEAU]: nouvelle.creneau ?? '',
    [I.STATUT]: nouvelle.statut,
    [I.MIS_A_JOUR]: horodatage(maintenant),
  }]);
  return id;
}

/** Ce que le bot peut changer dans une inscription. */
export interface ChangementsInscription {
  statut?: StatutInscription;
  demandeId?: string;
  nom?: string;
  creneau?: string;
  // Recopie des infos de l'action (si le référent a modifié la date, l'heure, le lieu…)
  type?: string;
  date?: CleDate;
  heure?: string;
  lieu?: string;
}

/**
 * Met à jour plusieurs inscriptions en UNE requête (économise le quota Google).
 * « Mis à jour » est rempli automatiquement.
 */
export async function modifierInscriptions(
  tableur: Tableur,
  modifications: { inscription: Inscription; changements: ChangementsInscription }[],
  maintenant: Date,
): Promise<void> {
  if (modifications.length === 0) return;
  const correspondance: Record<keyof ChangementsInscription, string> = {
    statut: I.STATUT, demandeId: I.DEMANDE_ID, nom: I.NOM, creneau: I.CRENEAU,
    type: I.TYPE, date: I.DATE, heure: I.HEURE, lieu: I.LIEU,
  };

  await tableur.modifierLignes(ONGLETS.INSCRIPTIONS, modifications.map(({ inscription, changements }) => {
    const valeurs: Valeurs = { [I.MIS_A_JOUR]: horodatage(maintenant) };
    for (const [champ, valeur] of Object.entries(changements)) {
      if (valeur !== undefined) valeurs[correspondance[champ as keyof ChangementsInscription]] = valeur;
    }
    return { numero: inscription.numero, valeurs };
  }));

  for (const { inscription, changements } of modifications) {
    Object.assign(inscription, changements, { misAJour: horodatage(maintenant) });
  }
}
