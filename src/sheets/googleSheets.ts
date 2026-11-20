/**
 * sheets/googleSheets.ts — Le vrai Google Sheet, via l'API officielle de Google.
 *
 * Implémente les contrats Tableur (utilisé par le bot) et AdministrationTableur
 * (utilisé par l'installation). Authentification : compte de service Google
 * (voir docs/compte-service-google.md).
 *
 * Choix importants :
 *   - lecture des valeurs AFFICHÉES (FORMATTED_VALUE) : on lit '28/11/2026' et '19:00',
 *     jamais un numéro de série de date ;
 *   - écriture en mode RAW : le texte est écrit tel quel, jamais converti
 *     (pas de 0 perdu, et un nom WhatsApp qui commence par « = » ne devient pas une formule).
 */
import { readFileSync } from 'node:fs';
import { auth, sheets, type sheets_v4 } from '@googleapis/sheets';
import type { Config } from '../config.ts';
import {
  valeursVersTableau, verifierColonnes,
  type AdministrationTableur, type ConfigColonne, type ContenuOnglet, type SeparateurArguments,
  type Tableur, type Valeurs,
} from '../ports/tableur.ts';
import { lettreColonne } from './schema.ts';

export class GoogleSheets implements Tableur, AdministrationTableur {
  private readonly api: sheets_v4.Sheets;
  private readonly idSheet: string;
  /** Adresse e-mail du compte de service (pour les messages d'erreur « partagez le Sheet avec… »). */
  readonly emailCompteService: string;

