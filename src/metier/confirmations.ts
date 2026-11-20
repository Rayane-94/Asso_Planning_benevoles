/**
 * metier/confirmations.ts — Demandes de confirmation J-2 et réponses en privé (CLAUDE.md §4.4).
 *
 * Envoi : à J-2 à partir de HEURE_CONFIRMATION, chaque « Inscrit » reçoit en privé
 *   « Bonjour Bob 👋 … Tu confirmes ta présence ? Réponds OUI ou NON (avant vendredi 20:00). »
 *   → « En attente » (ou « Non joignable » si l'envoi échoue). L'action passe ensuite à
 *   « Confirmations envoyées ».
 *   Rattrapage : si le bot était arrêté à J-2, il envoie dès que possible, au plus tard
 *   la veille avant HEURE_LISTE. Jamais entre 22:00 et 08:00.
 *
 * Réponses en privé : OUI → « Confirmé », NON → « Désisté », puis « C'est noté, merci ! ».
 *   Changer d'avis reste possible tant que la liste finale n'est pas publiée.
 */
import {
  HEURE_DEBUT_ENVOIS_AUTO, HEURE_FIN_ENVOIS_AUTO, MARQUEUR_ENVOI_EN_COURS, MESSAGES, PAUSE_ENTRE_MESSAGES_MS,
  REPONSE, STATUT_ACTION, STATUT_INSCRIPTION, type Reponse,
} from '../constantes.ts';
import type { MessageRecu } from '../ports/messagerie.ts';
import { lireActions, modifierAction, type Action } from '../sheets/actions.ts';
import { lireBenevoles, prenomPourMessage, type Benevole } from '../sheets/benevoles.ts';
import { lireInscriptions, modifierInscriptions, type ChangementsInscription, type Inscription } from '../sheets/inscriptions.ts';
import type { Parametres } from '../sheets/parametres.ts';
import { ajouterJours, cleDate, dateLongue, ecartJours, heureDe, jourSemaine } from '../utils/dates.ts';
import { formaterTelephone } from '../utils/telephones.ts';
import { remplirModele } from '../utils/textes.ts';
import { estDansLaFenetre } from './annonces.ts';
import type { Contexte, DonneesDuTick } from './contexte.ts';

export type ModeConfirmation = 'automatique' | 'commande';

/** Les résultats d'envoi sont écrits par paquets (quota Google : ~60 écritures par minute). */
const TAILLE_PAQUET_ECRITURE = 10;

// ===========================================================================
// Envoi des demandes
// ===========================================================================

/**
 * Envoie les demandes de confirmation dues.
 * @return le nombre de demandes envoyées
 */
export async function envoyerConfirmations(ctx: Contexte, donnees: DonneesDuTick, mode: ModeConfirmation): Promise<number> {
  const { parametres, actions } = donnees;
  const maintenant = ctx.horloge.maintenant();
  const concernees = actionsAConfirmer(actions, cleDate(maintenant), heureDe(maintenant), parametres, mode);
  if (concernees.length === 0) return 0; // le cas habituel : on ne lit rien de plus

  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const { parTelephone } = await lireBenevoles(ctx.tableur);
  signalerDemandesInterrompues(ctx, inscriptions, concernees);

  let envoyees = 0;
  for (const action of concernees) {
    const cibles = inscriptions.filter(
      (i) => i.actionId === action.id && i.statut === STATUT_INSCRIPTION.INSCRIT && i.demandeId === '',
    );
    envoyees += await envoyerPourUneAction(ctx, action, cibles, parTelephone, parametres, envoyees > 0);
    await modifierAction(ctx.tableur, action, { statut: STATUT_ACTION.CONFIRMATIONS_ENVOYEES });
    ctx.logger.info(`Confirmations envoyées pour ${action.type} du ${dateLongue(action.date)} : ${cibles.length} demande(s)`);
  }
  return envoyees;
}

/**
 * Les actions dont il faut envoyer les demandes maintenant (exportée pour les tests).
 * J = aujourd'hui ; avec les réglages par défaut :
 *   - J+2 (jour normal) : à partir de 10:00 ;
 *   - J+1 (rattrapage)  : avant 20:00 (après, c'est l'heure de la liste finale) ;
 *   - jamais entre 22:00 et 08:00 ; la commande manuelle, elle, marche à toute heure.
 */
export function actionsAConfirmer(
  actions: Action[], aujourdhui: string, heure: string, parametres: Parametres, mode: ModeConfirmation,
): Action[] {
  const joursAvant = parametres.joursAvantConfirmation;
  return actions
    .filter((action) => action.statut === STATUT_ACTION.ANNONCEE)
    .filter((action) => {
      const ecart = ecartJours(aujourdhui, action.date);
      if (mode === 'commande') return ecart >= 0 && ecart <= joursAvant;
      if (!estDansLaFenetre(heure, HEURE_DEBUT_ENVOIS_AUTO, HEURE_FIN_ENVOIS_AUTO)) return false;
      if (ecart === joursAvant) return heure >= parametres.heureConfirmation; // le jour prévu
      if (ecart === 1) return heure < parametres.heureListe; // rattrapage la veille, avant la liste
      return ecart > 1 && ecart < joursAvant; // rattrapage (si JOURS_AVANT_CONFIRMATION > 2)
    })
    .sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
}

