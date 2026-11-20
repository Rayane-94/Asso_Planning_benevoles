/**
 * metier/desistement.ts — Désistement de dernière minute (CLAUDE.md §4.6).
 *
 * Après la publication de la liste finale, plus rien ne change automatiquement… sauf un
 * cas : un CONFIRMÉ qui écrit NON au bot en privé (ou vote « Non » dans le sondage de
 * confirmation, voir votes.ts). On le passe à « Désisté » (il apparaît
 * dans Absents) et on PRÉVIENT LE RÉFÉRENT en privé, pour qu'il puisse s'organiser.
 * (Un OUI après la liste, lui, ne change rien : la personne contacte le référent.)
 */
import { MESSAGES, STATUT_ACTION, STATUT_INSCRIPTION } from '../constantes.ts';
import type { MessageRecu } from '../ports/messagerie.ts';
import { lireActions, type Action } from '../sheets/actions.ts';
import { lireInscriptions, modifierInscriptions, type Inscription } from '../sheets/inscriptions.ts';
import { lireParametres } from '../sheets/parametres.ts';
import { cleDate, dateLongue } from '../utils/dates.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { remplirModele } from '../utils/textes.ts';
import { choisirDemande } from './confirmations.ts';
import type { Contexte } from './contexte.ts';

/**
 * Traite un NON reçu en privé après la publication de la liste.
 * @return true si le message correspondait à un désistement tardif (traité), false sinon
 */
export async function traiterDesistementTardif(ctx: Contexte, message: MessageRecu): Promise<boolean> {
  const telephone = message.telephone;
  if (telephone === null) return false;

  // Actions dont la liste est publiée et qui n'ont pas encore eu lieu
  const aujourdhui = cleDate(ctx.horloge.maintenant());
  const { actions } = await lireActions(ctx.tableur);
  const publiees = new Map(
    actions.filter((a) => a.statut === STATUT_ACTION.LISTE_PUBLIEE && a.date >= aujourdhui).map((a) => [a.id, a]),
  );
  if (publiees.size === 0) return false;

  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const confirmees = inscriptions.filter(
    (i) => i.telephone === telephone && publiees.has(i.actionId) && i.statut === STATUT_INSCRIPTION.CONFIRME,
  );
  if (confirmees.length === 0) return false;

  const cible = choisirDemande(confirmees, message.citeId);
  if (cible === null) {
    await envoyerSansPlanter(ctx, telephone, MESSAGES.CITER_LE_MESSAGE);
    return true;
  }
  const action = publiees.get(cible.actionId);
  if (!action) return false;

  await enregistrerDesistementTardif(ctx, cible, action);
  return true;
}

/**
 * Le désistement tardif lui-même (NON écrit, ou « Non » voté dans le sondage de confirmation) :
 * « Désisté », accusé de réception, et message au référent.
 */
export async function enregistrerDesistementTardif(ctx: Contexte, cible: Inscription, action: Action): Promise<void> {
  await modifierInscriptions(ctx.tableur, [{ inscription: cible, changements: { statut: STATUT_INSCRIPTION.DESISTE } }], ctx.horloge.maintenant());
  await envoyerSansPlanter(ctx, cible.telephone, MESSAGES.ACCUSE_RECEPTION);

  // Prévenir le référent
  const telephone = formaterTelephone(cible.telephone);
  const description = `${cible.nom} (${telephone}) pour ${action.type} du ${dateLongue(action.date)}`;
  const { parametres } = await lireParametres(ctx.tableur);
  if (parametres.numeroReferent === null) {
    ctx.logger.avertissement(`Désistement de dernière minute : ${description}. Aucun NUMERO_REFERENT dans les Paramètres pour prévenir le référent.`);
    return;
  }
  ctx.logger.avertissement(`Désistement de dernière minute : ${description} (référent prévenu)`);
  await envoyerSansPlanter(ctx, parametres.numeroReferent, remplirModele(MESSAGES.ALERTE_DESISTEMENT, {
    nom: cible.nom, telephone,
    type: action.type, date: dateLongue(action.date), heure: action.heure, lieu: action.lieu,
  }));
}

async function envoyerSansPlanter(ctx: Contexte, destinataire: string, texte: string): Promise<void> {
  try {
    await ctx.messagerie.envoyerTexte(destinataire, texte);
  } catch (erreur) {
    ctx.logger.avertissement(`Message non envoyé à ${formaterTelephone(destinataire)} : ${String(erreur)}`);
  }
}
