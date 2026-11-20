/**
 * metier/listeFinale.ts — La veille de l'action, à HEURE_LISTE (CLAUDE.md §4.5).
 *
 * Pour chaque action « Confirmations envoyées » qui a lieu demain :
 *   1. « En attente » → « Sans réponse » (ils iront dans l'onglet Absents) ;
 *   2. l'action passe à « Liste publiée » (plus aucun changement automatique ensuite) ;
 *   3. liste des confirmés dans le groupe, une ligne par personne :
 *        BP – 28/11 – Durand Bob – 06 12 34 56 78
 *      ou, si personne : ⚠️ BP – 28/11 : personne n'a confirmé…
 *   4. message privé « ✅ Nous vous confirmons votre participation… » à chaque confirmé.
 *
 * Anti-doublon : le statut « Liste publiée » est écrit AVANT l'envoi de la liste. Si l'envoi
 * échoue, on remet le statut précédent et on réessaiera au tick suivant.
 *
 * Rattrapage : si le bot était arrêté la veille au soir, la liste est publiée le jour même
 * à partir de 08:00, jusqu'à l'heure de l'action.
 */
import {
  HEURE_DEBUT_ENVOIS_AUTO, HEURE_FIN_ENVOIS_AUTO, PAUSE_ENTRE_MESSAGES_MS, STATUT_ACTION, STATUT_INSCRIPTION,
} from '../constantes.ts';
import { lireCreneaux, modifierAction, type Action } from '../sheets/actions.ts';
import { lireBenevoles, prenomPourMessage, type Benevole } from '../sheets/benevoles.ts';
import { lireInscriptions, modifierInscriptions, type Inscription } from '../sheets/inscriptions.ts';
import type { Parametres } from '../sheets/parametres.ts';
import { cleDate, dateCourte, dateLongue, ecartJours, heureDe } from '../utils/dates.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { remplirModele } from '../utils/textes.ts';
import { estDansLaFenetre } from './annonces.ts';
import { avecCreneau } from './confirmations.ts';
import type { Contexte, DonneesDuTick } from './contexte.ts';

export type ModeListe = 'automatique' | 'commande';

/**
 * Publie les listes finales dues.
 * @return le nombre de listes publiées
 */
export async function publierListes(ctx: Contexte, donnees: DonneesDuTick, mode: ModeListe): Promise<number> {
  const { parametres, actions } = donnees;
  const maintenant = ctx.horloge.maintenant();
  const aujourdhui = cleDate(maintenant);
  const heure = heureDe(maintenant);

  signalerConfirmationsJamaisEnvoyees(ctx, actions, aujourdhui, heure, parametres);
  const concernees = actionsAPublier(actions, aujourdhui, heure, parametres, mode);
  if (concernees.length === 0) return 0;
  if (ctx.groupeId === null) {
    ctx.logger.avertissement('Liste finale impossible : le groupe WhatsApp n\'est pas configuré (GROUPE_ID dans le .env)');
    return 0;
  }

  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const { parTelephone } = await lireBenevoles(ctx.tableur);
  let publiees = 0;
  for (const action of concernees) {
    if (publiees > 0) await ctx.horloge.attendre(PAUSE_ENTRE_MESSAGES_MS);
    const deCetteAction = inscriptions.filter((i) => i.actionId === action.id);
    if (await publierUneListe(ctx, ctx.groupeId, action, deCetteAction, parTelephone, parametres)) publiees++;
  }
  return publiees;
}

/** Les actions dont il faut publier la liste maintenant (exportée pour les tests). */
export function actionsAPublier(
  actions: Action[], aujourdhui: string, heure: string, parametres: Parametres, mode: ModeListe,
): Action[] {
  return actions
    .filter((action) => action.statut === STATUT_ACTION.CONFIRMATIONS_ENVOYEES)
    .filter((action) => {
      const ecart = ecartJours(aujourdhui, action.date);
      if (mode === 'commande') return ecart === 0 || ecart === 1;
      if (ecart === 1) return estDansLaFenetre(heure, parametres.heureListe, HEURE_FIN_ENVOIS_AUTO); // la veille au soir
      if (ecart === 0) return estDansLaFenetre(heure, HEURE_DEBUT_ENVOIS_AUTO, action.heure); // rattrapage le jour même
      return false;
    })
    .sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
}

