/**
 * scripts/lister-groupes.ts — Affiche les groupes WhatsApp du numéro du bot, avec leur ID.
 *
 * Lancement : npm run lister-groupes
 * Puis copier l'ID du groupe des bénévoles dans le .env : GROUPE_ID=1203…@g.us
 * (WAHA doit tourner et la session être connectée : docker compose up -d)
 *
 * Communauté WhatsApp : elle apparaît plusieurs fois, souvent sous le MÊME nom (la communauté
 * elle-même, son canal d'annonces, ses sous-groupes). Le script indique lequel choisir.
 */
import { existsSync } from 'node:fs';
import { chargerConfig } from '../src/config.ts';
import type { Groupe } from '../src/ports/messagerie.ts';
import { MessagerieWaha } from '../src/whatsapp/waha.ts';

/** Ce qu'on affiche à côté du nom, selon le genre du groupe. */
const DESCRIPTIONS: Record<NonNullable<Groupe['genre']>, string> = {
  annonces: "📣 canal d'annonces de la communauté → c'est CE GROUPE_ID qu'il faut pour une communauté",
  communaute: '⛔ la communauté elle-même → ne pas choisir (on ne peut pas y publier)',
  groupe: '👥 groupe',
};

try {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // GOOGLE_SHEET_ID n'est pas utile ici, mais chargerConfig l'exige : on tolère son absence.
  const config = chargerConfig({ GOOGLE_SHEET_ID: 'inutile-ici', ...process.env });
  const messagerie = new MessagerieWaha(config.waha);

  const connexion = await messagerie.verifierConnexion();
  if (!connexion.ok) throw new Error(`WhatsApp n'est pas connecté : ${connexion.detail ?? 'raison inconnue'}`);

  // Rangés par communauté (la communauté, puis son canal d'annonces, puis ses sous-groupes), puis par nom
  const ordre = { communaute: 0, annonces: 1, groupe: 2 };
  const cleTri = (g: Groupe) => (g.genre === 'communaute' ? g.nom : g.communaute ?? g.nom);
  const groupes = (await messagerie.listerGroupes()).sort((a, b) =>
    cleTri(a).localeCompare(cleTri(b), 'fr') ||
    ordre[a.genre ?? 'groupe'] - ordre[b.genre ?? 'groupe'] ||
    a.nom.localeCompare(b.nom, 'fr'));

  console.log(`\n${groupes.length} groupe(s) :\n`);
  for (const groupe of groupes) {
    const dansCommunaute = groupe.communaute ? ` (communauté « ${groupe.communaute} »)` : '';
    console.log(`  ${groupe.nom || '(sans nom)'}${dansCommunaute}`);
    console.log(`    ${DESCRIPTIONS[groupe.genre ?? 'groupe']}`);
    console.log(`    GROUPE_ID=${groupe.id}\n`);
  }
  console.log('→ Copier la ligne GROUPE_ID=… du bon groupe dans le .env, puis relancer le bot.');
} catch (erreur) {
  console.error('❌ ' + (erreur instanceof Error ? erreur.message : String(erreur)));
  process.exitCode = 1;
}
