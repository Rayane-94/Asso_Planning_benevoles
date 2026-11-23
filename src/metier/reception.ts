/**
 * metier/reception.ts — Ce que fait le bot quand il reçoit un MESSAGE WhatsApp.
 *
 * Point d'entrée : recevoirMessage(), appelé par le webhook WAHA pour chaque message reçu.
 *
 * Depuis les sondages (20/11/2026), on s'inscrit en VOTANT (voir votes.ts) : les messages
 * texte du GROUPE ne concernent plus le bot et sont ignorés. Restent les messages PRIVÉS :
 *   - OUI / NON à une demande de confirmation → voir confirmations.ts ;
 *   - NON après la publication de la liste → désistement de dernière minute (desistement.ts) ;
 *   - la réponse à la demande « prénom et nom » → fiche du bénévole ; si ce n'est pas un nom
 *     (question, « salut »…), le bot dit qu'il est un robot et redemande (2 fois maximum).
 */
import { MESSAGES, REPONSE, STATUT_ACTION, STATUT_INSCRIPTION } from '../constantes.ts';
import type { MessageRecu } from '../ports/messagerie.ts';
import { lireActions } from '../sheets/actions.ts';
import { lireBenevoles, modifierBenevole, nomPourListe, type Benevole } from '../sheets/benevoles.ts';
import { lireInscriptions, modifierInscriptions, type Inscription } from '../sheets/inscriptions.ts';
import { lireParametres } from '../sheets/parametres.ts';
import { cleDate, dateLongue } from '../utils/dates.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { detecterReponse, lireNomComplet, remplirModele } from '../utils/textes.ts';
import { traiterReponseConfirmation } from './confirmations.ts';
import type { Contexte } from './contexte.ts';
import { traiterDesistementTardif } from './desistement.ts';

/**
 * Traite un message reçu. Ne lève jamais d'erreur : un problème est noté dans le Journal
 * (un message mal traité ne doit pas bloquer les suivants).
 */
export async function recevoirMessage(ctx: Contexte, message: MessageRecu): Promise<void> {
  if (message.estGroupe) return; // on s'inscrit avec le sondage : les messages du groupe ne concernent pas le bot
  if (ctx.memoireMessages.dejaVu(message.id)) {
    ctx.logger.debug(`Message ${message.id} déjà traité : ignoré`);
    return;
  }
  ctx.memoireMessages.noter(message.id);

  // Chacun son tour avec le tick : jamais deux écritures simultanées dans le Sheet.
  await ctx.file.executer(async () => {
    try {
      await traiterMessagePrive(ctx, message);
    } catch (erreur) {
      ctx.logger.erreur(`Message de ${message.nomWhatsApp || message.idBrut} non traité`, erreur);
    }
  });
}

async function traiterMessagePrive(ctx: Contexte, message: MessageRecu): Promise<void> {
  if (message.telephone === null) return;

  // OUI / NON : réponse à une demande de confirmation (et jamais un nom).
  const reponse = detecterReponse(message.texte);
  if (reponse !== null) {
    let traite = await traiterReponseConfirmation(ctx, message, reponse);
    // Pas de demande ouverte : peut-être un NON après la publication de la liste (§4.6)…
    if (!traite && reponse === REPONSE.NON) traite = await traiterDesistementTardif(ctx, message);
    // … ou un NON pour annuler une inscription faite avant les confirmations.
    if (!traite && reponse === REPONSE.NON) await retirerEnPrive(ctx, message.telephone);
    return;
  }

  // Sinon : peut-être la réponse à la demande de nom ?
  const { parTelephone } = await lireBenevoles(ctx.tableur);
  const benevole = parTelephone.get(message.telephone);
  const attenduUnNom = benevole && benevole.nomDemandeLe !== '' && benevole.prenom === '' && benevole.nom === '';
  if (!benevole || !attenduUnNom) return; // message privé qui ne concerne pas le bot

  const nomComplet = lireNomComplet(message.texte);
  if (nomComplet === null) {
    ctx.logger.info(
      `Message privé de ${benevole.nomWhatsApp || formaterTelephone(benevole.telephone)} non compris comme un nom : ` +
      `« ${message.texte} » (à traiter à la main si besoin)`,
    );
    await repondreNomIncompris(ctx, benevole);
    return;
  }
  await enregistrerNom(ctx, benevole, nomComplet);
}

/** Nombre maximum de messages « je suis un robot… » par personne (jamais de ping-pong sans fin). */
const MAX_REPONSES_NOM_INCOMPRIS = 2;

