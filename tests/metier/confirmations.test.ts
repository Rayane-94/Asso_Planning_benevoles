/**
 * Confirmations J-2 (CLAUDE.md §4.4). Scénario : le BP du samedi 28/11 est annoncé,
 * Bob et Alice sont inscrits. Jeudi 26/11 = J-2 ; vendredi 27/11 = J-1.
 */
import { describe, expect, test } from 'vitest';
import { envoyerConfirmations } from '../../src/metier/confirmations.ts';
import { recevoirMessage } from '../../src/metier/reception.ts';
import { recevoirVote } from '../../src/metier/votes.ts';
import { lireActions } from '../../src/sheets/actions.ts';
import { lireParametres } from '../../src/sheets/parametres.ts';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { ajouterLignesDeTest, changerParametre } from '../faux/sheetDeTest.ts';

const BOB = '33612345678';
const ALICE = '33611223344';
const ANNONCE_BP = 'annonce-bp';
const DEMANDE_BOB =
  "Bonjour Bob 👋 Tu t'es inscrit(e) pour : BP – samedi 28/11 à 14:00 – Entrepôt.\n" +
  '👇 Tu confirmes ta présence ? Réponds dans le sondage ci-dessous (avant vendredi 20:00).';
const QUESTION_BP = 'BP – samedi 28/11 à 14:00 : tu confirmes ?';
const OUI = '✅ Oui, je serai là';
const NON = '❌ Non, je ne peux plus';

/** BP du 28/11 annoncé, Bob et Alice inscrits. */
async function preparer(depart = '2026-11-26 10:00'): Promise<EnvironnementDeTest> {
  const env = await contexteDeTest(depart);
  await ajouterAction(env, {
    ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt', Statut: 'Annoncée', 'Message ID': ANNONCE_BP,
  });
  await ajouterLignesDeTest(env.tableur, 'Bénévoles', [
    { Téléphone: '06 12 34 56 78', Prénom: 'Bob', Nom: 'Durand' },
    { Téléphone: '06 11 22 33 44', Prénom: 'Alice', Nom: 'Martin' },
  ]);
  await ajouterLignesDeTest(env.tableur, 'Inscriptions', [
    { ID: 'I-00001', 'Action ID': 'A-0001', Type: 'BP', Date: '2026-11-28', Heure: '14:00', Lieu: 'Entrepôt', Téléphone: '06 12 34 56 78', Nom: 'Durand Bob', Statut: 'Inscrit' },
    { ID: 'I-00002', 'Action ID': 'A-0001', Type: 'BP', Date: '2026-11-28', Heure: '14:00', Lieu: 'Entrepôt', Téléphone: '06 11 22 33 44', Nom: 'Martin Alice', Statut: 'Inscrit' },
  ]);
  return env;
}

const statuts = (env: EnvironnementDeTest) => env.tableur.lignes('Inscriptions').map((l) => `${l.Nom} : ${l.Statut}`);
const statutAction = (env: EnvironnementDeTest) => env.tableur.lignes('Actions')[0].Statut;

