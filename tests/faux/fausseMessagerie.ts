/**
 * Fausse messagerie WhatsApp pour les tests.
 *
 * Elle respecte le contrat Messagerie, mais n'envoie rien : elle note les messages
 * « envoyés », et fabrique des messages « reçus » à la demande du test.
 *
 *   const annonce = messagerie.dernierEnvoi();             // l'annonce publiée par le bot
 *   const reponse = messagerie.recu({                      // Bob répond OUI en la citant
 *     de: BOB, nom: 'Bob', texte: 'oui', groupe: GROUPE_TEST, cite: annonce.id,
 *   });
 *   await traiterMessage(reponse);                          // le bot traite la réponse
 */
import type { EtatConnexion, Groupe, MessageRecu, Messagerie, VoteRecu } from '../../src/ports/messagerie.ts';
import type { Horloge } from '../../src/ports/horloge.ts';

/** ID du groupe WhatsApp de test. */
export const GROUPE_TEST = 'groupe-test';
/** Numéro du bot dans les tests. */
export const NUMERO_BOT = '33700000000';

/** Un message envoyé par le bot, tel que noté par la fausse messagerie. */
export interface MessageEnvoye {
  id: string;
  destinataire: string;
  /** Le texte du message, ou la question du sondage. */
  texte: string;
  citeId: string | null;
  date: Date;
  /** Présent seulement si c'est un sondage. */
  sondage?: { choix: string[]; plusieursChoix: boolean };
}

/** Ce qu'il faut pour fabriquer un message reçu. */
export interface DescriptionMessageRecu {
  /** Numéro de l'expéditeur, ex. '33612345678'. null pour simuler un LID (numéro masqué). */
  de: string | null;
  texte: string;
  /** ID du groupe ; absent = message privé. */
  groupe?: string;
  /** ID du message cité. */
  cite?: string;
  /** Nom WhatsApp de l'expéditeur. */
  nom?: string;
  /** Pour simuler un doublon : réutiliser l'ID d'un message déjà reçu. */
  id?: string;
  /** Identifiant masqué (LID) de l'expéditeur, ex. 'lid-bob' (sinon : le numéro). */
  lid?: string;
}

/** Ce qu'il faut pour fabriquer un vote. */
export interface DescriptionVote {
  /** Numéro de la personne qui vote ; null pour simuler un numéro masqué. */
  de: string | null;
  /** ID du sondage (celui renvoyé par envoyerSondage). */
  sondage: string;
  /** Tous les choix cochés après ce vote ; [] = vote retiré. */
  choix: string[];
  nom?: string;
  groupe?: string;
  id?: string;
  /** Identifiant masqué (LID) de la personne, ex. 'lid-bob'. */
  lid?: string;
}

export class FausseMessagerie implements Messagerie {
  /** Tous les messages envoyés par le bot, dans l'ordre. */
  readonly envoyes: MessageEnvoye[] = [];
  /** Les groupes que listerGroupes renvoie (modifiable par le test). */
  groupes: Groupe[] = [{ id: GROUPE_TEST, nom: 'Bénévoles (test)' }];

  private readonly horloge: Horloge;
  private compteur = 0;
  private connectee = true;
  private readonly destinatairesEnEchec = new Set<string>();
  /** true = les envois de SONDAGES échouent (les textes passent) : pour tester un envoi à moitié réussi. */
  sondagesEnEchec = false;

  constructor(horloge: Horloge) {
    this.horloge = horloge;
  }

  // ----- Le contrat Messagerie (ce que le bot utilise) -----

  async envoyerTexte(destinataire: string, texte: string, options: { citeId?: string } = {}): Promise<string> {
    if (!this.connectee) throw new Error('WhatsApp déconnecté');
    if (this.destinatairesEnEchec.has(destinataire)) throw new Error(`Envoi impossible vers ${destinataire}`);
    const id = `envoye-${++this.compteur}`;
    this.envoyes.push({ id, destinataire, texte, citeId: options.citeId ?? null, date: this.horloge.maintenant() });
    return id;
  }

