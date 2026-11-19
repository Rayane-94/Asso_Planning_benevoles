/**
 * Horloge contrôlée pour les tests : le temps ne passe que quand le test le décide.
 *
 *   const horloge = new HorlogeDeTest('2026-11-21 18:00'); // samedi 18:00 à Paris
 *   horloge.avancer({ jours: 2 });                         // lundi 18:00
 *   horloge.texte();                                       // '2026-11-23 18:00'
 *
 * Toutes les heures sont des heures de PARIS.
 */
import type { Horloge } from '../../src/ports/horloge.ts';
import { ajouterJours, cleDate, heureDe, instantDeParis } from '../../src/utils/dates.ts';

export class HorlogeDeTest implements Horloge {
  private instant: Date;
  /** Durées des pauses demandées par le bot (pour vérifier l'espacement des messages). */
  readonly pauses: number[] = [];

  /** @param depart heure de Paris, 'yyyy-MM-dd HH:mm' (par défaut : lundi 16/11/2026 09:00) */
  constructor(depart = '2026-11-16 09:00') {
    this.instant = lireHeureDeParis(depart);
  }

  maintenant(): Date {
    return new Date(this.instant.getTime()); // une copie : personne ne peut modifier l'horloge par accident
  }

  /** Ne fait pas attendre le test : avance simplement l'horloge. */
  async attendre(ms: number): Promise<void> {
    this.pauses.push(ms);
    this.instant = new Date(this.instant.getTime() + ms);
  }

  /** Saute directement à une date et une heure de Paris. */
  regler(texte: string): void {
    this.instant = lireHeureDeParis(texte);
  }

  /**
   * Fait avancer le temps.
   * « 1 jour » = même heure le lendemain, même lors d'un changement d'heure (pas 24 h pile).
   */
  avancer({ jours = 0, heures = 0, minutes = 0, secondes = 0 }: Duree): void {
    if (jours !== 0) {
      const secondesEtMs = this.instant.getTime() % 60_000; // conservées telles quelles
      const lendemain = instantDeParis(ajouterJours(cleDate(this.instant), jours), heureDe(this.instant));
      this.instant = new Date(lendemain.getTime() + secondesEtMs);
    }
    const dureeMs = ((heures * 60 + minutes) * 60 + secondes) * 1000;
    this.instant = new Date(this.instant.getTime() + dureeMs);
  }

  /** L'heure actuelle à Paris, lisible : '2026-11-21 18:00'. */
  texte(): string {
    return `${cleDate(this.instant)} ${heureDe(this.instant)}`;
  }
}

export interface Duree {
  jours?: number;
  heures?: number;
  minutes?: number;
  secondes?: number;
}

/** 'yyyy-MM-dd HH:mm' ou 'yyyy-MM-dd' (heure de Paris) → Date */
function lireHeureDeParis(texte: string): Date {
  const m = texte.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/);
  if (!m) throw new Error(`HorlogeDeTest : format attendu 'yyyy-MM-dd HH:mm', reçu « ${texte} »`);
  return instantDeParis(m[1], m[2] ?? '00:00');
}
