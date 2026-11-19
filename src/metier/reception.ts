/**
 * metier/reception.ts — Ce que fait le bot quand il reçoit un message WhatsApp.
 *
 * Point d'entrée : recevoirMessage(), appelé par le webhook WAHA (étape 5) pour CHAQUE
 * message reçu. La plupart des messages du groupe ne concernent pas le bot : ils sont
 * ignorés sans même lire le Sheet.
 *
 * Messages traités (CLAUDE.md §4.3) :
 *   - dans le groupe, une réponse OUI / NON qui CITE une annonce → inscription ;
 *   - en privé, OUI / NON à une demande de confirmation → voir confirmations.ts ;
 *   - en privé, la réponse à la demande « prénom et nom » → fiche du bénévole.
 */
import {
  MESSAGES, PAUSE_ENTRE_MESSAGES_MS, REPONSE, STATUT_ACTION, STATUT_INSCRIPTION, type StatutInscription,
} from '../constantes.ts';
import type { MessageRecu } from '../ports/messagerie.ts';
import { lireActions, type Action } from '../sheets/actions.ts';
import {
  ajouterBenevole, lireBenevoles, modifierBenevole, nomPourListe, type Benevole,
} from '../sheets/benevoles.ts';
import { ajouterInscription, lireInscriptions, modifierInscriptions, type Inscription } from '../sheets/inscriptions.ts';
import { dateLongue, horodatage } from '../utils/dates.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { detecterReponse, lireNomComplet, remplirModele } from '../utils/textes.ts';
import { lireParametres } from '../sheets/parametres.ts';
import { demanderConfirmationMaintenant, traiterReponseConfirmation } from './confirmations.ts';
import type { Contexte } from './contexte.ts';

/** Statuts d'une inscription « active » (la personne compte venir). */
const STATUTS_ACTIFS: StatutInscription[] = [STATUT_INSCRIPTION.INSCRIT, STATUT_INSCRIPTION.EN_ATTENTE, STATUT_INSCRIPTION.CONFIRME];

/**
 * Traite un message reçu. Ne lève jamais d'erreur : un problème est noté dans le Journal
 * (un message mal traité ne doit pas bloquer les suivants).
 */
export async function recevoirMessage(ctx: Contexte, message: MessageRecu): Promise<void> {
  if (ctx.memoireMessages.dejaVu(message.id)) {
    ctx.logger.debug(`Message ${message.id} déjà traité : ignoré`);
    return;
  }
  ctx.memoireMessages.noter(message.id);

  // Chacun son tour avec le tick : jamais deux écritures simultanées dans le Sheet.
  await ctx.file.executer(async () => {
    try {
      if (message.estGroupe) await traiterMessageDeGroupe(ctx, message);
      else await traiterMessagePrive(ctx, message);
    } catch (erreur) {
      ctx.logger.erreur(`Message de ${message.nomWhatsApp || message.idBrut} non traité`, erreur);
    }
  });
}

// ===========================================================================
// Messages du groupe : réponses aux annonces
// ===========================================================================

async function traiterMessageDeGroupe(ctx: Contexte, message: MessageRecu): Promise<void> {
  // Filtres rapides, sans lire le Sheet : la plupart des messages du groupe s'arrêtent ici.
  if (message.discussionId !== ctx.groupeId) return; // un autre groupe
  if (message.citeId === null) return; // ne cite aucun message
  const reponse = detecterReponse(message.texte);
  if (reponse === null) return; // ni OUI ni NON (« peut-être », question…)

  const { actions } = await lireActions(ctx.tableur);
  const action = actions.find((a) => a.messageId !== '' && a.messageId === message.citeId);
  if (!action) return; // cite un message qui n'est pas une annonce

  if (action.statut !== STATUT_ACTION.ANNONCEE && action.statut !== STATUT_ACTION.CONFIRMATIONS_ENVOYEES) {
    ctx.logger.info(`Réponse de ${message.nomWhatsApp} ignorée : ${action.type} du ${dateLongue(action.date)} est « ${action.statut} »`);
    return;
  }

  if (message.telephone === null) {
    // Numéro masqué par WhatsApp (LID) : impossible de savoir qui c'est (voir CLAUDE.md §6).
    ctx.logger.avertissement(
      `${message.nomWhatsApp || 'Un bénévole'} a répondu ${reponse} pour ${action.type} du ${dateLongue(action.date)}, ` +
      'mais WhatsApp masque son numéro : à inscrire à la main',
    );
    return;
  }

  if (reponse === REPONSE.OUI) await inscrire(ctx, action, message.telephone, message.nomWhatsApp);
  else await desinscrire(ctx, action, message.telephone, message.nomWhatsApp);
}

