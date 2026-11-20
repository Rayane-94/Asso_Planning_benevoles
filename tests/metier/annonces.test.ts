/**
 * Annonces J-7 (CLAUDE.md §4.2). Calendrier utilisé : samedi 21/11/2026 = J.
 */
import { describe, expect, test } from 'vitest';
import { estDansLaFenetre, publierAnnonces } from '../../src/metier/annonces.ts';
import { lireActions } from '../../src/sheets/actions.ts';
import { lireParametres } from '../../src/sheets/parametres.ts';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { changerParametre } from '../faux/sheetDeTest.ts';

const BP_SAMEDI_28 = { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' };

/** Lance la tâche d'annonces comme le ferait le tick. */
async function annoncer(env: EnvironnementDeTest, mode: 'automatique' | 'commande' = 'automatique'): Promise<number> {
  const { parametres } = await lireParametres(env.tableur);
  const { actions } = await lireActions(env.tableur);
  return publierAnnonces(env.ctx, { parametres, actions }, mode);
}

describe('annonce J-7 : le cas normal', () => {
  test('samedi 21 à 18:00 : le BP du samedi 28 est annoncé dans le groupe — un texte, puis le sondage', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();

    const [texte, sondage] = env.messagerie.envoyesA(GROUPE_TEST);
    expect(texte.texte).toBe(
      '📣 BP – samedi 28/11 à 14:00 – Entrepôt\n' +
      '👇 Votez dans le sondage ci-dessous pour participer.',
    );
    expect(sondage).toMatchObject({
      texte: 'BP – samedi 28/11 à 14:00',
      sondage: { choix: ['dispo !!', 'pas dispo :/'], plusieursChoix: false },
    });
    expect(env.horloge.pauses).toEqual([2000]); // 2 s entre le texte et le sondage
  });

  test('avec des créneaux : un choix par créneau + « pas dispo », plusieurs réponses possibles', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { ...BP_SAMEDI_28, Créneaux: 'dispo de 10h à 13h, dispo de 13h à 16h' });
    await env.planificateur.tick();
    expect(env.messagerie.sondages()[0].sondage).toEqual({
      choix: ['dispo de 10h à 13h', 'dispo de 13h à 16h', 'pas dispo :/'],
      plusieursChoix: true,
    });
  });

  test('les libellés « dispo » / « pas dispo » viennent des Paramètres', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await changerParametre(env.tableur, 'OPTION_DISPO', 'je viens 🙋');
    await changerParametre(env.tableur, 'OPTION_PAS_DISPO', 'pas cette fois');
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();
    expect(env.messagerie.sondages()[0].sondage?.choix).toEqual(['je viens 🙋', 'pas cette fois']);
  });

  test("le texte part mais pas le sondage : pas de renvoi automatique (le texte serait en double), erreur claire", async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, BP_SAMEDI_28);
    env.messagerie.sondagesEnEchec = true;
    await env.planificateur.tick();
    env.messagerie.sondagesEnEchec = false;
    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();

    expect(env.messagerie.textes()).toHaveLength(1); // le texte n'est PAS renvoyé
    expect(env.tableur.lignes('Actions')[0]['Message ID']).toBe('envoi-en-cours');
    expect(logsDeNiveau(env, 'ERREUR')[0]).toContain('le texte est parti mais PAS le sondage');
  });

  test("l'action passe à « Annoncée » et l'ID du message est gardé (pour reconnaître les réponses)", async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();

    const ligne = env.tableur.lignes('Actions')[0];
    expect(ligne).toMatchObject({ ID: 'A-0001', Statut: 'Annoncée', 'Message ID': env.messagerie.dernierEnvoi().id });
    expect(logsDeNiveau(env, 'INFO')).toContain('Annonce publiée : BP du samedi 28/11 (A-0001)');
  });

  test('avant 18:00 : rien ; à 18:00 : annonce', async () => {
    const env = await contexteDeTest('2026-11-21 17:59');
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toHaveLength(0);

    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();
    expect(env.messagerie.sondages()).toHaveLength(1);
  });

  test('action à J+8 : pas encore ; le lendemain à 18:00 : annoncée', async () => {
    const env = await contexteDeTest('2026-11-20 18:00'); // vendredi 20 → samedi 28 = J+8
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toHaveLength(0);

    env.horloge.avancer({ jours: 1 });
    await env.planificateur.tick();
    expect(env.messagerie.sondages()).toHaveLength(1);
  });

  test('HEURE_ANNONCE modifiée par l\'équipe : respectée', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await changerParametre(env.tableur, 'HEURE_ANNONCE', '19h');
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toHaveLength(0);
    env.horloge.regler('2026-11-21 19:00');
    await env.planificateur.tick();
    expect(env.messagerie.sondages()).toHaveLength(1);
  });
});

