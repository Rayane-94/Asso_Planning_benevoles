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
    expect(aRemplir(ONGLETS.ACTIONS)).toEqual(['Type', 'Date', 'Heure', 'Lieu', 'Créneaux', 'Places']);
    expect(aRemplir(ONGLETS.PARAMETRES)).toEqual(['Valeur']);
    expect(aRemplir(ONGLETS.COMMANDES)).toEqual(['Lancer']);
    expect(aRemplir(ONGLETS.INSCRIPTIONS)).toEqual([]); // tout est rempli par le bot
  });

  test('cases à cocher « Lancer » : seulement en face des 7 commandes, pas sur toute la colonne', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    expect(tableur.configuration(ONGLETS.COMMANDES).find((c) => c.nom === 'Lancer')?.lignes).toBe(7);
  });

  test('chaque colonne verte (à remplir par le responsable) a une aide avec un exemple', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    for (const onglet of [ONGLETS.ACTIONS, ONGLETS.PARAMETRES, ONGLETS.COMMANDES]) {
      for (const colonne of tableur.configuration(onglet).filter((c) => c.aRemplir)) {
        expect(colonne.aide, `${onglet} › ${colonne.nom}`).toBeTruthy();
      }
    }
    const aide = (nom: string) => tableur.configuration(ONGLETS.ACTIONS).find((c) => c.nom === nom)?.aide;
    expect(aide('Date')).toContain('28/11/2026');
    expect(aide('Créneaux')).toContain('dispo de 10h à 13h, dispo de 13h à 16h');
  });

  test('écrit les formules des vues Présents et Absents', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    expect(tableur.formule(ONGLETS.PRESENTS)).toContain("where J = 'Confirmé'");
    expect(tableur.formule(ONGLETS.ABSENTS)).toContain("'Sans réponse'");
  });

  test('Sheet en français : les formules utilisent « ; » (sinon #ERROR!)', async () => {
    const tableur = new FauxTableur();
    tableur.separateur = ';';
    await installer(tableur);
    expect(tableur.formule(ONGLETS.PRESENTS)).toMatch(/^=QUERY\('Inscriptions'!A:L; ".*"; 1\)$/);
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

describe('installerSheet : migration des anciennes valeurs par défaut', () => {
  const ANCIEN_TEXTE = '📣 {type} – {date} à {heure} – {lieu}\nPour participer, répondez OUI en citant ce message (appui long → Répondre).';

  async function avecTexteAnnonce(texte: string): Promise<FauxTableur> {
    const tableur = new FauxTableur();
    await installer(tableur);
    const ligne = (await tableur.lireOnglet(ONGLETS.PARAMETRES)).lignes.find((l) => l.valeurs.Paramètre === 'TEXTE_ANNONCE');
    await tableur.modifierLignes(ONGLETS.PARAMETRES, [{ numero: ligne?.numero ?? 0, valeurs: { Valeur: texte } }]);
    return tableur;
  }
  const texteAnnonce = (tableur: FauxTableur) => tableur.lignes(ONGLETS.PARAMETRES).find((p) => p.Paramètre === 'TEXTE_ANNONCE')?.Valeur;

  test("l'ancien texte d'annonce (« répondez OUI en citant ») est remplacé par celui des sondages", async () => {
    const tableur = await avecTexteAnnonce(ANCIEN_TEXTE);
    const rapport = await installer(tableur);
    expect(texteAnnonce(tableur)).toBe(PARAMETRES_DEFAUT.TEXTE_ANNONCE.valeur);
    expect(rapport).toContain('Paramètres mis à jour (ancienne valeur par défaut) : TEXTE_ANNONCE');
  });

  test("l'ancien texte de confirmation (« Réponds OUI ou NON ») est remplacé par celui du sondage, avec les 2 nouveaux choix", async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const ligne = (await tableur.lireOnglet(ONGLETS.PARAMETRES)).lignes.find((l) => l.valeurs.Paramètre === 'TEXTE_CONFIRMATION');
    const ancien = "Bonjour {prenom} 👋 Tu t'es inscrit(e) pour : {type} – {date} à {heure} – {lieu}.\nTu confirmes ta présence ? Réponds OUI ou NON (avant {limite}).";
    await tableur.modifierLignes(ONGLETS.PARAMETRES, [{ numero: ligne?.numero ?? 0, valeurs: { Valeur: ancien } }]);

    await installer(tableur);
    const valeur = (nom: string) => tableur.lignes(ONGLETS.PARAMETRES).find((p) => p.Paramètre === nom)?.Valeur;
    expect(valeur('TEXTE_CONFIRMATION')).toBe(PARAMETRES_DEFAUT.TEXTE_CONFIRMATION.valeur);
    expect(valeur('OPTION_CONFIRMER_OUI')).toBe('✅ Oui, je serai là');
    expect(valeur('OPTION_CONFIRMER_NON')).toBe('❌ Non, je ne peux plus');
  });

  test("un texte personnalisé par l'équipe n'est jamais remplacé", async () => {
    const tableur = await avecTexteAnnonce('📣 Hello la team !! {type} le {date}');
    await installer(tableur);
    expect(texteAnnonce(tableur)).toBe('📣 Hello la team !! {type} le {date}');
  });

  test('nouveaux paramètres des sondages ajoutés', async () => {
    const tableur = new FauxTableur();
    await installer(tableur);
    const parametres = tableur.lignes(ONGLETS.PARAMETRES);
    expect(parametres.find((p) => p.Paramètre === 'OPTION_DISPO')?.Valeur).toBe('dispo !!');
    expect(parametres.find((p) => p.Paramètre === 'OPTION_PAS_DISPO')?.Valeur).toBe('pas dispo :/');
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

    expect(await tableur.lireEntetes(ONGLETS.ACTIONS)).toEqual(['ID', 'Type', 'Date', 'Heure', 'Lieu', 'Notes', 'Statut', 'Créneaux', 'Places', 'Message ID']);
    expect(tableur.lignes(ONGLETS.ACTIONS)[0]).toMatchObject({ Type: 'BP', Notes: 'apporter des gants', Places: '' });
    expect(rapport).toContain('Onglet « Actions » : colonne(s) ajoutée(s) Créneaux, Places, Message ID');
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
