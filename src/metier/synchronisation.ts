/**
 * metier/synchronisation.ts — Garde les inscriptions à jour quand l'équipe corrige le Sheet.
 *
 * Chaque inscription garde une COPIE :
 *   - du type, de la date, de l'heure et du lieu de son action ;
 *   - du nom du bénévole (« Durand Bob »).
 * (pour que les vues Présents / Absents et la liste finale soient lisibles sans les autres onglets).
 * Si l'équipe modifie l'action ou corrige un nom dans Bénévoles, ces copies deviennent fausses :
 * à chaque tick, on les remet d'accord (CLAUDE.md §5).
 *
 * Les noms ne sont recopiés que dans les inscriptions d'aujourd'hui et à venir : l'historique
 * des actions passées ne bouge pas. Les noms se corrigent donc dans BÉNÉVOLES (une correction
 * faite directement dans Inscriptions serait remplacée par celle de Bénévoles).
 *
 * AUCUN message n'est envoyé : prévenir les bénévoles d'un changement se fait à la main
 * (CLAUDE.md §4.8).
 */
import type { Action } from '../sheets/actions.ts';
import { lireBenevoles, nomPourListe, type Benevole } from '../sheets/benevoles.ts';
import { lireInscriptions, modifierInscriptions, type ChangementsInscription, type Inscription } from '../sheets/inscriptions.ts';
import { cleDate } from '../utils/dates.ts';
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
  const { parTelephone } = await lireBenevoles(ctx.tableur);
  const aujourdhui = cleDate(ctx.horloge.maintenant());
  const modifications: { inscription: Inscription; changements: ChangementsInscription }[] = [];
  const actionsModifiees = new Map<string, string[]>(); // ID d'action → champs changés (pour le Journal)
  const nomsCorriges = new Map<string, number>(); // nouveau nom → nombre d'inscriptions (pour le Journal)

  for (const inscription of inscriptions) {
    const action = actionsParId.get(inscription.actionId);
    if (!action) continue; // action supprimée ou ligne illisible : on ne touche à rien
    const changements = differences(inscription, action);
    const champs = Object.keys(changements);
    if (champs.length > 0) actionsModifiees.set(action.id, champs);

    const nom = nomCorrige(inscription, parTelephone.get(inscription.telephone), aujourdhui);
    if (nom !== null) {
      changements.nom = nom;
      nomsCorriges.set(nom, (nomsCorriges.get(nom) ?? 0) + 1);
    }
    if (Object.keys(changements).length > 0) modifications.push({ inscription, changements });
  }
  if (modifications.length === 0) return 0; // le cas habituel : rien à écrire

  // Une seule écriture pour toutes les inscriptions (quota Google)
  await modifierInscriptions(ctx.tableur, modifications, ctx.horloge.maintenant());
  for (const [id, champs] of actionsModifiees) {
    const nombre = modifications.filter((m) =>
      m.inscription.actionId === id && CHAMPS_RECOPIES.some((champ) => m.changements[champ] !== undefined),
    ).length;
    ctx.logger.info(`Action ${id} modifiée (${champs.join(', ')}) : ${nombre} inscription(s) mise(s) à jour (aucun message envoyé)`);
  }
  for (const [nom, nombre] of nomsCorriges) {
    ctx.logger.info(`Nom corrigé dans Bénévoles : « ${nom} » recopié dans ${nombre} inscription(s)`);
  }
  return modifications.length;
}

/**
 * Le nom à recopier dans l'inscription, ou null s'il n'y a rien à changer.
 * Seulement si l'équipe a donné un prénom ou un nom dans Bénévoles (sinon on garde ce qui
 * est dans l'inscription), et seulement pour une inscription d'aujourd'hui ou à venir.
 */
function nomCorrige(inscription: Inscription, benevole: Benevole | undefined, aujourdhui: string): string | null {
  if (!benevole || (benevole.prenom === '' && benevole.nom === '')) return null;
  if (inscription.date < aujourdhui) return null; // action passée : on garde l'historique
  const nom = nomPourListe(benevole);
  return inscription.nom === nom ? null : nom;
}

/** Ce qui diffère entre la copie gardée dans l'inscription et l'action elle-même. */
function differences(inscription: Inscription, action: Action): ChangementsInscription {
  const changements: ChangementsInscription = {};
  for (const champ of CHAMPS_RECOPIES) {
    if (inscription[champ] !== action[champ]) changements[champ] = action[champ];
  }
  return changements;
}
