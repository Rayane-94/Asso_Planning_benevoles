/**
 * metier/synchronisation.ts — Garde les inscriptions à jour quand une action est modifiée.
 *
 * Chaque inscription garde une COPIE du type, de la date, de l'heure et du lieu de son
 * action (pour que les vues Présents / Absents soient lisibles sans l'onglet Actions).
 * Si le référent modifie l'action, ces copies deviennent fausses : à chaque tick, on les
 * remet d'accord avec l'action (CLAUDE.md §5, « Cohérence après modification d'une action »).
 *
 * AUCUN message n'est envoyé : prévenir les bénévoles d'un changement se fait à la main
 * (CLAUDE.md §4.8).
 */
import type { Action } from '../sheets/actions.ts';
import { lireInscriptions, modifierInscriptions, type ChangementsInscription, type Inscription } from '../sheets/inscriptions.ts';
import type { Contexte, DonneesDuTick } from './contexte.ts';

/** Les champs recopiés de l'action vers ses inscriptions. */
const CHAMPS_RECOPIES = ['type', 'date', 'heure', 'lieu'] as const;

/**
 * @return le nombre d'inscriptions mises à jour
 */
export async function synchroniserInscriptions(ctx: Contexte, donnees: DonneesDuTick): Promise<number> {
  const actionsParId = new Map(donnees.actions.filter((a) => a.id !== '').map((a) => [a.id, a]));
  if (actionsParId.size === 0) return 0;

  const { inscriptions } = await lireInscriptions(ctx.tableur);
  const modifications: { inscription: Inscription; changements: ChangementsInscription }[] = [];
  const actionsModifiees = new Map<string, string[]>(); // ID d'action → champs changés (pour le Journal)

  for (const inscription of inscriptions) {
    const action = actionsParId.get(inscription.actionId);
    if (!action) continue; // action supprimée ou ligne illisible : on ne touche à rien
    const changements = differences(inscription, action);
    const champs = Object.keys(changements);
    if (champs.length === 0) continue;
    modifications.push({ inscription, changements });
    actionsModifiees.set(action.id, champs);
  }
  if (modifications.length === 0) return 0; // le cas habituel : rien à écrire

  // Une seule écriture pour toutes les inscriptions (quota Google)
  await modifierInscriptions(ctx.tableur, modifications, ctx.horloge.maintenant());
  for (const [id, champs] of actionsModifiees) {
    const nombre = modifications.filter((m) => m.inscription.actionId === id).length;
    ctx.logger.info(`Action ${id} modifiée (${champs.join(', ')}) : ${nombre} inscription(s) mise(s) à jour (aucun message envoyé)`);
  }
  return modifications.length;
}

/** Ce qui diffère entre la copie gardée dans l'inscription et l'action elle-même. */
function differences(inscription: Inscription, action: Action): ChangementsInscription {
  const changements: ChangementsInscription = {};
  for (const champ of CHAMPS_RECOPIES) {
    if (inscription[champ] !== action[champ]) changements[champ] = action[champ];
  }
  return changements;
}
