/**
 * Faux service « Utilities » d'Apps Script, pour les tests locaux.
 * On n'imite que ce dont le projet a besoin. (Il sera complété à l'étape 3.)
 */

/**
 * Imite Utilities.formatDate(date, fuseau, motif).
 * Motifs gérés : yyyy, MM, dd, HH, mm, ss (ex. 'yyyy-MM-dd', 'HH:mm').
 * S'appuie sur Intl, qui connaît les fuseaux et les changements d'heure.
 */
function formatDate(date, fuseau, motif) {
  const morceaux = new Intl.DateTimeFormat('en-GB', {
    timeZone: fuseau,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const valeur = {};
  for (const m of morceaux) valeur[m.type] = m.value;

  const correspondance = {
    yyyy: valeur.year, MM: valeur.month, dd: valeur.day,
    HH: valeur.hour, mm: valeur.minute, ss: valeur.second,
  };
  return motif.replace(/yyyy|MM|dd|HH|mm|ss/g, (jeton) => correspondance[jeton]);
}

function creerFauxUtilities() {
  return { formatDate };
}

module.exports = { creerFauxUtilities };
