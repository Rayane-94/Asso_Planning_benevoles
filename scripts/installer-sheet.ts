/**
 * scripts/installer-sheet.ts — Crée ou répare la structure du Google Sheet.
 *
 * Lancement : npm run installer-sheet
 * Prérequis : fichier .env avec GOOGLE_SHEET_ID (et GOOGLE_FICHIER_CLE si la clé n'est
 * pas dans ./secrets/compte-service.json). Voir docs/compte-service-google.md.
 *
 * Sans danger : peut être relancé autant de fois que nécessaire (voir sheets/installation.ts).
 */
import { existsSync } from 'node:fs';
import { chargerConfigGoogle, ErreurConfig } from '../src/config.ts';
import { GoogleSheets } from '../src/sheets/googleSheets.ts';
import { installerSheet } from '../src/sheets/installation.ts';

try {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const configGoogle = chargerConfigGoogle();
  const google = new GoogleSheets(configGoogle);

  console.log(`Installation du Google Sheet ${configGoogle.idSheet}`);
  console.log(`(compte de service : ${google.emailCompteService})\n`);

  const rapport = await installerSheet({ tableur: google, admin: google });

  if (rapport.length === 0) console.log('✅ Tout était déjà en place (formats et vues réappliqués).');
  else console.log('✅ Installation terminée :\n' + rapport.map((ligne) => `  - ${ligne}`).join('\n'));
} catch (erreur) {
  console.error('❌ ' + (erreur instanceof ErreurConfig || erreur instanceof Error ? erreur.message : String(erreur)));
  process.exitCode = 1;
}
