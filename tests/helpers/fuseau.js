/**
 * Outils de fuseau horaire pour les faux services (côté Node uniquement).
 *
 * Problème à résoudre : « samedi 18:00 à Paris », c'est quel instant exact ?
 * Ça dépend de l'heure d'été / d'hiver. Intl (intégré à Node) connaît ces règles :
 * on s'en sert pour convertir dans les deux sens.
 */

/**
 * Découpe un instant en morceaux (année, mois, jour, heure…) vus depuis un fuseau.
 * @param {Date} date
 * @param {string} fuseau ex. 'Europe/Paris'
 */
function partiesDate(date, fuseau) {
  const morceaux = new Intl.DateTimeFormat('en-GB', {
    timeZone: fuseau,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const texte = {};
  for (const m of morceaux) texte[m.type] = m.value;
  return {
    annee: Number(texte.year), mois: Number(texte.month), jour: Number(texte.day),
    heure: Number(texte.hour), minute: Number(texte.minute), seconde: Number(texte.second),
    texte, // les mêmes valeurs en texte, avec les zéros ('05')
  };
}

/** Décalage (en ms) entre l'heure locale du fuseau et UTC, à un instant donné. */
function decalageMs(date, fuseau) {
  const p = partiesDate(date, fuseau);
  const localCommeSiUtc = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde);
  return localCommeSiUtc - (date.getTime() - date.getUTCMilliseconds());
}

/**
 * Instant correspondant à une heure locale dans un fuseau.
 * ex. instantDepuisHeureLocale('Europe/Paris', 2026, 11, 28, 18, 0) → 2026-11-28T17:00:00Z
 * Les débordements sont acceptés (jour 32 → mois suivant).
 */
function instantDepuisHeureLocale(fuseau, annee, mois, jour, heure = 0, minute = 0, seconde = 0) {
  const naif = Date.UTC(annee, mois - 1, jour, heure, minute, seconde);
  // Deux passes : la 2e corrige le cas où le décalage change entre les deux (changement d'heure).
  let essai = naif - decalageMs(new Date(naif), fuseau);
  essai = naif - decalageMs(new Date(essai), fuseau);
  return new Date(essai);
}

/**
 * Formate un instant selon un motif simple (yyyy, MM, dd, HH, mm, ss).
 * ex. formaterDate(date, 'Europe/Paris', 'yyyy-MM-dd HH:mm') → '2026-11-28 18:00'
 */
function formaterDate(date, fuseau, motif) {
  const t = partiesDate(date, fuseau).texte;
  const correspondance = { yyyy: t.year, MM: t.month, dd: t.day, HH: t.hour, mm: t.minute, ss: t.second };
  return motif.replace(/yyyy|MM|dd|HH|mm|ss/g, (jeton) => correspondance[jeton]);
}

module.exports = { partiesDate, instantDepuisHeureLocale, formaterDate };
