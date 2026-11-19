/**
 * Un contexte complet pour tester le code métier : faux Sheet installé, fausse
 * messagerie, horloge contrôlée, et un logger dont on peut relire les messages.
 *
 *   const env = await contexteDeTest('2026-11-21 18:00');
 *   await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });
 *   await env.planificateur.tick();
 *   env.messagerie.dernierEnvoi().texte; // → '📣 BP – samedi 28/11 à 14:00 – Entrepôt…'
 */
import { creerMemoireMessages } from '../../src/etat/memoireMessages.ts';
import type { Contexte } from '../../src/metier/contexte.ts';
import { creerFileExclusive } from '../../src/utils/fileExclusive.ts';
import { creerPlanificateur, type Planificateur } from '../../src/planificateur.ts';
import type { Valeurs } from '../../src/ports/tableur.ts';
import { creerLoggerSansRepetition } from '../../src/utils/antiRepetition.ts';
import { creerLogger } from '../../src/utils/logger.ts';
import { FausseMessagerie, GROUPE_TEST } from './fausseMessagerie.ts';
import type { FauxTableur } from './fauxTableur.ts';
import { HorlogeDeTest } from './horlogeDeTest.ts';
import { ajouterLignesDeTest, sheetInstalle } from './sheetDeTest.ts';

export interface EnvironnementDeTest {
  ctx: Contexte;
  tableur: FauxTableur;
  messagerie: FausseMessagerie;
  horloge: HorlogeDeTest;
  planificateur: Planificateur;
  /** Toutes les lignes écrites par le logger (format « … [NIVEAU] message »). */
  logs: string[];
}

export async function contexteDeTest(depart = '2026-11-21 18:00'): Promise<EnvironnementDeTest> {
  const horloge = new HorlogeDeTest(depart);
  const tableur = await sheetInstalle();
  const messagerie = new FausseMessagerie(horloge);
  const logs: string[] = [];
  const logger = creerLoggerSansRepetition(creerLogger('debug', (ligne) => logs.push(ligne), () => horloge.maintenant()), horloge);

  const ctx: Contexte = {
    tableur, messagerie, horloge, logger, groupeId: GROUPE_TEST,
    file: creerFileExclusive(), memoireMessages: creerMemoireMessages(),
  };
  return { ctx, tableur, messagerie, horloge, planificateur: creerPlanificateur(ctx), logs };
}

/** Ajoute une action comme le ferait le référent. */
export async function ajouterAction(env: EnvironnementDeTest, action: Valeurs): Promise<void> {
  await ajouterLignesDeTest(env.tableur, 'Actions', [action]);
}

/** Les logs d'un niveau donné (sans l'horodatage), ex. logsDeNiveau(env, 'AVERTISSEMENT'). */
export function logsDeNiveau(env: EnvironnementDeTest, niveau: string): string[] {
  return env.logs
    .filter((ligne) => ligne.includes(`[${niveau}]`))
    .map((ligne) => ligne.slice(ligne.indexOf(']') + 2));
}
