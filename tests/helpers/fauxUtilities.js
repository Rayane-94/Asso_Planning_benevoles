/**
 * Faux service « Utilities » d'Apps Script.
 * On n'imite que ce dont le projet a besoin.
 */
const { instantDepuisHeureLocale, formaterDate } = require('./fuseau');

/**
 * @param {Object} [horloge] si fournie, Utilities.sleep fait avancer l'horloge
 *   au lieu d'attendre pour de vrai (un test ne doit jamais attendre).
 */
function creerFauxUtilities(horloge = null) {
  let compteurUuid = 0;

  return {
    /** Utilities.formatDate(date, fuseau, motif) — motifs : yyyy MM dd HH mm ss */
    formatDate(date, fuseau, motif) {
      return formaterDate(date, fuseau, motif);
    },

    /**
     * Utilities.parseDate(texte, fuseau, motif) — l'inverse de formatDate.
     * ex. parseDate('2026-11-28 18:00', 'Europe/Paris', 'yyyy-MM-dd HH:mm')
     */
    parseDate(texte, fuseau, motif) {
      const ordre = [];
      const source = motif
        .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') // échappe les caractères spéciaux
        .replace(/yyyy|MM|dd|HH|mm|ss/g, (jeton) => {
          ordre.push(jeton);
          return jeton === 'yyyy' ? '(\\d{4})' : '(\\d{1,2})';
        });
      const m = String(texte).match(new RegExp('^' + source + '$'));
      if (!m) throw new Error(`Utilities.parseDate : « ${texte} » ne correspond pas au motif « ${motif} »`);

      const v = { yyyy: 1970, MM: 1, dd: 1, HH: 0, mm: 0, ss: 0 };
      ordre.forEach((jeton, i) => { v[jeton] = Number(m[i + 1]); });
      return instantDepuisHeureLocale(fuseau, v.yyyy, v.MM, v.dd, v.HH, v.mm, v.ss);
    },

    /** Utilities.sleep(ms) — fait avancer l'horloge du test, sans attendre. */
    sleep(ms) {
      if (horloge) horloge.avancer({ ms });
    },

    /** Utilities.getUuid() — identifiants prévisibles dans les tests. */
    getUuid() {
      compteurUuid += 1;
      return '00000000-0000-4000-8000-' + String(compteurUuid).padStart(12, '0');
    },
  };
}

module.exports = { creerFauxUtilities };