describe('jamais de doublon', () => {
  test('les ticks suivants ne renvoient pas une annonce déjà publiée', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, BP_SAMEDI_28);
    for (let minute = 0; minute < 5; minute++) {
      await env.planificateur.tick();
      env.horloge.avancer({ minutes: 1 });
    }
    env.horloge.avancer({ jours: 1 });
    await env.planificateur.tick();
    expect(env.messagerie.sondages()).toHaveLength(1);
  });

  test('envoi interrompu (marqueur « envoi-en-cours ») : pas de renvoi, avertissement pour un humain', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { ...BP_SAMEDI_28, ID: 'A-0001', 'Message ID': 'envoi-en-cours' });
    await env.planificateur.tick();

    expect(env.messagerie.envoyes).toHaveLength(0);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('peut-être interrompue : vérifier dans le groupe WhatsApp');
  });

  test("l'avertissement n'est pas répété à chaque minute (une fois par heure)", async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { ...BP_SAMEDI_28, ID: 'A-0001', 'Message ID': 'envoi-en-cours' });
    for (let minute = 0; minute < 30; minute++) {
      await env.planificateur.tick();
      env.horloge.avancer({ minutes: 1 });
    }
    expect(logsDeNiveau(env, 'AVERTISSEMENT')).toHaveLength(1);
  });

  test("échec d'envoi : l'action reste « à annoncer » et sera réessayée au tick suivant", async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, BP_SAMEDI_28);
    env.messagerie.deconnecter();
    await env.planificateur.tick();

    expect(env.tableur.lignes('Actions')[0]).toMatchObject({ Statut: '', 'Message ID': '' });
    expect(logsDeNiveau(env, 'ERREUR')[0]).toContain('Annonce non envoyée : BP du samedi 28/11');

    env.messagerie.reconnecter();
    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();
    expect(env.messagerie.sondages()).toHaveLength(1);
    expect(env.tableur.lignes('Actions')[0].Statut).toBe('Annoncée');
  });
});

describe('rattrapage et commande « Annoncer maintenant »', () => {
  test.each([
    ['28/11/2026', 'J+7', true],
    ['26/11/2026', 'J+5 (ajoutée tard)', true],
    ['24/11/2026', 'J+3 (ajoutée tard)', true],
    ['23/11/2026', 'J+2 (trop proche)', false],
    ['21/11/2026', "aujourd'hui", false],
    ['20/11/2026', 'passée', false],
  ])('automatique, action le %s (%s) → annoncée : %s', async (date, _description, annoncee) => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { ...BP_SAMEDI_28, Date: date });
    expect(await annoncer(env)).toBe(annoncee ? 1 : 0);
  });

  test('commande : annonce aussi les actions proches (J+2, aujourd\'hui), à toute heure', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await ajouterAction(env, { ...BP_SAMEDI_28, Date: '23/11/2026' });
    await ajouterAction(env, { ...BP_SAMEDI_28, Date: '21/11/2026' });
    await ajouterAction(env, { ...BP_SAMEDI_28, Date: '20/11/2026' }); // passée : jamais
    await ajouterAction(env, { ...BP_SAMEDI_28, Date: '30/11/2026' }); // J+9 : trop tôt, même en commande
    expect(await annoncer(env, 'commande')).toBe(2);
  });

  test('la limite du rattrapage suit JOURS_AVANT_CONFIRMATION (+1)', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await changerParametre(env.tableur, 'JOURS_AVANT_CONFIRMATION', '1');
    await ajouterAction(env, { ...BP_SAMEDI_28, Date: '23/11/2026' }); // J+2 devient autorisé
    expect(await annoncer(env)).toBe(1);
  });
});

describe('ce qui n\'est jamais annoncé automatiquement', () => {
  test.each(['Annoncée', 'Annulée', 'Liste publiée'])('statut « %s »', async (statut) => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { ...BP_SAMEDI_28, Statut: statut });
    expect(await annoncer(env)).toBe(0);
  });

  test('après 22:00 : attend le lendemain 18:00', async () => {
    const env = await contexteDeTest('2026-11-21 22:00');
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toHaveLength(0);
  });

  test('ligne incomplète : ignorée, avec un avertissement qui explique pourquoi', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026' });
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toHaveLength(0);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')).toContain('Actions, ligne 2 ignorée : incomplète (manque : Heure)');
  });

  test('groupe WhatsApp non configuré : rien n\'est envoyé, avertissement', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    env.ctx.groupeId = null;
    await ajouterAction(env, BP_SAMEDI_28);
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toHaveLength(0);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('GROUPE_ID');
  });
});

describe('plusieurs annonces le même soir', () => {
  test('une annonce par action, dans l\'ordre chronologique, espacées de 2 secondes', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { Type: 'Collecte', Date: '28/11/2026', Heure: '10:00', Lieu: 'Supermarché' });
    await ajouterAction(env, { Type: 'Maraude', Date: '25/11/2026', Heure: '19:00', Lieu: 'Gare de Lyon' });
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '09:00', Lieu: 'Entrepôt' });
    await env.planificateur.tick();

    expect(env.messagerie.envoyes.map((m) => m.texte.split('\n')[0])).toEqual([
      '📣 Maraude – mercredi 25/11 à 19:00 – Gare de Lyon', 'Maraude – mercredi 25/11 à 19:00',
      '📣 BP – samedi 28/11 à 09:00 – Entrepôt', 'BP – samedi 28/11 à 09:00',
      '📣 Collecte – samedi 28/11 à 10:00 – Supermarché', 'Collecte – samedi 28/11 à 10:00',
    ]);
    // 2 s entre chaque message : texte → sondage → texte → sondage…
    expect(env.horloge.pauses).toEqual([2000, 2000, 2000, 2000, 2000]);
    // Chaque action a son propre sondage (et donc son propre ID)
    expect(new Set(env.tableur.lignes('Actions').map((l) => l['Message ID'])).size).toBe(3);
  });
});

describe('estDansLaFenetre', () => {
  test.each([
    ['17:59', false], ['18:00', true], ['21:59', true], ['22:00', false],
  ])('%s entre 18:00 et 22:00 : %s', (heure, attendu) => {
    expect(estDansLaFenetre(heure, '18:00', '22:00')).toBe(attendu);
  });
});
