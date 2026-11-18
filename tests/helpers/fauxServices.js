/**
 * Les autres faux services Google, plus petits :
 *   PropertiesService (réglages et secrets), CacheService (mémoire temporaire),
 *   LockService (verrou anti-exécutions simultanées), ScriptApp (déclencheurs),
 *   UrlFetchApp (appels HTTP), Logger (logs).
 *
 * Chaque fabrique renvoie { service, ...outils de test } :
 *   - service : l'objet injecté dans le bac à sable, sous le nom du vrai service ;
 *   - le reste : des commandes et des infos pour les tests uniquement.
 */

// ---------------------------------------------------------------------------
// PropertiesService : petites valeurs texte persistantes (tokens, état du bot)
// ---------------------------------------------------------------------------
/** Limite réelle de Google : 9 Ko par valeur. Au-delà, setProperty plante. */
const TAILLE_MAX_PROPRIETE = 9 * 1024;

function creerFauxPropertiesService() {
  const valeurs = new Map();

  const proprietes = {
    getProperty(cle) {
      return valeurs.has(cle) ? valeurs.get(cle) : null; // null si absente, comme le vrai
    },
    setProperty(cle, valeur) {
      const texte = String(valeur); // le vrai service stocke tout en texte
      if (Buffer.byteLength(texte, 'utf8') > TAILLE_MAX_PROPRIETE) {
        throw new Error(`Argument too large: value (propriété « ${cle} » > 9 Ko)`);
      }
      valeurs.set(cle, texte);
      return proprietes;
    },
    setProperties(objet, supprimerLesAutres = false) {
      if (supprimerLesAutres) valeurs.clear();
      for (const [cle, valeur] of Object.entries(objet)) proprietes.setProperty(cle, valeur);
      return proprietes;
    },
    getProperties() { return Object.fromEntries(valeurs); },
    getKeys() { return [...valeurs.keys()]; },
    deleteProperty(cle) { valeurs.delete(cle); return proprietes; },
    deleteAllProperties() { valeurs.clear(); return proprietes; },
  };

  return { service: { getScriptProperties: () => proprietes }, proprietes };
}

// ---------------------------------------------------------------------------
// CacheService : mémoire qui s'efface toute seule après un délai
// ---------------------------------------------------------------------------
/** Durée max réelle : 6 heures. */
const DUREE_MAX_CACHE_S = 21600;

function creerFauxCacheService(horloge) {
  const entrees = new Map(); // clé → { valeur, expireA (ms) }
  const maintenantMs = () => horloge.maintenant().getTime();

  const cache = {
    get(cle) {
      const entree = entrees.get(cle);
      if (!entree) return null;
      if (entree.expireA <= maintenantMs()) { entrees.delete(cle); return null; }
      return entree.valeur;
    },
    put(cle, valeur, dureeSecondes = 600) {
      const duree = Math.min(dureeSecondes, DUREE_MAX_CACHE_S);
      entrees.set(cle, { valeur: String(valeur), expireA: maintenantMs() + duree * 1000 });
    },
    remove(cle) { entrees.delete(cle); },
    getAll(cles) {
      const resultat = {};
      for (const cle of cles) {
        const valeur = cache.get(cle);
        if (valeur !== null) resultat[cle] = valeur;
      }
      return resultat;
    },
    putAll(valeurs, dureeSecondes) {
      for (const [cle, valeur] of Object.entries(valeurs)) cache.put(cle, valeur, dureeSecondes);
    },
  };

  return { service: { getScriptCache: () => cache }, vider: () => entrees.clear() };
}

// ---------------------------------------------------------------------------
// LockService : un seul tick à la fois
// ---------------------------------------------------------------------------
function creerFauxLockService() {
  let detenteur = null; // le verrou actuellement pris, ou null

  const service = {
    getScriptLock() {
      const verrou = {
        tryLock() {
          if (detenteur && detenteur !== verrou) return false;
          detenteur = verrou;
          return true;
        },
        waitLock(ms) {
          if (!verrou.tryLock(ms)) throw new Error('Lock timeout: another process was holding the lock for too long.');
        },
        releaseLock() {
          if (detenteur === verrou) detenteur = null;
        },
        hasLock() { return detenteur === verrou; },
      };
      return verrou;
    },
  };

  return {
    service,
    /** Simule une autre exécution du bot qui tient déjà le verrou. */
    simulerAutreExecution() { detenteur = { autreExecution: true }; },
    liberer() { detenteur = null; },
    estVerrouille() { return detenteur !== null; },
  };
}

