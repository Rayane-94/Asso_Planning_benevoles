/**
 * Votes dans le sondage de l'annonce (étape S3). Scénario de base : le samedi 21/11 à 18:00,
 * le bot annonce le BP du samedi 28/11 (texte + sondage) ; les bénévoles votent.
 */
import { describe, expect, test } from 'vitest';
import { recevoirMessage } from '../../src/metier/reception.ts';
import { recevoirVote } from '../../src/metier/votes.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { ajouterLignesDeTest } from '../faux/sheetDeTest.ts';

const BOB = '33612345678';
const ALICE = '33611223344';
const DEMANDE_NOM = 'Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?';
const CRENEAU_1 = 'dispo de 10h à 13h';
const CRENEAU_2 = 'dispo de 13h à 16h';

/** Annonce publiée ; renvoie aussi l'ID du sondage. `creneaux` vide = sondage dispo / pas dispo. */
async function apresAnnonce(creneaux = ''): Promise<EnvironnementDeTest & { sondage: string }> {
  const env = await contexteDeTest('2026-11-21 18:00');
  await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt', Créneaux: creneaux });
  await env.planificateur.tick();
  const sondage = env.messagerie.sondages()[0].id;
  env.messagerie.envoyes.length = 0;
  env.horloge.avancer({ minutes: 5 });
  return { ...env, sondage };
}

/** Bob (ou un autre) vote : `choix` = tout ce qui est coché après ce vote. */
const vote = (env: EnvironnementDeTest & { sondage: string }, choix: string[], de: string | null = BOB, nom = 'Bob') =>
  recevoirVote(env.ctx, env.messagerie.vote({ de, nom, sondage: env.sondage, choix }));

const inscriptions = (env: EnvironnementDeTest) =>
  env.tableur.lignes('Inscriptions').map((l) => `${l.Nom} : ${l.Statut}${l.Créneau ? ` [${l.Créneau}]` : ''}`);

describe('sondage simple (dispo / pas dispo)', () => {
  test('« dispo !! » : nouveau bénévole inscrit, ajouté aux Bénévoles, et on lui demande son nom en privé', async () => {
    const env = await apresAnnonce();
    await vote(env, ['dispo !!']);

    expect(env.tableur.lignes('Inscriptions')[0]).toMatchObject({
      ID: 'I-00001', 'Action ID': 'A-0001', Type: 'BP', Date: '2026-11-28', Heure: '14:00', Lieu: 'Entrepôt',
      Téléphone: '06 12 34 56 78', Nom: 'Bob', Créneau: '', Statut: 'Inscrit',
    });
    expect(env.tableur.lignes('Bénévoles')[0]).toMatchObject({ Téléphone: '06 12 34 56 78', 'Nom WhatsApp': 'Bob' });
    expect(env.messagerie.envoyes).toEqual([expect.objectContaining({ destinataire: BOB, texte: DEMANDE_NOM })]);
    expect(logsDeNiveau(env, 'INFO')).toContain('Inscription : Bob pour BP du samedi 28/11');
  });

  test('bénévole déjà connu : inscrit sous « Nom Prénom », aucun message privé', async () => {
    const env = await apresAnnonce();
    await ajouterLignesDeTest(env.tableur, 'Bénévoles', [{ Téléphone: '06 12 34 56 78', Prénom: 'Bob', Nom: 'Durand' }]);
    await vote(env, ['dispo !!']);
    expect(inscriptions(env)).toEqual(['Durand Bob : Inscrit']);
    expect(env.messagerie.envoyes).toEqual([]);
  });

  test('« pas dispo :/ » sans avoir été inscrit : rien n\'est créé', async () => {
    const env = await apresAnnonce();
    await vote(env, ['pas dispo :/']);
    expect(inscriptions(env)).toEqual([]);
    expect(env.tableur.lignes('Bénévoles')).toEqual([]);
  });

  test('changement d\'avis : dispo → pas dispo (Retiré) → dispo (même ligne, de nouveau Inscrit)', async () => {
    const env = await apresAnnonce();
    await vote(env, ['dispo !!']);
    await vote(env, ['pas dispo :/']);
    expect(inscriptions(env)).toEqual(['Bob : Retiré']);
    await vote(env, ['dispo !!']);
    expect(inscriptions(env)).toEqual(['Bob : Inscrit']);
  });

  test('vote retiré (plus rien de coché) : Retiré', async () => {
    const env = await apresAnnonce();
    await vote(env, ['dispo !!']);
    await vote(env, []);
    expect(inscriptions(env)).toEqual(['Bob : Retiré']);
  });

  test('deux bénévoles : deux inscriptions avec des ID différents', async () => {
    const env = await apresAnnonce();
    await vote(env, ['dispo !!']);
    await vote(env, ['dispo !!'], ALICE, 'Alice');
    expect(env.tableur.lignes('Inscriptions').map((l) => [l.ID, l.Nom])).toEqual([['I-00001', 'Bob'], ['I-00002', 'Alice']]);
  });
});

