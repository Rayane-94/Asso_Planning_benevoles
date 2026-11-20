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
 *   Mer 18 18:00  📣 Maraude annoncée (sondage dispo / pas dispo) ; Bob (nouveau), Alice et
 *                 Chloé votent « dispo » ; Bob donne son nom en privé ; Chloé repasse « pas dispo »
 *   Ven 20 20:30  📅 récap : Maraude, 2 inscrits
 *   Sam 21 18:00  📣 BP annoncé (sondage à 2 créneaux) ; Bob coche les deux, Alice 14h-16h,
 *                 David (nouveau) 16h-18h
 *   Lun 23 10:00  demandes de confirmation Maraude ; Bob écrit OUI (le texte marche toujours),
 *                 Alice ne répond pas
 *   Mar 24 20:00  liste Maraude : Bob ; Alice « Sans réponse »
 *   Mar 24 21:00  Bob se désiste en privé → le référent est prévenu
 *   Jeu 26 10:00  demandes de confirmation BP (texte + sondage Oui / Non) ; Bob vote Oui,
 *                 Alice vote Non, David ne répond pas
 *   Jeu 26 15:00  Emma (nouvelle) vote 16h-18h, en retard → demande immédiate → vote Oui
 *   Ven 27 20:00  liste BP regroupée par créneau : Bob (sur les deux) et Emma ; David « Sans réponse »
 *   Ven 27 20:30  📅 récap : BP, 2 confirmés (détail par créneau)
 */
import { describe, expect, test } from 'vitest';
import { recevoirMessage } from '../src/metier/reception.ts';
import { recevoirVote } from '../src/metier/votes.ts';
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

/** Un bénévole vote dans le sondage : choix = tout ce qui est coché après ce vote. */
async function vote(env: EnvironnementDeTest, de: string, nom: string, sondage: string, choix: string[]): Promise<void> {
  await recevoirVote(env.ctx, env.messagerie.vote({ de, nom, sondage, choix }));
}

const CRENEAU_1 = 'dispo de 14h à 16h';
const CRENEAU_2 = 'dispo de 16h à 18h';

/** Un bénévole écrit au bot en privé. */
async function ecritEnPrive(env: EnvironnementDeTest, de: string, texte: string): Promise<void> {
  await recevoirMessage(env.ctx, env.messagerie.recu({ de, texte }));
}

/** L'ID du sondage publié pour un type d'action (c'est lui que les réponses citent). */
function annonce(env: EnvironnementDeTest, type: string): string {
  const sondage = env.messagerie.sondages().find((m) => m.texte.startsWith(type));
  if (!sondage) throw new Error(`Sondage ${type} introuvable`);
  return sondage.id;
}

/** Un bénévole vote dans le sondage de confirmation qu'il a reçu en privé pour ce type d'action. */
async function voteConfirmation(env: EnvironnementDeTest, de: string, type: string, choix: string): Promise<void> {
  const sondage = env.messagerie.envoyesA(de).filter((m) => m.sondage && m.texte.startsWith(type)).at(-1);
  if (!sondage) throw new Error(`Sondage de confirmation ${type} introuvable pour ${de}`);
  await recevoirVote(env.ctx, env.messagerie.vote({ de, sondage: sondage.id, choix: [choix], groupe: de }));
}

const OUI = '✅ Oui, je serai là';
const NON = '❌ Non, je ne peux plus';

const textesA = (env: EnvironnementDeTest, destinataire: string) => env.messagerie.envoyesA(destinataire).map((m) => m.texte);

