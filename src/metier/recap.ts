/**
 * metier/recap.ts — Le récap de la semaine dans le groupe (CLAUDE.md §4.7).
 *
 * Le JOUR_RECAP (vendredi) à HEURE_RECAP (20:30), si RECAP_ACTIF = oui :
 *   📅 Récap de la semaine (samedi 28/11 → vendredi 04/12)
 *   • BP – samedi 28/11 à 14:00 – Entrepôt : 5 confirmés
 *   • Maraude – mardi 01/12 à 19:00 – Gare : 3 inscrits
 *   • Collecte – dimanche 29/11 à 10:00 – Supermarché : pas encore annoncée
 *
 * La période va de demain à J+7. Les actions annulées n'y sont pas. Semaine sans action :
 * pas de message (inutile de faire du bruit dans le groupe).
 *
 * Anti-doublon : le récap n'a pas de statut dans le Sheet ; on note « récap envoyé le … »
 * dans l'état local (data/etat.json) AVANT l'envoi (effacé si l'envoi échoue).
 */
import { HEURE_FIN_ENVOIS_AUTO, STATUT_ACTION, STATUT_INSCRIPTION } from '../constantes.ts';
import type { Action } from '../sheets/actions.ts';
import { lireInscriptions, type Inscription } from '../sheets/inscriptions.ts';
import { ajouterJours, cleDate, dateLongue, heureDe, horodatage, numeroJourSemaine } from '../utils/dates.ts';
import { estDansLaFenetre } from './annonces.ts';
import type { Contexte, DonneesDuTick } from './contexte.ts';

export type ModeRecap = 'automatique' | 'commande';

/**
 * Envoie le récap s'il est dû (ou tout de suite en mode « commande »).
 * @return true si un récap a été envoyé
 */
export async function envoyerRecap(ctx: Contexte, donnees: DonneesDuTick, mode: ModeRecap): Promise<boolean> {
  const { parametres, actions } = donnees;
  const maintenant = ctx.horloge.maintenant();
  const aujourdhui = cleDate(maintenant);
  const cleEtat = `recap:${aujourdhui}`;

  if (mode === 'automatique') {
    const cEstLeMoment =
      parametres.recapActif &&
      numeroJourSemaine(aujourdhui) === parametres.jourRecap &&
      estDansLaFenetre(heureDe(maintenant), parametres.heureRecap, HEURE_FIN_ENVOIS_AUTO);
    if (!cEstLeMoment || ctx.etat.lire(cleEtat) !== null) return false;
  }
  if (ctx.groupeId === null) {
    ctx.logger.avertissement('Récap impossible : le groupe WhatsApp n\'est pas configuré (GROUPE_ID dans le .env)');
    return false;
  }

  const debut = ajouterJours(aujourdhui, 1);
  const fin = ajouterJours(aujourdhui, 7);
  const semaine = actions
    .filter((a) => a.statut !== STATUT_ACTION.ANNULEE && a.date >= debut && a.date <= fin)
    .sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));

  if (semaine.length === 0) {
    ctx.etat.ecrire(cleEtat, horodatage(maintenant));
    ctx.logger.info(`Récap : aucune action du ${dateLongue(debut)} au ${dateLongue(fin)}, pas de message`);
    return false;
  }

  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const texte = texteRecap(semaine, inscriptions, debut, fin);

  ctx.etat.ecrire(cleEtat, horodatage(maintenant)); // AVANT l'envoi : jamais de doublon
  try {
    await ctx.messagerie.envoyerTexte(ctx.groupeId, texte);
  } catch (erreur) {
    ctx.etat.ecrire(cleEtat, null); // on réessaiera au prochain tick
    ctx.logger.erreur('Récap de la semaine non envoyé', erreur);
    return false;
  }
  ctx.logger.info(`Récap de la semaine envoyé (${semaine.length} action(s))`);
  return true;
}

/** Le texte du récap (exportée pour les tests). */
export function texteRecap(semaine: Action[], inscriptions: Inscription[], debut: string, fin: string): string {
  const lignes = semaine.map((action) => {
    const lieu = action.lieu ? ` – ${action.lieu}` : '';
    return `• ${action.type} – ${dateLongue(action.date)} à ${action.heure}${lieu} : ${etatAction(action, inscriptions)}`;
  });
  return [`📅 Récap de la semaine (${dateLongue(debut)} → ${dateLongue(fin)})`, ...lignes].join('\n');
}

/** « 5 confirmés », « 3 inscrits » ou « pas encore annoncée », selon l'avancement de l'action. */
function etatAction(action: Action, inscriptions: Inscription[]): string {
  const deCetteAction = inscriptions.filter((i) => i.actionId === action.id);
  const S = STATUT_INSCRIPTION;
  switch (action.statut) {
    case STATUT_ACTION.A_ANNONCER:
      // Au moment du récap, une action pas encore annoncée est trop proche pour l'annonce
      // automatique : l'équipe doit utiliser la commande « Annoncer maintenant ».
      return 'pas encore annoncée';
    case STATUT_ACTION.ANNONCEE: {
      const inscrits = deCetteAction.filter((i) => i.statut === S.INSCRIT || i.statut === S.EN_ATTENTE || i.statut === S.CONFIRME);
      return pluriel(inscrits.length, 'inscrit');
    }
    default: // confirmations envoyées ou liste publiée : on compte les confirmés
      return pluriel(deCetteAction.filter((i) => i.statut === S.CONFIRME).length, 'confirmé');
  }
}

/** pluriel(0, 'inscrit') → '0 inscrit' ; pluriel(3, 'inscrit') → '3 inscrits' */
function pluriel(nombre: number, mot: string): string {
  return `${nombre} ${mot}${nombre > 1 ? 's' : ''}`;
}
