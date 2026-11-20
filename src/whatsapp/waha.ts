/**
 * whatsapp/waha.ts — L'adaptateur WAHA : le « traducteur » entre WAHA et le bot.
 *
 * Deux sens :
 *   - le bot → WhatsApp : MessagerieWaha (contrat Messagerie) appelle l'API HTTP de WAHA ;
 *   - WhatsApp → le bot : convertirWebhook() transforme le JSON reçu de WAHA en MessageRecu.
 *
 * Tous les formats propres à WhatsApp/WAHA (…@c.us, …@g.us, …@lid, …@s.whatsapp.net,
 * ID longs/courts) restent ICI. Le reste du bot ne voit que des numéros E.164 et des ID courts.
 *
 * Ce qu'on a appris au spike (CLAUDE.md §7, étape 0), moteur GOWS :
 *   - l'expéditeur arrive souvent en identifiant masqué « …@lid » ; le vrai numéro est dans
 *     payload._data.Info.SenderAlt (« 336…@s.whatsapp.net ») ;
 *   - un message a un ID court (« AC43B61D… », dans _data.Info.ID) et un ID long
 *     (« true_<discussion>_<ID court>_<expéditeur> ») ; une citation ne donne que l'ID court
 *     (payload.replyTo.id) → on manipule TOUJOURS l'ID court ;
 *   - les messages envoyés par le compte du bot arrivent aussi, avec fromMe = true → ignorés.
 */
import type { Config } from '../config.ts';
import type { EtatConnexion, Groupe, MessageRecu, Messagerie } from '../ports/messagerie.ts';
import { normaliserTelephone } from '../utils/telephones.ts';

/** Délai maximum d'une requête vers WAHA (au-delà, on considère qu'il ne répond pas). */
const DELAI_MAX_MS = 30_000;

/** La fonction fetch, injectable pour les tests (par défaut : celle de Node). */
export type Fetch = typeof fetch;

// ===========================================================================
// Le bot → WhatsApp
// ===========================================================================

export class MessagerieWaha implements Messagerie {
  private readonly config: Config['waha'];
  private readonly fetch: Fetch;

  constructor(config: Config['waha'], fetchFn: Fetch = fetch) {
    this.config = config;
    this.fetch = fetchFn;
  }

  /** @return l'ID COURT du message envoyé (celui que les citations utiliseront) */
  async envoyerTexte(destinataire: string, texte: string, options: { citeId?: string } = {}): Promise<string> {
    const message = await this.appeler<{ id?: string }>('POST', '/api/sendText', {
      session: this.config.session,
      chatId: versChatId(destinataire),
      text: texte,
      ...(options.citeId ? { reply_to: options.citeId } : {}),
    });
    if (!message.id) throw new Error('WAHA n\'a pas renvoyé d\'ID pour le message envoyé');
    return idCourt(message.id);
  }

  async listerGroupes(): Promise<Groupe[]> {
    const reponse = await this.appeler<unknown>('GET', `/api/${encodeURIComponent(this.config.session)}/groups`);
    // Selon le moteur, WAHA renvoie une liste ou un objet { id: groupe } ; et les champs
    // s'appellent id/subject (format général) ou JID/Name (moteur GOWS).
    const liste = Array.isArray(reponse) ? reponse : Object.values(reponse ?? {});
    return liste.map((brut) => {
      const groupe = brut as Record<string, unknown>;
      return {
        id: String(groupe.id ?? groupe.JID ?? ''),
        nom: String(groupe.subject ?? groupe.name ?? groupe.Name ?? ''),
      };
    }).filter((groupe) => groupe.id !== '');
  }

  /** Ne lève jamais d'erreur : un problème donne { ok: false, detail }. */
  async verifierConnexion(): Promise<EtatConnexion> {
    try {
      const session = await this.appeler<{ status?: string; me?: { id?: string } }>(
        'GET', `/api/sessions/${encodeURIComponent(this.config.session)}`,
      );
      if (session.status === 'WORKING') {
        return { ok: true, numero: telephoneDepuisIdentifiant(session.me?.id) };
      }
      const detail = session.status === 'SCAN_QR_CODE'
        ? 'session déconnectée : QR code à rescanner dans le tableau de bord WAHA'
        : `session WAHA dans l'état « ${session.status ?? 'inconnu'} »`;
      return { ok: false, numero: null, detail };
    } catch (erreur) {
      return { ok: false, numero: null, detail: erreur instanceof Error ? erreur.message : String(erreur) };
    }
  }

