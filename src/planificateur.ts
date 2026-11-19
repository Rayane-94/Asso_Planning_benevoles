/**
 * planificateur.ts — Le « cœur qui bat » du bot.
 *
 * Toutes les minutes, tick() :
 *   1. lit le Sheet UNE fois (paramètres + actions) et signale les lignes inutilisables ;
 *   2. donne un ID aux nouvelles actions ;
 *   3. lance chaque tâche dont c'est l'heure (pour l'instant : les annonces) ;
 *   4. écrit le Journal dans le Sheet.
 *
 * Sécurités :
 *   - un seul tick à la fois (si le précédent n'est pas fini, on saute ce tour) ;
 *   - chaque tâche est isolée : si l'une plante, les autres continuent ;
 *   - les tâches sont « idempotentes » : relancées, elles ne refont pas ce qui est fait
 *     (grâce aux statuts dans le Sheet), donc un redémarrage ne crée jamais de doublon.
 */
import type { Contexte, DonneesDuTick } from './metier/contexte.ts';
import { publierAnnonces } from './metier/annonces.ts';
import { envoyerConfirmations } from './metier/confirmations.ts';
import { attribuerIdsActions, lireActions } from './sheets/actions.ts';
import { lireParametres } from './sheets/parametres.ts';

/** Ce qui doit être écrit à la fin de chaque tick (le Journal du Sheet). */
export interface Enregistrable {
  enregistrer(): Promise<void>;
}

export interface Planificateur {
  /** Un passage complet. Exporté pour les tests et les commandes manuelles. */
  tick(): Promise<void>;
  /** Lance tick() toutes les `intervalleMs` (60 s par défaut). */
  demarrer(intervalleMs?: number): void;
  arreter(): void;
}

/**
 * @param ctx le contexte (idéalement avec un logger « sans répétition »)
 * @param journal le Journal à écrire à la fin de chaque tick (facultatif)
 */
export function creerPlanificateur(ctx: Contexte, journal?: Enregistrable): Planificateur {
  let enCours = false;
  let minuterie: ReturnType<typeof setInterval> | null = null;

  /** Lance une tâche en l'isolant : une erreur est notée, mais n'arrête pas le tick. */
  async function tache(nom: string, executer: () => Promise<unknown>): Promise<void> {
    try {
      await executer();
    } catch (erreur) {
      ctx.logger.erreur(`Tâche « ${nom} » en échec`, erreur);
    }
  }

  async function tick(): Promise<void> {
    if (enCours) {
      ctx.logger.debug('Tick précédent encore en cours : tour sauté');
      return;
    }
    enCours = true;
    try {
      // Dans la file partagée avec les messages reçus : jamais deux écritures simultanées.
      await ctx.file.executer(async () => {
        const donnees = await lireDonnees();
        if (donnees) {
          await tache('Annonces', () => publierAnnonces(ctx, donnees, 'automatique'));
          await tache('Confirmations', () => envoyerConfirmations(ctx, donnees, 'automatique'));
          // Étapes suivantes : liste J-1, récap, commandes…
        }
      });
    } finally {
      enCours = false;
      if (journal) {
        try {
          await journal.enregistrer();
        } catch (erreur) {
          // Pas dans le Journal (c'est lui qui échoue) : seulement dans le terminal.
          ctx.logger.debug(`Journal non enregistré, nouvel essai au prochain tick : ${String(erreur)}`);
        }
      }
    }
  }

  /** Lit paramètres et actions. Renvoie null si le Sheet est inaccessible (rien d'autre n'est possible). */
  async function lireDonnees(): Promise<DonneesDuTick | null> {
    try {
      const { parametres, avertissements } = await lireParametres(ctx.tableur);
      for (const avertissement of avertissements) ctx.logger.avertissement(avertissement);

      const { actions, ignorees } = await lireActions(ctx.tableur);
      for (const { numero, raison } of ignorees) ctx.logger.avertissement(`Actions, ligne ${numero} ignorée : ${raison}`);

      const nouvelles = await attribuerIdsActions(ctx.tableur, actions);
      for (const action of nouvelles) ctx.logger.info(`Nouvelle action : ${action.id} — ${action.type} du ${action.date} à ${action.heure}`);

      return { parametres, actions };
    } catch (erreur) {
      ctx.logger.erreur('Lecture du Google Sheet impossible', erreur);
      return null;
    }
  }

  return {
    tick,
    demarrer(intervalleMs = 60_000) {
      if (minuterie) return;
      void tick(); // un premier passage tout de suite
      minuterie = setInterval(() => void tick(), intervalleMs);
    },
    arreter() {
      if (minuterie) clearInterval(minuterie);
      minuterie = null;
    },
  };
}