/**
 * La réponse à la demande de nom n'est pas un nom (question, « salut », emoji…) : le bot
 * explique qu'il est un robot, redemande le nom, et donne le contact du référent pour les
 * vraies questions. Le numéro du référent n'apparaît QUE dans ce message (décidé le 23/11/2026),
 * pour qu'il ne soit pas sollicité pour rien.
 */
async function repondreNomIncompris(ctx: Contexte, benevole: Benevole): Promise<void> {
  const cle = `nom-incompris:${benevole.telephone}`;
  const dejaEnvoyes = Number(ctx.etat.lire(cle) ?? 0);
  if (dejaEnvoyes >= MAX_REPONSES_NOM_INCOMPRIS) return; // déjà expliqué 2 fois : l'équipe corrigera à la main

  const { parametres } = await lireParametres(ctx.tableur);
  const contact = parametres.numeroReferent
    ? `le référent au ${formaterTelephone(parametres.numeroReferent)}`
    : "un responsable de l'association";
  try {
    await ctx.messagerie.envoyerTexte(benevole.telephone, remplirModele(MESSAGES.NOM_INCOMPRIS, { contact }));
    ctx.etat.ecrire(cle, String(dejaEnvoyes + 1));
  } catch (erreur) {
    ctx.logger.avertissement(`Message « nom incompris » non envoyé à ${formaterTelephone(benevole.telephone)} : ${String(erreur)}`);
  }
}

/**
 * NON en privé d'une personne encore « Inscrit » (avant les demandes de confirmation) :
 * on la retire. Une seule inscription concernée → retirée ; plusieurs → on explique.
 */
async function retirerEnPrive(ctx: Contexte, telephone: string): Promise<void> {
  const aujourdhui = cleDate(ctx.horloge.maintenant());
  const { actions } = await lireActions(ctx.tableur);
  const annoncees = new Map(actions
    .filter((a) => a.statut === STATUT_ACTION.ANNONCEE && a.date >= aujourdhui)
    .map((a) => [a.id, a]));
  if (annoncees.size === 0) return;
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const concernees = inscriptions.filter((i) =>
    i.telephone === telephone && annoncees.has(i.actionId) && i.statut === STATUT_INSCRIPTION.INSCRIT);
  if (concernees.length === 0) return;

  if (concernees.length > 1) {
    await envoyerSansPlanter(ctx, telephone, MESSAGES.CITER_POUR_RETIRER);
    return;
  }
  const [inscription] = concernees;
  await modifierInscriptions(ctx.tableur, [{ inscription, changements: { statut: STATUT_INSCRIPTION.RETIRE } }], ctx.horloge.maintenant());
  ctx.logger.info(`Retiré (NON en privé) : ${inscription.nom} pour ${annoncees.get(inscription.actionId)?.type} du ${dateLongue(inscription.date)}`);
  await envoyerSansPlanter(ctx, telephone, MESSAGES.ACCUSE_RECEPTION);
}

async function envoyerSansPlanter(ctx: Contexte, destinataire: string, texte: string): Promise<void> {
  try {
    await ctx.messagerie.envoyerTexte(destinataire, texte);
  } catch (erreur) {
    ctx.logger.avertissement(`Message non envoyé à ${formaterTelephone(destinataire)} : ${String(erreur)}`);
  }
}

/** Enregistre prénom et nom, les recopie dans les inscriptions, et remercie. */
async function enregistrerNom(ctx: Contexte, benevole: Benevole, { prenom, nom }: { prenom: string; nom: string }): Promise<void> {
  const maintenant = ctx.horloge.maintenant();
  await modifierBenevole(ctx.tableur, benevole, { prenom, nom });
  const nomListe = nomPourListe(benevole);

  // Les inscriptions gardent une copie du nom (pour les vues Présents / Absents) : on la met à jour.
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const aMettreAJour = inscriptions.filter((i: Inscription) => i.telephone === benevole.telephone && i.nom !== nomListe);
  await modifierInscriptions(ctx.tableur, aMettreAJour.map((inscription) => ({ inscription, changements: { nom: nomListe } })), maintenant);

  ctx.logger.info(`Nom enregistré : ${nomListe} (${formaterTelephone(benevole.telephone)})`);
  try {
    await ctx.messagerie.envoyerTexte(benevole.telephone, remplirModele(MESSAGES.MERCI_NOM, { prenom }));
  } catch (erreur) {
    ctx.logger.avertissement(`Remerciement non envoyé à ${nomListe} : ${String(erreur)}`);
  }
}