  /** Appelle l'API de WAHA ; lève une erreur claire si WAHA est injoignable ou répond une erreur. */
  private async appeler<T>(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<T> {
    let reponse: Response;
    try {
      reponse = await this.fetch(`${this.config.url}${chemin}`, {
        method: methode,
        headers: { 'X-Api-Key': this.config.cleApi, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        signal: AbortSignal.timeout(DELAI_MAX_MS),
      });
    } catch (erreur) {
      throw new Error(`WAHA injoignable (${this.config.url}) : ${erreur instanceof Error ? erreur.message : String(erreur)}`, { cause: erreur });
    }
    if (!reponse.ok) {
      const texte = (await reponse.text()).slice(0, 300);
      const conseil = reponse.status === 401 ? ' — vérifier WAHA_API_KEY (même valeur pour WAHA et le bot)' : '';
      throw new Error(`WAHA a répondu ${reponse.status} sur ${methode} ${chemin}${conseil} : ${texte}`);
    }
    return (await reponse.json()) as T;
  }
}

// ===========================================================================
// WhatsApp → le bot : conversion des webhooks
// ===========================================================================

/**
 * Transforme un événement reçu de WAHA en MessageRecu.
 * @return null si l'événement ne concerne pas le bot (connexion, accusé de lecture,
 *   message envoyé par le bot lui-même, message sans texte…)
 */
export function convertirWebhook(evenement: unknown): MessageRecu | null {
  const e = evenement as WebhookWaha;
  if (e?.event !== 'message' && e?.event !== 'message.any') return null;
  const p = e.payload;
  if (!p || p.fromMe) return null;
  const texte = typeof p.body === 'string' ? p.body : '';
  if (texte.trim() === '') return null; // photo sans légende, sticker… : rien à traiter

  const info = p._data?.Info;
  const estGroupe = info?.IsGroup ?? String(p.from ?? '').endsWith('@g.us');
  const idBrut = String(info?.Sender ?? (estGroupe ? p.participant : p.from) ?? '');
  // Le vrai numéro : d'abord SenderAlt (le numéro derrière un LID), sinon l'identifiant lui-même
  // s'il s'agit d'un numéro (…@c.us / …@s.whatsapp.net). Un LID seul → null (numéro masqué).
  const telephone = telephoneDepuisIdentifiant(info?.SenderAlt) ?? telephoneDepuisIdentifiant(idBrut);

  return {
    id: String(info?.ID ?? idCourt(String(p.id ?? ''))),
    // En privé, la discussion est identifiée par le numéro (comme dans le reste du bot).
    discussionId: estGroupe ? String(p.from ?? '') : (telephone ?? idBrut),
    estGroupe,
    telephone,
    idBrut,
    nomWhatsApp: String(info?.PushName ?? ''),
    texte,
    citeId: p.replyTo?.id ? idCourt(p.replyTo.id) : null,
    date: typeof p.timestamp === 'number' ? new Date(p.timestamp * 1000) : new Date(),
  };
}

/** Ce qu'on lit dans un webhook WAHA (seulement les champs utiles, tous facultatifs par prudence). */
interface WebhookWaha {
  event?: string;
  payload?: {
    id?: string;
    timestamp?: number;
    from?: string;
    fromMe?: boolean;
    participant?: string;
    body?: string;
    replyTo?: { id?: string } | null;
    _data?: { Info?: { ID?: string; Sender?: string; SenderAlt?: string; IsGroup?: boolean; PushName?: string } };
  };
}

// ===========================================================================
// Formats d'identifiants WhatsApp (utilisés uniquement ici)
// ===========================================================================

/**
 * Numéro E.164 (sans « + ») ou ID de groupe → identifiant de discussion WAHA.
 *   '33612345678' → '33612345678@c.us' ; '1203…@g.us' → inchangé
 */
export function versChatId(destinataire: string): string {
  return destinataire.includes('@') ? destinataire : `${destinataire}@c.us`;
}

/**
 * ID long WAHA → ID court WhatsApp.
 *   'true_1203…@g.us_AC43B61D…_2736…@lid' → 'AC43B61D…' ; un ID déjà court est renvoyé tel quel.
 */
export function idCourt(id: string): string {
  const morceaux = id.split('_');
  return morceaux.length >= 3 ? morceaux[2] : id;
}

/**
 * Identifiant WhatsApp → numéro E.164 sans « + », ou null si ce n'est pas un numéro.
 *   '33612345678@c.us' → '33612345678'
 *   '33612345678:11@s.whatsapp.net' → '33612345678' (« :11 » = numéro d'appareil)
 *   '273667112104190@lid' → null (identifiant masqué : PAS un numéro)
 */
export function telephoneDepuisIdentifiant(identifiant: string | null | undefined): string | null {
  if (!identifiant) return null;
  const [utilisateur, domaine] = identifiant.split('@');
  if (domaine !== 'c.us' && domaine !== 's.whatsapp.net') return null;
  return normaliserTelephone('+' + utilisateur.split(':')[0]);
}