/** Réponse OUI : crée l'inscription (ou réactive celle d'un « NON » précédent). */
async function inscrire(ctx: Contexte, action: Action, telephone: string, nomWhatsApp: string): Promise<void> {
  const maintenant = ctx.horloge.maintenant();
  const benevole = await trouverOuCreerBenevole(ctx, telephone, nomWhatsApp);
  const nom = nomPourListe({ prenom: benevole.prenom, nom: benevole.nom, nomWhatsApp: benevole.nomWhatsApp || nomWhatsApp, telephone });
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const existante = inscriptions.find((i) => i.actionId === action.id && i.telephone === telephone);
  const description = `${nom} pour ${action.type} du ${dateLongue(action.date)}`;

  if (existante && STATUTS_ACTIFS.includes(existante.statut)) {
    ctx.logger.debug(`${description} : déjà inscrit(e), rien à faire`);
    await demanderLeNomSiBesoin(ctx, benevole);
    return;
  }
  if (existante) {
    // Avait dit NON (ou s'était désisté) et redit OUI : on réactive la même ligne.
    // L'ancienne demande de confirmation est effacée : une nouvelle sera envoyée si besoin.
    await modifierInscriptions(ctx.tableur, [{
      inscription: existante, changements: { statut: STATUT_INSCRIPTION.INSCRIT, nom, demandeId: '' },
    }], maintenant);
    ctx.logger.info(`Réinscription : ${description}`);
  } else {
    await ajouterInscription(ctx.tableur, {
      actionId: action.id, type: action.type, date: action.date, heure: action.heure, lieu: action.lieu,
      telephone, nom, statut: STATUT_INSCRIPTION.INSCRIT,
    }, inscriptions, maintenant);
    ctx.logger.info(`Inscription : ${description}`);
  }

  // Inscrit APRÈS l'envoi des demandes de confirmation : on lui envoie la sienne tout de suite (§4.3).
  if (action.statut === STATUT_ACTION.CONFIRMATIONS_ENVOYEES) {
    const { parametres } = await lireParametres(ctx.tableur);
    const inscription = (await lireInscriptions(ctx.tableur)).inscriptions
      .find((i) => i.actionId === action.id && i.telephone === telephone);
    if (inscription) {
      await demanderConfirmationMaintenant(ctx, action, inscription, benevole, parametres);
      await ctx.horloge.attendre(PAUSE_ENTRE_MESSAGES_MS); // avant l'éventuelle demande de nom
    }
  }

  await demanderLeNomSiBesoin(ctx, benevole);
}

/** Réponse NON : retire l'inscription active (s'il n'y en a pas, il n'y a rien à faire). */
async function desinscrire(ctx: Contexte, action: Action, telephone: string, nomWhatsApp: string): Promise<void> {
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const existante = inscriptions.find((i) => i.actionId === action.id && i.telephone === telephone);
  if (!existante || !STATUTS_ACTIFS.includes(existante.statut)) return;

  // Avant la demande de confirmation : « Retiré ». Après : c'est un désistement.
  const statut = existante.statut === STATUT_INSCRIPTION.INSCRIT ? STATUT_INSCRIPTION.RETIRE : STATUT_INSCRIPTION.DESISTE;
  await modifierInscriptions(ctx.tableur, [{ inscription: existante, changements: { statut } }], ctx.horloge.maintenant());
  ctx.logger.info(`${statut} : ${existante.nom || nomWhatsApp} pour ${action.type} du ${dateLongue(action.date)}`);
}

