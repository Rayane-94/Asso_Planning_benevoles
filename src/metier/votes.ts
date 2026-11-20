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
import { REPONSE, STATUT_ACTION, STATUT_INSCRIPTION } from '../constantes.ts';
import type { VoteRecu } from '../ports/messagerie.ts';
import { lireActions, type Action } from '../sheets/actions.ts';
import { lireInscriptions } from '../sheets/inscriptions.ts';
import { lireParametres, type Parametres } from '../sheets/parametres.ts';
import { cleDate, dateLongue } from '../utils/dates.ts';
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
  if (vote.telephone === null) {
    ctx.logger.avertissement(
      `${vote.nomWhatsApp || 'Un bénévole'} a voté pour ${action.type} du ${dateLongue(action.date)}, ` +
      'mais WhatsApp masque son numéro : à inscrire à la main',
    );
    return;
  }
  if (estPlusAncienQueLeDernier(ctx, vote)) {
    ctx.logger.debug(`Vote de ${vote.nomWhatsApp} plus ancien que le dernier reçu : ignoré`);
    return;
  }

  const { parametres } = await lireParametres(ctx.tableur);
  const creneaux = creneauxChoisis(action, vote.choix, parametres);
  if (creneaux === null) await desinscrire(ctx, action, vote.telephone, vote.nomWhatsApp);
  else await inscrire(ctx, action, vote.telephone, vote.nomWhatsApp, creneaux.join(', '));
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
