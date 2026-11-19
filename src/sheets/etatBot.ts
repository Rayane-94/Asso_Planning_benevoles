/**
 * sheets/etatBot.ts — Le tableau de bord « État du bot » (premier onglet du Sheet).
 *
 *   Élément          | État                 | Depuis              | Que faire
 *   WhatsApp         | 🔴 Déconnecté         | 2026-11-27 14:32:00 | Rescanner le QR code…
 *   Bot              | 🟢 Actif              |                     |
 *   Dernier passage  | 2026-11-27 14:45:00   |                     | Si plus de 5 min : bot arrêté…
 *
 * « Dernier passage » est mis à jour à chaque tick : si l'heure ne bouge plus, c'est que
 * le bot (ou le VPS) est arrêté — le seul cas où le bot ne peut prévenir personne lui-même.
 */
import { ONGLETS } from '../constantes.ts';
import type { Alerte, Alertes } from '../ports/alertes.ts';
import type { Tableur } from '../ports/tableur.ts';
import { horodatage } from '../utils/dates.ts';
import { COLONNES_ETAT, ELEMENTS_ETAT } from './schema.ts';

const E = COLONNES_ETAT;

export interface LigneEtat {
  etat: string;
  depuis?: string;
  queFaire?: string;
}

/** Écrit une ligne du tableau de bord (la crée si elle n'existe pas). */
export async function ecrireEtat(tableur: Tableur, element: string, { etat, depuis = '', queFaire = '' }: LigneEtat): Promise<void> {
  const { lignes } = await tableur.lireOnglet(ONGLETS.ETAT);
  const ligne = lignes.find((l) => l.valeurs[E.ELEMENT].trim() === element);
  const valeurs = { [E.ETAT]: etat, [E.DEPUIS]: depuis, [E.QUE_FAIRE]: queFaire };
  if (ligne) await tableur.modifierLignes(ONGLETS.ETAT, [{ numero: ligne.numero, valeurs }]);
  else await tableur.ajouterLignes(ONGLETS.ETAT, [{ [E.ELEMENT]: element, ...valeurs }]);
}

/** Met à jour « Dernier passage » (appelé à chaque tick). */
export async function noterDernierPassage(tableur: Tableur, maintenant: Date): Promise<void> {
  await ecrireEtat(tableur, ELEMENTS_ETAT.DERNIER_PASSAGE, {
    etat: horodatage(maintenant),
    queFaire: 'Si cette heure a plus de 5 minutes de retard, le bot est arrêté : prévenir un mainteneur.',
  });
}

/** Les alertes affichées dans le tableau de bord (implémentation « Sheet » du contrat Alertes). */
export function creerAlertesSheet(tableur: Tableur): Alertes {
  return {
    declencher: (alerte: Alerte) => ecrireEtat(tableur, alerte.id, {
      etat: alerte.titre, depuis: horodatage(alerte.depuis), queFaire: alerte.conseil,
    }),
    lever: (id: string, texte: string, maintenant: Date) => ecrireEtat(tableur, id, {
      etat: texte, depuis: horodatage(maintenant),
    }),
  };
}
