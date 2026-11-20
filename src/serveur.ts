/**
 * serveur.ts — Le petit serveur web du bot (Express).
 *
 *   POST /webhook/waha : WAHA nous prévient qu'un message est arrivé (« webhook »).
 *   GET  /sante        : répond « ok » (pour vérifier que le bot tourne : Docker, curl…).
 *
 * Règle importante : on répond 200 à WAHA TOUT DE SUITE, puis on traite le message.
 * Sinon, si le traitement prend du temps (lecture du Sheet…), WAHA croit à un échec et
 * renvoie le même message (d'où l'anti-doublon dans recevoirMessage).
 *
 * Sécurité : ce serveur n'est jamais exposé sur Internet (réseau Docker interne sur le VPS,
 * ou ton PC en local). Seul WAHA lui parle.
 */
import type { Server } from 'node:http';
import express from 'express';
import type { MessageRecu } from './ports/messagerie.ts';
import type { Logger } from './utils/logger.ts';
import { convertirWebhook } from './whatsapp/waha.ts';

export interface OptionsServeur {
  port: number;
  logger: Logger;
  /** Ce qu'on fait d'un message reçu (en production : recevoirMessage du code métier). */
  surMessage: (message: MessageRecu) => Promise<void>;
}

/** Démarre le serveur. @return le serveur (pour l'arrêter proprement) */
export function demarrerServeur({ port, logger, surMessage }: OptionsServeur): Promise<Server> {
  const app = express();
  app.use(express.json({ limit: '2mb' })); // les webhooks WAHA font quelques Ko

  app.get('/sante', (_requete, reponse) => {
    reponse.json({ ok: true });
  });

  app.post('/webhook/waha', (requete, reponse) => {
    reponse.sendStatus(200); // d'abord répondre à WAHA…
    const message = convertirWebhook(requete.body); // … puis traiter
    if (message === null) return; // événement qui ne concerne pas le bot
    logger.debug(`Message reçu de ${message.nomWhatsApp || message.idBrut} : « ${message.texte.slice(0, 50)} »`);
    surMessage(message).catch((erreur: unknown) => logger.erreur('Traitement d\'un message reçu impossible', erreur));
  });

  return new Promise((resolve, reject) => {
    const serveur = app.listen(port, () => resolve(serveur));
    serveur.on('error', reject); // ex. port déjà utilisé
  });
}
