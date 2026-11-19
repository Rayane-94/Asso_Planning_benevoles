/**
 * ports/horloge.ts — Le contrat « heure et pauses ».
 *
 * Le code métier ne fait JAMAIS `new Date()` ni `setTimeout` lui-même : il demande à
 * l'horloge qu'on lui donne. En production c'est l'horloge système ; dans les tests,
 * une horloge qu'on règle et qu'on fait avancer à volonté (tests/faux/horlogeDeTest.ts).
 */

export interface Horloge {
  /** L'instant présent. */
  maintenant(): Date;
  /** Attend `ms` millisecondes (ex. entre deux messages privés, pour éviter le bannissement). */
  attendre(ms: number): Promise<void>;
}

/** L'horloge réelle, utilisée en production. */
export const horlogeSysteme: Horloge = {
  maintenant: () => new Date(),
  attendre: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
