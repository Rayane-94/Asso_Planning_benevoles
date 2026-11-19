/**
 * ports/alertes.ts — Le contrat « prévenir l'équipe d'un problème grave ».
 *
 * Appelé seulement quand l'état CHANGE (problème apparu, problème réglé), jamais en boucle.
 * Implémentations :
 *   - Sheet : onglet « État du bot » (sheets/etatBot.ts) — disponible dès maintenant ;
 *   - e-mail au référent : prévu plus tard (CLAUDE.md, étape 14), branché à côté grâce à
 *     combinerAlertes(), sans toucher au code métier.
 */
export interface Alerte {
  /** Ce qui pose problème (= ligne du tableau de bord), ex. 'WhatsApp'. */
  id: string;
  /** Ce que voit l'équipe, ex. '🔴 Déconnecté'. */
  titre: string;
  /** Ce qu'il faut faire, ex. 'Rescanner le QR code de WAHA'. */
  conseil: string;
  depuis: Date;
}

export interface Alertes {
  /** Un problème vient d'apparaître. */
  declencher(alerte: Alerte): Promise<void>;
  /** Le problème `id` est réglé ; `texte` = nouvel état affiché, ex. '🟢 Connecté'. */
  lever(id: string, texte: string, maintenant: Date): Promise<void>;
}

/** Envoie chaque alerte à plusieurs destinations (ex. Sheet + e-mail). Une destination en panne n'empêche pas les autres. */
export function combinerAlertes(...destinations: Alertes[]): Alertes {
  const pourChacune = async (action: (destination: Alertes) => Promise<void>): Promise<void> => {
    const resultats = await Promise.allSettled(destinations.map(action));
    const echec = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (echec) throw echec.reason;
  };
  return {
    declencher: (alerte) => pourChacune((d) => d.declencher(alerte)),
    lever: (id, texte, maintenant) => pourChacune((d) => d.lever(id, texte, maintenant)),
  };
}
