/**
 * Onglet Commandes, pause, et tableau de bord « État du bot » (étape 10b).
 */
import { describe, expect, test } from 'vitest';
import { combinerAlertes, type Alerte, type Alertes } from '../../src/ports/alertes.ts';
import { estCochee } from '../../src/sheets/commandes.ts';
import { GROUPE_TEST } from '../faux/fausseMessagerie.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';

/** Coche la case « Lancer » d'une commande, comme le ferait le responsable. */
async function cocher(env: EnvironnementDeTest, commande: string, valeur = 'VRAI'): Promise<void> {
  const { lignes } = await env.tableur.lireOnglet('Commandes');
  const ligne = lignes.find((l) => l.valeurs.Commande === commande);
  if (!ligne) throw new Error(`Commande « ${commande} » introuvable`);
  await env.tableur.modifierLignes('Commandes', [{ numero: ligne.numero, valeurs: { Lancer: valeur } }]);
}

const commande = (env: EnvironnementDeTest, nom: string) => env.tableur.lignes('Commandes').find((l) => l.Commande === nom);
const etat = (env: EnvironnementDeTest, element: string) => env.tableur.lignes('État du bot').find((l) => l.Élément === element);

describe('onglet Commandes', () => {
  test('« Annoncer maintenant » : annonce une action proche (J+2) hors horaire ; case décochée, résultat noté', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await ajouterAction(env, { Type: 'BP', Date: '23/11/2026', Heure: '14:00', Lieu: 'Entrepôt' });
    await cocher(env, 'Annoncer maintenant');
    await env.planificateur.tick();

    expect(env.messagerie.envoyesA(GROUPE_TEST)).toHaveLength(1);
    expect(commande(env, 'Annoncer maintenant')).toMatchObject({
      Lancer: '', 'Dernière exécution': '2026-11-21 09:00:00', Résultat: '1 annonce(s) publiée(s)',
    });
  });

  test('« Annoncer maintenant » sans rien à publier : le résultat explique POURQUOI (cas réel du 20/11)', async () => {
    const env = await contexteDeTest('2026-11-20 15:45');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt' }); // J+8
    await cocher(env, 'Annoncer maintenant');
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toEqual([]);
    expect(commande(env, 'Annoncer maintenant')?.Résultat).toBe(
      'Aucune annonce publiée : A-0001 (28/11) : trop loin, annonce possible à partir du 21/11',
    );
  });

  test('les lignes vides de l\'onglet Commandes (case à cocher seule) sont ignorées', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await env.tableur.ajouterLignes('Commandes', [{ Commande: '', Lancer: 'FALSE' }, { Commande: '', Lancer: 'VRAI' }]);
    await env.planificateur.tick();
    expect(logsDeNiveau(env, 'INFO').some((l) => l.includes('Commande inconnue'))).toBe(false);
  });

  test('une commande cochée n\'est exécutée qu\'une fois', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await ajouterAction(env, { Type: 'BP', Date: '23/11/2026', Heure: '14:00' });
    await cocher(env, 'Annoncer maintenant');
    await env.planificateur.tick();
    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();
    expect(commande(env, 'Annoncer maintenant')?.Résultat).toBe('1 annonce(s) publiée(s)');
    expect(env.messagerie.envoyes).toHaveLength(1);
  });

  test.each(['TRUE', 'VRAI', 'true'])('case cochée lue comme « %s » (selon la langue du Sheet)', (valeur) => {
    expect(estCochee(valeur)).toBe(true);
  });

  test.each(['', 'FALSE', 'FAUX'])('case décochée lue comme « %s »', (valeur) => {
    expect(estCochee(valeur)).toBe(false);
  });

  test('« Vérifier la configuration » : résumé lisible', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await cocher(env, 'Vérifier la configuration');
    await env.planificateur.tick();
    expect(commande(env, 'Vérifier la configuration')?.Résultat).toBe(
      '✅ Google Sheet accessible · ✅ WhatsApp connecté (07 00 00 00 00) · ✅ Groupe « Bénévoles (test) » · ' +
      '⚠️ NUMERO_REFERENT vide (désistements tardifs non signalés)',
    );
  });

  test('« Vérifier la configuration » : groupe introuvable', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    env.ctx.groupeId = 'groupe-inconnu';
    await cocher(env, 'Vérifier la configuration');
    await env.planificateur.tick();
    expect(commande(env, 'Vérifier la configuration')?.Résultat).toContain('❌ Groupe introuvable');
  });

  test('commande qui échoue : la case est quand même décochée et l\'échec noté', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    env.ctx.messagerie.listerGroupes = async () => { throw new Error('WAHA ne répond pas'); };
    await cocher(env, 'Vérifier la configuration');
    await env.planificateur.tick();
    expect(commande(env, 'Vérifier la configuration')).toMatchObject({ Lancer: '', Résultat: 'Échec : WAHA ne répond pas' });
  });
});

