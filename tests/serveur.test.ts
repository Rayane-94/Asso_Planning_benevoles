/**
 * Le serveur Express, testé pour de vrai : on le démarre sur un port libre et on lui
 * envoie des requêtes HTTP, comme le ferait WAHA.
 */
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import type { Server } from 'node:http';
import type { MessageRecu } from '../src/ports/messagerie.ts';
import { demarrerServeur } from '../src/serveur.ts';
import { creerLogger } from '../src/utils/logger.ts';
import { messageDuBot, reponseCiteeDansLeGroupe, statutSession } from './whatsapp/exemplesWaha.ts';

let serveur: Server | null = null;
afterEach(() => { serveur?.close(); serveur = null; });

/** Démarre le serveur sur un port libre (0 = « choisis-en un ») et note les messages transmis. */
async function demarrer(surMessage?: (m: MessageRecu) => Promise<void>) {
  const recus: MessageRecu[] = [];
  serveur = await demarrerServeur({
    port: 0,
    logger: creerLogger('erreur', () => {}),
    surMessage: surMessage ?? (async (message) => { recus.push(message); }),
  });
  const adresse = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const envoyer = (corps: unknown) => fetch(`${adresse}/webhook/waha`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  });
  return { adresse, envoyer, recus };
}

/** Laisse le temps au traitement (lancé après la réponse) de se faire. */
const unInstant = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('serveur', () => {
  test('GET /sante répond ok', async () => {
    const { adresse } = await demarrer();
    const reponse = await fetch(`${adresse}/sante`);
    expect(await reponse.json()).toEqual({ ok: true });
  });

  test('webhook d\'un message : répond 200 et transmet le MessageRecu au bot', async () => {
    const { envoyer, recus } = await demarrer();
    const reponse = await envoyer(reponseCiteeDansLeGroupe);
    expect(reponse.status).toBe(200);
    await unInstant();
    expect(recus).toHaveLength(1);
    expect(recus[0].texte).toBe('oui');
  });

  test('événements qui ne concernent pas le bot : 200, mais rien de transmis', async () => {
    const { envoyer, recus } = await demarrer();
    for (const evenement of [statutSession, messageDuBot]) expect((await envoyer(evenement)).status).toBe(200);
    await unInstant();
    expect(recus).toEqual([]);
  });

  test('répond 200 AVANT la fin du traitement (sinon WAHA renverrait le message)', async () => {
    let fini = false;
    const { envoyer } = await demarrer(async () => { await new Promise((r) => setTimeout(r, 200)); fini = true; });
    const reponse = await envoyer(reponseCiteeDansLeGroupe);
    expect(reponse.status).toBe(200);
    expect(fini).toBe(false); // la réponse est arrivée alors que le traitement continue
  });

  test('un traitement qui plante ne fait pas tomber le serveur', async () => {
    const { envoyer, adresse } = await demarrer(async () => { throw new Error('boum'); });
    await envoyer(reponseCiteeDansLeGroupe);
    await unInstant();
    expect((await fetch(`${adresse}/sante`)).status).toBe(200);
  });
});
