/**
 * sheets/journal.ts — L'onglet Journal : ce que le bot a fait, visible par l'équipe.
 *
 * Pour économiser le quota Google, les messages sont gardés en mémoire puis écrits
 * EN UNE FOIS par enregistrer() (appelé à la fin de chaque tick). On ne garde que les
 * 1000 dernières lignes : les plus anciennes sont supprimées.
 *
 * Utilisation habituelle : via creerLoggerJournalise(), qui écrit à la fois dans le
 * terminal et dans le Journal.
 */
import { ONGLETS } from '../constantes.ts';
import type { Horloge } from '../ports/horloge.ts';
import type { Tableur, Valeurs } from '../ports/tableur.ts';
import { horodatage } from '../utils/dates.ts';
import { decrireErreur, NIVEAUX_LOG, type Logger, type NiveauLog } from '../utils/logger.ts';
import { COLONNES_JOURNAL } from './schema.ts';

const J = COLONNES_JOURNAL;

/** Une cellule Google accepte 50 000 caractères ; on coupe bien avant pour rester lisible. */
const LONGUEUR_MAX_MESSAGE = 1000;
/** Si Google est injoignable longtemps, on ne garde pas une mémoire infinie. */
const ATTENTE_MAX = 500;

export class JournalSheet {
  private enAttente: Valeurs[] = [];
  private readonly tableur: Tableur;
  private readonly horloge: Horloge;
  private readonly lignesMax: number;

  constructor(tableur: Tableur, horloge: Horloge, lignesMax = 1000) {
    this.tableur = tableur;
    this.horloge = horloge;
    this.lignesMax = lignesMax;
  }

  /** Note un message (pas encore écrit dans le Sheet). */
  ajouter(niveau: NiveauLog, message: string): void {
    const texte = message.length > LONGUEUR_MAX_MESSAGE ? message.slice(0, LONGUEUR_MAX_MESSAGE) + '…' : message;
    this.enAttente.push({ [J.DATE]: horodatage(this.horloge.maintenant()), [J.NIVEAU]: niveau.toUpperCase(), [J.MESSAGE]: texte });
    if (this.enAttente.length > ATTENTE_MAX) this.enAttente.splice(0, this.enAttente.length - ATTENTE_MAX);
  }

  /** Nombre de messages pas encore écrits. */
  get nombreEnAttente(): number {
    return this.enAttente.length;
  }

  /**
   * Écrit les messages en attente, puis supprime les plus anciennes lignes au-delà de la limite.
   * En cas d'échec (Google injoignable), les messages restent en attente pour la prochaine fois.
   */
  async enregistrer(): Promise<void> {
    if (this.enAttente.length === 0) return;
    const lot = this.enAttente;
    this.enAttente = [];
    try {
      await this.tableur.ajouterLignes(ONGLETS.JOURNAL, lot);
    } catch (erreur) {
      this.enAttente = [...lot, ...this.enAttente]; // on réessaiera au prochain tick
      throw erreur;
    }

    const { lignes } = await this.tableur.lireOnglet(ONGLETS.JOURNAL);
    const enTrop = lignes.length - this.lignesMax;
    if (enTrop > 0) await this.tableur.supprimerLignes(ONGLETS.JOURNAL, 2, enTrop); // les plus anciennes sont en haut
  }
}

/**
 * Logger qui écrit dans le terminal (logger de base) ET dans le Journal du Sheet.
 * Le Journal ne reçoit que les messages à partir de `niveauMinimumJournal` (par défaut
 * « info ») : les détails techniques (debug) restent dans le terminal.
 */
export function creerLoggerJournalise(base: Logger, journal: JournalSheet, niveauMinimumJournal: NiveauLog = 'info'): Logger {
  const rangMinimum = NIVEAUX_LOG.indexOf(niveauMinimumJournal);
  const versJournal = (niveau: NiveauLog, message: string): void => {
    if (NIVEAUX_LOG.indexOf(niveau) >= rangMinimum) journal.ajouter(niveau, message);
  };

  return {
    debug: (message) => { base.debug(message); versJournal('debug', message); },
    info: (message) => { base.info(message); versJournal('info', message); },
    avertissement: (message) => { base.avertissement(message); versJournal('avertissement', message); },
    erreur: (message, cause) => {
      base.erreur(message, cause);
      versJournal('erreur', cause === undefined ? message : `${message} : ${decrireErreur(cause)}`);
    },
  };
}
