/**
 * utils/dates.ts — Dates et heures, toujours vues depuis Paris.
 *
 * ⚠️ Le serveur tourne en UTC. Un `new Date().getHours()` donnerait l'heure de Londres
 * l'hiver… On passe donc TOUJOURS par les fonctions de ce fichier.
 *
 * Principe : on ne compare jamais des objets Date entre eux (piège des fuseaux et
 * des changements d'heure). On travaille avec des textes simples :
 *   - une « clé de date » : 'yyyy-MM-dd'  (ex. '2026-11-29')
 *   - une « heure »       : 'HH:mm'       (ex. '19:00')
 * Ces textes se comparent directement : '2026-11-29' < '2026-11-30' et '09:00' < '19:00'.
 */
import { FUSEAU, JOURS_SEMAINE } from '../constantes.ts';

/** Clé de date au format 'yyyy-MM-dd'. */
export type CleDate = string;
/** Heure au format 'HH:mm'. */
export type Heure = string;

// Formateur réutilisé : découpe un instant en année, mois, jour… vus depuis Paris.
// (Intl est intégré à Node et connaît les règles d'heure d'été/hiver.)
const formateurParis = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

/** Morceaux d'un instant vus depuis Paris, en texte ('2026', '11', '05'…). */
function morceauxParis(date: Date): Record<string, string> {
  const morceaux: Record<string, string> = {};
  for (const morceau of formateurParis.formatToParts(date)) morceaux[morceau.type] = morceau.value;
  return morceaux;
}

/**
 * Clé de date d'un instant, vue depuis Paris.
 * ex. 2026-11-28T23:30Z → '2026-11-29' (il est 00:30 à Paris)
 */
export function cleDate(date: Date): CleDate {
  const m = morceauxParis(date);
  return `${m.year}-${m.month}-${m.day}`;
}

/** Heure d'un instant, vue depuis Paris. ex. → '19:05' */
export function heureDe(date: Date): Heure {
  const m = morceauxParis(date);
  return `${m.hour}:${m.minute}`;
}

/**
 * L'instant exact correspondant à une date et une heure de Paris.
 * ex. instantDeParis('2026-11-28', '18:00') → 2026-11-28T17:00:00Z (hiver : UTC+1)
 */
export function instantDeParis(cle: CleDate, heure: Heure = '00:00'): Date {
  const [annee, mois, jour] = cle.split('-').map(Number);
  const [heures, minutes] = heure.split(':').map(Number);
  // 1) On fait comme si l'heure de Paris était l'heure UTC…
  const naif = Date.UTC(annee, mois - 1, jour, heures, minutes);
  // 2) …puis on retire le décalage de Paris à cet instant. Deux passes pour bien gérer
  //    les jours de changement d'heure.
  let essai = naif - decalageParisMs(new Date(naif));
  essai = naif - decalageParisMs(new Date(essai));
  return new Date(essai);
}

/**
 * Ajoute (ou retire, si n est négatif) des jours à une clé de date.
 * Calcul en UTC, sans fuseau : aucun piège de changement d'heure.
 * ex. ajouterJours('2026-11-29', -7) → '2026-11-22'
 */
export function ajouterJours(cle: CleDate, n: number): CleDate {
  const date = dateUtcDepuisCle(cle);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/**
 * Nombre de jours entre deux clés de date (positif si cleB est après cleA).
 * ex. ecartJours('2026-11-22', '2026-11-29') → 7
 */
export function ecartJours(cleA: CleDate, cleB: CleDate): number {
  const UN_JOUR_MS = 24 * 60 * 60 * 1000;
  return Math.round((dateUtcDepuisCle(cleB).getTime() - dateUtcDepuisCle(cleA).getTime()) / UN_JOUR_MS);
}

/** Nom du jour. ex. jourSemaine('2026-11-28') → 'samedi' */
export function jourSemaine(cle: CleDate): string {
  return JOURS_SEMAINE[dateUtcDepuisCle(cle).getUTCDay()];
}

/** Format court, pour la liste finale. ex. '2026-11-28' → '28/11' */
export function dateCourte(cle: CleDate): string {
  const [, mois, jour] = cle.split('-');
  return `${jour}/${mois}`;
}

/** Format long, pour les annonces. ex. '2026-11-28' → 'samedi 28/11' */
export function dateLongue(cle: CleDate): string {
  return `${jourSemaine(cle)} ${dateCourte(cle)}`;
}

/**
 * Lit une date tapée à la française : '28/11/2026', '28/11/26' ou '28-11-2026'.
 * @return la clé 'yyyy-MM-dd', ou null si la date est invalide (ex. 31/02)
 */
export function parseDateFr(texte: string): CleDate | null {
  const m = texte.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = Number(m[2]);
  const annee = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const cle = `${annee}-${deuxChiffres(mois)}-${deuxChiffres(jour)}`;
  // Vérifie que la date existe (refuse le 31/02) : on la reconstruit et on compare.
  const date = dateUtcDepuisCle(cle);
  if (date.getUTCMonth() + 1 !== mois || date.getUTCDate() !== jour) return null;
  return cle;
}

/**
 * Lit une heure tapée librement : '19:00', '19h', '19h30', '9H05', '19 h 30', '19:00:00', '19'.
 * @return l'heure au format 'HH:mm', ou null si invalide
 */
export function parseHeure(texte: string): Heure | null {
  const propre = texte.trim().toLowerCase().replace(/\s+/g, '');
  // heures (1 ou 2 chiffres), puis éventuellement « h » ou « : » suivi des minutes,
  // puis éventuellement des secondes (ignorées).
  const m = propre.match(/^(\d{1,2})(?:[h:](\d{2})?)?(?::\d{2})?$/);
  if (!m) return null;
  const heures = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (heures > 23 || minutes > 59) return null;
  return `${deuxChiffres(heures)}:${deuxChiffres(minutes)}`;
}

// ---------------------------------------------------------------------------
// Fonctions internes à ce fichier (non exportées)
// ---------------------------------------------------------------------------

/** Décalage (en ms) entre l'heure de Paris et UTC à un instant donné (1 h l'hiver, 2 h l'été). */
function decalageParisMs(date: Date): number {
  const m = morceauxParis(date);
  const parisCommeSiUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  return parisCommeSiUtc - (date.getTime() - date.getUTCMilliseconds());
}

/** Transforme une clé 'yyyy-MM-dd' en Date UTC à minuit (pour les calculs de jours). */
function dateUtcDepuisCle(cle: CleDate): Date {
  const [annee, mois, jour] = cle.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour));
}

/** 5 → '05' */
function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0');
}
