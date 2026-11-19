/**
 * Faux Google Sheet en mémoire, pour les tests.
 *
 * Il respecte les contrats Tableur (utilisé par le bot) et AdministrationTableur
 * (utilisé par l'installation). Le test prépare les onglets comme le ferait un humain,
 * puis vérifie ce que le bot y a écrit :
 *
 *   tableur.preparerOnglet('Actions', ['ID', 'Type', 'Date'], [{ Type: 'BP', Date: '28/11/2026' }]);
 *   await publierAnnonces(...);
 *   tableur.lignes('Actions'); // → [{ ID: 'A-1', Type: 'BP', Date: '28/11/2026' }]
 */
import {
  valeursVersTableau, verifierColonnes,
  type AdministrationTableur, type ConfigColonne, type ContenuOnglet, type SeparateurArguments,
  type Tableur, type Valeurs,
} from '../../src/ports/tableur.ts';

interface Onglet {
  entetes: string[];
  lignes: string[][]; // lignes[0] = ligne 2 du Sheet
  colonnes: ConfigColonne[]; // configuration appliquée par l'installation
  formule: string | null; // formule en A1 (vues)
}

export class FauxTableur implements Tableur, AdministrationTableur {
  private readonly onglets = new Map<string, Onglet>();
  /** Compteurs d'appels, pour vérifier qu'on ne surcharge pas l'API Google (quotas). */
  readonly appels = { lectures: 0, ecritures: 0 };
  /** Simule la langue du Sheet : ',' = anglais, ';' = français (modifiable par le test). */
  separateur: SeparateurArguments = ',';

  constructor() {
    this.onglets.set('Feuille 1', ongletVide()); // comme un Sheet neuf
  }

  // ----- Contrat Tableur (ce que le bot utilise) -----

  async lireOnglet(nom: string): Promise<ContenuOnglet> {
    this.appels.lectures++;
    const onglet = this.onglet(nom);
    const lignes = onglet.lignes
      .map((valeurs, index) => ({ numero: index + 2, valeurs: versObjet(onglet.entetes, valeurs) }))
      .filter((ligne) => Object.values(ligne.valeurs).some((valeur) => valeur !== ''));
    return { entetes: [...onglet.entetes], lignes };
  }

  async ajouterLignes(nom: string, lignes: Valeurs[]): Promise<void> {
    this.appels.ecritures++;
    const onglet = this.onglet(nom);
    for (const valeurs of lignes) onglet.lignes.push(valeursVersTableau(nom, onglet.entetes, valeurs));
  }

  async modifierLignes(nom: string, modifications: { numero: number; valeurs: Valeurs }[]): Promise<void> {
    this.appels.ecritures++;
    const onglet = this.onglet(nom);
    for (const { numero, valeurs } of modifications) {
      verifierColonnes(nom, onglet.entetes, valeurs);
      if (numero < 2) throw new Error(`Onglet « ${nom} » : impossible de modifier la ligne ${numero} (en-têtes)`);
      // Si la ligne n'existe pas encore, on la crée vide (comme une cellule vide du Sheet).
      while (onglet.lignes.length < numero - 1) onglet.lignes.push(onglet.entetes.map(() => ''));
      const ligne = onglet.lignes[numero - 2];
      for (const [colonne, valeur] of Object.entries(valeurs)) ligne[onglet.entetes.indexOf(colonne)] = valeur;
    }
  }

  async supprimerLignes(nom: string, debut: number, nombre: number): Promise<void> {
    this.appels.ecritures++;
    if (debut < 2) throw new Error(`Onglet « ${nom} » : impossible de supprimer la ligne ${debut} (en-têtes)`);
    this.onglet(nom).lignes.splice(debut - 2, nombre);
  }

  // ----- Contrat AdministrationTableur (installation) -----

  async listerOnglets(): Promise<string[]> {
    return [...this.onglets.keys()];
  }

  async creerOnglet(nom: string): Promise<void> {
    if (this.onglets.has(nom)) throw new Error(`Une feuille nommée « ${nom} » existe déjà.`);
    this.onglets.set(nom, ongletVide());
  }

  async lireEntetes(nom: string): Promise<string[]> {
    return [...this.onglet(nom).entetes];
  }

  async ecrireEntetes(nom: string, entetes: string[]): Promise<void> {
    const onglet = this.onglet(nom);
    onglet.entetes = [...entetes];
    // Les lignes existantes s'allongent avec des cellules vides (les données ne bougent pas).
    onglet.lignes = onglet.lignes.map((ligne) => entetes.map((_, i) => ligne[i] ?? ''));
  }

  async configurerColonnes(nom: string, colonnes: ConfigColonne[]): Promise<void> {
    const onglet = this.onglet(nom);
    for (const colonne of colonnes) {
      if (!onglet.entetes.includes(colonne.nom)) throw new Error(`Onglet « ${nom} » : colonne « ${colonne.nom} » introuvable`);
    }
    onglet.colonnes = colonnes.map((colonne) => ({ ...colonne }));
  }

  async separateurArguments(): Promise<SeparateurArguments> {
    return this.separateur;
  }

  async ecrireFormule(nom: string, formule: string): Promise<void> {
    this.onglet(nom).formule = formule;
  }

  // ----- Commandes pour les tests -----

  /** Crée (ou remplace) un onglet avec ses en-têtes et, éventuellement, des lignes. */
  preparerOnglet(nom: string, entetes: string[], lignes: Valeurs[] = []): void {
    this.onglets.set(nom, {
      ...ongletVide(),
      entetes: [...entetes],
      lignes: lignes.map((valeurs) => valeursVersTableau(nom, entetes, valeurs)),
    });
  }

  /** Contenu d'un onglet, par nom de colonne (sans les numéros de ligne). */
  lignes(nom: string): Valeurs[] {
    const onglet = this.onglet(nom);
    return onglet.lignes.map((valeurs) => versObjet(onglet.entetes, valeurs));
  }

  existe(nom: string): boolean {
    return this.onglets.has(nom);
  }

  /** Configuration de colonnes appliquée par l'installation. */
  configuration(nom: string): ConfigColonne[] {
    return this.onglet(nom).colonnes;
  }

  /** Formule écrite en A1 par l'installation. */
  formule(nom: string): string | null {
    return this.onglet(nom).formule;
  }

  private onglet(nom: string): Onglet {
    const onglet = this.onglets.get(nom);
    if (!onglet) throw new Error(`Onglet « ${nom} » introuvable. (Lancer « npm run installer-sheet ».)`);
    return onglet;
  }
}

function ongletVide(): Onglet {
  return { entetes: [], lignes: [], colonnes: [], formule: null };
}

/** ['A-1', 'BP'] + ['ID', 'Type'] → { ID: 'A-1', Type: 'BP' } */
function versObjet(entetes: string[], valeurs: string[]): Valeurs {
  return Object.fromEntries(entetes.map((entete, i) => [entete, valeurs[i] ?? '']));
}
