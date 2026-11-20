/**
 * Action modifiée par le référent → les inscriptions suivent (CLAUDE.md §5).
 * Scénario : le BP du dimanche 22/11 (16:00, Entrepôt) a deux inscrits.
 */
import { describe, expect, test } from 'vitest';
import { synchroniserInscriptions } from '../../src/metier/synchronisation.ts';
import { lireActions } from '../../src/sheets/actions.ts';
import { lireParametres } from '../../src/sheets/parametres.ts';
import { ajouterAction, contexteDeTest, logsDeNiveau, type EnvironnementDeTest } from '../faux/contexteDeTest.ts';
import { ajouterLignesDeTest } from '../faux/sheetDeTest.ts';

async function bpAvecDeuxInscrits(): Promise<EnvironnementDeTest> {
  const env = await contexteDeTest('2026-11-20 16:00');
  await ajouterAction(env, {
    ID: 'A-0001', Type: 'BP', Date: '22/11/2026', Heure: '16:00', Lieu: 'Entrepôt', Statut: 'Annoncée', 'Message ID': 'm1',
  });
  const inscription = (id: string, telephone: string, nom: string) => ({
    ID: id, 'Action ID': 'A-0001', Type: 'BP', Date: '2026-11-22', Heure: '16:00', Lieu: 'Entrepôt',
    Téléphone: telephone, Nom: nom, Statut: 'Confirmé',
  });
  await ajouterLignesDeTest(env.tableur, 'Inscriptions', [
    inscription('I-00001', '06 12 34 56 78', 'Durand Bob'),
    inscription('I-00002', '06 11 22 33 44', 'Martin Alice'),
  ]);
  return env;
}

/** Le référent modifie une cellule de l'action, comme dans le Sheet. */
const modifierAction = (env: EnvironnementDeTest, valeurs: Record<string, string>) =>
  env.tableur.modifierLignes('Actions', [{ numero: 2, valeurs }]);

const copies = (env: EnvironnementDeTest) =>
  env.tableur.lignes('Inscriptions').map((l) => `${l.Type} ${l.Date} ${l.Heure} ${l.Lieu}`);

describe('synchronisation des inscriptions', () => {
  test('date, heure et lieu modifiés : toutes les inscriptions suivent, sans aucun message', async () => {
    const env = await bpAvecDeuxInscrits();
    await modifierAction(env, { Date: '21/11/2026', Heure: '15h', Lieu: 'Local' });
    await env.planificateur.tick();

    expect(copies(env)).toEqual(['BP 2026-11-21 15:00 Local', 'BP 2026-11-21 15:00 Local']);
    expect(env.messagerie.envoyes).toEqual([]);
    expect(logsDeNiveau(env, 'INFO')).toContain(
      'Action A-0001 modifiée (date, heure, lieu) : 2 inscription(s) mise(s) à jour (aucun message envoyé)',
    );
  });

  test('le type change aussi (ex. BP → Collecte)', async () => {
    const env = await bpAvecDeuxInscrits();
    await modifierAction(env, { Type: 'Collecte' });
    await env.planificateur.tick();
    expect(copies(env)[0]).toBe('Collecte 2026-11-22 16:00 Entrepôt');
  });

  test('les statuts et les noms ne sont jamais touchés', async () => {
    const env = await bpAvecDeuxInscrits();
    await modifierAction(env, { Lieu: 'Local' });
    await env.planificateur.tick();
    expect(env.tableur.lignes('Inscriptions').map((l) => `${l.Nom} : ${l.Statut}`)).toEqual([
      'Durand Bob : Confirmé', 'Martin Alice : Confirmé',
    ]);
  });

  test('une seule écriture pour toutes les inscriptions ; rien à faire = aucune écriture', async () => {
    const env = await bpAvecDeuxInscrits();
    const donnees = async () => ({
      parametres: (await lireParametres(env.tableur)).parametres, actions: (await lireActions(env.tableur)).actions,
    });

    env.tableur.appels.ecritures = 0;
    expect(await synchroniserInscriptions(env.ctx, await donnees())).toBe(0);
    expect(env.tableur.appels.ecritures).toBe(0); // tout est à jour : on n'écrit rien

    await modifierAction(env, { Heure: '17:00' });
    env.tableur.appels.ecritures = 0;
    expect(await synchroniserInscriptions(env.ctx, await donnees())).toBe(2);
    expect(env.tableur.appels.ecritures).toBe(1);
  });

  test('inscription d\'une action supprimée du Sheet : laissée telle quelle', async () => {
    const env = await bpAvecDeuxInscrits();
    await env.tableur.supprimerLignes('Actions', 2, 1);
    await env.planificateur.tick();
    expect(copies(env)).toEqual(['BP 2026-11-22 16:00 Entrepôt', 'BP 2026-11-22 16:00 Entrepôt']);
  });

  test('fonctionne même quand le bot est en pause (aucun message n\'est envoyé de toute façon)', async () => {
    const env = await bpAvecDeuxInscrits();
    env.ctx.etat.ecrire('pause', '2026-11-20 15:00:00');
    await modifierAction(env, { Lieu: 'Local' });
    await env.planificateur.tick();
    expect(copies(env)[0]).toContain('Local');
  });
});
