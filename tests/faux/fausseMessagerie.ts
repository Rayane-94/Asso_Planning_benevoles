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
import type { EtatConnexion, Groupe, MessageRecu, Messagerie } from '../../src/ports/messagerie.ts';
import type { Horloge } from '../../src/ports/horloge.ts';

/** ID du groupe WhatsApp de test. */
export const GROUPE_TEST = 'groupe-test';
/** Numéro du bot dans les tests. */
export const NUMERO_BOT = '33700000000';

/** Un message envoyé par le bot, tel que noté par la fausse messagerie. */
export interface MessageEnvoye {
  id: string;
  destinataire: string;
  texte: string;
  citeId: string | null;
  date: Date;
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

  async listerGroupes(): Promise<Groupe[]> {
    return this.groupes.map((groupe) => ({ ...groupe }));
  }

  async verifierConnexion(): Promise<EtatConnexion> {
    return this.connectee
      ? { ok: true, numero: NUMERO_BOT }
      : { ok: false, numero: null, detail: 'Session déconnectée (simulation de test)' };
  }

  // ----- Commandes pour les tests -----

  /** Fabrique un message reçu par le bot (à passer ensuite au code qui traite les messages). */
  recu({ de, texte, groupe, cite, nom = '', id }: DescriptionMessageRecu): MessageRecu {
    const idBrut = de ?? `lid-${++this.compteur}`;
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

  /** Messages envoyés à un destinataire (numéro ou ID de groupe). */
  envoyesA(destinataire: string): MessageEnvoye[] {
    return this.envoyes.filter((message) => message.destinataire === destinataire);
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