  async envoyerSondage(destinataire: string, question: string, choix: string[], plusieursChoix: boolean): Promise<string> {
    if (!this.connectee) throw new Error('WhatsApp déconnecté');
    if (this.destinatairesEnEchec.has(destinataire)) throw new Error(`Envoi impossible vers ${destinataire}`);
    if (this.sondagesEnEchec) throw new Error('Envoi du sondage impossible (simulation de test)');
    const id = `sondage-${++this.compteur}`;
    this.envoyes.push({
      id, destinataire, texte: question, citeId: null, date: this.horloge.maintenant(), sondage: { choix: [...choix], plusieursChoix },
    });
    return id;
  }

  async listerGroupes(): Promise<Groupe[]> {
    return this.groupes.map((groupe) => ({ ...groupe }));
  }

  async verifierConnexion(): Promise<EtatConnexion> {
    return this.connectee
      ? { ok: true, numero: NUMERO_BOT }
      : { ok: false, numero: null, detail: 'Session déconnectée (simulation de test)' };
  }

  /** Annuaire « identifiant masqué → numéro » (comme celui de WAHA), rempli par le test. */
  readonly annuaire = new Map<string, string>();

  async retrouverTelephone(idBrut: string): Promise<string | null> {
    return this.annuaire.get(idBrut) ?? null;
  }

  // ----- Commandes pour les tests -----

  /** Fabrique un message reçu par le bot (à passer ensuite au code qui traite les messages). */
  recu({ de, texte, groupe, cite, nom = '', id, lid }: DescriptionMessageRecu): MessageRecu {
    const idBrut = lid ?? de ?? `lid-${++this.compteur}`;
    return {
      id: id ?? `recu-${++this.compteur}`,
      discussionId: groupe ?? idBrut,
      estGroupe: groupe !== undefined,
      telephone: de,
      idBrut,
      nomWhatsApp: nom,
      texte,
      citeId: cite ?? null,
      date: this.horloge.maintenant(),
    };
  }

  /**
   * Fabrique un vote dans un sondage (à passer ensuite à recevoirVote).
   * `choix` = TOUS les choix cochés après ce vote (comme WhatsApp) ; [] = vote retiré.
   */
  vote({ de, sondage, choix, nom = '', groupe = GROUPE_TEST, id, lid }: DescriptionVote): VoteRecu {
    const idBrut = lid ?? de ?? `lid-${++this.compteur}`;
    return {
      id: id ?? `vote-${++this.compteur}`,
      sondageId: sondage,
      discussionId: groupe,
      telephone: de,
      idBrut,
      nomWhatsApp: nom,
      choix: [...choix],
      date: this.horloge.maintenant(),
    };
  }

  /** Messages envoyés à un destinataire (numéro ou ID de groupe). */
  envoyesA(destinataire: string): MessageEnvoye[] {
    return this.envoyes.filter((message) => message.destinataire === destinataire);
  }

  /** Les sondages envoyés (dans l'ordre). */
  sondages(): MessageEnvoye[] {
    return this.envoyes.filter((message) => message.sondage !== undefined);
  }

  /** Les messages envoyés qui ne sont PAS des sondages. */
  textes(): MessageEnvoye[] {
    return this.envoyes.filter((message) => message.sondage === undefined);
  }

  /** Le dernier message envoyé (erreur claire s'il n'y en a aucun). */
  dernierEnvoi(): MessageEnvoye {
    const dernier = this.envoyes.at(-1);
    if (!dernier) throw new Error("FausseMessagerie : le bot n'a encore rien envoyé");
    return dernier;
  }

  /** Les prochains envois vers ce destinataire échoueront (pour tester « Non joignable »). */
  faireEchouerEnvoisVers(destinataire: string): void {
    this.destinatairesEnEchec.add(destinataire);
  }

  /** Simule une session WhatsApp perdue (téléphone éteint, QR code à rescanner…). */
  deconnecter(): void {
    this.connectee = false;
  }

  reconnecter(): void {
    this.connectee = true;
  }
}
