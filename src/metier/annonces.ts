/**
 * metier/annonces.ts — Publication des annonces dans le groupe (CLAUDE.md §4.2).
 *
 * Une annonce par action (jamais regroupées) = un TEXTE (TEXTE_ANNONCE) suivi d'un SONDAGE
 * WhatsApp (créneaux de la colonne Créneaux, ou « dispo / pas dispo »). Après l'envoi,
 * l'action passe à « Annoncée » et l'ID du SONDAGE est enregistré : c'est lui qui permettra
 * de rattacher chaque vote à la bonne action.
 *
 * Quelles actions annoncer ? (J = aujourd'hui, réglages par défaut)
 *   - automatique (à partir de HEURE_ANNONCE, jusqu'à 22:00) : date entre J+3 et J+7
 *       · J+7 = cas normal ; J+3 à J+6 = « rattrapage » d'une action ajoutée tard ;
 *       · J+3 = JOURS_AVANT_CONFIRMATION + 1 : l'annonce part au moins la veille
 *         de la demande de confirmation ;
 *   - commande « Annoncer maintenant » : date entre aujourd'hui et J+7, à toute heure.
 */
import { HEURE_FIN_ENVOIS_AUTO, MARQUEUR_ENVOI_EN_COURS, PAUSE_ENTRE_MESSAGES_MS, STATUT_ACTION } from '../constantes.ts';
import { modifierAction, type Action } from '../sheets/actions.ts';
import type { Parametres } from '../sheets/parametres.ts';
import { ajouterJours, cleDate, dateCourte, dateLongue, ecartJours, heureDe } from '../utils/dates.ts';
import { remplirModele } from '../utils/textes.ts';
import type { Contexte, DonneesDuTick } from './contexte.ts';

export type ModeAnnonce = 'automatique' | 'commande';

/**
 * Publie les annonces dues.
 * @return le nombre d'annonces publiées
 */
export async function publierAnnonces(ctx: Contexte, donnees: DonneesDuTick, mode: ModeAnnonce): Promise<number> {
  const { parametres, actions } = donnees;
  const maintenant = ctx.horloge.maintenant();

  if (mode === 'automatique' && !estDansLaFenetre(heureDe(maintenant), parametres.heureAnnonce, HEURE_FIN_ENVOIS_AUTO)) {
    return 0; // pas encore l'heure, ou trop tard ce soir
  }
  if (ctx.groupeId === null) {
    ctx.logger.avertissement('Annonces impossibles : le groupe WhatsApp n\'est pas configuré (GROUPE_ID dans le .env)');
    return 0;
  }

  signalerEnvoisInterrompus(ctx, actions);
  const aAnnoncer = actionsAAnnoncer(actions, cleDate(maintenant), parametres, mode);
  let publiees = 0;

  for (const action of aAnnoncer) {
    if (publiees > 0) await ctx.horloge.attendre(PAUSE_ENTRE_MESSAGES_MS);
    if (await publierUneAnnonce(ctx, ctx.groupeId, action, parametres)) publiees++;
  }
  return publiees;
}

/**
 * Les actions à annoncer maintenant, triées par date puis heure.
 * Exportée pour être testée seule.
 */
export function actionsAAnnoncer(actions: Action[], aujourdhui: string, parametres: Parametres, mode: ModeAnnonce): Action[] {
  const ecartMinimum = mode === 'automatique' ? parametres.joursAvantConfirmation + 1 : 0;
  return actions
    .filter((action) => action.statut === STATUT_ACTION.A_ANNONCER && action.messageId === '')
    .filter((action) => {
      const ecart = ecartJours(aujourdhui, action.date);
      return ecart >= ecartMinimum && ecart <= parametres.joursAvantAnnonce;
    })
    .sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
}

/**
 * Envoie l'annonce d'une action et enregistre le résultat.
 * @return true si l'annonce est partie
 */
