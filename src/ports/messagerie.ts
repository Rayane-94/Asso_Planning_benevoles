/**
 * ports/messagerie.ts — Le contrat « WhatsApp ».
 *
 * Tout le code métier passe par cette interface. Chaque fournisseur a son « adaptateur »
 * qui la respecte : WAHA en production (src/whatsapp/waha.ts, étape 5), une fausse
 * messagerie dans les tests. Changer de fournisseur = écrire un nouvel adaptateur,
 * sans toucher au reste.
 *
 * Les formats d'identifiants propres au fournisseur (…@c.us, …@g.us, …@lid) restent
 * dans l'adaptateur. Ici, un destinataire est soit un numéro E.164 sans « + »
 * ('33612345678'), soit l'ID d'un groupe (tel que donné par listerGroupes).
 */

export interface Messagerie {
  /**
   * Envoie un texte.
   * @param destinataire numéro E.164 sans « + », ou ID de groupe
   * @param options.citeId pour répondre en citant un message
   * @return l'ID du message envoyé (sert à reconnaître les réponses qui le citent)
   * @throws si l'envoi échoue (numéro invalide, WhatsApp déconnecté…)
   */
  envoyerTexte(destinataire: string, texte: string, options?: { citeId?: string }): Promise<string>;

  /** Les groupes dont le numéro du bot fait partie. */
  listerGroupes(): Promise<Groupe[]>;

  /** La session WhatsApp est-elle connectée ? (ne lève pas d'erreur : renvoie ok: false) */
  verifierConnexion(): Promise<EtatConnexion>;
}

export interface Groupe {
  id: string;
  nom: string;
}

export interface EtatConnexion {
  ok: boolean;
  /** Numéro du bot (E.164 sans « + »), si connecté. */
  numero: string | null;
  /** Explication en cas de problème (« session déconnectée, rescanner le QR code »…). */
  detail?: string;
}

/**
 * Un message reçu, au format commun à tous les fournisseurs.
 * La réception arrive par webhook : l'adaptateur transforme le JSON du fournisseur en MessageRecu.
 */
export interface MessageRecu {
  /** ID unique du message (sert à ignorer les doublons). */
  id: string;
  /** Conversation : ID du groupe, ou numéro de l'expéditeur pour un message privé. */
  discussionId: string;
  estGroupe: boolean;
  /**
   * Numéro de l'expéditeur, E.164 sans « + ».
   * null si WhatsApp ne donne qu'un identifiant masqué (LID, voir CLAUDE.md §6).
   */
  telephone: string | null;
  /** Identifiant brut de l'expéditeur chez le fournisseur (numéro ou LID). */
  idBrut: string;
  /** Nom affiché sur WhatsApp (peut être vide). */
  nomWhatsApp: string;
  texte: string;
  /** ID du message cité (« Répondre » sur un message), sinon null. */
  citeId: string | null;
  date: Date;
}
