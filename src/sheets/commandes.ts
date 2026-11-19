/**
 * sheets/commandes.ts — Lecture et mise à jour de l'onglet Commandes.
 *
 * Une case cochée se lit selon la langue du Sheet : « TRUE » en anglais, « VRAI » en
 * français. Pour décocher, on vide la cellule (une case à cocher vide = décochée).
 */
import { ONGLETS } from '../constantes.ts';
import type { Tableur } from '../ports/tableur.ts';
import { horodatage } from '../utils/dates.ts';
import { normaliserPourDetection } from '../utils/textes.ts';
import { COLONNES_COMMANDES } from './schema.ts';

const C = COLONNES_COMMANDES;

export interface LigneCommande {
  numero: number;
  commande: string;
  /** La case « Lancer » est-elle cochée ? */
  lancer: boolean;
}

export async function lireCommandes(tableur: Tableur): Promise<LigneCommande[]> {
  const { lignes } = await tableur.lireOnglet(ONGLETS.COMMANDES);
  return lignes.map(({ numero, valeurs }) => ({
    numero,
    commande: valeurs[C.COMMANDE].trim(),
    lancer: estCochee(valeurs[C.LANCER]),
  }));
}

/** « TRUE », « VRAI », « true »… → true ; vide ou « FALSE » / « FAUX » → false. */
export function estCochee(texte: string): boolean {
  return ['true', 'vrai'].includes(normaliserPourDetection(texte));
}

/** Décoche la case et note l'heure et le résultat. */
export async function noterResultatCommande(tableur: Tableur, numero: number, resultat: string, maintenant: Date): Promise<void> {
  await tableur.modifierLignes(ONGLETS.COMMANDES, [{
    numero,
    valeurs: { [C.LANCER]: '', [C.DERNIERE_EXECUTION]: horodatage(maintenant), [C.RESULTAT]: resultat },
  }]);
}