async function publierUneAnnonce(ctx: Contexte, groupeId: string, action: Action, parametres: Parametres): Promise<boolean> {
  const texte = remplirModele(parametres.textes.annonce, {
    type: action.type,
    date: dateLongue(action.date),
    heure: action.heure,
    lieu: action.lieu,
  });
  const description = `${action.type} du ${dateLongue(action.date)} (${action.id})`;

  // 1) Marqueur AVANT l'envoi : si on plante après l'envoi, on ne renverra pas en double.
  await modifierAction(ctx.tableur, action, { messageId: MARQUEUR_ENVOI_EN_COURS });

  // 2) Le texte de l'annonce
  try {
    await ctx.messagerie.envoyerTexte(groupeId, texte);
  } catch (erreur) {
    // Rien n'est parti : on retire le marqueur pour réessayer au prochain tick.
    await modifierAction(ctx.tableur, action, { messageId: '' });
    ctx.logger.erreur(`Annonce non envoyée : ${description}`, erreur);
    return false;
  }

  // 3) Le sondage, juste en dessous (c'est lui qui recevra les votes)
  const { question, choix, plusieursChoix } = sondageDeLAction(action, parametres);
  let sondageId: string;
  try {
    await ctx.horloge.attendre(PAUSE_ENTRE_MESSAGES_MS);
    sondageId = await ctx.messagerie.envoyerSondage(groupeId, question, choix, plusieursChoix);
  } catch (erreur) {
    // Le texte est parti mais pas le sondage : on NE renvoie PAS tout automatiquement (le texte
    // serait en double). Le marqueur reste : un humain vérifie (voir signalerEnvoisInterrompus).
    ctx.logger.erreur(
      `Annonce de ${description} : le texte est parti mais PAS le sondage. Supprimer le texte dans le groupe, ` +
      'puis vider la cellule « Message ID » (colonne masquée) pour tout renvoyer',
      erreur,
    );
    return false;
  }

  // 4) Enregistrement : on garde l'ID du SONDAGE (les votes y feront référence)
  await modifierAction(ctx.tableur, action, { statut: STATUT_ACTION.ANNONCEE, messageId: sondageId });
  ctx.logger.info(`Annonce publiée : ${description}`);
  return true;
}

/**
 * Le sondage d'une action (exportée pour les tests).
 *   - avec créneaux : un choix par créneau + « pas dispo », plusieurs réponses possibles ;
 *   - sans créneau : « dispo » / « pas dispo », une seule réponse.
 */
export function sondageDeLAction(action: Action, parametres: Parametres): { question: string; choix: string[]; plusieursChoix: boolean } {
  const avecCreneaux = action.creneaux.length > 0;
  return {
    question: `${action.type} – ${dateLongue(action.date)} à ${action.heure}`,
    choix: avecCreneaux
      ? [...action.creneaux, parametres.options.pasDispo]
      : [parametres.options.dispo, parametres.options.pasDispo],
    plusieursChoix: action.creneaux.length > 1,
  };
}

/**
 * Une action avec le marqueur « envoi-en-cours » mais pas « Annoncée » : le bot s'est
 * arrêté pendant l'envoi. On ne sait pas si l'annonce est partie : un humain doit vérifier.
 */
function signalerEnvoisInterrompus(ctx: Contexte, actions: Action[]): void {
  for (const action of actions) {
    if (action.statut === STATUT_ACTION.A_ANNONCER && action.messageId === MARQUEUR_ENVOI_EN_COURS) {
      ctx.logger.avertissement(
        `Annonce de ${action.type} du ${dateLongue(action.date)} (ligne ${action.numero}) peut-être interrompue : ` +
        'vérifier dans le groupe WhatsApp. Si elle n\'est pas partie, vider la cellule « Message ID » (colonne masquée) pour la renvoyer.',
      );
    }
  }
}

/**
 * Pourquoi la commande « Annoncer maintenant » n'a rien publié ? Une raison par action
 * pas encore annoncée, pour que l'équipe comprenne sans aller lire le code.
 *   ex. 'A-0001 (28/11) : trop loin, annonce possible à partir du 21/11'
 */
export function expliquerAucuneAnnonce(actions: Action[], aujourdhui: string, parametres: Parametres): string {
  const enAttente = actions.filter((action) => action.statut === STATUT_ACTION.A_ANNONCER);
  if (enAttente.length === 0) {
    return 'aucune action à annoncer (toutes sont déjà annoncées ou annulées ; une ligne incomplète est signalée dans le Journal)';
  }
  return enAttente.map((action) => {
    const ecart = ecartJours(aujourdhui, action.date);
    const quoi = `${action.id || `ligne ${action.numero}`} (${dateCourte(action.date)})`;
    if (action.messageId === MARQUEUR_ENVOI_EN_COURS) return `${quoi} : envoi peut-être interrompu, voir le Journal`;
    if (ecart < 0) return `${quoi} : date passée`;
    if (ecart > parametres.joursAvantAnnonce) {
      return `${quoi} : trop loin, annonce possible à partir du ${dateCourte(ajouterJours(action.date, -parametres.joursAvantAnnonce))}`;
    }
    return `${quoi} : non envoyée, voir le Journal`;
  }).join(' ; ');
}

/** '18:30' est-il dans [debut, fin[ ? (les heures 'HH:mm' se comparent comme du texte) */
export function estDansLaFenetre(heure: string, debut: string, fin: string): boolean {
  return heure >= debut && heure < fin;
}