describe('pause', () => {
  test('en pause : plus d\'annonce automatique ; « Reprendre » relance', async () => {
    const env = await contexteDeTest('2026-11-21 17:00');
    await ajouterAction(env, { Type: 'BP', Date: '28/11/2026', Heure: '14:00' });
    await cocher(env, 'Mettre le bot en pause');
    await env.planificateur.tick();
    expect(etat(env, 'Bot')?.État).toBe('⏸️ En pause');

    env.horloge.regler('2026-11-21 18:00');
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toEqual([]); // 18:00 mais en pause : pas d'annonce

    await cocher(env, 'Reprendre');
    await env.planificateur.tick();
    expect(etat(env, 'Bot')?.État).toBe('🟢 Actif');
    expect(env.messagerie.envoyes).toHaveLength(1); // annoncé dans le même tick
  });

  test('en pause, les commandes manuelles marchent toujours', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await ajouterAction(env, { Type: 'BP', Date: '23/11/2026', Heure: '14:00' });
    await cocher(env, 'Mettre le bot en pause');
    await env.planificateur.tick();
    await cocher(env, 'Annoncer maintenant');
    await env.planificateur.tick();
    expect(env.messagerie.envoyes).toHaveLength(1);
  });
});

describe('tableau de bord « État du bot »', () => {
  test('premier onglet du Sheet', async () => {
    const env = await contexteDeTest();
    expect((await env.tableur.listerOnglets())[0]).toBe('État du bot');
  });

  test('« Dernier passage » est mis à jour à chaque tick', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await env.planificateur.tick();
    expect(etat(env, 'Dernier passage')?.État).toBe('2026-11-21 09:00:00');
    env.horloge.avancer({ minutes: 1 });
    await env.planificateur.tick();
    expect(etat(env, 'Dernier passage')?.État).toBe('2026-11-21 09:01:00');
  });

  test('WhatsApp connecté au premier passage : « 🟢 Connecté »', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await env.planificateur.tick();
    expect(etat(env, 'WhatsApp')?.État).toBe('🟢 Connecté');
  });

  test('déconnexion : alerte rouge avec la marche à suivre, UNE seule erreur au Journal ; puis retour au vert', async () => {
    const env = await contexteDeTest('2026-11-21 09:00');
    await env.planificateur.tick();

    env.messagerie.deconnecter();
    env.horloge.avancer({ minutes: 1 });
    for (let i = 0; i < 5; i++) {
      await env.planificateur.tick();
      env.horloge.avancer({ minutes: 1 });
    }
    expect(etat(env, 'WhatsApp')).toMatchObject({ État: '🔴 Déconnecté', Depuis: '2026-11-21 09:01:00' });
    expect(etat(env, 'WhatsApp')?.['Que faire']).toContain('Rescanner le QR code');
    expect(logsDeNiveau(env, 'ERREUR').filter((l) => l.startsWith('WhatsApp déconnecté'))).toHaveLength(1);

    env.messagerie.reconnecter();
    await env.planificateur.tick();
    expect(etat(env, 'WhatsApp')?.État).toBe('🟢 Connecté');
    expect(logsDeNiveau(env, 'INFO')).toContain('WhatsApp reconnecté');
  });
});

describe('combinerAlertes (préparé pour l\'e-mail, étape 14)', () => {
  test('chaque alerte va à toutes les destinations, même si l\'une est en panne', async () => {
    const recues: string[] = [];
    const destination = (nom: string, enPanne = false): Alertes => ({
      declencher: async (alerte: Alerte) => { if (enPanne) throw new Error(`${nom} en panne`); recues.push(`${nom}:${alerte.titre}`); },
      lever: async () => {},
    });
    const alertes = combinerAlertes(destination('sheet'), destination('email', true), destination('sms'));
    const alerte = { id: 'WhatsApp', titre: '🔴', conseil: '', depuis: new Date() };

    await expect(alertes.declencher(alerte)).rejects.toThrow('email en panne');
    expect(recues).toEqual(['sheet:🔴', 'sms:🔴']); // les autres ont bien reçu l'alerte
  });
});
