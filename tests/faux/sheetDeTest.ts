/**
 * Un faux Sheet déjà installé (mêmes onglets, colonnes et paramètres que le vrai),
 * prêt à être rempli par les tests.
 *
 *   const tableur = await sheetInstalle();
 *   await ajouterLignesDeTest(tableur, 'Actions', [{ Type: 'BP', Date: '28/11/2026', Heure: '14:00' }]);
 */
import type { Valeurs } from '../../src/ports/tableur.ts';
import { installerSheet } from '../../src/sheets/installation.ts';
import { FauxTableur } from './fauxTableur.ts';

export async function sheetInstalle(): Promise<FauxTableur> {
  const tableur = new FauxTableur();
  await installerSheet({ tableur, admin: tableur });
  tableur.appels.lectures = 0; // on ne compte que ce que fait le test
  tableur.appels.ecritures = 0;
  return tableur;
}

/** Ajoute des lignes « comme un humain » (sans compter dans les appels du bot). */
export async function ajouterLignesDeTest(tableur: FauxTableur, onglet: string, lignes: Valeurs[]): Promise<void> {
  await tableur.ajouterLignes(onglet, lignes);
  tableur.appels.ecritures--;
}

/** Change la valeur d'un paramètre dans l'onglet Paramètres. */
export async function changerParametre(tableur: FauxTableur, nom: string, valeur: string): Promise<void> {
  const { lignes } = await tableur.lireOnglet('Paramètres');
  const ligne = lignes.find((l) => l.valeurs.Paramètre === nom);
  if (!ligne) throw new Error(`Paramètre ${nom} introuvable`);
  await tableur.modifierLignes('Paramètres', [{ numero: ligne.numero, valeurs: { Valeur: valeur } }]);
  tableur.appels.lectures--;
  tableur.appels.ecritures--;
}
