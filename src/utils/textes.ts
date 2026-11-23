/**
 * utils/textes.ts — Modèles de messages et détection des réponses OUI / NON.
 */
import { EMOJIS_REPONSE, EXPRESSIONS_REPONSE, MOTS_PAS_UN_NOM, REPONSE, type Reponse } from '../constantes.ts';

/** Valeurs à injecter dans un modèle ({prenom}, {date}…). */
export type ValeursModele = Record<string, string | number | null | undefined>;

/**
 * Remplace les variables {nom} d'un modèle par leur valeur.
 * Une variable inconnue ou vide est laissée telle quelle (ex. « {prenom} ») : l'équipe
 * voit ainsi tout de suite qu'il y a une faute de frappe dans le modèle.
 *
 * ex. remplirModele('Bonjour {prenom} !', { prenom: 'Bob' }) → 'Bonjour Bob !'
 */
export function remplirModele(modele: string, valeurs: ValeursModele): string {
  return modele.replace(/\{(\w+)\}/g, (variable, nom: string) => {
    const valeur = Object.hasOwn(valeurs, nom) ? valeurs[nom] : undefined;
    return valeur === null || valeur === undefined ? variable : String(valeur);
  });
}

/**
 * Prépare un texte pour la détection : minuscules, sans accents, sans ponctuation,
 * et lettres répétées réduites à une seule (« ouiiii » → « oui », « okkk » → « ok »).
 * À n'utiliser QUE pour comparer des mots, jamais pour afficher.
 *
 * ex. 'Présente !!' → 'presente'
 */
export function normaliserPourDetection(texte: string): string {
  return texte
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // « é » → « e » + accent, puis on retire l'accent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // ponctuation, emojis, apostrophes → espace
    .replace(/(.)\1+/g, '$1') // lettres (et espaces) répétées → une seule
    .trim();
}

/**
 * Détecte si un message est un OUI ou un NON.
 *
 * Ordre de priorité :
 *   1. incertain (« peut-être », « je sais pas »)  → null : on ne fait rien
 *   2. NON (« non », « je peux plus », 👎…)
 *   3. OUI (« oui », « ok », « je viens », 👍…)
 * Le NON passe avant le OUI : « ok finalement je peux pas » est un NON.
 *
 * @return 'OUI', 'NON', ou null si on ne sait pas
 */
export function detecterReponse(texte: string | null | undefined): Reponse | null {
  if (!texte) return null;
  const normalise = normaliserPourDetection(texte);

  if (contientExpression(normalise, EXPRESSIONS_REPONSE.INCERTAIN)) return null;
  if (contientEmoji(texte, EMOJIS_REPONSE.NON) || contientExpression(normalise, EXPRESSIONS_REPONSE.NON)) return REPONSE.NON;
  if (contientEmoji(texte, EMOJIS_REPONSE.OUI) || contientExpression(normalise, EXPRESSIONS_REPONSE.OUI)) return REPONSE.OUI;
  return null;
}

/**
 * Essaie de lire « prénom nom » dans un message privé (réponse à la demande de nom).
 * Prudent : on refuse tout ce qui ne ressemble pas clairement à un nom (question,
 * chiffres, phrase longue…) ; un humain s'en occupera.
 *
 *   'bob durand'          → { prenom: 'Bob', nom: 'Durand' }
 *   'Jean-Pierre De La Tour' → { prenom: 'Jean-Pierre', nom: 'De La Tour' }
 *   'Alice'               → { prenom: 'Alice', nom: '' }
 *   "c'est à quelle heure ?" → null
 */
export function lireNomComplet(texte: string): { prenom: string; nom: string } | null {
  const propre = texte.trim().replace(/\s+/g, ' ');
  if (propre === '' || propre.length > 50) return null;
  // Uniquement des lettres (avec accents), espaces, tirets et apostrophes (' ou ’, celle des iPhone)
  if (!/^\p{L}[\p{L}'’ \-]*$/u.test(propre)) return null;
  const mots = propre.split(' ');
  if (mots.length > 4) return null; // plus proche d'une phrase que d'un nom
  // « Salut », « merci », « je sais pas »… : des lettres, mais pas un nom
  const motsInterdits: readonly string[] = MOTS_PAS_UN_NOM;
  if (mots.some((mot) => motsInterdits.includes(normaliserPourDetection(mot)))) return null;
  const [prenom, ...reste] = mots.map(majusculeInitiale);
  return { prenom, nom: reste.join(' ') };
}

/** 'bob' → 'Bob', 'DURAND' → 'Durand', mais 'McDonald' reste 'McDonald' (déjà en casse mixte). */
function majusculeInitiale(mot: string): string {
  const casseMixte = mot !== mot.toLowerCase() && mot !== mot.toUpperCase();
  if (casseMixte) return mot;
  // Gère aussi les prénoms composés : 'jean-pierre' → 'Jean-Pierre'
  return mot.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, separateur: string, lettre: string) => separateur + lettre.toUpperCase());
}

// ---------------------------------------------------------------------------
// Fonctions internes à ce fichier
// ---------------------------------------------------------------------------

/**
 * Le texte normalisé contient-il l'une des expressions, en tant que mots entiers ?
 * (« non » est trouvé dans « bah non », mais pas dans « nonne »)
 */
function contientExpression(texteNormalise: string, expressions: readonly string[]): boolean {
  const texteEntoure = ` ${texteNormalise} `;
  return expressions.some((expression) => texteEntoure.includes(` ${normaliserPourDetection(expression)} `));
}

/** Le texte brut contient-il l'un des emojis ? (👍🏽 contient 👍 : les couleurs de peau marchent) */
function contientEmoji(texte: string, emojis: readonly string[]): boolean {
  return emojis.some((emoji) => texte.includes(emoji));
}
