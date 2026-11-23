/**
 * metier/votes.ts — Ce que fait le bot quand quelqu'un vote dans le sondage d'une annonce.
 *
 * Point d'entrée : recevoirVote(), appelé par le webhook WAHA à CHAQUE vote (y compris un
 * changement d'avis ou un vote retiré). Chaque vote contient TOUS les choix actuellement
 * cochés par la personne, donc il suffit de regarder « ce qui est coché maintenant » :
 *   - un ou plusieurs créneaux (ou « dispo ») → inscrit(e), avec ces créneaux ;
 *   - « pas dispo », ou plus rien de coché     → retiré(e) (désisté(e) si déjà en confirmation).
 *
 * Deux sortes de sondages :
 *   - le sondage de l'ANNONCE, dans le groupe (ci-dessus) ;
 *   - le sondage de CONFIRMATION, en privé à J-2 (« Oui, je serai là » / « Non, je ne peux plus »).
 */
import { MESSAGES, REPONSE, STATUT_ACTION, STATUT_INSCRIPTION } from '../constantes.ts';
import type { VoteRecu } from '../ports/messagerie.ts';
import { lireActions, type Action } from '../sheets/actions.ts';
import { ajouterBenevole, lireBenevoles } from '../sheets/benevoles.ts';
import { lireInscriptions } from '../sheets/inscriptions.ts';
import { lireParametres, type Parametres } from '../sheets/parametres.ts';
import { cleDate, dateLongue, horodatage } from '../utils/dates.ts';
import { appliquerReponse, estDemandeOuverte } from './confirmations.ts';
import type { Contexte } from './contexte.ts';
import { enregistrerDesistementTardif } from './desistement.ts';
import { desinscrire, inscrire } from './inscription.ts';

/**
 * Traite un vote. Ne lève jamais d'erreur : un problème est noté dans le Journal
 * (un vote mal traité ne doit pas bloquer les suivants).
 */
export async function recevoirVote(ctx: Contexte, vote: VoteRecu): Promise<void> {
  if (ctx.memoireMessages.dejaVu(vote.id)) {
    ctx.logger.debug(`Vote ${vote.id} déjà traité : ignoré`);
    return;
  }
  ctx.memoireMessages.noter(vote.id);

  // Chacun son tour avec le tick et les messages : jamais deux écritures simultanées dans le Sheet.
  await ctx.file.executer(async () => {
    try {
      await traiterVote(ctx, vote);
    } catch (erreur) {
      ctx.logger.erreur(`Vote de ${vote.nomWhatsApp || vote.idBrut} non traité`, erreur);
    }
  });
}

async function traiterVote(ctx: Contexte, vote: VoteRecu): Promise<void> {
  // Pas dans le groupe : c'est peut-être un vote dans un sondage de confirmation (en privé)
  if (vote.discussionId !== ctx.groupeId) {
    await traiterVoteConfirmation(ctx, vote);
    return;
  }

  const { actions } = await lireActions(ctx.tableur);
  const action = actions.find((a) => a.messageId !== '' && a.messageId === vote.sondageId);
  if (!action) return; // ce sondage n'est pas celui d'une annonce du bot

  if (action.statut !== STATUT_ACTION.ANNONCEE && action.statut !== STATUT_ACTION.CONFIRMATIONS_ENVOYEES) {
    ctx.logger.info(
      `Vote de ${vote.nomWhatsApp} ignoré : ${action.type} du ${dateLongue(action.date)} est « ${action.statut} » ` +
      '(après la liste finale, les changements se font avec le référent)',
    );
    return;
  }
  // Numéro masqué (canal d'annonces d'une communauté) : on demande d'abord à l'annuaire du
  // fournisseur (A) ; s'il ne le connaît pas, le vote attend la réponse en privé (B).
  const telephone = vote.telephone ?? await ctx.messagerie.retrouverTelephone(vote.idBrut);
  if (telephone === null) {
    await mettreEnAttente(ctx, vote, action);
    return;
  }
  if (estPlusAncienQueLeDernier(ctx, vote)) {
    ctx.logger.debug(`Vote de ${vote.nomWhatsApp} plus ancien que le dernier reçu : ignoré`);
    return;
  }

  const { parametres } = await lireParametres(ctx.tableur);
  const creneaux = creneauxChoisis(action, vote.choix, parametres);
  if (creneaux === null) await desinscrire(ctx, action, telephone, vote.nomWhatsApp);
  else await inscrire(ctx, action, telephone, vote.nomWhatsApp, creneaux.join(', '));
}

