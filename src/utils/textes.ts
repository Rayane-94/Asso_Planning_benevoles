/**
 * utils/textes.ts — Modèles de messages et détection des réponses OUI / NON.
 */
import { EMOJIS_REPONSE, EXPRESSIONS_REPONSE, REPONSE, type Reponse } from '../constantes.ts';

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
