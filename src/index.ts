/**
 * index.ts — Le point d'entrée : démarre le bot.
 *
 * C'est le SEUL fichier qui assemble les vraies pièces : Google Sheets, WAHA, l'horloge
 * système, les fichiers d'état. Tout le reste du code ne connaît que des contrats
 * (Tableur, Messagerie, Horloge…), ce qui permet de le tester avec des faux.
 *
 * Lancement : npm start   (arrêt : Ctrl+C, le Journal est enregistré avant de quitter)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chargerConfig, ErreurConfig, resumerConfig } from './config.ts';
import { creerEtatFichier } from './etat/etatLocal.ts';
import { creerMemoireMessages } from './etat/memoireMessages.ts';
import { prendreVerrouInstance } from './etat/verrouInstance.ts';
import { estEnPause } from './metier/commandes.ts';
import { ecrireEtat } from './sheets/etatBot.ts';
import { ELEMENTS_ETAT } from './sheets/schema.ts';
import { horodatage } from './utils/dates.ts';
import type { Contexte } from './metier/contexte.ts';
import { recevoirMessage } from './metier/reception.ts';
import { creerPlanificateur } from './planificateur.ts';
import { horlogeSysteme } from './ports/horloge.ts';
import { demarrerServeur } from './serveur.ts';
import { creerAlertesSheet } from './sheets/etatBot.ts';
import { GoogleSheets } from './sheets/googleSheets.ts';
import { creerLoggerJournalise, JournalSheet } from './sheets/journal.ts';
import { creerLoggerSansRepetition } from './utils/antiRepetition.ts';
import { creerFileExclusive } from './utils/fileExclusive.ts';
import { creerLogger } from './utils/logger.ts';
import { MessagerieWaha } from './whatsapp/waha.ts';

async function demarrer(): Promise<void> {
  // 1) Configuration (.env) — s'arrête tout de suite avec un message clair si elle est incomplète
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = chargerConfig();
  // Un seul bot à la fois (sinon chaque message partirait en double)
  const libererVerrou = prendreVerrouInstance(join(config.dossierDonnees, 'bot.lock'));
  process.once('exit', libererVerrou);

  // 2) Les vraies pièces
  const horloge = horlogeSysteme;
  const google = new GoogleSheets(config.google);
  const journal = new JournalSheet(google, horloge);
  // Logger : terminal + onglet Journal, sans répéter le même avertissement chaque minute
  const logger = creerLoggerSansRepetition(creerLoggerJournalise(creerLogger(config.niveauLog), journal), horloge);
  const etat = creerEtatFichier(join(config.dossierDonnees, 'etat.json'));

  const ctx: Contexte = {
    tableur: google,
    messagerie: new MessagerieWaha(config.waha),
    horloge,
    logger,
    groupeId: config.groupeId,
    file: creerFileExclusive(),
    memoireMessages: creerMemoireMessages(1000, etat),
    etat,
    alertes: creerAlertesSheet(google),
  };

  // 3) Démarrage : serveur (réception des messages) puis planificateur (tâches à heure fixe)
  const serveur = await demarrerServeur({
    port: config.port,
    logger,
    surMessage: (message) => recevoirMessage(ctx, message),
  });
  const planificateur = creerPlanificateur(ctx, journal);

  logger.info('Bot démarré');
  for (const [cle, valeur] of Object.entries(resumerConfig(config))) logger.info(`  ${cle} : ${valeur}`);
  if (config.groupeId === null) logger.avertissement('GROUPE_ID manquant : lancer « npm run lister-groupes » puis le mettre dans le .env');
  await noterEtatDuBot(ctx);
  planificateur.demarrer(config.intervalleTickSecondes * 1000);

  // 4) Arrêt propre (Ctrl+C, ou « docker stop » qui envoie SIGTERM)
  const arreter = async (signal: string): Promise<void> => {
    logger.info(`Arrêt du bot (${signal})`);
    planificateur.arreter();
    serveur.close();
    try {
      await journal.enregistrer(); // ne pas perdre les derniers messages du Journal
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void arreter('SIGINT'));
  process.once('SIGTERM', () => void arreter('SIGTERM'));
}

/** Tableau de bord, ligne « Bot » : 🟢 Actif (ou ⏸️ En pause) dès le démarrage. */
async function noterEtatDuBot(ctx: Contexte): Promise<void> {
  const depuis = horodatage(ctx.horloge.maintenant());
  try {
    await ecrireEtat(ctx.tableur, ELEMENTS_ETAT.BOT, estEnPause(ctx)
      ? { etat: '⏸️ En pause', depuis, queFaire: 'Plus aucun envoi automatique. Cocher « Reprendre » dans Commandes pour relancer.' }
      : { etat: '🟢 Actif', depuis });
  } catch (erreur) {
    ctx.logger.avertissement(`Tableau de bord non mis à jour : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  }
}

demarrer().catch((erreur: unknown) => {
  console.error('❌ Le bot n\'a pas pu démarrer :\n' + (erreur instanceof ErreurConfig || erreur instanceof Error ? erreur.message : String(erreur)));
  process.exitCode = 1;
});