// ===========================================================================
// Votes « en attente » : WhatsApp cache le numéro (S9, test en communauté du 23/11/2026)
// ===========================================================================
//
// Dans le canal d'annonces d'une communauté, WhatsApp ne donne qu'un identifiant masqué
// (LID). Si l'annuaire du fournisseur ne connaît pas le numéro, le bot :
//   1. garde le vote de côté (état local, clé « votes-en-attente:<LID> ») ;
//   2. écrit en privé à cet identifiant : « peux-tu me donner ton prénom et ton nom ? » ;
//   3. quand la personne répond en privé, WhatsApp donne son vrai numéro : reception.ts
//      appelle rejouerVotesEnAttente(), qui crée le bénévole et rejoue ses votes.

/** Un vote mis de côté (la date est gardée en texte dans l'état local). */
type VoteEnAttente = Omit<VoteRecu, 'date' | 'telephone'> & { date: string };

const cleEnAttente = (idBrut: string) => `votes-en-attente:${idBrut}`;
const cleNomDemande = (idBrut: string) => `nom-demande-masque:${idBrut}`;

function lireEnAttente(ctx: Contexte, idBrut: string): Record<string, VoteEnAttente> {
  try {
    return JSON.parse(ctx.etat.lire(cleEnAttente(idBrut)) ?? '{}');
  } catch {
    return {};
  }
}

async function mettreEnAttente(ctx: Contexte, vote: VoteRecu, action: Action): Promise<void> {
  const qui = vote.nomWhatsApp || 'Un bénévole';
  const pour = `${action.type} du ${dateLongue(action.date)}`;

  // Un seul vote gardé par sondage : le plus récent (chaque vote = l'état complet des choix)
  const enAttente = lireEnAttente(ctx, vote.idBrut);
  const precedent = enAttente[vote.sondageId];
  if (precedent && new Date(precedent.date) > vote.date) return; // vote plus ancien arrivé en retard
  const { telephone: _telephone, ...reste } = vote;
  enAttente[vote.sondageId] = { ...reste, date: vote.date.toISOString() };
  ctx.etat.ecrire(cleEnAttente(vote.idBrut), JSON.stringify(enAttente));

  if (ctx.etat.lire(cleNomDemande(vote.idBrut)) !== null) {
    ctx.logger.info(`${qui} a modifié son vote pour ${pour} : toujours en attente de sa réponse en privé (numéro masqué par WhatsApp)`);
    return;
  }
  try {
    await ctx.messagerie.envoyerTexte(vote.idBrut, MESSAGES.DEMANDE_NOM);
    ctx.etat.ecrire(cleNomDemande(vote.idBrut), horodatage(ctx.horloge.maintenant()));
    ctx.logger.info(
      `${qui} a voté pour ${pour}, mais WhatsApp masque son numéro : nom demandé en privé, ` +
      'inscription dès sa réponse',
    );
  } catch (erreur) {
    ctx.logger.avertissement(
      `${qui} a voté pour ${pour}, mais WhatsApp masque son numéro et le message privé n'a pas pu partir ` +
      `(identifiant ${vote.idBrut}) : à inscrire à la main. ${String(erreur)}`,
    );
  }
}

/**
 * Une personne au numéro masqué vient d'écrire en privé, et on connaît maintenant son numéro :
 * on crée sa fiche (nom déjà demandé : on ne redemande pas) puis on rejoue ses votes en attente.
 * À appeler DANS la file d'attente (reception.ts le fait).
 */
export async function rejouerVotesEnAttente(ctx: Contexte, idBrut: string, telephone: string, nomWhatsApp: string): Promise<void> {
  const enAttente = Object.values(lireEnAttente(ctx, idBrut));
  if (enAttente.length === 0) return;
  ctx.etat.ecrire(cleEnAttente(idBrut), null);

  const { parTelephone } = await lireBenevoles(ctx.tableur);
  if (!parTelephone.has(telephone)) {
    await ajouterBenevole(ctx.tableur, { telephone, nomWhatsApp, nomDejaDemande: true }, ctx.horloge.maintenant());
  }
  ctx.logger.info(`Numéro de ${nomWhatsApp || idBrut} retrouvé grâce à sa réponse en privé : ${enAttente.length} vote(s) enregistré(s)`);
  for (const vote of enAttente) {
    await traiterVote(ctx, { ...vote, telephone, date: new Date(vote.date) });
  }
}

