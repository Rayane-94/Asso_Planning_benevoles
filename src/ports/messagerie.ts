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
   * @param destinataire numéro E.164 sans « + », ID de groupe, ou identifiant brut
   *        (idBrut) d'une personne dont on ne connaît pas encore le numéro
   * @param options.citeId pour répondre en citant un message
   * @return l'ID du message envoyé (sert à reconnaître les réponses qui le citent)
   * @throws si l'envoi échoue (numéro invalide, WhatsApp déconnecté…)
   */
  envoyerTexte(destinataire: string, texte: string, options?: { citeId?: string }): Promise<string>;

  /**
   * Envoie un sondage WhatsApp (les bénévoles votent d'un appui).
   * @param question titre du sondage, ex. « BP – samedi 28/11 à 14:00 »
   * @param choix 2 à 12 choix, ex. ['dispo de 10h à 13h', 'dispo de 13h à 16h', 'pas dispo :/']
   * @param plusieursChoix true = on peut cocher plusieurs cases
   * @return l'ID du sondage (les votes y feront référence)
   */
  envoyerSondage(destinataire: string, question: string, choix: string[], plusieursChoix: boolean): Promise<string>;

  /** Les groupes dont le numéro du bot fait partie. */
  listerGroupes(): Promise<Groupe[]>;

  /** La session WhatsApp est-elle connectée ? (ne lève pas d'erreur : renvoie ok: false) */
  verifierConnexion(): Promise<EtatConnexion>;

  /**
   * Retrouve le vrai numéro derrière un identifiant masqué (le « LID » que WhatsApp donne
   * à la place du numéro, par exemple dans le canal d'annonces d'une communauté).
   * @param idBrut l'identifiant reçu (MessageRecu.idBrut, VoteRecu.idBrut)
   * @return le numéro E.164 sans « + », ou null si le fournisseur ne le connaît pas
   *         (ne lève pas d'erreur)
   */
  retrouverTelephone(idBrut: string): Promise<string | null>;
}

export interface Groupe {
  id: string;
  nom: string;
  /**
   * Facultatif (affiché par `npm run lister-groupes`) :
   *   - 'groupe'     : groupe classique (ou sous-groupe d'une communauté) ;
   *   - 'annonces'   : canal d'annonces d'une communauté → le GROUPE_ID à choisir pour une communauté ;
   *   - 'communaute' : la communauté elle-même → on ne peut PAS y publier.
   */
  genre?: 'groupe' | 'annonces' | 'communaute';
  /** Nom de la communauté dont ce groupe fait partie, s'il y en a une. */
  communaute?: string;
}

export interface EtatConnexion {
  ok: boolean;
  /** Numéro du bot (E.164 sans « + »), si connecté. */
  numero: string | null;
  /** Explication en cas de problème (« session déconnectée, rescanner le QR code »…). */
  detail?: string;
}

/**
 * Un vote dans un sondage, au format commun à tous les fournisseurs.
 * IMPORTANT : `choix` contient TOUS les choix actuellement cochés par la personne (pas seulement
 * le dernier clic) ; une liste vide = elle a retiré son vote (constaté au spike du 20/11/2026).
 */
export interface VoteRecu {
  /** ID unique de ce vote (sert à ignorer les doublons). */
  id: string;
  /** ID du sondage concerné (celui renvoyé par envoyerSondage). */
  sondageId: string;
  /** Conversation où se trouve le sondage (ID du groupe). */
  discussionId: string;
  /** Numéro de la personne qui vote, E.164 sans « + » ; null si WhatsApp le masque. */
  telephone: string | null;
  idBrut: string;
  nomWhatsApp: string;
  /** Libellés des choix cochés, ex. ['dispo de 10h à 13h', 'dispo de 13h à 16h'] ; [] = vote retiré. */
  choix: string[];
  date: Date;
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
