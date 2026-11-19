/**
 * metier/commandes.ts — Les commandes manuelles de l'onglet Commandes (CLAUDE.md §5).
 *
 * L'équipe coche « Lancer » ; au tick suivant (≤ 1 min), le bot :
 *   1. décoche et écrit « en cours… » AVANT d'exécuter (une commande qui plante n'est
 *      jamais relancée en boucle) ;
 *   2. exécute ;
 *   3. écrit le résultat et l'heure.
 *
 * Pause : plus aucun envoi AUTOMATIQUE (annonces, confirmations, listes, récap). Les
 * commandes manuelles et l'enregistrement des réponses des bénévoles continuent.
 */
import { COMMANDES } from '../constantes.ts';
import { lireCommandes, noterResultatCommande } from '../sheets/commandes.ts';
import { ecrireEtat } from '../sheets/etatBot.ts';
import { ELEMENTS_ETAT } from '../sheets/schema.ts';
import { horodatage } from '../utils/dates.ts';
import { decrireErreur } from '../utils/logger.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { publierAnnonces } from './annonces.ts';
import { envoyerConfirmations } from './confirmations.ts';
import type { Contexte, DonneesDuTick } from './contexte.ts';
import { publierListes } from './listeFinale.ts';
import { envoyerRecap } from './recap.ts';

const CLE_PAUSE = 'pause';

/** Le bot est-il en pause (commande « Mettre le bot en pause ») ? */
export function estEnPause(ctx: Contexte): boolean {
  return ctx.etat.lire(CLE_PAUSE) !== null;
}

/** Exécute les commandes cochées. */
export async function executerCommandes(ctx: Contexte, donnees: DonneesDuTick): Promise<void> {
  const cochees = (await lireCommandes(ctx.tableur)).filter((ligne) => ligne.lancer);

  for (const ligne of cochees) {
    await noterResultatCommande(ctx.tableur, ligne.numero, 'en cours…', ctx.horloge.maintenant());
    let resultat: string;
    try {
      resultat = await executer(ctx, donnees, ligne.commande);
    } catch (erreur) {
      resultat = `Échec : ${decrireErreur(erreur)}`;
      ctx.logger.erreur(`Commande « ${ligne.commande} » en échec`, erreur);
    }
    await noterResultatCommande(ctx.tableur, ligne.numero, resultat, ctx.horloge.maintenant());
    ctx.logger.info(`Commande « ${ligne.commande} » : ${resultat}`);
  }
}

/** Exécute UNE commande et renvoie le résultat à afficher. */
async function executer(ctx: Contexte, donnees: DonneesDuTick, commande: string): Promise<string> {
  const maintenant = ctx.horloge.maintenant();
  switch (commande) {
    case COMMANDES.ANNONCER:
      return `${await publierAnnonces(ctx, donnees, 'commande')} annonce(s) publiée(s)`;
    case COMMANDES.CONFIRMATIONS:
      return `${await envoyerConfirmations(ctx, donnees, 'commande')} demande(s) de confirmation envoyée(s)`;
    case COMMANDES.LISTE:
      return `${await publierListes(ctx, donnees, 'commande')} liste(s) publiée(s)`;
    case COMMANDES.RECAP:
      return (await envoyerRecap(ctx, donnees, 'commande')) ? 'Récap envoyé' : 'Pas de récap envoyé (voir le Journal)';
    case COMMANDES.VERIFIER:
      return verifierConfiguration(ctx, donnees);
    case COMMANDES.PAUSE:
      ctx.etat.ecrire(CLE_PAUSE, horodatage(maintenant));
      await ecrireEtat(ctx.tableur, ELEMENTS_ETAT.BOT, {
        etat: '⏸️ En pause', depuis: horodatage(maintenant),
        queFaire: 'Plus aucun envoi automatique. Cocher « Reprendre » dans Commandes pour relancer.',
      });
      return 'Bot en pause : plus aucun envoi automatique';
    case COMMANDES.REPRENDRE:
      ctx.etat.ecrire(CLE_PAUSE, null);
      await ecrireEtat(ctx.tableur, ELEMENTS_ETAT.BOT, { etat: '🟢 Actif', depuis: horodatage(maintenant) });
      return 'Bot actif : envois automatiques relancés';
    default:
      return `Commande inconnue « ${commande} » (ne pas modifier le texte des commandes)`;
  }
}

/** « Vérifier la configuration » : WhatsApp, groupe, référent, Sheet. */
async function verifierConfiguration(ctx: Contexte, donnees: DonneesDuTick): Promise<string> {
  const resultats: string[] = ['✅ Google Sheet accessible']; // sinon on n'en serait pas là

  let connexion;
  try {
    connexion = await ctx.messagerie.verifierConnexion();
  } catch (erreur) {
    connexion = { ok: false, numero: null, detail: decrireErreur(erreur) };
  }
  resultats.push(connexion.ok
    ? `✅ WhatsApp connecté${connexion.numero ? ` (${formaterTelephone(connexion.numero)})` : ''}`
    : `❌ WhatsApp déconnecté${connexion.detail ? ` : ${connexion.detail}` : ''}`);

  if (ctx.groupeId === null) {
    resultats.push('❌ Groupe non configuré (GROUPE_ID dans le .env)');
  } else if (connexion.ok) {
    const groupe = (await ctx.messagerie.listerGroupes()).find((g) => g.id === ctx.groupeId);
    resultats.push(groupe ? `✅ Groupe « ${groupe.nom} »` : '❌ Groupe introuvable : le numéro du bot est-il bien membre du groupe ?');
  }

  const referent = donnees.parametres.numeroReferent;
  resultats.push(referent ? `✅ Référent ${formaterTelephone(referent)}` : '⚠️ NUMERO_REFERENT vide (désistements tardifs non signalés)');
  if (estEnPause(ctx)) resultats.push('⏸️ Bot en pause');

  return resultats.join(' · ');
}
