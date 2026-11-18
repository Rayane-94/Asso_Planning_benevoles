/**
 * Faux Google Sheet (SpreadsheetApp) pour les tests.
 *
 * Il reproduit volontairement les PIÈGES du vrai Google Sheets (voir CLAUDE.MD §6),
 * pour que les tests les attrapent :
 *   - '0612345678' écrit dans une cellule normale devient le NOMBRE 612345678 (0 perdu) ;
 *   - "'0612345678" (avec apostrophe) reste du texte ;
 *   - une cellule au format texte ('@') garde exactement ce qu'on écrit ;
 *   - '28/11/2026' devient une Date ;
 *   - '19:00' devient une Date au 30/12/1899 (avec le décalage bizarre de 1899),
 *     affichée '19:00:00' par getDisplayValues().
 *
 * Limites connues : pas de notation A1 (getRange('A1')), les formules ne sont pas
 * calculées (on peut seulement relire leur texte avec getFormula()).
 * Si le code du bot a besoin d'une méthode absente, on l'ajoute ici.
 */
const { instantDepuisHeureLocale, formaterDate } = require('./fuseau');

const FUSEAU = 'Europe/Paris';
const FORMAT_TEXTE = '@';

/**
 * Ce que Google Sheets fait d'une valeur au moment où on l'écrit dans une cellule.
 * @param {*} valeur ce que le code écrit
 * @param {string} format le format de la cellule ('' = automatique, '@' = texte)
 * @return {{valeur: *, formule: string}}
 */
function convertirSaisie(valeur, format) {
  if (valeur === null || valeur === undefined) return { valeur: '', formule: '' };
  if (typeof valeur !== 'string') return { valeur, formule: '' }; // nombre, booléen, Date : gardés tels quels

  // L'apostrophe de tête force le texte ; elle n'est pas stockée.
  if (valeur.startsWith("'")) return { valeur: valeur.slice(1), formule: '' };
  if (format === FORMAT_TEXTE) return { valeur, formule: '' };

  if (valeur.startsWith('=')) return { valeur: '', formule: valeur };

  const texte = valeur.trim();
  // Nombre : '0612345678' → 612345678, '+33612345678' → 33612345678
  if (/^[+-]?\d+([.,]\d+)?$/.test(texte)) return { valeur: Number(texte.replace(',', '.')), formule: '' };

  // Date à la française : '28/11/2026' → Date (minuit à Paris)
  let m = texte.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { valeur: instantDepuisHeureLocale(FUSEAU, +m[3], +m[2], +m[1]), formule: '' };

  // Heure : '19:00' → Date au 30/12/1899 (c'est ainsi que Sheets stocke une heure seule)
  m = texte.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return { valeur: instantDepuisHeureLocale(FUSEAU, 1899, 12, 30, +m[1], +m[2], +(m[3] || 0)), formule: '' };

  return { valeur, formule: '' };
}

/** Ce que getDisplayValues() renvoie pour une valeur stockée (locale française). */
function afficher(valeur) {
  if (valeur === '') return '';
  if (valeur instanceof Date) {
    const estUneHeureSeule = valeur.getTime() < Date.UTC(1900, 0, 1);
    return formaterDate(valeur, FUSEAU, estUneHeureSeule ? 'HH:mm:ss' : 'dd/MM/yyyy');
  }
  if (typeof valeur === 'number') return String(valeur).replace('.', ',');
  if (typeof valeur === 'boolean') return valeur ? 'TRUE' : 'FALSE';
  return String(valeur);
}

const CELLULE_VIDE = Object.freeze({ valeur: '', formule: '', format: '', validation: null });

// ---------------------------------------------------------------------------
// Plage (Range) : un rectangle de cellules
// ---------------------------------------------------------------------------
class FauxPlage {
  constructor(onglet, ligne, colonne, nbLignes, nbColonnes) {
    this._onglet = onglet;
    this._ligne = ligne;
    this._colonne = colonne;
    this._nbLignes = nbLignes;
    this._nbColonnes = nbColonnes;
  }

  getSheet() { return this._onglet; }
  getRow() { return this._ligne; }
  getColumn() { return this._colonne; }
  getNumRows() { return this._nbLignes; }
  getNumColumns() { return this._nbColonnes; }
  getLastRow() { return this._ligne + this._nbLignes - 1; }
  getLastColumn() { return this._colonne + this._nbColonnes - 1; }