describe('sondage avec créneaux', () => {
  test('un créneau coché : inscrit avec ce créneau (colonne Créneau)', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await vote(env, [CRENEAU_1]);
    expect(inscriptions(env)).toEqual([`Bob : Inscrit [${CRENEAU_1}]`]);
  });

  test('deux créneaux cochés : UNE inscription, avec les deux créneaux (dans l\'ordre du sondage)', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await vote(env, [CRENEAU_2, CRENEAU_1]);
    expect(inscriptions(env)).toEqual([`Bob : Inscrit [${CRENEAU_1}, ${CRENEAU_2}]`]);
  });

  test('le parcours exact du spike : 10h-13h → +13h-16h → 10h-13h → [] → pas dispo', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await vote(env, [CRENEAU_1]);
    await vote(env, [CRENEAU_1, CRENEAU_2]);
    expect(inscriptions(env)).toEqual([`Bob : Inscrit [${CRENEAU_1}, ${CRENEAU_2}]`]);
    await vote(env, [CRENEAU_1]);
    expect(inscriptions(env)).toEqual([`Bob : Inscrit [${CRENEAU_1}]`]);
    await vote(env, []);
    await vote(env, ['pas dispo :/']);
    // Le dernier créneau choisi est gardé : on sait quel créneau a perdu quelqu'un.
    expect(inscriptions(env)).toEqual([`Bob : Retiré [${CRENEAU_1}]`]);
    expect(logsDeNiveau(env, 'INFO').some((l) => l.startsWith('Créneau modifié'))).toBe(true);
  });

  test('test réel du 20/11 : « pas dispo » écrit dans Créneaux, puis voté → Retiré (pas inscrit sur un créneau « pas dispo »)', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}, pas dispo`);
    await vote(env, [CRENEAU_1]);
    await vote(env, ['pas dispo']); // le choix « pas dispo » écrit par le référent
    expect(inscriptions(env)).toEqual([`Bob : Retiré [${CRENEAU_1}]`]);
  });

  test('« pas dispo » écrit dans Créneaux : le sondage ne le propose qu\'une fois', async () => {
    const env = await contexteDeTest('2026-11-21 18:00');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Créneaux: `${CRENEAU_1}, pas dispo` });
    await env.planificateur.tick();
    expect(env.messagerie.sondages()[0].sondage?.choix).toEqual([CRENEAU_1, 'pas dispo :/']);
  });

  test('un créneau ET « pas dispo » cochés en même temps : le créneau l\'emporte (il a coché qu\'il venait)', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await vote(env, [CRENEAU_1, 'pas dispo :/']);
    expect(inscriptions(env)).toEqual([`Bob : Inscrit [${CRENEAU_1}]`]);
  });
});

describe('après la demande de confirmation', () => {
  test('vote retiré alors qu\'il était « En attente » : Désisté', async () => {
    const env = await apresAnnonce();
    await vote(env, ['dispo !!']);
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 2, valeurs: { Statut: 'En attente' } }]);
    await vote(env, ['pas dispo :/']);
    expect(inscriptions(env)).toEqual(['Bob : Désisté']);
  });

  test('changement de créneau alors qu\'il est « Confirmé » : reste Confirmé, créneau mis à jour', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await vote(env, [CRENEAU_1]);
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 2, valeurs: { Statut: 'Confirmé' } }]);
    await vote(env, [CRENEAU_2]);
    expect(inscriptions(env)).toEqual([`Bob : Confirmé [${CRENEAU_2}]`]);
  });
});

describe('votes ignorés', () => {
  test.each(['Annulée', 'Liste publiée'])('vote sur une action « %s » : ignoré (info au Journal)', async (statut) => {
    const env = await apresAnnonce();
    await env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: statut } }]);
    await vote(env, ['dispo !!']);
    expect(inscriptions(env)).toEqual([]);
    expect(logsDeNiveau(env, 'INFO').some((l) => l.includes('Vote de Bob ignoré'))).toBe(true);
  });

  test('vote sur un sondage qui n\'est pas une annonce du bot : ignoré', async () => {
    const env = await apresAnnonce();
    await recevoirVote(env.ctx, env.messagerie.vote({ de: BOB, sondage: 'un-autre-sondage', choix: ['dispo !!'] }));
    expect(inscriptions(env)).toEqual([]);
  });

  test('vote dans un autre groupe : ignoré', async () => {
    const env = await apresAnnonce();
    await recevoirVote(env.ctx, env.messagerie.vote({ de: BOB, sondage: env.sondage, choix: ['dispo !!'], groupe: 'autre-groupe' }));
    expect(inscriptions(env)).toEqual([]);
  });

  test('numéro masqué et inconnu de l\'annuaire, et message privé impossible : avertissement pour l\'équipe', async () => {
    const env = await apresAnnonce();
    const unVote = env.messagerie.vote({ de: null, nom: 'Bob', sondage: env.sondage, choix: ['dispo !!'], lid: 'lid-bob' });
    env.messagerie.faireEchouerEnvoisVers('lid-bob');
    await recevoirVote(env.ctx, unVote);
    expect(inscriptions(env)).toEqual([]);
    expect(logsDeNiveau(env, 'AVERTISSEMENT')[0]).toContain('à inscrire à la main');
  });

  test('le même vote reçu deux fois (webhook renvoyé) : traité une seule fois', async () => {
    const env = await apresAnnonce();
    const unVote = env.messagerie.vote({ de: BOB, nom: 'Bob', sondage: env.sondage, choix: ['dispo !!'] });
    await recevoirVote(env.ctx, unVote);
    await env.tableur.modifierLignes('Inscriptions', [{ numero: 2, valeurs: { Statut: 'Retiré' } }]); // l'équipe corrige
    await recevoirVote(env.ctx, unVote);
    expect(inscriptions(env)).toEqual(['Bob : Retiré']);
  });

  test('un vote plus ANCIEN que le dernier reçu (arrivé dans le désordre) : ignoré', async () => {
    const env = await apresAnnonce();
    const ancien = env.messagerie.vote({ de: BOB, nom: 'Bob', sondage: env.sondage, choix: ['dispo !!'] });
    env.horloge.avancer({ secondes: 1 });
    const recent = env.messagerie.vote({ de: BOB, nom: 'Bob', sondage: env.sondage, choix: [] });
    await recevoirVote(env.ctx, recent); // arrive en premier…
    await recevoirVote(env.ctx, ancien); // … puis l'ancien : ne doit pas réinscrire
    expect(inscriptions(env)).toEqual([]);
  });
});

describe('file d\'attente partagée avec le tick', () => {
  test('un vote arrivé pendant un tick est traité après, sans conflit', async () => {
    const env = await apresAnnonce();
    await Promise.all([env.planificateur.tick(), vote(env, ['dispo !!'])]);
    expect(inscriptions(env)).toHaveLength(1);
  });
});

describe('numéro masqué par WhatsApp (canal d\'annonces d\'une communauté, S9)', () => {
  const DEMANDE = 'Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?';
  /** Bob vote depuis la communauté : WhatsApp ne donne que son identifiant masqué. */
  const voteMasque = (env: EnvironnementDeTest & { sondage: string }, choix: string[]) =>
    recevoirVote(env.ctx, env.messagerie.vote({ de: null, nom: 'Bob', sondage: env.sondage, choix, lid: 'lid-bob' }));
  /** Bob répond en privé : là, WhatsApp donne son vrai numéro. */
  const reponsePrivee = (env: EnvironnementDeTest, texte: string) =>
    recevoirMessage(env.ctx, env.messagerie.recu({ de: BOB, nom: 'Bob', texte, lid: 'lid-bob' }));

  test('A — l\'annuaire du fournisseur connaît le numéro : inscription normale, comme dans un groupe classique', async () => {
    const env = await apresAnnonce();
    env.messagerie.annuaire.set('lid-bob', BOB);
    await voteMasque(env, ['dispo !!']);
    expect(env.tableur.lignes('Inscriptions')[0]).toMatchObject({ Téléphone: '06 12 34 56 78', Statut: 'Inscrit' });
    expect(env.messagerie.envoyes).toEqual([expect.objectContaining({ destinataire: BOB, texte: DEMANDE })]);
  });

  test('B — numéro inconnu : le vote attend, et le nom est demandé en privé à l\'identifiant masqué', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await voteMasque(env, [CRENEAU_1]);
    expect(inscriptions(env)).toEqual([]);
    expect(env.messagerie.envoyes).toEqual([expect.objectContaining({ destinataire: 'lid-bob', texte: DEMANDE })]);
    expect(logsDeNiveau(env, 'INFO').some((l) => l.includes('nom demandé en privé, inscription dès sa réponse'))).toBe(true);
  });

  test('B — il répond son nom en privé : fiche créée avec son vrai numéro, vote enregistré, « Merci » ; pas de 2e demande', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await voteMasque(env, [CRENEAU_1]);
    env.messagerie.envoyes.length = 0;

    await reponsePrivee(env, 'bob durand');
    expect(env.tableur.lignes('Bénévoles')[0]).toMatchObject({ Téléphone: '06 12 34 56 78', Prénom: 'Bob', Nom: 'Durand' });
    expect(inscriptions(env)).toEqual([`Durand Bob : Inscrit [${CRENEAU_1}]`]);
    expect(env.messagerie.envoyes.map((m) => [m.destinataire, m.texte])).toEqual([[BOB, "Merci Bob, c'est noté !"]]);
  });

  test('B — il change son vote avant de répondre : c\'est le DERNIER vote qui compte, une seule demande de nom', async () => {
    const env = await apresAnnonce(`${CRENEAU_1}, ${CRENEAU_2}`);
    await voteMasque(env, [CRENEAU_1]);
    env.horloge.avancer({ secondes: 5 });
    await voteMasque(env, [CRENEAU_1, CRENEAU_2]);
    expect(env.messagerie.envoyes).toHaveLength(1);

    await reponsePrivee(env, 'Bob Durand');
    expect(inscriptions(env)).toEqual([`Durand Bob : Inscrit [${CRENEAU_1}, ${CRENEAU_2}]`]);
  });

  test('B — il vote « pas dispo » avant de répondre : rien n\'est créé dans Inscriptions', async () => {
    const env = await apresAnnonce();
    await voteMasque(env, ['dispo !!']);
    env.horloge.avancer({ secondes: 5 });
    await voteMasque(env, ['pas dispo :/']);
    await reponsePrivee(env, 'Bob Durand');
    expect(inscriptions(env)).toEqual([]);
  });

  test('B — sa réponse n\'est pas un nom : il est quand même inscrit (numéro connu), et le bot dit qu\'il est un robot', async () => {
    const env = await apresAnnonce();
    await voteMasque(env, ['dispo !!']);
    env.messagerie.envoyes.length = 0;
    await reponsePrivee(env, "c'est à quelle heure ?");
    expect(inscriptions(env)).toEqual(['Bob : Inscrit']); // le nom WhatsApp en attendant
    expect(env.messagerie.dernierEnvoi().texte).toContain('Je suis un robot');
  });

  test('B — les confirmations sont déjà parties quand il répond : sa demande de confirmation part tout de suite', async () => {
    const env = await apresAnnonce();
    await voteMasque(env, ['dispo !!']);
    await env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs: { Statut: 'Confirmations envoyées' } }]);
    env.messagerie.envoyes.length = 0;
    await reponsePrivee(env, 'Bob Durand');
    expect(env.messagerie.sondages().map((m) => m.destinataire)).toEqual([BOB]); // le sondage Oui / Non
    expect(inscriptions(env)).toEqual(['Durand Bob : En attente']);
  });
});