/** Le bénévole de ce numéro, créé dans l'onglet Bénévoles s'il n'existe pas encore. */
async function trouverOuCreerBenevole(ctx: Contexte, telephone: string, nomWhatsApp: string): Promise<Benevole> {
  const { parTelephone } = await lireBenevoles(ctx.tableur);
  const connu = parTelephone.get(telephone);
  if (connu) return connu;

  await ajouterBenevole(ctx.tableur, { telephone, nomWhatsApp }, ctx.horloge.maintenant());
  ctx.logger.info(`Nouveau bénévole : ${nomWhatsApp || formaterTelephone(telephone)}`);
  const apresAjout = (await lireBenevoles(ctx.tableur)).parTelephone.get(telephone);
  if (!apresAjout) throw new Error(`Bénévole ${formaterTelephone(telephone)} introuvable juste après son ajout`);
  return apresAjout;
}

/** Envoie UNE SEULE FOIS la demande « prénom et nom » à un bénévole qui n'a pas de nom. */
async function demanderLeNomSiBesoin(ctx: Contexte, benevole: Benevole): Promise<void> {
  const aUnNom = benevole.prenom !== '' || benevole.nom !== '';
  if (aUnNom || benevole.nomDemandeLe !== '') return;

  try {
    await ctx.messagerie.envoyerTexte(benevole.telephone, MESSAGES.DEMANDE_NOM);
  } catch (erreur) {
    // Pas grave : on redemandera à sa prochaine réponse OUI.
    ctx.logger.avertissement(`Demande de nom non envoyée à ${formaterTelephone(benevole.telephone)} : ${String(erreur)}`);
    return;
  }
  await modifierBenevole(ctx.tableur, benevole, { nomDemandeLe: horodatage(ctx.horloge.maintenant()) });
}

// ===========================================================================
// Messages privés
// ===========================================================================

async function traiterMessagePrive(ctx: Contexte, message: MessageRecu): Promise<void> {
  if (message.telephone === null) return;

  // OUI / NON : réponse à une demande de confirmation (et jamais un nom).
  const reponse = detecterReponse(message.texte);
  if (reponse !== null) {
    await traiterReponseConfirmation(ctx, message, reponse);
    return;
  }

  // Sinon : peut-être la réponse à la demande de nom ?
  const { parTelephone } = await lireBenevoles(ctx.tableur);
  const benevole = parTelephone.get(message.telephone);
  const attenduUnNom = benevole && benevole.nomDemandeLe !== '' && benevole.prenom === '' && benevole.nom === '';
  if (!benevole || !attenduUnNom) return; // message privé qui ne concerne pas le bot

  const nomComplet = lireNomComplet(message.texte);
  if (nomComplet === null) {
    ctx.logger.info(
      `Message privé de ${benevole.nomWhatsApp || formaterTelephone(benevole.telephone)} non compris comme un nom : ` +
      `« ${message.texte} » (à traiter à la main si besoin)`,
    );
    return;
  }
  await enregistrerNom(ctx, benevole, nomComplet);
}

/** Enregistre prénom et nom, les recopie dans les inscriptions, et remercie. */
async function enregistrerNom(ctx: Contexte, benevole: Benevole, { prenom, nom }: { prenom: string; nom: string }): Promise<void> {
  const maintenant = ctx.horloge.maintenant();
  await modifierBenevole(ctx.tableur, benevole, { prenom, nom });
  const nomListe = nomPourListe(benevole);

  // Les inscriptions gardent une copie du nom (pour les vues Présents / Absents) : on la met à jour.
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const aMettreAJour = inscriptions.filter((i: Inscription) => i.telephone === benevole.telephone && i.nom !== nomListe);
  await modifierInscriptions(ctx.tableur, aMettreAJour.map((inscription) => ({ inscription, changements: { nom: nomListe } })), maintenant);

  ctx.logger.info(`Nom enregistré : ${nomListe} (${formaterTelephone(benevole.telephone)})`);
  try {
    await ctx.messagerie.envoyerTexte(benevole.telephone, remplirModele(MESSAGES.MERCI_NOM, { prenom }));
  } catch (erreur) {
    ctx.logger.avertissement(`Remerciement non envoyé à ${nomListe} : ${String(erreur)}`);
  }
}
