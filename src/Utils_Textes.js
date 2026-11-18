/**
 * Utils_Textes.js — Modèles de messages et détection des réponses OUI / NON.
 */

/**
 * Remplace les variables {nom} d'un modèle par leur valeur.
 * Une variable inconnue est laissée telle quelle (ex. « {prenom} ») : l'équipe voit
 * ainsi tout de suite qu'il y a une faute de frappe dans le modèle.
 *
 * Exemple : remplirModele_('Bonjour {prenom} !', { prenom: 'Bob' }) → 'Bonjour Bob !'
 *
 * @param {string} modele
 * @param {Object<string, *>} valeurs
 * @return {string}
 */
function remplirModele_(modele, valeurs) {
  return String(modele).replace(/\{(\w+)\}/g, function (variable, nom) {
    const connue = Object.prototype.hasOwnProperty.call(valeurs, nom) && valeurs[nom] !== null && valeurs[nom] !== undefined;
    return connue ? String(valeurs[nom]) : variable;
  });
}

/**
 * Prépare un texte pour la détection : minuscules, sans accents, sans ponctuation,
 * et lettres répétées réduites à une seule (« ouiiii » → « oui », « okkk » → « ok »).
 * À n'utiliser QUE pour comparer des mots, jamais pour afficher.
 *
 * Exemple : 'Présente !!' → 'presente'
 *
 * @param {string} texte
 * @return {string}
 */
function normaliserPourDetection_(texte) {
  return String(texte)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // « é » → « e » + accent, puis on retire l'accent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // ponctuation, emojis, apostrophes → espace
    .replace(/(.)\1+/g, '$1') // lettres (et espaces) répétées → une seule
    .trim();
}

/**
 * Le texte contient-il l'une des expressions, en tant que mots entiers ?
 * (« non » est trouvé dans « bah non », mais pas dans « nonne »)
 * @param {string} texteNormalise résultat de normaliserPourDetection_
 * @param {string[]} expressions
 * @return {boolean}
 */
function contientExpression_(texteNormalise, expressions) {
  const texteEntoure = ' ' + texteNormalise + ' ';
  return expressions.some(function (expression) {
    return texteEntoure.includes(' ' + normaliserPourDetection_(expression) + ' ');
  });
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
 * @param {string} texte le message reçu
 * @return {string|null} REPONSE.OUI, REPONSE.NON, ou null si on ne sait pas
 */
function detecterReponse_(texte) {
  if (!texte) return null;
  const brut = String(texte);
  const normalise = normaliserPourDetection_(brut);
  const contientEmoji = function (emojis) {
    return emojis.some(function (emoji) { return brut.includes(emoji); });
  };

  if (contientExpression_(normalise, EXPRESSIONS_REPONSE.INCERTAIN)) return null;
  if (contientEmoji(EMOJIS_REPONSE.NON) || contientExpression_(normalise, EXPRESSIONS_REPONSE.NON)) return REPONSE.NON;
  if (contientEmoji(EMOJIS_REPONSE.OUI) || contientExpression_(normalise, EXPRESSIONS_REPONSE.OUI)) return REPONSE.OUI;
  return null;
}
