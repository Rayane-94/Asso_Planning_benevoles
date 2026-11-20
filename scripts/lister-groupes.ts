/**
 * scripts/lister-groupes.ts — Affiche les groupes WhatsApp du numéro du bot, avec leur ID.
 *
 * Lancement : npm run lister-groupes
 * Puis copier l'ID du groupe des bénévoles dans le .env : GROUPE_ID=1203…@g.us
 * (WAHA doit tourner et la session être connectée : docker compose up -d)
 */
import { existsSync } from 'node:fs';
import { chargerConfig } from '../src/config.ts';
import { MessagerieWaha } from '../src/whatsapp/waha.ts';

try {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // GOOGLE_SHEET_ID n'est pas utile ici, mais chargerConfig l'exige : on tolère son absence.
  const config = chargerConfig({ GOOGLE_SHEET_ID: 'inutile-ici', ...process.env });
  const messagerie = new MessagerieWaha(config.waha);

  const connexion = await messagerie.verifierConnexion();
  if (!connexion.ok) throw new Error(`WhatsApp n'est pas connecté : ${connexion.detail ?? 'raison inconnue'}`);

  const groupes = (await messagerie.listerGroupes()).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  console.log(`\n${groupes.length} groupe(s) :\n`);
  for (const groupe of groupes) console.log(`  ${groupe.nom || '(sans nom)'}\n    GROUPE_ID=${groupe.id}\n`);
  console.log('→ Copier la ligne GROUPE_ID=… du bon groupe dans le .env, puis relancer le bot.');
} catch (erreur) {
  console.error('❌ ' + (erreur instanceof Error ? erreur.message : String(erreur)));
  process.exitCode = 1;
}
