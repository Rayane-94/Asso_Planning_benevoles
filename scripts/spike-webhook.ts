/**
 * scripts/spike-webhook.ts — Script JETABLE pour l'étape 0 (spike).
 *
 * Écoute sur http://localhost:3000/webhook/waha et AFFICHE tout ce que WAHA envoie
 * (messages reçus, citations, changements de connexion…). Rien n'est envoyé ailleurs :
 * tout reste sur ton PC. Chaque événement est aussi enregistré dans data/spike/webhooks.jsonl
 * (une ligne JSON par événement) pour qu'on puisse l'étudier ensuite.
 *
 * Lancement : npm run spike   (Ctrl+C pour arrêter)
 * Ce script sera supprimé une fois l'adaptateur WAHA écrit (étape 5).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = 3000;
const FICHIER = 'data/spike/webhooks.jsonl';
mkdirSync('data/spike', { recursive: true });

const serveur = createServer((requete, reponse) => {
  let corps = '';
  requete.on('data', (morceau) => { corps += morceau; });
  requete.on('end', () => {
    // On répond tout de suite « OK » à WAHA, puis on affiche.
    reponse.writeHead(200).end('ok');
    const heure = new Date().toLocaleTimeString('fr-FR');
    try {
      const evenement = JSON.parse(corps);
      appendFileSync(FICHIER, JSON.stringify(evenement) + '\n');
      console.log(`\n━━━━━━━━ ${heure} — ${requete.method} ${requete.url} — événement « ${evenement.event} » ━━━━━━━━`);
      console.log(JSON.stringify(evenement, null, 2));
    } catch {
      console.log(`\n━━━━━━━━ ${heure} — corps non JSON ━━━━━━━━\n${corps}`);
    }
  });
});

serveur.listen(PORT, () => {
  console.log(`🕵️  Spike : en écoute sur http://localhost:${PORT}/webhook/waha`);
  console.log(`   Événements enregistrés dans ${FICHIER}`);
  console.log('   Envoie un message dans le groupe de test pour voir ce que WAHA reçoit…');
});