  /** Applique fn(ligne, colonne) à chaque cellule et renvoie le tableau 2D des résultats. */
  _parcourir(fn) {
    const resultat = [];
    for (let i = 0; i < this._nbLignes; i++) {
      const rangee = [];
      for (let j = 0; j < this._nbColonnes; j++) rangee.push(fn(this._ligne + i, this._colonne + j, i, j));
      resultat.push(rangee);
    }
    return resultat;
  }

  // --- Lecture ---
  getValues() {
    return this._parcourir((l, c) => {
      const v = this._onglet._lire(l, c).valeur;
      return v instanceof Date ? new Date(v.getTime()) : v;
    });
  }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValues() { return this._parcourir((l, c) => afficher(this._onglet._lire(l, c).valeur)); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getFormulas() { return this._parcourir((l, c) => this._onglet._lire(l, c).formule); }
  getFormula() { return this.getFormulas()[0][0]; }
  getNumberFormats() { return this._parcourir((l, c) => this._onglet._lire(l, c).format); }
  getNumberFormat() { return this.getNumberFormats()[0][0]; }
  getDataValidation() { return this._onglet._lire(this._ligne, this._colonne).validation; }

  // --- Écriture ---
  setValues(tableau) {
    if (tableau.length !== this._nbLignes) {
      throw new Error(`Les données contiennent ${tableau.length} lignes, mais la plage en contient ${this._nbLignes}.`);
    }
    tableau.forEach((rangee, i) => {
      if (rangee.length !== this._nbColonnes) {
        throw new Error(`Les données contiennent ${rangee.length} colonnes, mais la plage en contient ${this._nbColonnes}.`);
      }
    });
    this._parcourir((l, c, i, j) => {
      this._onglet._ecrire(l, c, convertirSaisie(tableau[i][j], this._onglet._lire(l, c).format));
    });
    return this;
  }
  setValue(valeur) {
    this._parcourir((l, c) => this._onglet._ecrire(l, c, convertirSaisie(valeur, this._onglet._lire(l, c).format)));
    return this;
  }
  setFormula(formule) {
    this._parcourir((l, c) => this._onglet._ecrire(l, c, { valeur: '', formule }));
    return this;
  }
  setNumberFormat(format) {
    this._parcourir((l, c) => this._onglet._ecrire(l, c, { format }));
    return this;
  }
  setNumberFormats(formats) {
    this._parcourir((l, c, i, j) => this._onglet._ecrire(l, c, { format: formats[i][j] }));
    return this;
  }
  setDataValidation(validation) {
    this._parcourir((l, c) => this._onglet._ecrire(l, c, { validation }));
    return this;
  }
  clearContent() {
    this._parcourir((l, c) => this._onglet._ecrire(l, c, { valeur: '', formule: '' }));
    return this;
  }

  // --- Mise en forme : sans effet dans les tests, mais doit exister ---
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setWrap() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setNote() { return this; }
}

// ---------------------------------------------------------------------------
// Onglet (Sheet)
// ---------------------------------------------------------------------------
class FauxOnglet {
  constructor(classeur, nom) {
    this._classeur = classeur;
    this._nom = nom;
    this._cellules = new Map(); // clé 'ligne:colonne' → { valeur, formule, format, validation }
    this._lignesFigees = 0;
    this._colonnesMasquees = new Set();
  }

  _lire(ligne, colonne) {
    return this._cellules.get(ligne + ':' + colonne) || CELLULE_VIDE;
  }
  _ecrire(ligne, colonne, modifications) {
    this._cellules.set(ligne + ':' + colonne, { ...this._lire(ligne, colonne), ...modifications });
  }
  /** Plus grand numéro de ligne (index 0) ou de colonne (index 1) qui contient quelque chose. */
  _dernier(index) {
    let max = 0;
    for (const [cle, cellule] of this._cellules) {
      if (cellule.valeur !== '' || cellule.formule) max = Math.max(max, Number(cle.split(':')[index]));
    }
    return max;
  }

  getName() { return this._nom; }
  setName(nom) { this._nom = nom; return this; }
  getParent() { return this._classeur; }
  getLastRow() { return this._dernier(0); }
  getLastColumn() { return this._dernier(1); }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }

