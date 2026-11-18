/**
 * Faux fournisseur WhatsApp.
 *
 * Il implémente la même interface WA que les vrais adaptateurs (CLAUDE.MD §3.2) :
 *   sendText, fetchIncoming, listGroups, ping
 * mais n'envoie rien : il note les messages « envoyés » et laisse le test fabriquer
 * des messages « reçus ».
 *
 * Exemple dans un test :
 *   const annonce = whatsapp.dernierEnvoi();                 // l'annonce publiée par le bot
 *   whatsapp.recevoir({ de: '33612345678', nom: 'Bob',      // Bob répond OUI dans le groupe
 *                       texte: 'oui', groupe: GROUPE_TEST, cite: annonce.id });
 *   environnement.ctx.tick();                                 // le bot traite la réponse
 */

const GROUPE_TEST = 'groupe-test';
const NUMERO_BOT = '33700000000';

function creerFauxWhatsApp({ horloge }) {
  const envoyes = []; // tous les messages envoyés par le bot
  let fileDeReception = []; // messages en attente que le bot vienne les chercher
  let compteur = 0;
  let connecte = true;
  const destinatairesEnEchec = new Set();
  const groupes = [{ id: GROUPE_TEST, name: 'Bénévoles (test)' }];

  /** L'interface WA, telle que le code du bot la voit. */
  const service = {
    /** Envoie un texte. Renvoie l'ID du message (utile pour reconnaître les citations). */
    sendText(destinataire, texte, options = {}) {
      if (!connecte) throw new Error('Instance WhatsApp déconnectée');
      if (destinatairesEnEchec.has(destinataire)) throw new Error(`Envoi impossible vers ${destinataire}`);
      compteur += 1;
      const id = 'envoye-' + compteur;
      envoyes.push({ id, a: destinataire, texte, citeId: options.quotedId || null, date: horloge.maintenant() });
      return id;
    },

    /** Renvoie les messages reçus depuis le dernier appel (puis vide la file). */
    fetchIncoming() {
      if (!connecte) throw new Error('Instance WhatsApp déconnectée');
      const lot = fileDeReception;
      fileDeReception = [];
      return lot;
    },

    listGroups() {
      return groupes.map((g) => ({ ...g }));
    },

    ping() {
      return { ok: connecte, number: NUMERO_BOT };
    },
  };

  return {
    service,

    // ----- Commandes pour les tests -----

    /**
     * Simule un message reçu par le bot.
     * @param {Object} message
     * @param {string} message.de numéro de l'expéditeur, ex. '33612345678'
     * @param {string} message.texte
     * @param {string} [message.groupe] ID du groupe (absent = message privé)
     * @param {string} [message.cite] ID du message cité (réponse à une annonce…)
     * @param {string} [message.nom] nom WhatsApp de l'expéditeur
     * @param {string} [message.id] pour simuler un doublon, réutiliser un ID déjà reçu
     * @return {Object} le message au format IncomingMessage
     */
    recevoir({ de, texte, groupe = null, cite = null, nom = '', id = null }) {
      compteur += 1;
      const message = {
        id: id || 'recu-' + compteur,
        chatId: groupe || de,
        isGroup: Boolean(groupe),
        fromPhone: de,
        fromRaw: de + '@faux',
        pushName: nom,
        text: texte,
        quotedId: cite,
        timestamp: Math.floor(horloge.maintenant().getTime() / 1000),
      };
      fileDeReception.push(message);
      return message;
    },

    /** Tous les messages envoyés par le bot (copie). */
    envoyes() { return envoyes.slice(); },
    /** Messages envoyés à un destinataire (numéro ou ID de groupe). */
    envoyesA(destinataire) { return envoyes.filter((m) => m.a === destinataire); },
    dernierEnvoi() { return envoyes[envoyes.length - 1] || null; },
    oublierEnvoyes() { envoyes.length = 0; },

    /** Les prochains envois vers ce destinataire échoueront (numéro invalide, bloqué…). */
    faireEchouerEnvoisVers(destinataire) { destinatairesEnEchec.add(destinataire); },
    /** Simule une instance déconnectée (téléphone éteint, session expirée…). */
    deconnecter() { connecte = false; },
    reconnecter() { connecte = true; },
  };
}

module.exports = { creerFauxWhatsApp, GROUPE_TEST, NUMERO_BOT };
