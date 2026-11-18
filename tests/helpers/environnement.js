/**
 * Environnement de test complet : le code de src/ + tous les faux services, branchés
 * sur une même horloge contrôlée.
 *
 * Utilisation :
 *   const env = creerEnvironnement({ depart: '2026-11-21 18:00' });
 *   env.ctx.maFonction_();        // appelle le vrai code du bot
 *   env.horloge.avancer({ jours: 1 });
 *   env.whatsapp.envoyes();       // ce que le bot a « envoyé »
 *   env.classeur.getSheetByName('Actions');
 *
 * Chaque test crée son propre environnement : les tests ne se marchent pas dessus.
 */
const { chargerProjet } = require('./charger');
const { creerHorloge } = require('./horloge');
const { creerFauxUtilities } = require('./fauxUtilities');
const { creerFauxSpreadsheetApp } = require('./fauxSpreadsheetApp');
const {
  creerFauxPropertiesService, creerFauxCacheService, creerFauxLockService,
  creerFauxScriptApp, creerFauxUrlFetchApp, creerFauxLogger,
} = require('./fauxServices');
const { creerFauxWhatsApp } = require('./fauxWhatsApp');

/**
 * @param {Object} [options]
 * @param {string} [options.depart] heure de départ à Paris, ex. '2026-11-21 18:00'
 */
function creerEnvironnement({ depart } = {}) {
  const horloge = creerHorloge(depart);
  const sheets = creerFauxSpreadsheetApp();
  const proprietes = creerFauxPropertiesService();
  const cache = creerFauxCacheService(horloge);
  const verrou = creerFauxLockService();
  const declencheurs = creerFauxScriptApp();
  const urlFetch = creerFauxUrlFetchApp();
  const logger = creerFauxLogger();
  const whatsapp = creerFauxWhatsApp({ horloge });

  const ctx = chargerProjet({
    Utilities: creerFauxUtilities(horloge),
    SpreadsheetApp: sheets.service,
    PropertiesService: proprietes.service,
    CacheService: cache.service,
    LockService: verrou.service,
    ScriptApp: declencheurs.service,
    UrlFetchApp: urlFetch.service,
    Logger: logger.service,
  });

  // Le bot lit l'heure via now_() : on la branche sur l'horloge du test.
  ctx.now_ = () => horloge.maintenant();
  // Le code métier parle à WhatsApp via WA : on branche le faux fournisseur.
  // (À l'étape 5, la vraie couche WA permettra de choisir ce fournisseur proprement.)
  ctx.WA = whatsapp.service;

  return {
    ctx,
    horloge,
    classeur: sheets.classeur,
    proprietes: proprietes.proprietes,
    cache,
    verrou,
    declencheurs,
    urlFetch,
    logger,
    whatsapp,
  };
}

module.exports = { creerEnvironnement };