// ---------------------------------------------------------------------------
// ScriptApp : les déclencheurs (« lance tick() toutes les 15 minutes »)
// ---------------------------------------------------------------------------
/** Intervalles autorisés par Google pour everyMinutes(). */
const INTERVALLES_MINUTES_AUTORISES = [1, 5, 10, 15, 30];

function creerFauxScriptApp() {
  const declencheurs = [];
  let compteur = 0;

  const service = {
    EventType: { CLOCK: 'CLOCK', ON_OPEN: 'ON_OPEN', ON_EDIT: 'ON_EDIT' },

    newTrigger(nomFonction) {
      const reglage = { nomFonction, intervalle: null };
      const constructeur = {
        everyMinutes(n) {
          if (!INTERVALLES_MINUTES_AUTORISES.includes(n)) {
            throw new Error(`everyMinutes(${n}) refusé : valeurs possibles ${INTERVALLES_MINUTES_AUTORISES.join(', ')}`);
          }
          reglage.intervalle = { minutes: n };
          return constructeur;
        },
        everyHours(n) {
          reglage.intervalle = { heures: n };
          return constructeur;
        },
        create() {
          compteur += 1;
          const id = 'declencheur-' + compteur;
          const declencheur = {
            getHandlerFunction: () => reglage.nomFonction,
            getUniqueId: () => id,
            getEventType: () => 'CLOCK',
            intervalle: reglage.intervalle, // pour les tests
          };
          declencheurs.push(declencheur);
          return declencheur;
        },
      };
      return { timeBased: () => constructeur };
    },

    getProjectTriggers() { return declencheurs.slice(); },
    deleteTrigger(declencheur) {
      const index = declencheurs.indexOf(declencheur);
      if (index >= 0) declencheurs.splice(index, 1);
    },
  };

  return { service, declencheurs };
}

// ---------------------------------------------------------------------------
// UrlFetchApp : appels HTTP (utilisé par les adaptateurs WhatsApp réels)
// ---------------------------------------------------------------------------
function creerFauxUrlFetchApp() {
  const appels = []; // historique : [{ url, params }]
  let repondeur = () => ({ code: 200, corps: '{}' });

  const service = {
    fetch(url, params = {}) {
      appels.push({ url, params });
      const { code = 200, corps = '' } = repondeur(url, params) || {};
      const texte = typeof corps === 'string' ? corps : JSON.stringify(corps);
      // Comme le vrai : une erreur HTTP fait planter, sauf avec muteHttpExceptions: true
      if (code >= 400 && !params.muteHttpExceptions) {
        throw new Error(`Request failed for ${url} returned code ${code}. Truncated server response: ${texte.slice(0, 100)}`);
      }
      return {
        getResponseCode: () => code,
        getContentText: () => texte,
        getHeaders: () => ({}),
      };
    },
  };

  return {
    service,
    appels,
    /**
     * Définit la réponse du « serveur » : fn(url, params) → { code, corps }.
     * corps peut être un objet (converti en JSON) ou du texte.
     */
    definirRepondeur(fn) { repondeur = fn; },
  };
}

// ---------------------------------------------------------------------------
// Logger : on garde les lignes pour pouvoir les vérifier
// ---------------------------------------------------------------------------
function creerFauxLogger() {
  const lignes = [];
  return { service: { log: (...morceaux) => { lignes.push(morceaux.join(' ')); } }, lignes };
}

module.exports = {
  creerFauxPropertiesService,
  creerFauxCacheService,
  creerFauxLockService,
  creerFauxScriptApp,
  creerFauxUrlFetchApp,
  creerFauxLogger,
};
