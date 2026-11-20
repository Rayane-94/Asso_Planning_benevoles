/**
 * serveur.ts — Le petit serveur web du bot (Express).
 *
 *   POST /webhook/waha : WAHA nous prévient qu'un message ou un vote est arrivé (« webhook »).
 *   GET  /sante        : répond « ok » (pour vérifier que le bot tourne : Docker, curl…).
 *
 * Règle importante : on répond 200 à WAHA TOUT DE SUITE, puis on traite.
 * Sinon, si le traitement prend du temps (lecture du Sheet…), WAHA croit à un échec et
 * renvoie le même événement (d'où l'anti-doublon dans recevoirMessage / recevoirVote).
 *
 * Sécurité : ce serveur n'est jamais exposé sur Internet (réseau Docker interne sur le VPS,
 * ou ton PC en local). Seul WAHA lui parle.
 */
import type { Server } from 'node:http';
import express from 'express';
import type { MessageRecu, VoteRecu } from './ports/messagerie.ts';
import type { Logger } from './utils/logger.ts';
import { convertirWebhook, convertirWebhookVote } from './whatsapp/waha.ts';

export interface OptionsServeur {
  port: number;
  logger: Logger;
  /** Ce qu'on fait d'un message reçu (en production : recevoirMessage du code métier). */
  surMessage: (message: MessageRecu) => Promise<void>;
  /** Ce qu'on fait d'un vote dans un sondage (en production : recevoirVote). */
  surVote: (vote: VoteRecu) => Promise<void>;
}

/** Démarre le serveur. @return le serveur (pour l'arrêter proprement) */
export function demarrerServeur({ port, logger, surMessage, surVote }: OptionsServeur): Promise<Server> {
  const app = express();
  app.use(express.json({ limit: '2mb' })); // les webhooks WAHA font quelques Ko

  app.get('/sante', (_requete, reponse) => {
    reponse.json({ ok: true });
  });

  app.post('/webhook/waha', (requete, reponse) => {
    reponse.sendStatus(200); // d'abord répondre à WAHA…
    const evenement: unknown = requete.body; // … puis traiter
    const signalerErreur = (erreur: unknown) => logger.erreur('Traitement d\'un événement WhatsApp impossible', erreur);

    const message = convertirWebhook(evenement);
    if (message) {
      logger.debug(`Message reçu de ${message.nomWhatsApp || message.idBrut} : « ${message.texte.slice(0, 50)} »`);
      surMessage(message).catch(signalerErreur);
      return;
    }
    const vote = convertirWebhookVote(evenement);
    if (vote) {
      logger.debug(`Vote reçu de ${vote.nomWhatsApp || vote.idBrut} : ${JSON.stringify(vote.choix)}`);
      surVote(vote).catch(signalerErreur);
      return;
    }
    if ((evenement as { event?: string })?.event === 'poll.vote.failed') {
      // WhatsApp chiffre les votes ; très rarement, WAHA n'arrive pas à en lire un.
      logger.avertissement('Un vote de sondage n\'a pas pu être lu : vérifier les votes dans WhatsApp (« Voir les votes ») et corriger le Sheet si besoin');
    }
  });

  return new Promise((resolve, reject) => {
    const serveur = app.listen(port, () => resolve(serveur));
    serveur.on('error', reject); // ex. port déjà utilisé
  });
}