  constructor(configGoogle: Config['google']) {
    this.idSheet = configGoogle.idSheet;
    const cle = lireCleCompteService(configGoogle.fichierCle);
    this.emailCompteService = cle.email;
    // Authentification « JWT » : le bot signe ses demandes avec la clé privée du compte de
    // service, Google lui renvoie un jeton d'accès valable 1 h (renouvelé automatiquement).
    // Le droit demandé (« scope ») est limité aux Google Sheets.
    const authentification = new auth.JWT({
      email: cle.email,
      key: cle.clePrivee,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.api = sheets({ version: 'v4', auth: authentification });
  }

  // =========================================================================
  // Contrat Tableur
  // =========================================================================

  async lireOnglet(onglet: string): Promise<ContenuOnglet> {
    const reponse = await this.appeler(onglet, () => this.api.spreadsheets.values.get({
      spreadsheetId: this.idSheet,
      range: plage(onglet),
      valueRenderOption: 'FORMATTED_VALUE',
    }));
    const [entetesBruts = [], ...lignes] = reponse.data.values ?? [];
    const entetes = entetesBruts.map((entete) => String(entete).trim());

    return {
      entetes,
      lignes: lignes
        .map((cellules, index) => ({
          numero: index + 2, // ligne 1 = en-têtes
          valeurs: Object.fromEntries(entetes.map((entete, i) => [entete, String(cellules[i] ?? '')])),
        }))
        .filter((ligne) => Object.values(ligne.valeurs).some((valeur) => valeur !== '')),
    };
  }

  async ajouterLignes(onglet: string, lignes: Valeurs[]): Promise<void> {
    if (lignes.length === 0) return;
    const entetes = await this.lireEntetes(onglet);
    await this.appeler(onglet, () => this.api.spreadsheets.values.append({
      spreadsheetId: this.idSheet,
      range: plage(onglet),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: lignes.map((valeurs) => valeursVersTableau(onglet, entetes, valeurs)) },
    }));
  }

  async modifierLignes(onglet: string, modifications: { numero: number; valeurs: Valeurs }[]): Promise<void> {
    if (modifications.length === 0) return;
    const entetes = await this.lireEntetes(onglet);
    // Une seule requête pour toutes les cellules (économise le quota Google).
    const data = modifications.flatMap(({ numero, valeurs }) => {
      verifierColonnes(onglet, entetes, valeurs);
      return Object.entries(valeurs).map(([colonne, valeur]) => ({
        range: `${nomProtege(onglet)}!${lettreColonne(entetes.indexOf(colonne))}${numero}`,
        values: [[valeur]],
      }));
    });
    await this.appeler(onglet, () => this.api.spreadsheets.values.batchUpdate({
      spreadsheetId: this.idSheet,
      requestBody: { valueInputOption: 'RAW', data },
    }));
  }

  async supprimerLignes(onglet: string, debut: number, nombre: number): Promise<void> {
    if (debut < 2) throw new Error(`Onglet « ${onglet} » : impossible de supprimer la ligne ${debut} (en-têtes)`);
    const idOnglet = await this.idOnglet(onglet);
    await this.modifierStructure(onglet, [{
      deleteDimension: { range: { sheetId: idOnglet, dimension: 'ROWS', startIndex: debut - 1, endIndex: debut - 1 + nombre } },
    }]);
  }

  // =========================================================================
  // Contrat AdministrationTableur (installation)
  // =========================================================================

  async listerOnglets(): Promise<string[]> {
    return (await this.proprietesOnglets()).map((p) => p.title ?? '');
  }

  async creerOnglet(nom: string, position?: number): Promise<void> {
    await this.modifierStructure(nom, [{ addSheet: { properties: { title: nom, index: position } } }]);
  }

  async lireEntetes(onglet: string): Promise<string[]> {
    const reponse = await this.appeler(onglet, () => this.api.spreadsheets.values.get({
      spreadsheetId: this.idSheet,
      range: `${nomProtege(onglet)}!1:1`,
    }));
    return (reponse.data.values?.[0] ?? []).map((entete) => String(entete).trim());
  }

  async ecrireEntetes(onglet: string, entetes: string[]): Promise<void> {
    await this.appeler(onglet, () => this.api.spreadsheets.values.update({
      spreadsheetId: this.idSheet,
      range: `${nomProtege(onglet)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [entetes] },
    }));
  }

  async configurerColonnes(onglet: string, colonnes: ConfigColonne[]): Promise<void> {
    const sheetId = await this.idOnglet(onglet);
    const entetes = await this.lireEntetes(onglet);
    const requetes: sheets_v4.Schema$Request[] = [
      // Ligne d'en-têtes figée (reste visible en défilant) et en gras
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      },
    ];

    for (const colonne of colonnes) {
      const index = entetes.indexOf(colonne.nom);
      if (index < 0) throw new Error(`Onglet « ${onglet} » : colonne « ${colonne.nom} » introuvable`);
      // Toute la colonne sauf la ligne d'en-têtes (ou seulement les `lignes` premières lignes)
      const colonneSeule = { sheetId, startColumnIndex: index, endColumnIndex: index + 1 };
      const zone = colonne.lignes === undefined
        ? { ...colonneSeule, startRowIndex: 1 }
        : { ...colonneSeule, startRowIndex: 1, endRowIndex: 1 + colonne.lignes };
      if (colonne.lignes !== undefined) {
        // En dessous de la zone : on retire format, liste/case et valeurs éventuelles
        // (répare un Sheet installé avec une ancienne version, où toute la colonne avait des cases).
        const dessous = { ...colonneSeule, startRowIndex: 1 + colonne.lignes };
        requetes.push({ setDataValidation: { range: dessous } }); // sans « rule » = supprime la validation
        requetes.push({ repeatCell: { range: dessous, cell: {}, fields: 'userEnteredValue' } }); // vide les cellules
      }

      // Couleur de l'en-tête : vert = à remplir par le responsable, gris = rempli par le bot
      requetes.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 },
          cell: { userEnteredFormat: { backgroundColor: colonne.aRemplir ? VERT_A_REMPLIR : GRIS_AUTOMATIQUE } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });

      if (colonne.format !== 'case') {
        requetes.push({
          repeatCell: {
            range: zone,
            cell: {
              userEnteredFormat: {
                numberFormat: colonne.format === 'date' ? { type: 'DATE', pattern: 'dd/mm/yyyy' } : { type: 'TEXT' },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }

      if (colonne.format === 'case') {
        requetes.push({ setDataValidation: { range: zone, rule: { condition: { type: 'BOOLEAN' } } } });
      } else if (colonne.choix && colonne.choix.length > 0) {
        requetes.push({
          setDataValidation: {
            range: zone,
            rule: {
              condition: { type: 'ONE_OF_LIST', values: colonne.choix.map((choix) => ({ userEnteredValue: choix })) },
              showCustomUi: true, // affiche la petite flèche de liste déroulante
              strict: true, // refuse une valeur hors liste
            },
          },
        });
      }

      requetes.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
          properties: { hiddenByUser: colonne.masquee === true },
          fields: 'hiddenByUser',
        },
      });
    }

    await this.modifierStructure(onglet, requetes);
  }

  async separateurArguments(): Promise<SeparateurArguments> {
    const reponse = await this.appeler('(paramètres du Sheet)', () => this.api.spreadsheets.get({
      spreadsheetId: this.idSheet,
      fields: 'properties.locale',
    }));
    return separateurPourLangue(reponse.data.properties?.locale ?? 'en_US');
  }

  async ecrireFormule(onglet: string, formule: string): Promise<void> {
    await this.appeler(onglet, () => this.api.spreadsheets.values.update({
      spreadsheetId: this.idSheet,
      range: `${nomProtege(onglet)}!A1`,
      valueInputOption: 'USER_ENTERED', // pour qu'elle soit interprétée comme une formule
      requestBody: { values: [[formule]] },
    }));
  }

  // =========================================================================
  // Fonctions internes
  // =========================================================================

  private async proprietesOnglets(): Promise<sheets_v4.Schema$SheetProperties[]> {
    const reponse = await this.appeler('(liste des onglets)', () => this.api.spreadsheets.get({
      spreadsheetId: this.idSheet,
      fields: 'sheets.properties(sheetId,title)',
    }));
    return (reponse.data.sheets ?? []).map((onglet) => onglet.properties ?? {});
  }

  /** Identifiant numérique interne d'un onglet (nécessaire pour les requêtes de structure). */
  private async idOnglet(nom: string): Promise<number> {
    const proprietes = (await this.proprietesOnglets()).find((p) => p.title === nom);
    if (proprietes?.sheetId === undefined || proprietes.sheetId === null) {
      throw new Error(`Onglet « ${nom} » introuvable. (Lancer « npm run installer-sheet ».)`);
    }
    return proprietes.sheetId;
  }

  private async modifierStructure(onglet: string, requests: sheets_v4.Schema$Request[]): Promise<void> {
    await this.appeler(onglet, () => this.api.spreadsheets.batchUpdate({
      spreadsheetId: this.idSheet,
      requestBody: { requests },
    }));
  }

  /** Lance un appel à Google et traduit les erreurs courantes en messages compréhensibles. */
  private async appeler<T>(onglet: string, appel: () => Promise<T>): Promise<T> {
    try {
      return await appel();
    } catch (erreur) {
      throw new Error(expliquerErreurGoogle(erreur, onglet, this.emailCompteService), { cause: erreur });
    }
  }
}

// ---------------------------------------------------------------------------

/** Couleurs des en-têtes (format Google : rouge, vert, bleu entre 0 et 1). */
const VERT_A_REMPLIR = { red: 0.714, green: 0.843, blue: 0.659 }; // vert #B6D7A8 (« vert clair 2 » de Google)
const GRIS_AUTOMATIQUE = { red: 0.937, green: 0.937, blue: 0.937 }; // gris clair #EFEFEF

/** 'Bénévoles' → "'Bénévoles'" : les noms d'onglets sont entourés d'apostrophes (et ' doublé). */
function nomProtege(onglet: string): string {
  return `'${onglet.replaceAll("'", "''")}'`;
}

/** Plage couvrant tout l'onglet. */
function plage(onglet: string): string {
  return nomProtege(onglet);
}

/**
 * Lit le fichier de clé du compte de service (téléchargé depuis la console Google).
 * On vérifie que c'est bien une clé de COMPTE DE SERVICE : par sécurité, on refuse tout
 * autre type de fichier d'identifiants.
 */
function lireCleCompteService(fichierCle: string): { email: string; clePrivee: string } {
  let contenu: string;
  try {
    contenu = readFileSync(fichierCle, 'utf8');
  } catch {
    throw new Error(
      `Fichier de clé Google introuvable : « ${fichierCle} ». ` +
      'Voir docs/compte-service-google.md, puis vérifier GOOGLE_FICHIER_CLE dans le .env.',
    );
  }
  const json: { type?: unknown; client_email?: unknown; private_key?: unknown } = JSON.parse(contenu);
  if (json.type !== 'service_account' || typeof json.client_email !== 'string' || typeof json.private_key !== 'string') {
    throw new Error(`« ${fichierCle} » n'est pas une clé de compte de service Google valide.`);
  }
  return { email: json.client_email, clePrivee: json.private_key };
}

/**
 * Séparateur d'arguments des formules selon la langue du Sheet (ex. 'fr_FR', 'en_US').
 * Règle de Google Sheets : si la langue écrit les décimales avec une virgule (1,5),
 * la virgule ne peut pas séparer les arguments → on utilise ';'.
 */
export function separateurPourLangue(langue: string): SeparateurArguments {
  try {
    const code = langue.replace('_', '-'); // 'fr_FR' (Google) → 'fr-FR' (format standard)
    // Langue inconnue : Node prendrait celle de l'ordinateur ; on préfère la syntaxe anglaise.
    if (Intl.NumberFormat.supportedLocalesOf([code]).length === 0) return ',';
    const morceaux = new Intl.NumberFormat(code).formatToParts(1.5);
    return morceaux.find((morceau) => morceau.type === 'decimal')?.value === ',' ? ';' : ',';
  } catch {
    return ','; // code de langue mal formé
  }
}

/** Transforme une erreur de l'API Google en message qui dit quoi faire. */
export function expliquerErreurGoogle(erreur: unknown, onglet: string, emailCompteService: string): string {
  const code = (erreur as { code?: unknown })?.code;
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  if (code === 403 || code === '403') {
    return `Accès refusé au Google Sheet. Partagez le Sheet (bouton « Partager ») avec ${emailCompteService} en tant qu'Éditeur.`;
  }
  if (code === 404 || code === '404') {
    return 'Google Sheet introuvable. Vérifiez GOOGLE_SHEET_ID dans le .env (la partie entre /d/ et /edit dans l\'URL).';
  }
  if (code === 429 || code === '429') {
    return 'Trop de requêtes vers Google (quota dépassé). Réessayer dans une minute.';
  }
  if (/Unable to parse range/i.test(message)) {
    return `Onglet « ${onglet} » introuvable. (Lancer « npm run installer-sheet ».)`;
  }
  return `Erreur Google Sheets (onglet « ${onglet} ») : ${message}`;
}
