/**
 * sheets/benevoles.ts — Lecture et mise à jour de l'onglet Bénévoles.
 *
 * Le bot ajoute un bénévole la première fois qu'il répond OUI. L'équipe peut corriger
 * un prénom ou un nom. La clé est le numéro de téléphone : on le normalise à la
 * lecture, donc l'équipe peut l'écrire comme elle veut (06 12…, +33 6…).
 */
import { ONGLETS } from '../constantes.ts';
import type { Tableur, Valeurs } from '../ports/tableur.ts';
import { horodatage } from '../utils/dates.ts';
import { formaterTelephone, normaliserTelephone } from '../utils/telephones.ts';
import type { LigneIgnoree } from './actions.ts';
import { COLONNES_BENEVOLES } from './schema.ts';

const B = COLONNES_BENEVOLES;

export interface Benevole {
  numero: number;
  /** Clé : E.164 sans « + », ex. '33612345678'. */
  telephone: string;
  prenom: string;
  nom: string;
  nomWhatsApp: string;
  /** Quand le bot a demandé prénom et nom en privé (vide = jamais demandé). */
  nomDemandeLe: string;
  inscritLe: string;
}

export interface LectureBenevoles {
  /** Bénévoles rangés par téléphone, pour les retrouver instantanément. */
  parTelephone: Map<string, Benevole>;
  ignorees: LigneIgnoree[];
}

export async function lireBenevoles(tableur: Tableur): Promise<LectureBenevoles> {
  const { lignes } = await tableur.lireOnglet(ONGLETS.BENEVOLES);
  const parTelephone = new Map<string, Benevole>();
  const ignorees: LigneIgnoree[] = [];

  for (const { numero, valeurs } of lignes) {
    const telephone = normaliserTelephone(valeurs[B.TELEPHONE]);
    if (telephone === null) {
      ignorees.push({ numero, raison: `téléphone illisible « ${valeurs[B.TELEPHONE]} »` });
      continue;
    }
    if (parTelephone.has(telephone)) {
      ignorees.push({ numero, raison: `doublon : le ${formaterTelephone(telephone)} est déjà à la ligne ${parTelephone.get(telephone)?.numero}` });
      continue;
    }
    parTelephone.set(telephone, {
      numero,
      telephone,
      prenom: valeurs[B.PRENOM].trim(),
      nom: valeurs[B.NOM].trim(),
      nomWhatsApp: valeurs[B.NOM_WHATSAPP].trim(),
      nomDemandeLe: valeurs[B.NOM_DEMANDE_LE].trim(),
      inscritLe: valeurs[B.INSCRIT_LE].trim(),
    });
  }
  return { parTelephone, ignorees };
}

/** Ajoute un nouveau bénévole (le téléphone est écrit au format lisible 06 12 34 56 78). */
export async function ajouterBenevole(
  tableur: Tableur,
  nouveau: { telephone: string; nomWhatsApp: string; nomDejaDemande?: boolean },
  maintenant: Date,
): Promise<void> {
  await tableur.ajouterLignes(ONGLETS.BENEVOLES, [{
    [B.TELEPHONE]: formaterTelephone(nouveau.telephone),
    [B.NOM_WHATSAPP]: nouveau.nomWhatsApp,
    [B.INSCRIT_LE]: horodatage(maintenant),
    // Nom déjà demandé (ex. demandé en privé avant de connaître le numéro) : ne pas redemander
    ...(nouveau.nomDejaDemande ? { [B.NOM_DEMANDE_LE]: horodatage(maintenant) } : {}),
  }]);
}

/** Ce que le bot peut changer pour un bénévole. */
export interface ChangementsBenevole {
  prenom?: string;
  nom?: string;
  nomWhatsApp?: string;
  nomDemandeLe?: string;
}

export async function modifierBenevole(tableur: Tableur, benevole: Benevole, changements: ChangementsBenevole): Promise<void> {
  const valeurs: Valeurs = {};
  if (changements.prenom !== undefined) valeurs[B.PRENOM] = changements.prenom;
  if (changements.nom !== undefined) valeurs[B.NOM] = changements.nom;
  if (changements.nomWhatsApp !== undefined) valeurs[B.NOM_WHATSAPP] = changements.nomWhatsApp;
  if (changements.nomDemandeLe !== undefined) valeurs[B.NOM_DEMANDE_LE] = changements.nomDemandeLe;
  await tableur.modifierLignes(ONGLETS.BENEVOLES, [{ numero: benevole.numero, valeurs }]);
  Object.assign(benevole, changements);
}

/**
 * Nom pour la liste finale : « Durand Bob ». À défaut, le nom WhatsApp, puis le numéro.
 */
export function nomPourListe(benevole: Pick<Benevole, 'prenom' | 'nom' | 'nomWhatsApp' | 'telephone'>): string {
  const complet = [benevole.nom, benevole.prenom].filter((morceau) => morceau !== '').join(' ');
  return complet || benevole.nomWhatsApp || formaterTelephone(benevole.telephone);
}

/**
 * Prénom pour personnaliser un message : « Bonjour Bob ». À défaut, le premier mot du
 * nom WhatsApp ; sinon une chaîne vide (le texte reste correct : « Bonjour 👋 »).
 */
export function prenomPourMessage(benevole: Pick<Benevole, 'prenom' | 'nomWhatsApp'>): string {
  return benevole.prenom || benevole.nomWhatsApp.split(/\s+/)[0] || '';
}
