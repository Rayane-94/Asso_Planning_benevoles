/**
 * Horloge contrôlée pour les tests.
 *
 * Dans les tests, le temps ne passe pas tout seul : c'est le test qui décide.
 *   const horloge = creerHorloge('2026-11-21 18:00'); // samedi 18:00 à Paris
 *   horloge.avancer({ jours: 2 });                    // lundi 18:00
 *   horloge.texte();                                  // '2026-11-23 18:00'
 *
 * Le code du bot lit l'heure via now_(), que l'environnement de test branche sur
 * horloge.maintenant(). Toutes les heures données ici sont des heures de Paris.
 */
const { instantDepuisHeureLocale, partiesDate, formaterDate } = require('./fuseau');

const FUSEAU = 'Europe/Paris';

/** 'yyyy-MM-dd HH:mm' ou 'yyyy-MM-dd' (heure de Paris) → Date */
function lireHeureDeParis(texte) {
  const m = String(texte).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!m) throw new Error(`Horloge : format attendu 'yyyy-MM-dd HH:mm', reçu « ${texte} »`);
  return instantDepuisHeureLocale(FUSEAU, +m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), 0);
}

/**
 * @param {string} [depart] heure de départ à Paris (par défaut : lundi 16/11/2026 09:00)
 */
function creerHorloge(depart = '2026-11-16 09:00') {
  let instant = lireHeureDeParis(depart);

  return {
    /** L'instant actuel (une copie : personne ne peut modifier l'horloge par accident). */
    maintenant() {
      return new Date(instant.getTime());
    },

    /** Saute directement à une date et une heure de Paris. */
    regler(texte) {
      instant = lireHeureDeParis(texte);
    },

    /**
     * Fait avancer le temps.
     * « 1 jour » = même heure le lendemain, même lors d'un changement d'heure (pas 24 h pile).
     */
    avancer({ jours = 0, heures = 0, minutes = 0, secondes = 0, ms = 0 } = {}) {
      if (jours) {
        const p = partiesDate(instant, FUSEAU);
        const msRestantes = instant.getUTCMilliseconds();
        const lendemain = instantDepuisHeureLocale(FUSEAU, p.annee, p.mois, p.jour + jours, p.heure, p.minute, p.seconde);
        instant = new Date(lendemain.getTime() + msRestantes);
      }
      const dureeMs = ((heures * 60 + minutes) * 60 + secondes) * 1000 + ms;
      instant = new Date(instant.getTime() + dureeMs);
    },

    /** L'heure actuelle en texte lisible, à Paris : '2026-11-21 18:00'. */
    texte() {
      return formaterDate(instant, FUSEAU, 'yyyy-MM-dd HH:mm');
    },
  };
}

module.exports = { creerHorloge };
