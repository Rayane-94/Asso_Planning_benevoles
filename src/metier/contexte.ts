/**
 * metier/contexte.ts — Tout ce dont le code métier a besoin, regroupé dans un seul objet.
 *
 * Le code métier reçoit ce « contexte » au lieu d'aller chercher lui-même WhatsApp,
 * Google ou l'heure. En production, index.ts y met les vrais services ; dans les tests,
 * on y met les faux (tests/faux/contexteDeTest.ts).
 */
import type { MemoireMessages } from '../etat/memoireMessages.ts';
import type { Horloge } from '../ports/horloge.ts';
import type { FileExclusive } from '../utils/fileExclusive.ts';
import type { Messagerie } from '../ports/messagerie.ts';
import type { Tableur } from '../ports/tableur.ts';
import type { Action } from '../sheets/actions.ts';
import type { Parametres } from '../sheets/parametres.ts';
import type { Logger } from '../utils/logger.ts';

export interface Contexte {
  tableur: Tableur;
  messagerie: Messagerie;
  horloge: Horloge;
  logger: Logger;
  /** ID du groupe WhatsApp des bénévoles (null tant qu'il n'est pas configuré). */
  groupeId: string | null;
  /** File d'attente partagée par le tick et les messages : un seul accès au Sheet à la fois. */
  file: FileExclusive;
  /** Messages déjà traités (anti-doublon). */
  memoireMessages: MemoireMessages;
}

/** Ce que le tick lit une fois dans le Sheet et partage entre toutes les tâches (économise le quota). */
export interface DonneesDuTick {
  parametres: Parametres;
  actions: Action[];
}