/** Envoie les demandes d'une action, espacées, et enregistre les résultats par paquets. */
async function envoyerPourUneAction(
  ctx: Contexte, action: Action, cibles: Inscription[], benevoles: Map<string, Benevole>,
  parametres: Parametres, pauseAvantLePremier: boolean,
): Promise<number> {
  if (cibles.length === 0) return 0;

  // 1) Marqueur sur TOUTES les cibles, en une seule écriture : si le bot s'arrête en plein
  //    envoi, aucune demande ne sera renvoyée en double au redémarrage.
  await modifierInscriptions(ctx.tableur, cibles.map((inscription) => ({
    inscription, changements: { demandeId: MARQUEUR_ENVOI_EN_COURS },
  })), ctx.horloge.maintenant());

  // 2) Envois espacés ; résultats écrits tous les 10 messages
  let paquet: { inscription: Inscription; changements: ChangementsInscription }[] = [];
  let envoyees = 0;
  for (const [index, inscription] of cibles.entries()) {
    if (index > 0 || pauseAvantLePremier) await ctx.horloge.attendre(PAUSE_ENTRE_MESSAGES_MS);
    const changements = await envoyerUneDemande(ctx, action, inscription, benevoles.get(inscription.telephone), parametres);
    if (changements.statut === STATUT_INSCRIPTION.EN_ATTENTE) envoyees++;
    paquet.push({ inscription, changements });
    if (paquet.length >= TAILLE_PAQUET_ECRITURE) {
      await modifierInscriptions(ctx.tableur, paquet, ctx.horloge.maintenant());
      paquet = [];
    }
  }
  await modifierInscriptions(ctx.tableur, paquet, ctx.horloge.maintenant());
  return envoyees;
}

/**
 * Envoie UNE demande et renvoie les changements à enregistrer (sans les écrire).
 * Succès → « En attente » + ID du message ; échec → « Non joignable ».
 */
async function envoyerUneDemande(
  ctx: Contexte, action: Action, inscription: Inscription, benevole: Benevole | undefined, parametres: Parametres,
): Promise<ChangementsInscription> {
  try {
    const demandeId = await ctx.messagerie.envoyerTexte(inscription.telephone, texteDemandeConfirmation(action, benevole, parametres, inscription.creneau));
    return { statut: STATUT_INSCRIPTION.EN_ATTENTE, demandeId };
  } catch (erreur) {
    ctx.logger.avertissement(
      `Demande de confirmation non envoyée à ${inscription.nom} (${formaterTelephone(inscription.telephone)}) ` +
      `pour ${action.type} du ${dateLongue(action.date)} : ${String(erreur)}`,
    );
    return { statut: STATUT_INSCRIPTION.NON_JOIGNABLE, demandeId: '' };
  }
}

/**
 * Demande de confirmation immédiate pour UNE inscription : utilisée quand quelqu'un
 * répond OUI dans le groupe alors que les demandes de cette action sont déjà parties.
 */
export async function demanderConfirmationMaintenant(
  ctx: Contexte, action: Action, inscription: Inscription, benevole: Benevole | undefined, parametres: Parametres,
): Promise<void> {
  await modifierInscriptions(ctx.tableur, [{ inscription, changements: { demandeId: MARQUEUR_ENVOI_EN_COURS } }], ctx.horloge.maintenant());
  const changements = await envoyerUneDemande(ctx, action, inscription, benevole, parametres);
  await modifierInscriptions(ctx.tableur, [{ inscription, changements }], ctx.horloge.maintenant());
  if (changements.statut === STATUT_INSCRIPTION.EN_ATTENTE) {
    ctx.logger.info(`Demande de confirmation envoyée tout de suite à ${inscription.nom} (inscrit après l'envoi des confirmations)`);
  }
}

/**
 * Le texte de la demande, à partir du modèle TEXTE_CONFIRMATION des Paramètres.
 * Si la personne a choisi un ou des créneaux, ils sont ajoutés à la fin (quel que soit le modèle).
 */
export function texteDemandeConfirmation(
  action: Action, benevole: Benevole | undefined, parametres: Parametres, creneau = '',
): string {
  const veille = ajouterJours(action.date, -1);
  const texte = remplirModele(parametres.textes.confirmation, {
    prenom: benevole ? prenomPourMessage(benevole) : '',
    type: action.type,
    date: dateLongue(action.date),
    heure: action.heure,
    lieu: action.lieu,
    limite: `${jourSemaine(veille)} ${parametres.heureListe}`, // ex. « vendredi 20:00 »
  });
  return avecCreneau(texte.replace(/ {2,}/g, ' '), creneau); // « Bonjour  👋 » (prénom inconnu) → « Bonjour 👋 »
}

