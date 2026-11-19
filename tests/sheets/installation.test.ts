import { describe, expect, test } from 'vitest';
import { COMMANDES, ONGLETS, PARAMETRES_DEFAUT } from '../../src/constantes.ts';
import { installerSheet } from '../../src/sheets/installation.ts';
import { COLONNES_ACTIONS, COLONNES_INSCRIPTIONS } from '../../src/sheets/schema.ts';
import { FauxTableur } from '../faux/fauxTableur.ts';

/** Lance l'installation sur un faux Sheet. */
async function installer(tableur: FauxTableur): Promise<string[]> {
  return installerSheet({ tableur, admin: tableur });
}

describe('installerSheet sur un Sheet neuf', () => {
  test('crée tous les onglets', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    for (const onglet of Object.values(ONGLETS)) expect(tableur.existe(onglet), onglet).toBe(true);
  });

  test('écrit les en-têtes dans l\'ordre du schéma', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    expect(await tableur.lireEntetes(ONGLETS.ACTIONS)).toEqual(Object.values(COLONNES_ACTIONS));
    expect(await tableur.lireEntetes(ONGLETS.INSCRIPTIONS)).toEqual(Object.values(COLONNES_INSCRIPTIONS));
  });

  test('remplit les paramètres par défaut et la liste des commandes', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const parametres = tableur.lignes(ONGLETS.PARAMETRES);
    expect(parametres.map((p) => p.Paramètre)).toEqual(Object.keys(PARAMETRES_DEFAUT));
    expect(parametres.find((p) => p.Paramètre === 'HEURE_ANNONCE')?.Valeur).toBe('18:00');
    expect(tableur.lignes(ONGLETS.COMMANDES).map((c) => c.Commande)).toEqual(Object.values(COMMANDES));
  });

  test('configure les colonnes : formats, listes déroulantes, cases, colonnes masquées', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const actions = tableur.configuration(ONGLETS.ACTIONS);
    const colonne = (nom: string) => actions.find((c) => c.nom === nom);
    expect(colonne('Date')?.format).toBe('date');
    expect(colonne('Heure')?.format).toBe('texte');
    expect(colonne('Type')?.choix).toEqual(['Maraude', 'BP', 'Paniers anti-gaspi', 'Collecte', 'Événement', 'Ménage']);
    expect(colonne('Statut')?.choix).toContain('Annulée');
    expect(colonne('Message ID')?.masquee).toBe(true);
    expect(tableur.configuration(ONGLETS.COMMANDES).find((c) => c.nom === 'Lancer')?.format).toBe('case');
  });

  test('marque en vert uniquement les colonnes à remplir par le responsable', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const aRemplir = (onglet: string) => tableur.configuration(onglet).filter((c) => c.aRemplir).map((c) => c.nom);
    expect(aRemplir(ONGLETS.ACTIONS)).toEqual(['Type', 'Date', 'Heure', 'Lieu', 'Places']);
    expect(aRemplir(ONGLETS.PARAMETRES)).toEqual(['Valeur']);
    expect(aRemplir(ONGLETS.COMMANDES)).toEqual(['Lancer']);
    expect(aRemplir(ONGLETS.INSCRIPTIONS)).toEqual([]); // tout est rempli par le bot
  });

  test('écrit les formules des vues Présents et Absents', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    expect(tableur.formule(ONGLETS.PRESENTS)).toContain("where I = 'Confirmé'");
    expect(tableur.formule(ONGLETS.ABSENTS)).toContain("'Sans réponse'");
  });

  test('Sheet en français : les formules utilisent « ; » (sinon #ERROR!)', async () => {
    const tableur = new FauxTableur();
    tableur.separateur = ';';
    await installer(tableur);
    expect(tableur.formule(ONGLETS.PRESENTS)).toMatch(/^=QUERY\('Inscriptions'!A:K; ".*"; 1\)$/);
  });

  test('le rapport liste ce qui a été fait', async () => {
    const rapport = await installer(new FauxTableur());
    expect(rapport).toContain('Onglet « Actions » créé');
    expect(rapport.some((ligne) => ligne.startsWith('Paramètres ajoutés'))).toBe(true);
  });
});

describe('installerSheet est idempotent (relançable sans danger)', () => {
  test('une 2e installation ne change rien et le rapport est vide', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const parametresAvant = tableur.lignes(ONGLETS.PARAMETRES);
    const rapport = await installer(tableur);
    expect(rapport).toEqual([]);
    expect(tableur.lignes(ONGLETS.PARAMETRES)).toEqual(parametresAvant); // pas de doublons
  });

  test("garde les valeurs modifiées par l'équipe", async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const ligneHeure = (await tableur.lireOnglet(ONGLETS.PARAMETRES)).lignes.find((l) => l.valeurs.Paramètre === 'HEURE_ANNONCE');
    await tableur.modifierLignes(ONGLETS.PARAMETRES, [{ numero: ligneHeure?.numero ?? 0, valeurs: { Valeur: '19:30' } }]);

    await installer(tableur);
    expect(tableur.lignes(ONGLETS.PARAMETRES).find((p) => p.Paramètre === 'HEURE_ANNONCE')?.Valeur).toBe('19:30');
  });

  test('la liste déroulante des types suit le paramètre TYPES_ACTIONS', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const ligneTypes = (await tableur.lireOnglet(ONGLETS.PARAMETRES)).lignes.find((l) => l.valeurs.Paramètre === 'TYPES_ACTIONS');
    await tableur.modifierLignes(ONGLETS.PARAMETRES, [{ numero: ligneTypes?.numero ?? 0, valeurs: { Valeur: 'Maraude, Distribution' } }]);

    await installer(tableur);
    expect(tableur.configuration(ONGLETS.ACTIONS).find((c) => c.nom === 'Type')?.choix).toEqual(['Maraude', 'Distribution']);
  });
});

describe('installerSheet répare un Sheet existant', () => {
  test('ajoute une colonne manquante à la fin, sans toucher aux données ni aux colonnes en plus', async () => {
    const tableur = new FauxTableur();
    // L'équipe a créé l'onglet à la main : il manque « Places » et « Message ID », il y a une colonne « Notes »
    tableur.preparerOnglet(ONGLETS.ACTIONS, ['ID', 'Type', 'Date', 'Heure', 'Lieu', 'Notes', 'Statut'], [
      { Type: 'BP', Date: '28/11/2026', Heure: '14:00', Lieu: 'Entrepôt', Notes: 'apporter des gants' },
    ]);

    const rapport = await installer(tableur);

    expect(await tableur.lireEntetes(ONGLETS.ACTIONS)).toEqual(['ID', 'Type', 'Date', 'Heure', 'Lieu', 'Notes', 'Statut', 'Places', 'Message ID']);
    expect(tableur.lignes(ONGLETS.ACTIONS)[0]).toMatchObject({ Type: 'BP', Notes: 'apporter des gants', Places: '' });
    expect(rapport).toContain('Onglet « Actions » : colonne(s) ajoutée(s) Places, Message ID');
  });

  test('les vues utilisent les lettres réelles si les colonnes d\'Inscriptions ont été déplacées', async () => {
    const tableur = new FauxTableur();
    const entetes = Object.values(COLONNES_INSCRIPTIONS);
    // On place « Statut » en premier
    tableur.preparerOnglet(ONGLETS.INSCRIPTIONS, ['Statut', ...entetes.filter((e) => e !== 'Statut')]);
    await installer(tableur);
    expect(tableur.formule(ONGLETS.PRESENTS)).toContain("where A = 'Confirmé'");
  });
});