describe('envoi des demandes à J-2', () => {
  test('jeudi 10:00 : chaque inscrit reçoit sa demande en privé, personnalisée', async () => {
    const env = await preparer();
    await env.planificateur.tick();

    // le texte, puis le sondage Oui / Non (une seule réponse possible)
    expect(env.messagerie.envoyesA(BOB).map((m) => [m.texte, m.sondage])).toEqual([
      [DEMANDE_BOB, undefined],
      [QUESTION_BP, { choix: [OUI, NON], plusieursChoix: false }],
    ]);
    expect(env.messagerie.envoyesA(ALICE)[0].texte).toContain('Bonjour Alice 👋');
    expect(env.messagerie.envoyesA(GROUPE_TEST)).toEqual([]); // rien dans le groupe
  });

  test('les inscriptions passent « En attente » avec l\'ID de la demande ; l\'action « Confirmations envoyées »', async () => {
    const env = await preparer();
    await env.planificateur.tick();

    expect(statuts(env)).toEqual(['Durand Bob : En attente', 'Martin Alice : En attente']);
    expect(env.tableur.lignes('Inscriptions')[0]['Demande ID']).toBe(env.messagerie.envoyesA(BOB)[1].id);
    expect(env.messagerie.envoyesA(BOB)[1].sondage).toBeDefined();
    expect(statutAction(env)).toBe('Confirmations envoyées');
  });

  test('messages espacés de 2 secondes ; résultats écrits en peu de requêtes (quota Google)', async () => {
    const env = await preparer();
    // On appelle la tâche seule (sans le tick, qui écrit aussi le tableau de bord) pour ne compter qu'elle.
    const donnees = { parametres: (await lireParametres(env.tableur)).parametres, actions: (await lireActions(env.tableur)).actions };
    env.tableur.appels.ecritures = 0;
    await envoyerConfirmations(env.ctx, donnees, 'automatique');
    // Bob : texte, 2 s, sondage ; 2 s ; Alice : texte, 2 s, sondage
    expect(env.horloge.pauses).toEqual([2000, 2000, 2000]);
    // marqueur (1) + résultats (1) + statut de l'action (1) = 3 écritures pour 2 personnes
    expect(env.tableur.appels.ecritures).toBe(3);
  });

  test('avant 10:00 : rien ; mercredi (J-3) : rien', async () => {
    const env = await preparer('2026-11-26 09:59');
    await env.planificateur.tick();
    env.horloge.regler('2026-11-25 12:00');
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('ticks suivants : aucune demande renvoyée', async () => {
    const env = await preparer();
    for (let i = 0; i < 5; i++) {
      await env.planificateur.tick();
      env.horloge.avancer({ minutes: 1 });
    }
    expect(env.messagerie.envoyes).toHaveLength(4); // 2 personnes × (texte + sondage)
  });

  test('seuls les « Inscrit » sont contactés (pas ceux qui ont dit NON)', async () => {
    const env = await preparer();
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 3, valeurs: { Statut: 'Retiré' } }]);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes.map((m) => m.destinataire)).toEqual([BOB, BOB]);
  });

  test('aucun inscrit : l\'action passe quand même à « Confirmations envoyées »', async () => {
    const env = await contexteDeTest('2026-11-26 10:00');
    await ajouterAction(env, { ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00', Statut: 'Annoncée', 'Message ID': 'x' });
    await env.planificateur.tick();
    expect(statutAction(env)).toBe('Confirmations envoyées');
  });

  test('envoi impossible : « Non joignable », les autres sont quand même contactés', async () => {
    const env = await preparer();
    env.messagerie.faireEchouerEnvoisVers(BOB);
    await env.planificateur.tick();
    expect(statuts(env)).toEqual(['Durand Bob : Non joignable', 'Martin Alice : En attente']);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('Demande de confirmation non envoyée à Durand Bob');
  });

  test('bénévole sans prénom : « Bonjour 👋 » (pas de trou, pas de {prenom})', async () => {
    const env = await preparer();
    await env.tableur.modifierLignes('Bénévoles', [{ numero: 2, valeurs: { Prénom: '', Nom: '' } }]);
    await env.planificateur.tick();
    expect(env.messagerie.envoyesA(BOB)[0].texte.startsWith("Bonjour 👋 Tu t'es inscrit(e)")).toBe(true);
  });
});

describe('rattrapage (bot arrêté le jeudi)', () => {
  test.each([
    ['2026-11-27 09:00', 'vendredi 09:00', true],
    ['2026-11-27 19:59', 'vendredi 19:59', true],
    ['2026-11-27 20:00', 'vendredi 20:00 (heure de la liste)', false],
    ['2026-11-27 07:30', 'vendredi 07:30 (trop tôt)', false],
    ['2026-11-26 23:00', 'jeudi 23:00 (trop tard)', false],
  ])('%s (%s) → envoi : %s', async (depart, _description, envoi) => {
    const env = await preparer(depart);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes.length > 0).toBe(envoi);
  });
});

