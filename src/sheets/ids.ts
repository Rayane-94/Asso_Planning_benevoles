/**
 * sheets/ids.ts — Identifiants uniques des lignes (« A-0001 », « I-00042 »).
 *
 * Pourquoi des ID et pas des numéros de ligne ? Parce que l'équipe peut trier,
 * insérer ou supprimer des lignes : le numéro de ligne change, l'ID jamais.
 */

/**
 * Prochain identifiant libre.
 * ex. prochainId('A', ['A-0001', 'A-0007', ''], 4) → 'A-0008'
 * Les valeurs qui ne suivent pas le format (vides, tapées à la main…) sont ignorées.
 */
export function prochainId(prefixe: string, existants: string[], chiffres: number): string {
  const format = new RegExp(`^${prefixe}-(\\d+)$`);
  let maximum = 0;
  for (const id of existants) {
    const m = id.trim().match(format);
    if (m) maximum = Math.max(maximum, Number(m[1]));
  }
  return `${prefixe}-${String(maximum + 1).padStart(chiffres, '0')}`;
}
