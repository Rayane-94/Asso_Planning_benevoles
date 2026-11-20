/**
 * metier/votes.ts — Ce que fait le bot quand quelqu'un vote dans le sondage d'une annonce.
 *
 * Point d'entrée : recevoirVote(), appelé par le webhook WAHA à CHAQUE vote (y compris un
 * changement d'avis ou un vote retiré). Chaque vote contient TOUS les choix actuellement
 * cochés par la personne, donc il suffit de regarder « ce qui est coché maintenant » :
 *   - un ou plusieurs créneaux (ou « dispo ») → inscrit(e), avec ces créneaux ;
 *   - « pas dispo », ou plus rien de coché     → retiré(e) (désisté(e) si déjà en confirmation).
 */
import { STATUT_ACTION } from '../constantes.ts';
import type { VoteRecu } from '../ports/messagerie.ts';
import { lireActions, type Action } from '../sheets/actions.ts';
import { lireParametres, type Parametres } from '../sheets/parametres.ts';
import { dateLongue } from '../utils/dates.ts';
import type { Contexte } from './contexte.ts';
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
  if (vote.discussionId !== ctx.groupeId) return; // sondage d'un autre groupe

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