describe('envoi interrompu', () => {
  test('inscription avec le marqueur « envoi-en-cours » : pas de renvoi, avertissement', async () => {
    const env = await preparer();
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 2, valeurs: { 'Demande ID': 'envoi-en-cours' } }]);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes.map((m) => m.destinataire)).toEqual([ALICE, ALICE]);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('Demande de confirmation à Durand Bob (ligne 2 d\'Inscriptions) peut-être interrompue');
  });
});

describe('réponses en privé', () => {
  /** Demandes envoyées le jeudi ; on vide les envois pour ne voir que la suite. */
  async function apresDemandes(): Promise<EnvironnementDeTest> {
    const env = await preparer();
    await env.planificateur.tick();
    env.messagerie.envoyes.length = 0;
    env.horloge.avancer({ minutes: 10 });
    return env;
  }

  test('OUI → « Confirmé » et « C\'est noté, merci ! »', async () => {
    const env = await apresDemandes();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'Oui je serai là' }));
    expect(statuts(env)[0]).toBe('Durand Bob : Confirmé');
    expect(env.messagerie.envoyes).toEqual([expect.objectContaining({ destinataire: BOB, texte: "C'est noté, merci !" })]);
  });

  test('NON → « Désisté »', async () => {
    const env = await apresDemandes();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non désolé' }));
    expect(statuts(env)[0]).toBe('Durand Bob : Désisté');
  });

  test('changement d\'avis : NON puis OUI → « Confirmé » (tant que la liste n\'est pas publiée)', async () => {
    const env = await apresDemandes();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non' }));
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'finalement oui !' }));
    expect(statuts(env)[0]).toBe('Durand Bob : Confirmé');
  });

  test('après la publication de la liste : la réponse n\'est plus prise en compte ici', async () => {
    const env = await apresDemandes();
    await env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: 'Liste publiée' } }]);
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'oui' }));
    expect(statuts(env)[0]).toBe('Durand Bob : En attente');
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('OUI de quelqu\'un qui n\'a aucune demande : ignoré', async () => {
    const env = await apresDemandes();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: '33699999999', texte: 'oui' }));
    expect(env.messagerie.envoyes).toEqual([]);
  });

  describe('plusieurs demandes en attente pour la même personne', () => {
    /** Bob est aussi inscrit à une Maraude le même week-end. */
    async function bobADeuxDemandes(): Promise<EnvironnementDeTest & { demandeBp: string; demandeMaraude: string }> {
      const env = await preparer();
      await ajouterAction(env, {
        ID: 'A-0002', Type: 'Maraude', Date: '28/11/2026', Heure: '19:00', Lieu: 'Gare', Statut: 'Annoncée', 'Message ID': 'annonce-m',
      });
      await ajouterLignesDeTest(env.tableur, 'Inscriptions', [{
        ID: 'I-00003', 'Action ID': 'A-0002', Type: 'Maraude', Date: '2026-11-28', Heure: '19:00', Téléphone: '06 12 34 56 78', Nom: 'Durand Bob', Statut: 'Inscrit',
      }]);
      await env.planificateur.tick();
      const [demandeBp, demandeMaraude] = env.messagerie.envoyesA(BOB).filter((m) => m.sondage).map((m) => m.id);
      env.messagerie.envoyes.length = 0;
      return { ...env, demandeBp, demandeMaraude };
    }

    test('OUI écrit sans citer : le bot ne devine pas, il demande de répondre dans le bon sondage', async () => {
      const env = await bobADeuxDemandes();
      await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'oui' }));
      expect(env.messagerie.dernierEnvoi().texte).toContain('réponds dans le sondage de chacune');
      expect(statuts(env).filter((s) => s.startsWith('Durand Bob'))).toEqual(['Durand Bob : En attente', 'Durand Bob : En attente']);
    });

    test('OUI écrit en citant le sondage de la Maraude : seule la Maraude est confirmée', async () => {
      const env = await bobADeuxDemandes();
      await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'oui', cite: env.demandeMaraude }));
      const lignes = env.tableur.lignes('Inscriptions').filter((l) => l.Nom === 'Durand Bob');
      expect(lignes.map((l) => `${l.Type} : ${l.Statut}`)).toEqual(['BP : En attente', 'Maraude : Confirmé']);
    });

    test('une demande déjà répondue, une en attente : un OUI sans citer va à celle en attente', async () => {
      const env = await bobADeuxDemandes();
      await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'oui', cite: env.demandeBp }));
      await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non' }));
      const lignes = env.tableur.lignes('Inscriptions').filter((l) => l.Nom === 'Durand Bob');
      expect(lignes.map((l) => `${l.Type} : ${l.Statut}`)).toEqual(['BP : Confirmé', 'Maraude : Désisté']);
    });
  });
});

