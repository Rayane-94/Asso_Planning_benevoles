/**
 * Utils_Telephones.js — Numéros de téléphone.
 *
 * Format interne (la « clé » d'un bénévole) : E.164 sans le « + », uniquement des chiffres.
 *   ex. '33612345678' pour le 06 12 34 56 78
 * Format d'affichage (liste finale, Sheet) : '06 12 34 56 78' pour la France,
 *   '+32470123456' pour un numéro étranger.
 *
 * ⚠️ Dans le Sheet, les numéros doivent être écrits comme du texte (préfixe ').
 * Sinon « +33… » devient une formule et « 0612… » perd son 0.
 */

/**
 * Transforme un numéro tapé n'importe comment en clé E.164 sans « + ».
 * Hypothèse : un numéro à 10 chiffres commençant par 0 est français.
 *
 * Exemples :
 *   '06 12 34 56 78'      → '33612345678'
 *   '+33 6 12 34 56 78'   → '33612345678'
 *   '+33 (0)6 12 34 56 78'→ '33612345678'
 *   '0033612345678'       → '33612345678'
 *   '612345678'           → '33612345678'  (0 de tête perdu par le Sheet)
 *   '+32 470 12 34 56'    → '32470123456'
 *
 * @param {string|number} brut
 * @return {string|null} la clé, ou null si ce n'est pas un numéro plausible
 */
function normaliserTelephone_(brut) {
  if (brut === null || brut === undefined) return null;
  const texte = String(brut).trim();
  const avecPlus = texte.startsWith('+');
  let chiffres = texte.replace(/\D/g, ''); // on ne garde que les chiffres

  if (avecPlus) {
    // « +33 (0)6… » : le 0 entre parenthèses ne doit pas rester
    if (chiffres.startsWith('330') && chiffres.length === 12) {
      chiffres = '33' + chiffres.slice(3);
    }
  } else if (chiffres.startsWith('00')) {
    chiffres = chiffres.slice(2); // préfixe international « 00 » = « + »
  } else if (chiffres.length === 10 && chiffres.startsWith('0')) {
    chiffres = '33' + chiffres.slice(1); // numéro français : 06… → 336…
  } else if (chiffres.length === 9 && /^[1-9]/.test(chiffres)) {
    chiffres = '33' + chiffres; // numéro français dont le 0 a été mangé par le Sheet
  }

  // Un numéro international fait entre 8 et 15 chiffres (norme E.164).
  if (chiffres.length < 8 || chiffres.length > 15) return null;
  return chiffres;
}

/**
 * Format lisible d'une clé de téléphone.
 *   '33612345678' → '06 12 34 56 78'
 *   '32470123456' → '+32470123456'
 * @param {string} cle
 * @return {string}
 */
function formaterTelephone_(cle) {
  if (/^33\d{9}$/.test(cle)) {
    const national = '0' + cle.slice(2); // '0612345678'
    return national.match(/\d{2}/g).join(' ');
  }
  return '+' + cle;
}
