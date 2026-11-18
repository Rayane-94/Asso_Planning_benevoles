/**
 * Utils_Dates.js — Dates et heures.
 *
 * Principe : on ne compare jamais des objets Date entre eux (piège des fuseaux et
 * des changements d'heure). On travaille avec des textes simples :
 *   - une « clé de date » : 'yyyy-MM-dd'  (ex. '2026-11-29')
 *   - une « heure »       : 'HH:mm'       (ex. '19:00')
 * Ces textes se comparent directement : '2026-11-29' < '2026-11-30' et '09:00' < '19:00'.
 *
 * Convention Apps Script : un nom de fonction qui finit par « _ » est « privé ».
 * Il n'apparaît pas dans le menu « Exécuter » de l'éditeur Google.
 */

/**
 * Heure actuelle. Toujours passer par cette fonction (jamais `new Date()` directement)
 * pour que les tests puissent « avancer l'horloge ».
 * @return {Date}
 */
function now_() {
  return new Date();
}

/**
 * Clé de date d'un instant, vue depuis Paris.
 * @param {Date} date
 * @return {string} ex. '2026-11-29'
 */
function cleDate_(date) {
  return Utilities.formatDate(date, FUSEAU, 'yyyy-MM-dd');
}

/**
 * Heure d'un instant, vue depuis Paris.
 * @param {Date} date
 * @return {string} ex. '19:05'
 */
function heureDe_(date) {
  return Utilities.formatDate(date, FUSEAU, 'HH:mm');
}

/**
 * Ajoute (ou retire, si n est négatif) des jours à une clé de date.
 * Le calcul se fait en UTC, sans fuseau : aucun piège de changement d'heure.
 * @param {string} cle ex. '2026-11-29'
 * @param {number} n ex. -7
 * @return {string} ex. '2026-11-22'
 */
function ajouterJours_(cle, n) {
  const date = dateUtcDepuisCle_(cle);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/**
 * Nombre de jours entre deux clés de date (positif si cleB est après cleA).
 * @param {string} cleA ex. '2026-11-22'
 * @param {string} cleB ex. '2026-11-29'
 * @return {number} ex. 7
 */
function ecartJours_(cleA, cleB) {
  const UN_JOUR_MS = 24 * 60 * 60 * 1000;
  return Math.round((dateUtcDepuisCle_(cleB) - dateUtcDepuisCle_(cleA)) / UN_JOUR_MS);
}

/**
 * Nom du jour de la semaine.
 * @param {string} cle ex. '2026-11-28'
 * @return {string} ex. 'samedi'
 */
function jourSemaine_(cle) {
  return JOURS_SEMAINE[dateUtcDepuisCle_(cle).getUTCDay()];
}

/**
 * Date au format court, pour la liste finale.
 * @param {string} cle ex. '2026-11-28'
 * @return {string} ex. '28/11'
 */
function dateCourte_(cle) {
  const [, mois, jour] = cle.split('-');
  return jour + '/' + mois;
}

/**
 * Date au format long, pour les annonces.
 * @param {string} cle ex. '2026-11-28'
 * @return {string} ex. 'samedi 28/11'
 */
function dateLongue_(cle) {
  return jourSemaine_(cle) + ' ' + dateCourte_(cle);
}

/**
 * Lit une date tapée à la française : '28/11/2026', '28/11/26' ou '28-11-2026'.
 * @param {string} texte
 * @return {string|null} la clé 'yyyy-MM-dd', ou null si la date est invalide
 */
function parseDateFr_(texte) {
  const m = String(texte).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = Number(m[2]);
  const annee = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const cle = annee + '-' + deuxChiffres_(mois) + '-' + deuxChiffres_(jour);
  // Vérifie que la date existe (refuse le 31/02) : on la reconstruit et on compare.
  const date = dateUtcDepuisCle_(cle);
  if (date.getUTCMonth() + 1 !== mois || date.getUTCDate() !== jour) return null;
  return cle;
}

/**
 * Lit une heure tapée librement : '19:00', '19h', '19h30', '9H05', '19 h 30', '19:00:00', '19'.
 * @param {string} texte
 * @return {string|null} l'heure au format 'HH:mm', ou null si invalide
 */
function parseHeure_(texte) {
  const propre = String(texte).trim().toLowerCase().replace(/\s+/g, '');
  // heures (1 ou 2 chiffres), puis éventuellement « h » ou « : » suivi des minutes,
  // puis éventuellement des secondes (ignorées).
  const m = propre.match(/^(\d{1,2})(?:[h:](\d{2})?)?(?::\d{2})?$/);
  if (!m) return null;
  const heures = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (heures > 23 || minutes > 59) return null;
  return deuxChiffres_(heures) + ':' + deuxChiffres_(minutes);
}

// ---------------------------------------------------------------------------
// Fonctions internes à ce fichier
// ---------------------------------------------------------------------------

/** Transforme une clé 'yyyy-MM-dd' en Date UTC à minuit (pour les calculs de jours). */
function dateUtcDepuisCle_(cle) {
  const [annee, mois, jour] = cle.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour));
}

/** 5 → '05' */
function deuxChiffres_(n) {
  return String(n).padStart(2, '0');
}