describe('vote tardif dans le sondage (après l\'envoi des confirmations)', () => {
  test('nouvel inscrit : sa demande de confirmation part tout de suite', async () => {
    const env = await preparer();
    await env.planificateur.tick(); // jeudi 10:00 : demandes envoyées
    env.horloge.avancer({ heures: 2 });

    const CHLOE = '33655555555';
    await recevoirVote(env.ctx, env.messagerie.vote({ de: CHLOE, nom: 'Chloé', sondage: ANNONCE_BP, choix: ['dispo !!'] }));

    const recus = env.messagerie.envoyesA(CHLOE).map((m) => m.texte);
    expect(recus[0]).toContain('Tu confirmes ta présence ?');
    expect(recus[1]).toBe(QUESTION_BP); // le sondage Oui / Non
    expect(recus[2]).toContain('peux-tu me donner ton prénom et ton nom'); // nouvelle : on demande aussi son nom
    expect(env.tableur.lignes('Inscriptions').find((l) => l.Téléphone === '06 55 55 55 55')?.Statut).toBe('En attente');
  });

  test('Désisté qui revote « dispo » dans le sondage : réinscrit, nouvelle demande envoyée', async () => {
    const env = await preparer();
    await env.planificateur.tick();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'non' })); // Désisté en privé
    env.messagerie.envoyes.length = 0;

    await recevoirVote(env.ctx, env.messagerie.vote({ de: BOB, nom: 'Bob', sondage: ANNONCE_BP, choix: ['dispo !!'] }));
    expect(env.messagerie.envoyesA(BOB)[0].texte).toBe(DEMANDE_BOB);
    expect(statuts(env)[0]).toBe('Durand Bob : En attente');
  });
});

