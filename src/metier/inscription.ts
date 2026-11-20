/**
 * metier/inscription.ts — Inscrire ou désinscrire un bénévole à une action.
 *
 * Utilisé quand un bénévole vote dans le sondage d'une annonce (metier/votes.ts) :
 *   - il coche un ou plusieurs créneaux (ou « dispo ») → inscrire() ;
 *   - il coche « pas dispo » ou retire son vote → desinscrire().
 */
import { MESSAGES, PAUSE_ENTRE_MESSAGES_MS, STATUT_ACTION, STATUT_INSCRIPTION, type StatutInscription } from '../constantes.ts';
import type { Action } from '../sheets/actions.ts';
import { ajouterBenevole, lireBenevoles, modifierBenevole, nomPourListe, type Benevole } from '../sheets/benevoles.ts';
import { ajouterInscription, lireInscriptions, modifierInscriptions } from '../sheets/inscriptions.ts';
import { lireParametres } from '../sheets/parametres.ts';
import { dateLongue, horodatage } from '../utils/dates.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { demanderConfirmationMaintenant } from './confirmations.ts';
import type { Contexte } from './contexte.ts';

/** Statuts d'une inscription « active » (la personne compte venir). */
export const STATUTS_ACTIFS: StatutInscription[] = [STATUT_INSCRIPTION.INSCRIT, STATUT_INSCRIPTION.EN_ATTENTE, STATUT_INSCRIPTION.CONFIRME];

/**
 * Inscrit (ou réinscrit) quelqu'un, avec son ou ses créneaux.
 * @param creneau ex. 'dispo de 10h à 13h, dispo de 13h à 16h' ; '' si l'action n'a pas de créneaux
 */
export async function inscrire(ctx: Contexte, action: Action, telephone: string, nomWhatsApp: string, creneau: string): Promise<void> {
  const maintenant = ctx.horloge.maintenant();
  const benevole = await trouverOuCreerBenevole(ctx, telephone, nomWhatsApp);
  const nom = nomPourListe({ prenom: benevole.prenom, nom: benevole.nom, nomWhatsApp: benevole.nomWhatsApp || nomWhatsApp, telephone });
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const existante = inscriptions.find((i) => i.actionId === action.id && i.telephone === telephone);
  const description = `${nom} pour ${action.type} du ${dateLongue(action.date)}${creneau ? ` (${creneau})` : ''}`;

  if (existante && STATUTS_ACTIFS.includes(existante.statut)) {
    // Déjà inscrit : il a seulement changé de créneau(x) dans le sondage.
    if (existante.creneau !== creneau) {
      await modifierInscriptions(ctx.tableur, [{ inscription: existante, changements: { creneau } }], maintenant);
      ctx.logger.info(`Créneau modifié : ${description}`);
    }
    await demanderLeNomSiBesoin(ctx, benevole);
    return;
  }
  if (existante) {
    // Avait dit « pas dispo » (ou s'était désisté) et revient : on réactive la même ligne.
    // L'ancienne demande de confirmation est effacée : une nouvelle sera envoyée si besoin.
    await modifierInscriptions(ctx.tableur, [{
      inscription: existante, changements: { statut: STATUT_INSCRIPTION.INSCRIT, nom, creneau, demandeId: '' },
    }], maintenant);
    ctx.logger.info(`Réinscription : ${description}`);
  } else {
    await ajouterInscription(ctx.tableur, {
      actionId: action.id, type: action.type, date: action.date, heure: action.heure, lieu: action.lieu,
      telephone, nom, creneau, statut: STATUT_INSCRIPTION.INSCRIT,
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

/** « Pas dispo » ou vote retiré : retire l'inscription active (s'il n'y en a pas, rien à faire). */
export async function desinscrire(ctx: Contexte, action: Action, telephone: string, nomWhatsApp: string): Promise<void> {
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
    // Pas grave : on redemandera à son prochain vote.
    ctx.logger.avertissement(`Demande de nom non envoyée à ${formaterTelephone(benevole.telephone)} : ${String(erreur)}`);
    return;
  }
  await modifierBenevole(ctx.tableur, benevole, { nomDemandeLe: horodatage(ctx.horloge.maintenant()) });
}
