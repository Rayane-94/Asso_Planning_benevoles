/**
 * TEST DE BOUT EN BOUT — une quinzaine complète de l'asso (CLAUDE.md §7, étape 11).
 *
 * Contrairement aux autres tests, le temps s'écoule vraiment : le bot fait un tick toutes
 * les 15 minutes pendant 12 jours (~1 100 passages). Chaque tâche est donc appelée des
 * centaines de fois « au mauvais moment » et doit alors ne rien faire. C'est ce qui prouve
 * qu'il n'y a ni oubli, ni doublon, ni interférence entre les étapes.
 *
 * L'histoire (novembre 2026) :
 *   Lun 16 09:00  le référent ajoute une Maraude (mer 25) et un BP (sam 28)
 *   Mer 18 18:00  📣 Maraude annoncée ; Bob (nouveau), Alice et Chloé répondent OUI ;
 *                 Bob donne son nom en privé ; Chloé se ravise (« finalement non »)
 *   Ven 20 20:30  📅 récap : Maraude, 2 inscrits
 *   Sam 21 18:00  📣 BP annoncé ; Bob, Alice et David (nouveau) répondent OUI
 *   Lun 23 10:00  demandes de confirmation Maraude ; Bob OUI, Alice ne répond pas
 *   Mar 24 20:00  liste Maraude : Bob ; Alice « Sans réponse »
 *   Mar 24 21:00  Bob se désiste en privé → le référent est prévenu
 *   Jeu 26 10:00  demandes de confirmation BP ; Bob OUI, Alice NON, David ne répond pas
 *   Jeu 26 15:00  Emma (nouvelle) répond OUI à l'annonce, en retard → demande immédiate → OUI
 *   Ven 27 20:00  liste BP : Bob et Emma ; David « Sans réponse »
 *   Ven 27 20:30  📅 récap : BP, 2 confirmés
 */
import { describe, expect, test } from 'vitest';
import { recevoirMessage } from '../src/metier/reception.ts';
import { GROUPE_TEST } from './faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from './faux/contexteDeTest.ts';
import { ajouterLignesDeTest, changerParametre } from './faux/sheetDeTest.ts';

const BOB = '33612345678';
const ALICE = '33611223344';
const CHLOE = '33633333333';
const DAVID = '33644444444';
const EMMA = '33655555555';
const REFERENT = '33699999999';

/** Fait vivre le bot jusqu'à `cible` (heure de Paris), avec un tick toutes les 15 minutes. */
async function vivreJusqua(env: EnvironnementDeTest, cible: string): Promise<void> {
  // Les textes 'yyyy-MM-dd HH:mm' se comparent directement : '2026-11-18 18:00' < '2026-11-18 18:30'
  while (env.horloge.texte() < cible) {
    env.horloge.avancer({ minutes: 15 });
    await env.planificateur.tick();
  }
}

/** Un bénévole écrit dans le groupe en citant un message (une annonce). */
async function repondDansLeGroupe(env: EnvironnementDeTest, de: string, nom: string, texte: string, cite: string): Promise<void> {
  await recevoirMessage(env.ctx, env.messagerie.recu({ de, nom, texte, groupe: GROUPE_TEST, cite }));
}

/** Un bénévole écrit au bot en privé. */
async function ecritEnPrive(env: EnvironnementDeTest, de: string, texte: string): Promise<void> {
  await recevoirMessage(env.ctx, env.messagerie.recu({ de, texte }));
}

/** L'ID de l'annonce publiée pour un type d'action. */
function annonce(env: EnvironnementDeTest, type: string): string {
  const message = env.messagerie.envoyesA(GROUPE_TEST).find((m) => m.texte.startsWith(`📣 ${type}`));
  if (!message) throw new Error(`Annonce ${type} introuvable`);
  return message.id;
}

const textesA = (env: EnvironnementDeTest, destinataire: string) => env.messagerie.envoyesA(destinataire).map((m) => m.texte);