/**
 * Vote dans un sondage de CONFIRMATION (J-2, en privé) : « ✅ Oui, je serai là » / « ❌ Non, je ne peux plus ».
 * Le sondage est retrouvé par son ID, gardé dans la colonne « Demande ID » de l'inscription :
 * on sait donc à quelle action il répond, même si la personne a plusieurs demandes, et même
 * si WhatsApp masque son numéro.
 *   - avant la liste finale : Oui → Confirmé, Non → Désisté (changement d'avis possible) ;
 *   - après la liste : Non d'un confirmé → désistement de dernière minute (le référent est
 *     prévenu) ; Oui → rien (les changements se font avec le référent) ;
 *   - vote retiré (plus rien de coché) : rien ne change.
 */
async function traiterVoteConfirmation(ctx: Contexte, vote: VoteRecu): Promise<void> {
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const cible = inscriptions.find((i) => i.demandeId !== '' && i.demandeId === vote.sondageId);
  if (!cible) return; // sondage inconnu (autre groupe, ancienne demande remplacée…)
  if (estPlusAncienQueLeDernier(ctx, vote)) return;

  const { parametres } = await lireParametres(ctx.tableur);
  const reponse = vote.choix.includes(parametres.options.confirmerOui) ? REPONSE.OUI
    : vote.choix.includes(parametres.options.confirmerNon) ? REPONSE.NON
      : null;
  if (reponse === null) {
    ctx.logger.info(`${cible.nom} a retiré son vote de confirmation pour ${cible.type} du ${dateLongue(cible.date)} : statut inchangé (${cible.statut})`);
    return;
  }

  const { actions } = await lireActions(ctx.tableur);
  const action = actions.find((a) => a.id === cible.actionId);
  if (!action) return;

  if (action.statut === STATUT_ACTION.CONFIRMATIONS_ENVOYEES && estDemandeOuverte(cible)) {
    await appliquerReponse(ctx, cible, reponse, { accuserMemeSansChangement: false });
    return;
  }
  const pasEncorePassee = action.date >= cleDate(ctx.horloge.maintenant());
  if (action.statut === STATUT_ACTION.LISTE_PUBLIEE && pasEncorePassee && reponse === REPONSE.NON && cible.statut === STATUT_INSCRIPTION.CONFIRME) {
    await enregistrerDesistementTardif(ctx, cible, action);
    return;
  }
  ctx.logger.info(
    `Vote de confirmation de ${cible.nom} (${reponse}) ignoré : ${action.type} du ${dateLongue(action.date)} est « ${action.statut} », ` +
    `inscription « ${cible.statut} » (les changements se font avec le référent)`,
  );
}

/**
 * Ce que la personne a coché, traduit pour l'inscription (exportée pour les tests).
 * @return null = ne vient pas (« pas dispo » ou rien de coché) ;
 *         [] = vient (sondage sans créneaux, « dispo ») ;
 *         ['dispo de 10h à 13h', …] = vient sur ces créneaux (dans l'ordre du sondage).
 */
export function creneauxChoisis(action: Action, choix: string[], parametres: Parametres): string[] | null {
  if (action.creneaux.length > 0) {
    const coches = action.creneaux.filter((creneau) => choix.includes(creneau));
    return coches.length > 0 ? coches : null; // « pas dispo » seul, ou rien → ne vient pas
  }
  return choix.includes(parametres.options.dispo) ? [] : null;
}

/**
 * Deux votes de la même personne peuvent arriver dans la même seconde, et en théorie dans
 * le désordre. On retient l'heure du dernier vote traité par (sondage, personne) et on
 * ignore un vote plus ancien. (Une clé par sondage dans data/etat.json.)
 */
function estPlusAncienQueLeDernier(ctx: Contexte, vote: VoteRecu): boolean {
  const cle = `votes:${vote.sondageId}`;
  let derniers: Record<string, number> = {};
  try {
    derniers = JSON.parse(ctx.etat.lire(cle) ?? '{}');
  } catch {
    derniers = {};
  }
  const instant = vote.date.getTime();
  if ((derniers[vote.idBrut] ?? 0) > instant) return true;
  derniers[vote.idBrut] = instant;
  ctx.etat.ecrire(cle, JSON.stringify(derniers));
  return false;
}