/** @return true si la liste a été publiée dans le groupe */
async function publierUneListe(
  ctx: Contexte, groupeId: string, action: Action, inscriptions: Inscription[],
  benevoles: Map<string, Benevole>, parametres: Parametres,
): Promise<boolean> {
  const maintenant = ctx.horloge.maintenant();
  const description = `${action.type} du ${dateLongue(action.date)}`;

  // 1) Pas de réponse à temps → « Sans réponse »
  const enAttente = inscriptions.filter((i) => i.statut === STATUT_INSCRIPTION.EN_ATTENTE);
  await modifierInscriptions(ctx.tableur, enAttente.map((inscription) => ({
    inscription, changements: { statut: STATUT_INSCRIPTION.SANS_REPONSE },
  })), maintenant);

  // 2) Statut AVANT l'envoi (anti-doublon)
  const statutPrecedent = action.statut;
  await modifierAction(ctx.tableur, action, { statut: STATUT_ACTION.LISTE_PUBLIEE });

  // 3) Liste dans le groupe
  const confirmes = inscriptions
    .filter((i) => i.statut === STATUT_INSCRIPTION.CONFIRME)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  try {
    await ctx.messagerie.envoyerTexte(groupeId, texteListe(action, confirmes));
  } catch (erreur) {
    await modifierAction(ctx.tableur, action, { statut: statutPrecedent }); // on réessaiera
    ctx.logger.erreur(`Liste finale non publiée : ${description}`, erreur);
    return false;
  }
  ctx.logger.info(
    `Liste finale publiée : ${description} — ${confirmes.length} confirmé(s), ${enAttente.length} sans réponse`,
  );

  // 4) Confirmation finale en privé à chaque confirmé (un échec n'empêche pas les autres)
  for (const inscription of confirmes) {
    await ctx.horloge.attendre(PAUSE_ENTRE_MESSAGES_MS);
    const texte = avecCreneau(remplirModele(parametres.textes.validation, {
      type: action.type, date: dateLongue(action.date), heure: action.heure, lieu: action.lieu,
      prenom: prenomPourMessage(benevoles.get(inscription.telephone) ?? { prenom: '', nomWhatsApp: '' }),
    }), inscription.creneau);
    try {
      await ctx.messagerie.envoyerTexte(inscription.telephone, texte);
    } catch (erreur) {
      ctx.logger.avertissement(`Confirmation finale non envoyée à ${inscription.nom} : ${String(erreur)}`);
    }
  }
  return true;
}

/**
 * Le texte de la liste, au format volontairement minimaliste (une ligne par présent).
 *   - sans créneaux : « BP – 28/11 – Durand Bob – 06 12 34 56 78 »
 *   - avec créneaux : regroupée par créneau (dans l'ordre du sondage) ; une personne inscrite
 *     sur deux créneaux apparaît sur les deux :
 *       « BP – 28/11 – dispo de 10h à 13h – Durand Bob – 06 12 34 56 78 »
 * Exportée pour les tests.
 */
export function texteListe(action: Action, confirmes: Inscription[]): string {
  const jour = dateCourte(action.date);
  if (confirmes.length === 0) {
    return `⚠️ ${action.type} – ${jour} : personne n'a confirmé. Si tu peux venir, contacte le référent.`;
  }
  const ligne = (inscription: Inscription, creneau?: string) =>
    [action.type, jour, creneau, inscription.nom, formaterTelephone(inscription.telephone)].filter(Boolean).join(' – ');

  if (action.creneaux.length === 0) return confirmes.map((inscription) => ligne(inscription)).join('\n');

  const lignes: string[] = [];
  for (const creneau of action.creneaux) {
    for (const inscription of confirmes) {
      if (lireCreneaux(inscription.creneau).includes(creneau)) lignes.push(ligne(inscription, creneau));
    }
  }
  // Confirmés sans créneau reconnu (ex. créneau renommé après le vote) : listés quand même, à la fin.
  for (const inscription of confirmes) {
    if (!lireCreneaux(inscription.creneau).some((c) => action.creneaux.includes(c))) lignes.push(ligne(inscription, inscription.creneau || undefined));
  }
  return lignes.join('\n');
}

/**
 * Une action encore « Annoncée » au moment de la liste : les demandes de confirmation
 * ne sont jamais parties (bot arrêté plusieurs jours…). On ne publie pas une liste vide
 * trompeuse : on prévient l'équipe.
 */
function signalerConfirmationsJamaisEnvoyees(
  ctx: Contexte, actions: Action[], aujourdhui: string, heure: string, parametres: Parametres,
): void {
  for (const action of actions) {
    if (action.statut !== STATUT_ACTION.ANNONCEE) continue;
    const ecart = ecartJours(aujourdhui, action.date);
    const cEstLHeure = (ecart === 1 && heure >= parametres.heureListe) || (ecart === 0 && heure < action.heure);
    if (cEstLHeure) {
      ctx.logger.avertissement(
        `${action.type} du ${dateLongue(action.date)} : les demandes de confirmation ne sont jamais parties, ` +
        'la liste finale n\'est donc pas publiée. Utiliser les commandes « Envoyer les confirmations maintenant » ' +
        'puis « Publier la liste de demain maintenant », ou prévenir les inscrits à la main.',
      );
    }
  }
}