describe('une quinzaine complète, du lundi 16 au vendredi 27 novembre', () => {
  test('tout se passe comme prévu, sans doublon ni erreur', async () => {
    // ----- Lundi 16, 09:00 : mise en place -----
    const env = await contexteDeTest('2026-11-16 09:00');
    await changerParametre(env.tableur, 'NUMERO_REFERENT', '06 99 99 99 99');
    await ajouterLignesDeTest(env.tableur, 'Bénévoles', [{ Téléphone: '06 11 22 33 44', Prénom: 'Alice', Nom: 'Martin' }]);
    await ajouterAction(env, { Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Lieu: 'Gare de Lyon' });
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });

    // ----- Mercredi 18 : annonce de la Maraude et réponses -----
    await vivreJusqua(env, '2026-11-18 18:30');
    const maraude = annonce(env, 'Maraude');
    await repondDansLeGroupe(env, BOB, 'Bob', 'Oui je viens !', maraude);
    await repondDansLeGroupe(env, ALICE, 'Alice M', '👍', maraude);
    await repondDansLeGroupe(env, CHLOE, 'Chloé', 'oui', maraude);
    await ecritEnPrive(env, BOB, 'bob durand'); // réponse à « peux-tu me donner ton prénom et ton nom ? »
    await vivreJusqua(env, '2026-11-18 21:00');
    await repondDansLeGroupe(env, CHLOE, 'Chloé', 'finalement non désolée', maraude);

    // ----- Samedi 21 : annonce du BP et réponses -----
    await vivreJusqua(env, '2026-11-21 19:00');
    const bp = annonce(env, 'BP');
    await repondDansLeGroupe(env, BOB, 'Bob', 'dispo', bp);
    await repondDansLeGroupe(env, ALICE, 'Alice M', 'ok', bp);
    await repondDansLeGroupe(env, DAVID, 'David', 'Ok pour moi', bp);

    // ----- Lundi 23 : confirmations de la Maraude -----
    await vivreJusqua(env, '2026-11-23 11:00');
    await ecritEnPrive(env, BOB, 'OUI'); // Alice ne répond pas

    // ----- Mardi 24 : liste de la Maraude, puis désistement de Bob -----
    await vivreJusqua(env, '2026-11-24 21:00');
    await ecritEnPrive(env, BOB, 'finalement je peux pas demain, désolé');

    // ----- Jeudi 26 : confirmations du BP -----
    await vivreJusqua(env, '2026-11-26 11:00');
    await ecritEnPrive(env, BOB, 'oui');
    await ecritEnPrive(env, ALICE, 'non pas dispo'); // David ne répond pas
    await vivreJusqua(env, '2026-11-26 15:00');
    await repondDansLeGroupe(env, EMMA, 'Emma', 'oui je viens !', bp); // en retard
    await ecritEnPrive(env, EMMA, 'Oui');

    // ----- Vendredi 27 : liste du BP et récap -----
    await vivreJusqua(env, '2026-11-27 21:00');

    // =========================================================================
    // Vérifications
    // =========================================================================

    // Le groupe : exactement ces 6 messages, dans cet ordre (aucun doublon)
    expect(textesA(env, GROUPE_TEST)).toEqual([
      '📣 Maraude – mercredi 25/11 à 19:00 – Gare de Lyon\n👇 Votez dans le sondage ci-dessous pour participer.',
      '📅 Récap de la semaine (samedi 21/11 → vendredi 27/11)\n• Maraude – mercredi 25/11 à 19:00 – Gare de Lyon : 2 inscrits',
      '📣 BP – samedi 28/11 à 14:00 – Entrepôt\n👇 Votez dans le sondage ci-dessous pour participer.',
      'Maraude – 25/11 – Durand Bob – 06 12 34 56 78',
      'BP – 28/11 – Durand Bob – 06 12 34 56 78\nBP – 28/11 – Emma – 06 55 55 55 55',
      '📅 Récap de la semaine (samedi 28/11 → vendredi 04/12)\n• BP – samedi 28/11 à 14:00 – Entrepôt : 2 confirmés',
    ]);

    // Bob : tout le parcours, chaque message une seule fois
    expect(textesA(env, BOB)).toEqual([
      'Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?',
      "Merci Bob, c'est noté !",
      "Bonjour Bob 👋 Tu t'es inscrit(e) pour : Maraude – mercredi 25/11 à 19:00 – Gare de Lyon.\nTu confirmes ta présence ? Réponds OUI ou NON (avant mardi 20:00).",
      "C'est noté, merci !",
      '✅ Nous vous confirmons votre participation à : Maraude – mercredi 25/11 à 19:00 – Gare de Lyon. Merci et à demain !',
      "C'est noté, merci !", // son désistement de mardi soir
      "Bonjour Bob 👋 Tu t'es inscrit(e) pour : BP – samedi 28/11 à 14:00 – Entrepôt.\nTu confirmes ta présence ? Réponds OUI ou NON (avant vendredi 20:00).",
      "C'est noté, merci !",
      '✅ Nous vous confirmons votre participation à : BP – samedi 28/11 à 14:00 – Entrepôt. Merci et à demain !',
    ]);

    // Alice (déjà connue) : jamais de demande de nom ; deux demandes de confirmation, un accusé
    expect(textesA(env, ALICE).map((t) => t.split(' ')[0])).toEqual(['Bonjour', 'Bonjour', "C'est"]);

    // Chloé : seulement la demande de nom (elle s'est retirée avant les confirmations)
    expect(textesA(env, CHLOE)).toEqual(['Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?']);

    // David : demande de nom + demande de confirmation, jamais de « ✅ »
    expect(textesA(env, DAVID)).toHaveLength(2);
    expect(textesA(env, DAVID).some((t) => t.startsWith('✅'))).toBe(false);

    // Emma (inscrite en retard) : demande immédiate, puis demande de nom, accusé, « ✅ »
    expect(textesA(env, EMMA).map((t) => t.slice(0, 12))).toEqual(['Bonjour Emma', 'Bienvenue ! ', "C'est noté, ", '✅ Nous vous ']);

    // Le référent : prévenu une seule fois, du désistement de Bob
    expect(textesA(env, REFERENT)).toEqual([
      '⚠️ Désistement de dernière minute : Durand Bob (06 12 34 56 78) ne viendra pas à Maraude – mercredi 25/11 à 19:00 – Gare de Lyon.',
    ]);

    // Le Sheet : statuts finaux des actions et des inscriptions
    expect(env.tableur.lignes('Actions').map((a) => `${a.ID} ${a.Type} : ${a.Statut}`)).toEqual([
      'A-0001 Maraude : Liste publiée',
      'A-0002 BP : Liste publiée',
    ]);
    expect(env.tableur.lignes('Inscriptions').map((i) => `${i['Action ID']} ${i.Nom} : ${i.Statut}`)).toEqual([
      'A-0001 Durand Bob : Désisté',
      'A-0001 Martin Alice : Sans réponse',
      'A-0001 Chloé : Retiré',
      'A-0002 Durand Bob : Confirmé',
      'A-0002 Martin Alice : Désisté',
      'A-0002 David : Sans réponse',
      'A-0002 Emma : Confirmé',
    ]);

    // Les bénévoles : Bob a donné son nom ; les nouveaux sans réponse gardent leur nom WhatsApp
    expect(env.tableur.lignes('Bénévoles').map((b) => `${b.Prénom || '-'} ${b.Nom || '-'} (${b['Nom WhatsApp'] || '-'})`)).toEqual([
      'Alice Martin (-)',
      'Bob Durand (Bob)',
      '- - (Chloé)',
      '- - (David)',
      '- - (Emma)',
    ]);

    // Le tableau de bord est à jour, et aucune erreur pendant toute la quinzaine
    // (à la minute près : les pauses de 2 s entre les messages ont ajouté quelques secondes)
    expect(env.tableur.lignes('État du bot').find((l) => l.Élément === 'Dernier passage')?.État).toMatch(/^2026-11-27 21:00:\d\d$/);
    expect(env.tableur.lignes('État du bot').find((l) => l.Élément === 'WhatsApp')?.État).toBe('🟢 Connecté');
    expect(logsDeNiveau(env, 'ERREUR')).toEqual([]);
  });
});