/** Ajoute « Créneau : … » à la fin d'un message, si la personne a choisi un créneau. */
export function avecCreneau(texte: string, creneau: string): string {
  return creneau ? `${texte}\n🕒 Créneau : ${creneau}` : texte;
}

/** Inscriptions bloquées avec le marqueur : le bot s'est arrêté en plein envoi. Un humain vérifie. */
function signalerDemandesInterrompues(ctx: Contexte, inscriptions: Inscription[], actions: Action[]): void {
  const ids = new Set(actions.map((action) => action.id));
  for (const inscription of inscriptions) {
    if (ids.has(inscription.actionId) && inscription.demandeId === MARQUEUR_ENVOI_EN_COURS) {
      ctx.logger.avertissement(
        `Demande de confirmation à ${inscription.nom} (ligne ${inscription.numero} d'Inscriptions) peut-être interrompue : ` +
        'lui demander directement, puis mettre son Statut à la main.',
      );
    }
  }
}

// ===========================================================================
// Réponses en privé
// ===========================================================================

/** Statuts d'une demande « ouverte » (on peut encore y répondre ou changer d'avis). */
const STATUTS_OUVERTS: string[] = [STATUT_INSCRIPTION.EN_ATTENTE, STATUT_INSCRIPTION.CONFIRME, STATUT_INSCRIPTION.DESISTE];

/**
 * Applique un OUI / NON reçu en privé à la bonne demande de confirmation.
 * @return true si le message concernait une demande (traité), false sinon
 */
export async function traiterReponseConfirmation(ctx: Contexte, message: MessageRecu, reponse: Reponse): Promise<boolean> {
  const telephone = message.telephone;
  if (telephone === null) return false;

  // Demandes encore ouvertes : action « Confirmations envoyées » (liste pas encore publiée)
  const { actions } = await lireActions(ctx.tableur);
  const actionsOuvertes = new Map(
    actions.filter((a) => a.statut === STATUT_ACTION.CONFIRMATIONS_ENVOYEES).map((a) => [a.id, a]),
  );
  if (actionsOuvertes.size === 0) return false;
  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const ouvertes = inscriptions.filter((i) =>
    i.telephone === telephone && actionsOuvertes.has(i.actionId) && STATUTS_OUVERTS.includes(i.statut) &&
    i.demandeId !== '' && i.demandeId !== MARQUEUR_ENVOI_EN_COURS,
  );
  if (ouvertes.length === 0) return false;

  const cible = choisirDemande(ouvertes, message.citeId);
  if (cible === null) {
    // Plusieurs possibilités et pas de citation : on ne devine pas, on demande.
    await envoyerSansPlanter(ctx, telephone, MESSAGES.CITER_LE_MESSAGE);
    ctx.logger.info(`${ouvertes[0].nom} a répondu ${reponse} sans citer, alors qu'il/elle a plusieurs demandes : précision demandée`);
    return true;
  }

  const statut = reponse === REPONSE.OUI ? STATUT_INSCRIPTION.CONFIRME : STATUT_INSCRIPTION.DESISTE;
  const action = actionsOuvertes.get(cible.actionId);
  if (cible.statut !== statut) {
    await modifierInscriptions(ctx.tableur, [{ inscription: cible, changements: { statut } }], ctx.horloge.maintenant());
  }
  ctx.logger.info(`${statut} : ${cible.nom} pour ${action?.type} du ${dateLongue(cible.date)}`);
  await envoyerSansPlanter(ctx, telephone, MESSAGES.ACCUSE_RECEPTION);
  return true;
}

/**
 * À quelle demande s'applique la réponse ?
 *   1. celle dont le message est cité ;
 *   2. sinon, s'il n'y a qu'UNE demande « En attente », celle-là ;
 *   3. sinon, s'il n'y en a aucune en attente mais une seule déjà répondue (changement d'avis), celle-là ;
 *   4. sinon : impossible de savoir → null.
 */
export function choisirDemande(ouvertes: Inscription[], citeId: string | null): Inscription | null {
  const citee = citeId === null ? undefined : ouvertes.find((i) => i.demandeId === citeId);
  if (citee) return citee;
  const enAttente = ouvertes.filter((i) => i.statut === STATUT_INSCRIPTION.EN_ATTENTE);
  const candidates = enAttente.length > 0 ? enAttente : ouvertes;
  return candidates.length === 1 ? candidates[0] : null;
}

async function envoyerSansPlanter(ctx: Contexte, destinataire: string, texte: string): Promise<void> {
  try {
    await ctx.messagerie.envoyerTexte(destinataire, texte);
  } catch (erreur) {
    ctx.logger.avertissement(`Message non envoyé à ${formaterTelephone(destinataire)} : ${String(erreur)}`);
  }
}