  getRange(ligne, colonne, nbLignes = 1, nbColonnes = 1) {
    if (typeof ligne === 'string') {
      throw new Error("Faux Sheet : la notation A1 n'est pas gérée, utiliser getRange(ligne, colonne, nbLignes, nbColonnes)");
    }
    if (ligne < 1 || colonne < 1 || nbLignes < 1 || nbColonnes < 1) {
      throw new Error(`Plage invalide : getRange(${ligne}, ${colonne}, ${nbLignes}, ${nbColonnes})`);
    }
    return new FauxPlage(this, ligne, colonne, nbLignes, nbColonnes);
  }

  /** Toute la zone remplie, à partir de A1. */
  getDataRange() {
    return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }

  appendRow(valeurs) {
    const ligne = this.getLastRow() + 1;
    valeurs.forEach((valeur, i) => {
      this._ecrire(ligne, i + 1, convertirSaisie(valeur, this._lire(ligne, i + 1).format));
    });
    return this;
  }

  deleteRow(ligne) { return this.deleteRows(ligne, 1); }
  /** Supprime des lignes : celles du dessous remontent. */
  deleteRows(debut, nombre) {
    const nouvelles = new Map();
    for (const [cle, cellule] of this._cellules) {
      const [l, c] = cle.split(':').map(Number);
      if (l < debut) nouvelles.set(cle, cellule);
      else if (l >= debut + nombre) nouvelles.set((l - nombre) + ':' + c, cellule);
    }
    this._cellules = nouvelles;
    return this;
  }

  clear() { this._cellules.clear(); return this; }
  clearContents() {
    for (const [cle, cellule] of this._cellules) this._cellules.set(cle, { ...cellule, valeur: '', formule: '' });
    return this;
  }

  setFrozenRows(n) { this._lignesFigees = n; return this; }
  getFrozenRows() { return this._lignesFigees; }
  hideColumns(colonne, nombre = 1) {
    for (let c = colonne; c < colonne + nombre; c++) this._colonnesMasquees.add(c);
    return this;
  }
  showColumns(colonne, nombre = 1) {
    for (let c = colonne; c < colonne + nombre; c++) this._colonnesMasquees.delete(c);
    return this;
  }
  isColumnHiddenByUser(colonne) { return this._colonnesMasquees.has(colonne); }
  setColumnWidth() { return this; }
  autoResizeColumns() { return this; }
}

// ---------------------------------------------------------------------------
// Classeur (Spreadsheet)
// ---------------------------------------------------------------------------
class FauxClasseur {
  constructor(nom) {
    this._nom = nom;
    this._onglets = [new FauxOnglet(this, 'Feuille 1')]; // un Sheet neuf a toujours un onglet
    this.toasts = []; // messages affichés avec toast(), consultables par les tests
  }

  getName() { return this._nom; }
  getId() { return 'classeur-de-test'; }
  getSpreadsheetTimeZone() { return FUSEAU; }
  getSheets() { return this._onglets.slice(); }
  getSheetByName(nom) { return this._onglets.find((o) => o.getName() === nom) || null; }

  insertSheet(nom, index) {
    const nomFinal = nom || 'Feuille ' + (this._onglets.length + 1);
    if (this.getSheetByName(nomFinal)) throw new Error(`Une feuille nommée « ${nomFinal} » existe déjà.`);
    const onglet = new FauxOnglet(this, nomFinal);
    if (index === undefined) this._onglets.push(onglet);
    else this._onglets.splice(index, 0, onglet);
    return onglet;
  }

  deleteSheet(onglet) {
    if (this._onglets.length === 1) throw new Error('Impossible de supprimer le dernier onglet.');
    this._onglets = this._onglets.filter((o) => o !== onglet);
  }

  toast(message, titre) { this.toasts.push({ message, titre }); }
}

/**
 * @return {{service: Object, classeur: FauxClasseur}}
 *   service  : à injecter comme « SpreadsheetApp » dans le bac à sable
 *   classeur : le Sheet, pour que le test le remplisse ou le vérifie
 */
function creerFauxSpreadsheetApp(nom = 'Planning bénévoles (test)') {
  const classeur = new FauxClasseur(nom);
  const service = {
    getActive: () => classeur,
    getActiveSpreadsheet: () => classeur,
    flush() {},
  };
  return { service, classeur };
}

module.exports = { creerFauxSpreadsheetApp };