describe('vote dans le sondage de confirmation (en privé, S6)', () => {
  /** Demandes envoyées le jeudi ; renvoie l'ID du sondage de confirmation de Bob. */
  async function apresDemandes(): Promise<EnvironnementDeTest & { sondageBob: string }> {
    const env = await preparer();
    await env.planificateur.tick();
    const sondageBob = env.messagerie.envoyesA(BOB).find((m) => m.sondage)?.id ?? '';
    env.messagerie.envoyes.length = 0;
    env.horloge.avancer({ minutes: 10 });
    return { ...env, sondageBob };
  }

  /** Bob vote en privé (la discussion est la sienne, pas le groupe). */
  const voteDeBob = (env: EnvironnementDeTest, sondage: string, choix: string[], de: string | null = BOB) =>
    recevoirVote(env.ctx, env.messagerie.vote({ de, nom: 'Bob', sondage, choix, groupe: BOB }));

  test('« Oui » → « Confirmé » et « C\'est noté, merci ! »', async () => {
    const env = await apresDemandes();
    await voteDeBob(env, env.sondageBob, [OUI]);
    expect(statuts(env)).toEqual(['Durand Bob : Confirmé', 'Martin Alice : En attente']);
    expect(env.messagerie.envoyes).toEqual([expect.objectContaining({ destinataire: BOB, texte: "C'est noté, merci !" })]);
  });

  test('« Non » → « Désisté »', async () => {
    const env = await apresDemandes();
    await voteDeBob(env, env.sondageBob, [NON]);
    expect(statuts(env)[0]).toBe('Durand Bob : Désisté');
  });

  test('changement d\'avis : Non puis Oui → « Confirmé » ; un accusé à chaque changement, pas plus', async () => {
    const env = await apresDemandes();
    await voteDeBob(env, env.sondageBob, [NON]);
    env.horloge.avancer({ secondes: 5 });
    await voteDeBob(env, env.sondageBob, [OUI]);
    env.horloge.avancer({ secondes: 5 });
    await voteDeBob(env, env.sondageBob, [OUI]); // même choix renvoyé : rien de nouveau
    expect(statuts(env)[0]).toBe('Durand Bob : Confirmé');
    expect(env.messagerie.envoyes).toHaveLength(2);
  });

  test('vote retiré (plus rien de coché) : statut inchangé, aucun message', async () => {
    const env = await apresDemandes();
    await voteDeBob(env, env.sondageBob, [OUI]);
    env.messagerie.envoyes.length = 0;
    env.horloge.avancer({ secondes: 5 });
    await voteDeBob(env, env.sondageBob, []);
    expect(statuts(env)[0]).toBe('Durand Bob : Confirmé');
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('numéro masqué par WhatsApp : le sondage suffit à retrouver Bob, l\'accusé part quand même chez lui', async () => {
    const env = await apresDemandes();
    await voteDeBob(env, env.sondageBob, [OUI], null);
    expect(statuts(env)[0]).toBe('Durand Bob : Confirmé');
    expect(env.messagerie.envoyes[0].destinataire).toBe(BOB);
  });

  test('deux demandes en même temps : chaque sondage s\'applique à SA demande (plus besoin de citer)', async () => {
    const env = await preparer();
    await ajouterAction(env, { ID: 'A-0002', Type: 'Maraude', Date: '28/11/2026', Heure: '19:00', Statut: 'Annoncée', 'Message ID': 'annonce-m' });
    await ajouterLignesDeTest(env.tableur, 'Inscriptions', [{
      ID: 'I-00003', 'Action ID': 'A-0002', Type: 'Maraude', Date: '2026-11-28', Heure: '19:00', Téléphone: '06 12 34 56 78', Nom: 'Durand Bob', Statut: 'Inscrit',
    }]);
    await env.planificateur.tick();
    const [sondageBp, sondageMaraude] = env.messagerie.envoyesA(BOB).filter((m) => m.sondage);
    expect(sondageMaraude.texte).toBe('Maraude – samedi 28/11 à 19:00 : tu confirmes ?');

    await voteDeBob(env, sondageMaraude.id, [NON]);
    await voteDeBob(env, sondageBp.id, [OUI]);
    const lignes = env.tableur.lignes('Inscriptions').filter((l) => l.Nom === 'Durand Bob');
    expect(lignes.map((l) => `${l.Type} : ${l.Statut}`)).toEqual(['BP : Confirmé', 'Maraude : Désisté']);
  });

  test('après la liste : « Non » d\'un confirmé → désistement de dernière minute, le référent est prévenu', async () => {
    const env = await apresDemandes();
    await changerParametre(env.tableur, 'NUMERO_REFERENT', '06 99 99 99 99');
    await voteDeBob(env, env.sondageBob, [OUI]);
    await env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: 'Liste publiée' } }]);
    env.messagerie.envoyes.length = 0;
    env.horloge.avancer({ minutes: 5 });

    await voteDeBob(env, env.sondageBob, [NON]);
    expect(statuts(env)[0]).toBe('Durand Bob : Désisté');
    expect(env.messagerie.envoyesA('33699999999')[0].texte).toContain('⚠️ Désistement de dernière minute : Durand Bob');
    expect(env.messagerie.envoyesA(BOB).map((m) => m.texte)).toEqual(["C'est noté, merci !"]);
  });

  test('après la liste : « Oui » de quelqu\'un qui n\'avait pas répondu → rien (le référent gère)', async () => {
    const env = await apresDemandes();
    await env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: 'Liste publiée' } }]);
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 2, valeurs: { Statut: 'Sans réponse' } }]);
    await voteDeBob(env, env.sondageBob, [OUI]);
    expect(statuts(env)[0]).toBe('Durand Bob : Sans réponse');
    expect(env.messagerie.envoyes).toEqual([]);
    expect(logsDeNiveau(env, 'INFO').some((l) => l.startsWith('Vote de confirmation de Durand Bob (OUI) ignoré'))).toBe(true);
  });

  test('vote sur un sondage inconnu (pas une demande du bot) : ignoré', async () => {
    const env = await apresDemandes();
    await voteDeBob(env, 'un-autre-sondage', [OUI]);
    expect(statuts(env)[0]).toBe('Durand Bob : En attente');
  });

  test('le même vote reçu deux fois (webhook renvoyé) : un seul accusé', async () => {
    const env = await apresDemandes();
    const vote = env.messagerie.vote({ de: BOB, sondage: env.sondageBob, choix: [OUI], groupe: BOB });
    await recevoirVote(env.ctx, vote);
    await recevoirVote(env.ctx, vote);
    expect(env.messagerie.envoyes).toHaveLength(1);
  });

  test('le OUI écrit marche toujours en secours', async () => {
    const env = await apresDemandes();
    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'oui' }));
    expect(statuts(env)[0]).toBe('Durand Bob : Confirmé');
  });

  test('sondage non envoyé (texte parti) : « En attente » quand même, et le OUI écrit fonctionne', async () => {
    const env = await preparer();
    env.messagerie.sondagesEnEchec = true;
    await env.planificateur.tick();
    expect(statuts(env)).toEqual(['Durand Bob : En attente', 'Martin Alice : En attente']);
    expect(env.tableur.lignes('Inscriptions')[0]['Demande ID']).toBe(env.messagerie.envoyesA(BOB)[0].id); // l'ID du texte
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('Sondage de confirmation non envoyé à Durand Bob');

    await recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, texte: 'oui' }));
    expect(statuts(env)[0]).toBe('Durand Bob : Confirmé');
  });

  test('libellés modifiés dans les Paramètres : utilisés dans le sondage ET pour lire les votes', async () => {
    const env = await contexteDeTest('2026-11-26 10:00');
    await changerParametre(env.tableur, 'OPTION_CONFIRMER_OUI', 'Je viens');
    await changerParametre(env.tableur, 'OPTION_CONFIRMER_NON', 'Je ne viens plus');
    await ajouterAction(env, { ID: 'A-0001', Type: 'BP', Date: '28/11/2026', Heure: '14:00', Statut: 'Annoncée', 'Message ID': ANNONCE_BP });
    await ajouterLignesDeTest(env.tableur, 'Inscriptions', [
      { ID: 'I-00001', 'Action ID': 'A-0001', Type: 'BP', Date: '2026-11-28', Heure: '14:00', Téléphone: '06 12 34 56 78', Nom: 'Bob', Statut: 'Inscrit' },
    ]);
    await env.planificateur.tick();
    const sondage = env.messagerie.sondages()[0];
    expect(sondage.sondage?.choix).toEqual(['Je viens', 'Je ne viens plus']);
    await voteDeBob(env, sondage.id, ['Je viens']);
    expect(statuts(env)[0]).toBe('Bob : Confirmé');
  });
});
