/**
 * metier/listeFinale.ts — La veille de l'action, à HEURE_LISTE (CLAUDE.md §4.5).
 *
 * Pour chaque action « Confirmations envoyées » qui a lieu demain :
 *   1. « En attente » → « Sans réponse » (ils iront dans l'onglet Absents) ;
 *   2. l'action passe à « Liste publiée » (plus aucun changement automatique ensuite) ;
 *   3. liste des confirmés dans le groupe : un titre, puis une ligne par personne
 *        📋 BP – samedi 28/11 à 14:00 – Entrepôt
 *        • Durand Bob – 06 12 34 56 78
 *      avec des créneaux : un bloc « 🕒 dispo de 10h à 13h » par créneau, les présents en dessous ;
 *      si personne : ⚠️ BP – 28/11 : personne n'a confirmé…
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
 * Le texte de la liste (format « titre + liste », choisi le 21/11/2026) :
 *
 *   📋 BP – samedi 28/11 à 10:00 – Entrepôt      (titre)
 *
 *   🕒 dispo de 10h à 13h                        (un bloc par créneau, ordre du sondage ;
 *   • Durand Bob – 06 12 34 56 78                 une personne sur deux créneaux est dans les deux)
 *
 *   🕒 dispo de 13h à 16h
 *   ⚠️ personne                                   (créneau sans aucun confirmé)
 *
 * Sans créneaux : le titre puis directement les « • Nom – téléphone ».
 * Exportée pour les tests.
 */
export function texteListe(action: Action, confirmes: Inscription[]): string {
  if (confirmes.length === 0) {
    return `⚠️ ${action.type} – ${dateCourte(action.date)} : personne n'a confirmé. Si tu peux venir, contacte le référent.`;
  }
  const lieu = action.lieu ? ` – ${action.lieu}` : '';
  const titre = `📋 ${action.type} – ${dateLongue(action.date)} à ${action.heure}${lieu}`;
  const puces = (personnes: Inscription[]) =>
    personnes.map((inscription) => `• ${inscription.nom} – ${formaterTelephone(inscription.telephone)}`);

  // Sans créneaux : le titre, puis une ligne par présent.
  if (action.creneaux.length === 0) return [titre, ...puces(confirmes)].join('\n');

  // Avec créneaux : un bloc par créneau, dans l'ordre du sondage (une personne peut être dans plusieurs).
  const blocs = action.creneaux.map((creneau) => {
    const presents = confirmes.filter((inscription) => lireCreneaux(inscription.creneau).includes(creneau));
    return [`🕒 ${creneau}`, ...(presents.length > 0 ? puces(presents) : ['⚠️ personne'])].join('\n');
  });
  // Confirmés sans créneau reconnu (ex. créneau renommé dans Actions après le vote) : listés quand même, à la fin.
  const autres = confirmes.filter((inscription) => !lireCreneaux(inscription.creneau).some((c) => action.creneaux.includes(c)));
  if (autres.length > 0) blocs.push(['🕒 autre créneau', ...autres.map((i) => `• ${i.nom} – ${formaterTelephone(i.telephone)}${i.creneau ? ` (${i.creneau})` : ''}`)].join('\n'));

  return [titre, ...blocs].join('\n\n');
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
