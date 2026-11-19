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
  MESSAGES, PAUSE_ENTRE_MESSAGES_MS, REPONSE, STATUT_ACTION, STATUT_INSCRIPTION, type Reponse, type StatutInscription,
} from '../constantes.ts';
import type { MessageRecu } from '../ports/messagerie.ts';
import { lireActions, type Action } from '../sheets/actions.ts';
import {
  ajouterBenevole, lireBenevoles, modifierBenevole, nomPourListe, type Benevole,
} from '../sheets/benevoles.ts';
import { ajouterInscription, lireInscriptions, modifierInscriptions, type Inscription } from '../sheets/inscriptions.ts';
import { cleDate, dateLongue, horodatage } from '../utils/dates.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { detecterReponse, lireNomComplet, normaliserPourDetection, remplirModele } from '../utils/textes.ts';
import { lireParametres } from '../sheets/parametres.ts';
import { demanderConfirmationMaintenant, traiterReponseConfirmation } from './confirmations.ts';
import type { Contexte } from './contexte.ts';
import { traiterDesistementTardif } from './desistement.ts';

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
  const reponse = detecterReponse(message.texte);
  if (reponse === null) return; // ni OUI ni NON (« peut-être », question…)
  if (message.citeId === null) {
    await traiterOuiSansCitation(ctx, message, reponse);
    return;
  }

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

/** Nombre maximum de mots d'un « OUI » sans citation (au-delà, c'est sûrement une conversation). */
const MOTS_MAX_SANS_CITATION = 3;

/**
 * « oui » écrit dans le groupe SANS citer d'annonce (compromis du 19/11/2026, CLAUDE.md 7b).
 * Accepté seulement si le message est court et qu'une SEULE action est ouverte ; sinon on
 * explique en privé comment faire. Un NON sans citation est ignoré (trop ambigu).
 */
async function traiterOuiSansCitation(ctx: Contexte, message: MessageRecu, reponse: Reponse): Promise<void> {
  if (reponse !== REPONSE.OUI) return;
  const mots = normaliserPourDetection(message.texte).split(' ').filter((mot) => mot !== '');
  if (mots.length > MOTS_MAX_SANS_CITATION) return; // « oui je suis d'accord avec toi… » : une conversation

  const aujourdhui = cleDate(ctx.horloge.maintenant());
  const { actions } = await lireActions(ctx.tableur);
  const ouvertes = actions.filter((a) =>
    (a.statut === STATUT_ACTION.ANNONCEE || a.statut === STATUT_ACTION.CONFIRMATIONS_ENVOYEES) && a.date >= aujourdhui);
  if (ouvertes.length === 0) return; // aucune action en cours : ce « oui » ne concerne pas le bot

  if (message.telephone === null) {
    ctx.logger.avertissement(`${message.nomWhatsApp || 'Un bénévole'} a répondu OUI sans citer d'annonce, mais WhatsApp masque son numéro : à inscrire à la main`);
    return;
  }
  if (ouvertes.length > 1) {
    // Impossible de savoir pour quelle action : on explique en privé (pas dans le groupe).
    await envoyerSansPlanter(ctx, message.telephone, MESSAGES.CITER_ANNONCE);
    ctx.logger.info(`${message.nomWhatsApp} a répondu OUI sans citer, avec ${ouvertes.length} actions ouvertes : explication envoyée en privé`);
    return;
  }
  await inscrire(ctx, ouvertes[0], message.telephone, message.nomWhatsApp, { sansCitation: true });
}

/**
 * Réponse OUI : crée l'inscription (ou réactive celle d'un « NON » précédent).
 * @param options.sansCitation la personne n'a pas cité l'annonce : on lui confirme en privé
 *   pour quelle action elle est inscrite (elle peut répondre NON si ce n'était pas ça).
 */
async function inscrire(
  ctx: Contexte, action: Action, telephone: string, nomWhatsApp: string, options: { sansCitation?: boolean } = {},
): Promise<void> {
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

  // OUI sans citation : on confirme en privé pour quelle action (sauf si la demande de
  // confirmation part juste après : elle le dit déjà).
  if (options.sansCitation && action.statut === STATUT_ACTION.ANNONCEE) {
    await envoyerSansPlanter(ctx, telephone, remplirModele(MESSAGES.INSCRIPTION_SANS_CITATION, {
      type: action.type, date: dateLongue(action.date), heure: action.heure, lieu: action.lieu,
    }));
    await ctx.horloge.attendre(PAUSE_ENTRE_MESSAGES_MS);
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
    let traite = await traiterReponseConfirmation(ctx, message, reponse);
    // Pas de demande ouverte : peut-être un NON après la publication de la liste (§4.6)…
    if (!traite && reponse === REPONSE.NON) traite = await traiterDesistementTardif(ctx, message);
    // … ou un NON pour annuler une inscription faite avant les confirmations (ex. OUI sans citation).
    if (!traite && reponse === REPONSE.NON) await retirerEnPrive(ctx, message.telephone);
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

/**
 * NON en privé d'une personne encore « Inscrit » (avant les demandes de confirmation) :
 * on la retire. Une seule inscription concernée → retirée ; plusieurs → on explique.
 */
async function retirerEnPrive(ctx: Contexte, telephone: string): Promise<void> {
  const aujourdhui = cleDate(ctx.horloge.maintenant());
  const { actions } = await lireActions(ctx.tableur);
  const annoncees = new Map(actions
    .filter((a) => a.statut === STATUT_ACTION.ANNONCEE && a.date >= aujourdhui)
    .map((a) => [a.id, a]));
  if (annoncees.size === 0) return;
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const concernees = inscriptions.filter((i) =>
    i.telephone === telephone && annoncees.has(i.actionId) && i.statut === STATUT_INSCRIPTION.INSCRIT);
  if (concernees.length === 0) return;

  if (concernees.length > 1) {
    await envoyerSansPlanter(ctx, telephone, MESSAGES.CITER_POUR_RETIRER);
    return;
  }
  const [inscription] = concernees;
  await modifierInscriptions(ctx.tableur, [{ inscription, changements: { statut: STATUT_INSCRIPTION.RETIRE } }], ctx.horloge.maintenant());
  ctx.logger.info(`Retiré (NON en privé) : ${inscription.nom} pour ${annoncees.get(inscription.actionId)?.type} du ${dateLongue(inscription.date)}`);
  await envoyerSansPlanter(ctx, telephone, MESSAGES.ACCUSE_RECEPTION);
}

async function envoyerSansPlanter(ctx: Contexte, destinataire: string, texte: string): Promise<void> {
  try {
    await ctx.messagerie.envoyerTexte(destinataire, texte);
  } catch (erreur) {
    ctx.logger.avertissement(`Message non envoyé à ${formaterTelephone(destinataire)} : ${String(erreur)}`);
  }
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
