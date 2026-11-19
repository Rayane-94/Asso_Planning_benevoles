/**
 * utils/antiRepetition.ts — Évite de noyer le Journal sous le même message.
 *
 * Le tick tourne chaque minute : sans ce filtre, « ligne 5 incomplète » serait écrit
 * 60 fois par heure. Ici, un même avertissement (ou une même erreur) n'est écrit qu'une
 * fois par période (1 h par défaut). Les messages « info » et « debug » passent toujours.
 */
import type { Horloge } from '../ports/horloge.ts';
import { decrireErreur, type Logger } from './logger.ts';

export function creerLoggerSansRepetition(base: Logger, horloge: Horloge, periodeMs = 60 * 60 * 1000): Logger {
  /** Dernière fois que chaque message a été écrit (en ms). */
  const derniereFois = new Map<string, number>();

  /** true si ce message n'a pas été écrit depuis au moins `periodeMs`. */
  const aEcrire = (cle: string): boolean => {
    const maintenant = horloge.maintenant().getTime();
    const precedent = derniereFois.get(cle);
    if (precedent !== undefined && maintenant - precedent < periodeMs) return false;
    derniereFois.set(cle, maintenant);
    return true;
  };

  return {
    debug: (message) => base.debug(message),
    info: (message) => base.info(message),
    avertissement: (message) => {
      if (aEcrire(`avertissement:${message}`)) base.avertissement(message);
    },
    erreur: (message, cause) => {
      const cle = `erreur:${message}:${cause === undefined ? '' : decrireErreur(cause)}`;
      if (aEcrire(cle)) base.erreur(message, cause);
    },
  };
}
