/**
 * scripts/spike-sondage.ts — Script JETABLE : teste les sondages WhatsApp via WAHA.
 *
 * 1. Écoute ce que WAHA envoie (comme le bot, sur le port 3000) et l'enregistre dans
 *    data/spike/sondage.jsonl (ignoré par Git : contient de vrais numéros).
 * 2. Envoie UN sondage de test dans le groupe GROUPE_ID du .env.
 *
 * Lancement : npm run spike-sondage   (le bot doit être ARRÊTÉ : même port 3000)
 * Arrêt     : Ctrl+C
 * Ce script sera supprimé une fois les sondages codés pour de vrai.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { chargerConfig } from '../src/config.ts';
import { MessagerieWaha } from '../src/whatsapp/waha.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = chargerConfig({ GOOGLE_SHEET_ID: 'inutile-ici', ...process.env });
if (!config.groupeId) throw new Error('GROUPE_ID manquant dans le .env (npm run lister-groupes)');

const FICHIER = 'data/spike/sondage.jsonl';
mkdirSync('data/spike', { recursive: true });

// ---------------------------------------------------------------------------
// 1) Écouter WAHA
// ---------------------------------------------------------------------------
const serveur = createServer((requete, reponse) => {
  let corps = '';
  requete.on('data', (morceau) => { corps += morceau; });
  requete.on('end', () => {
    reponse.writeHead(200).end('ok');
    try {
      const evenement = JSON.parse(corps);
      appendFileSync(FICHIER, JSON.stringify(evenement) + '\n');
      const heure = new Date().toLocaleTimeString('fr-FR');
      if (String(evenement.event).startsWith('poll.vote')) {
        const choix = evenement.payload?.vote?.selectedOptions;
        console.log(`🗳️  ${heure} — ${evenement.event} — choix : ${JSON.stringify(choix ?? '(illisible)')}`);
      } else {
        console.log(`   ${heure} — ${evenement.event}`);
      }
    } catch {
      console.log('(événement non JSON reçu)');
    }
  });
});

serveur.on('error', (erreur: NodeJS.ErrnoException) => {
  if (erreur.code === 'EADDRINUSE') console.error('❌ Le port 3000 est pris : arrête le bot (Ctrl+C dans son terminal) avant le spike.');
  else console.error('❌', erreur.message);
  process.exit(1);
});

serveur.listen(3000, async () => {
  console.log(`🕵️  Écoute de WAHA sur le port 3000 — événements enregistrés dans ${FICHIER}\n`);

  // -------------------------------------------------------------------------
  // 2) Attendre que WAHA soit prêt (il met ~15 s à démarrer après « docker compose up -d »)
  // -------------------------------------------------------------------------
  const messagerie = new MessagerieWaha(config.waha);
  for (let essai = 1; ; essai++) {
    const connexion = await messagerie.verifierConnexion();
    if (connexion.ok) break;
    if (essai >= 20) {
      console.error(`❌ WhatsApp toujours pas prêt après 1 minute : ${connexion.detail}`);
      process.exit(1);
    }
    console.log(`   WAHA pas encore prêt (${connexion.detail}) — nouvel essai dans 3 s…`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // -------------------------------------------------------------------------
  // 3) Envoyer le sondage de test
  // -------------------------------------------------------------------------
  const reponse = await fetch(`${config.waha.url}/api/sendPoll`, {
    method: 'POST',
    headers: { 'X-Api-Key': config.waha.cleApi, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: config.waha.session,
      chatId: config.groupeId,
      poll: {
        name: '🧪 Test sondage – Panier anti-gaspi samedi 28/11',
        options: ['dispo de 10h à 13h', 'dispo de 13h à 16h', 'pas dispo :/'],
        multipleAnswers: true, // comme les sondages de l'asso (« Select one or more »)
      },
    }),
  });
  const texte = await reponse.text();
  if (!reponse.ok) {
    console.error(`❌ Envoi du sondage refusé (${reponse.status}) : ${texte.slice(0, 300)}`);
    return;
  }
  const id = (JSON.parse(texte) as { id?: string }).id ?? '(pas d\'ID ?)';
  appendFileSync(FICHIER, JSON.stringify({ spike: 'reponse-sendPoll', reponse: JSON.parse(texte) }) + '\n');
  console.log(`✅ Sondage envoyé dans le groupe (ID : ${id})\n`);
  console.log('Maintenant, sur le téléphone de ta mère :');
  console.log('  1. voter « dispo de 10h à 13h »');
  console.log('  2. ajouter « dispo de 13h à 16h »');
  console.log('  3. tout décocher, puis cocher « pas dispo :/ »');
  console.log('  4. tout décocher (retirer son vote)');
  console.log('Chaque vote doit s\'afficher ici (🗳️). Puis Ctrl+C.\n');
});
