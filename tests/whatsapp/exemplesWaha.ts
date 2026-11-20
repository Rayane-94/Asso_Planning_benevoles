/**
 * Exemples de webhooks WAHA (moteur GOWS), reproduisant EXACTEMENT la structure observée
 * pendant le spike du 19/11/2026 — mais avec des numéros, noms et identifiants INVENTÉS.
 * (Les vrais enregistrements du spike ne sont jamais copiés dans le code.)
 */

/** Numéros et identifiants fictifs */
export const BOT = { numero: '33700000001', lid: '111111111111111@lid' };
export const BENEVOLE = { numero: '33600000002', lid: '222222222222222@lid', nom: 'Bénévole Test' };
export const GROUPE = '120363000000000001@g.us';
export const ID_ANNONCE = 'AC43B61DACD3CF383ABCA207DCDC46EA';

/** Partie commune à tous les événements */
const enveloppe = {
  session: 'default',
  me: { id: `${BOT.numero}@c.us`, pushName: 'Bot', lid: BOT.lid, jid: `${BOT.numero}:11@s.whatsapp.net` },
  engine: 'GOWS',
  environment: { version: '2026.10.1', engine: 'GOWS', tier: 'CORE' },
};

/** Le bénévole répond « oui » dans le groupe en CITANT l'annonce (cas central du bot). */
export const reponseCiteeDansLeGroupe = {
  ...enveloppe,
  id: 'evt_02',
  timestamp: 1795118988000,
  event: 'message',
  payload: {
    id: `false_${GROUPE}_ACD54338BDF3D3994A704555DBC6E65A_${BENEVOLE.lid}`,
    timestamp: 1795118988,
    from: GROUPE,
    fromMe: false,
    source: 'app',
    body: 'oui',
    to: BENEVOLE.lid,
    participant: BENEVOLE.lid,
    hasMedia: false,
    replyTo: { id: ID_ANNONCE, participant: BOT.lid, body: '📣 BP – samedi 28/11 à 14:00 – Entrepôt' },
    _data: {
      Info: {
        Chat: GROUPE,
        Sender: BENEVOLE.lid,
        IsFromMe: false,
        IsGroup: true,
        AddressingMode: 'lid',
        SenderAlt: `${BENEVOLE.numero}@s.whatsapp.net`,
        ID: 'ACD54338BDF3D3994A704555DBC6E65A',
        Type: 'text',
        PushName: BENEVOLE.nom,
      },
    },
  },
};

/** Le bénévole écrit « oui » en PRIVÉ au numéro du bot. */
export const messagePrive = {
  ...enveloppe,
  id: 'evt_03',
  timestamp: 1795119300000,
  event: 'message',
  payload: {
    id: `false_${BENEVOLE.lid}_AC2B197BAC7E5F9E29FF230F2285FA0A`,
    timestamp: 1795119300,
    from: BENEVOLE.lid,
    fromMe: false,
    source: 'app',
    body: 'oui',
    to: null,
    participant: null,
    hasMedia: false,
    replyTo: null,
    _data: {
      Info: {
        Chat: BENEVOLE.lid,
        Sender: BENEVOLE.lid,
        IsFromMe: false,
        IsGroup: false,
        AddressingMode: '',
        SenderAlt: `${BENEVOLE.numero}@s.whatsapp.net`,
        ID: 'AC2B197BAC7E5F9E29FF230F2285FA0A',
        PushName: BENEVOLE.nom,
      },
    },
  },
};

/** Le bot (le compte connecté) publie un message dans le groupe : fromMe = true. */
export const messageDuBot = {
  ...enveloppe,
  id: 'evt_01',
  timestamp: 1795118853000,
  event: 'message.any',
  payload: {
    id: `true_${GROUPE}_${ID_ANNONCE}_${BOT.lid}`,
    timestamp: 1795118853,
    from: GROUPE,
    fromMe: true,
    body: '📣 BP – samedi 28/11 à 14:00 – Entrepôt',
    participant: BOT.lid,
    replyTo: null,
    _data: { Info: { Chat: GROUPE, Sender: BOT.lid, IsFromMe: true, IsGroup: true, ID: ID_ANNONCE, PushName: 'Bot' } },
  },
};

/** Changement d'état de la session WhatsApp. */
export const statutSession = {
  ...enveloppe,
  id: 'evt_00',
  timestamp: 1795118000000,
  event: 'session.status',
  payload: { name: 'default', status: 'WORKING' },
};

/** Copie profonde modifiable d'un exemple (pour fabriquer des variantes dans les tests). */
export function copie<T>(exemple: T): T {
  return structuredClone(exemple);
}
