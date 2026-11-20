/**
 * sheets/parametres.ts — Lecture de l'onglet Paramètres.
 *
 * L'équipe peut modifier ces valeurs à tout moment dans le Sheet. Règle d'or :
 * une valeur mal tapée ne doit JAMAIS faire planter le bot. On utilise alors la
 * valeur par défaut, et on renvoie un avertissement (écrit dans le Journal).
 */
import { JOURS_SEMAINE, ONGLETS, PARAMETRES_DEFAUT, type NomParametre } from '../constantes.ts';
import type { Tableur } from '../ports/tableur.ts';
import { parseHeure, type Heure } from '../utils/dates.ts';
import { normaliserTelephone } from '../utils/telephones.ts';
import { normaliserPourDetection } from '../utils/textes.ts';
import { COLONNES_PARAMETRES } from './schema.ts';

/** Les paramètres, convertis et vérifiés. */
export interface Parametres {
  joursAvantAnnonce: number;
  heureAnnonce: Heure;
  joursAvantConfirmation: number;
  heureConfirmation: Heure;
  heureListe: Heure;
  recapActif: boolean;
  /** Jour du récap : 0 = dimanche … 5 = vendredi … 6 = samedi (comme Date.getDay()). */
  jourRecap: number;
  heureRecap: Heure;
  /** Numéro du référent (E.164 sans « + »), ou null s'il n'est pas renseigné. */
  numeroReferent: string | null;
  typesActions: string[];
  /** Libellés des choix du sondage : « je viens » (action sans créneaux) et « je ne viens pas ». */
  options: { dispo: string; pasDispo: string };
  textes: { annonce: string; confirmation: string; validation: string };
}

export interface LectureParametres {
  parametres: Parametres;
  /** Problèmes trouvés (valeur invalide, paramètre absent…), à écrire dans le Journal. */
  avertissements: string[];
}

export async function lireParametres(tableur: Tableur): Promise<LectureParametres> {
  const P = COLONNES_PARAMETRES;
  const { lignes } = await tableur.lireOnglet(ONGLETS.PARAMETRES);
  const valeurs = new Map(lignes.map((ligne) => [ligne.valeurs[P.PARAMETRE].trim(), ligne.valeurs[P.VALEUR].trim()]));
  const avertissements: string[] = [];

  /**
   * Lit un paramètre et le convertit. Si c'est impossible, avertissement + valeur par défaut.
   * @param convertir renvoie la valeur convertie, ou null si le texte est invalide
   */
  function lire<T>(nom: NomParametre, convertir: (texte: string) => T | null, attendu: string): T {
    const parDefaut = convertir(PARAMETRES_DEFAUT[nom].valeur) as T;
    const texte = valeurs.get(nom);
    if (texte === undefined) {
      avertissements.push(`Paramètre ${nom} absent de l'onglet Paramètres : valeur par défaut utilisée (lancer « npm run installer-sheet »)`);
      return parDefaut;
    }
    const converti = convertir(texte);
    if (converti === null) {
      avertissements.push(`Paramètre ${nom} invalide (« ${texte} », attendu : ${attendu}) : valeur par défaut « ${PARAMETRES_DEFAUT[nom].valeur} » utilisée`);
      return parDefaut;
    }
    return converti;
  }

  const parametres: Parametres = {
    joursAvantAnnonce: lire('JOURS_AVANT_ANNONCE', nombreDeJours, 'un nombre de jours entre 1 et 30'),
    heureAnnonce: lire('HEURE_ANNONCE', parseHeure, 'une heure comme 18:00'),
    joursAvantConfirmation: lire('JOURS_AVANT_CONFIRMATION', nombreDeJours, 'un nombre de jours entre 1 et 30'),
    heureConfirmation: lire('HEURE_CONFIRMATION', parseHeure, 'une heure comme 10:00'),
    heureListe: lire('HEURE_LISTE', parseHeure, 'une heure comme 20:00'),
    recapActif: lire('RECAP_ACTIF', ouiNon, 'oui ou non'),
    jourRecap: lire('JOUR_RECAP', jourDeLaSemaine, 'un jour comme vendredi'),
    heureRecap: lire('HEURE_RECAP', parseHeure, 'une heure comme 20:30'),
    numeroReferent: lireNumeroReferent(valeurs.get('NUMERO_REFERENT') ?? '', avertissements),
    typesActions: lire('TYPES_ACTIONS', listeNonVide, 'des types séparés par des virgules'),
    options: {
      dispo: lire('OPTION_DISPO', texteNonVide, 'un texte'),
      pasDispo: lire('OPTION_PAS_DISPO', texteNonVide, 'un texte'),
    },
    textes: {
      annonce: lire('TEXTE_ANNONCE', texteNonVide, 'un texte'),
      confirmation: lire('TEXTE_CONFIRMATION', texteNonVide, 'un texte'),
      validation: lire('TEXTE_VALIDATION', texteNonVide, 'un texte'),
    },
  };

  return { parametres, avertissements };
}

// ---------------------------------------------------------------------------
// Convertisseurs : texte → valeur, ou null si invalide
// ---------------------------------------------------------------------------

function nombreDeJours(texte: string): number | null {
  const n = Number(texte);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
}

function ouiNon(texte: string): boolean | null {
  const t = normaliserPourDetection(texte);
  if (['oui', 'o', 'vrai', 'true', '1'].includes(t)) return true;
  if (['non', 'n', 'faux', 'false', '0'].includes(t)) return false;
  return null;
}

/** 'Vendredi' → 5 */
function jourDeLaSemaine(texte: string): number | null {
  const index = JOURS_SEMAINE.indexOf(normaliserPourDetection(texte) as (typeof JOURS_SEMAINE)[number]);
  return index >= 0 ? index : null;
}

/**
 * NUMERO_REFERENT est facultatif : vide = pas de référent (normal, pas d'avertissement).
 * Un numéro mal tapé, lui, donne un avertissement.
 */
function lireNumeroReferent(texte: string, avertissements: string[]): string | null {
  if (texte === '') return null;
  const numero = normaliserTelephone(texte);
  if (numero === null) {
    avertissements.push(`Paramètre NUMERO_REFERENT invalide (« ${texte} », attendu : un numéro comme 06 12 34 56 78) : référent ignoré`);
  }
  return numero;
}

function listeNonVide(texte: string): string[] | null {
  const liste = texte.split(',').map((element) => element.trim()).filter((element) => element !== '');
  return liste.length > 0 ? liste : null;
}

function texteNonVide(texte: string): string | null {
  // Le Sheet peut contenir de vrais retours à la ligne : on les garde.
  return texte !== '' ? texte : null;
}