describe('une quinzaine complète, du lundi 16 au vendredi 27 novembre', () => {
  test('tout se passe comme prévu, sans doublon ni erreur', async () => {
    // ----- Lundi 16, 09:00 : mise en place -----
    const env = await contexteDeTest('2026-11-16 09:00');
    await changerParametre(env.tableur, 'NUMERO_REFERENT', '06 99 99 99 99');
    await ajouterLignesDeTest(env.tableur, 'Bénévoles', [{ Téléphone: '06 11 22 33 44', Prénom: 'Alice', Nom: 'Martin' }]);
    await ajouterAction(env, { Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Lieu: 'Gare de Lyon' });
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt', Créneaux: `${CRENEAU_1}, ${CRENEAU_2}` });

    // ----- Mercredi 18 : annonce de la Maraude et réponses -----
    await vivreJusqua(env, '2026-11-18 18:30');
    const maraude = annonce(env, 'Maraude');
    await vote(env, BOB, 'Bob', maraude, ['dispo !!']);
    await vote(env, ALICE, 'Alice M', maraude, ['dispo !!']);
    await vote(env, CHLOE, 'Chloé', maraude, ['dispo !!']);
    await ecritEnPrive(env, BOB, 'bob durand'); // réponse à « peux-tu me donner ton prénom et ton nom ? »
    await vivreJusqua(env, '2026-11-18 21:00');
    await vote(env, CHLOE, 'Chloé', maraude, ['pas dispo :/']); // elle change d'avis dans le sondage

    // ----- Samedi 21 : annonce du BP et réponses -----
    await vivreJusqua(env, '2026-11-21 19:00');
    const bp = annonce(env, 'BP');
    await vote(env, BOB, 'Bob', bp, [CRENEAU_1, CRENEAU_2]); // les deux créneaux
    await vote(env, ALICE, 'Alice M', bp, [CRENEAU_1]);
    await vote(env, DAVID, 'David', bp, [CRENEAU_2]);

    // ----- Lundi 23 : confirmations de la Maraude -----
    await vivreJusqua(env, '2026-11-23 11:00');
    await ecritEnPrive(env, BOB, 'OUI'); // Alice ne répond pas

    // ----- Mardi 24 : liste de la Maraude, puis désistement de Bob -----
    await vivreJusqua(env, '2026-11-24 21:00');
    await ecritEnPrive(env, BOB, 'finalement je peux pas demain, désolé');

    // ----- Jeudi 26 : confirmations du BP -----
    await vivreJusqua(env, '2026-11-26 11:00');
    await voteConfirmation(env, BOB, 'BP', OUI);
    await voteConfirmation(env, ALICE, 'BP', NON); // David ne répond pas
    await vivreJusqua(env, '2026-11-26 15:00');
    await vote(env, EMMA, 'Emma', bp, [CRENEAU_2]); // en retard
    await voteConfirmation(env, EMMA, 'BP', OUI);

    // ----- Vendredi 27 : liste du BP et récap -----
    await vivreJusqua(env, '2026-11-27 21:00');

    // =========================================================================
    // Vérifications
    // =========================================================================

    // Le groupe : exactement ces 6 messages, dans cet ordre (aucun doublon)
    expect(textesA(env, GROUPE_TEST)).toEqual([
      '📣 Maraude – mercredi 25/11 à 19:00 – Gare de Lyon\n👇 Votez dans le sondage ci-dessous pour participer.',
      'Maraude – mercredi 25/11 à 19:00', // le sondage
      '📅 Récap de la semaine (samedi 21/11 → vendredi 27/11)\n• Maraude – mercredi 25/11 à 19:00 – Gare de Lyon : 2 inscrits',
      '📣 BP – samedi 28/11 à 14:00 – Entrepôt\n👇 Votez dans le sondage ci-dessous pour participer.',
      'BP – samedi 28/11 à 14:00', // le sondage
      '📋 Maraude – mercredi 25/11 à 19:00 – Gare de Lyon\n• Durand Bob – 06 12 34 56 78',
      // la liste du BP : un bloc par créneau ; Bob apparaît dans les deux
      '📋 BP – samedi 28/11 à 14:00 – Entrepôt\n\n' +
        '🕒 dispo de 14h à 16h\n• Durand Bob – 06 12 34 56 78\n\n' +
        '🕒 dispo de 16h à 18h\n• Durand Bob – 06 12 34 56 78\n• Emma – 06 55 55 55 55',
      '📅 Récap de la semaine (samedi 28/11 → vendredi 04/12)\n• BP – samedi 28/11 à 14:00 – Entrepôt : 2 confirmés (dispo de 14h à 16h : 1, dispo de 16h à 18h : 2)',
    ]);

    // Bob : tout le parcours, chaque message une seule fois
    expect(textesA(env, BOB)).toEqual([
      'Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?',
      "Merci Bob, c'est noté !",
      "Bonjour Bob 👋 Tu t'es inscrit(e) pour : Maraude – mercredi 25/11 à 19:00 – Gare de Lyon.\n👇 Tu confirmes ta présence ? Réponds dans le sondage ci-dessous (avant mardi 20:00).",
      'Maraude – mercredi 25/11 à 19:00 : tu confirmes ?', // le sondage Oui / Non
      "C'est noté, merci !", // il a répondu OUI par écrit
      '✅ Nous vous confirmons votre participation à : Maraude – mercredi 25/11 à 19:00 – Gare de Lyon. Merci et à demain !',
      "C'est noté, merci !", // son désistement de mardi soir
      "Bonjour Bob 👋 Tu t'es inscrit(e) pour : BP – samedi 28/11 à 14:00 – Entrepôt.\n👇 Tu confirmes ta présence ? Réponds dans le sondage ci-dessous (avant vendredi 20:00).\n🕒 Créneau : dispo de 14h à 16h, dispo de 16h à 18h",
      'BP – samedi 28/11 à 14:00 : tu confirmes ?',
      "C'est noté, merci !", // il a voté Oui
      '✅ Nous vous confirmons votre participation à : BP – samedi 28/11 à 14:00 – Entrepôt. Merci et à demain !\n🕒 Créneau : dispo de 14h à 16h, dispo de 16h à 18h',
    ]);

    // Alice (déjà connue) : jamais de demande de nom ; deux demandes (texte + sondage), un accusé
    expect(textesA(env, ALICE).map((t) => t.split(' ')[0])).toEqual(['Bonjour', 'Maraude', 'Bonjour', 'BP', "C'est"]);

    // Chloé : seulement la demande de nom (elle s'est retirée avant les confirmations)
    expect(textesA(env, CHLOE)).toEqual(['Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?']);

    // David : demande de nom + demande de confirmation (texte + sondage), jamais de « ✅ »
    expect(textesA(env, DAVID)).toHaveLength(3);
    expect(textesA(env, DAVID).some((t) => t.startsWith('✅'))).toBe(false);

    // Emma (inscrite en retard) : demande immédiate, puis demande de nom, accusé, « ✅ »
    expect(textesA(env, EMMA).map((t) => t.slice(0, 12))).toEqual(['Bonjour Emma', 'BP – samedi ', 'Bienvenue ! ', "C'est noté, ", '✅ Nous vous ']);

    // Le référent : prévenu une seule fois, du désistement de Bob
    expect(textesA(env, REFERENT)).toEqual([
      '⚠️ Désistement de dernière minute : Durand Bob (06 12 34 56 78) ne viendra pas à Maraude – mercredi 25/11 à 19:00 – Gare de Lyon.',
    ]);

    // Le Sheet : statuts finaux des actions et des inscriptions
    expect(env.tableur.lignes('Actions').map((a) => `${a.ID} ${a.Type} : ${a.Statut}`)).toEqual([
      'A-0001 Maraude : Liste publiée',
      'A-0002 BP : Liste publiée',
    ]);
    expect(env.tableur.lignes('Inscriptions').map((i) => `${i['Action ID']} ${i.Nom} : ${i.Statut}${i.Créneau ? ` [${i.Créneau}]` : ''}`)).toEqual([
      'A-0001 Durand Bob : Désisté',
      'A-0001 Martin Alice : Sans réponse',
      'A-0001 Chloé : Retiré',
      'A-0002 Durand Bob : Confirmé [dispo de 14h à 16h, dispo de 16h à 18h]',
      'A-0002 Martin Alice : Désisté [dispo de 14h à 16h]',
      'A-0002 David : Sans réponse [dispo de 16h à 18h]',
      'A-0002 Emma : Confirmé [dispo de 16h à 18h]',
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
