/**
 * Charge le code de src/ dans un « bac à sable » Node (module vm), comme le ferait
 * Apps Script : tous les fichiers partagent le même espace global.
 *
 * Utilisation dans un test :
 *   const ctx = chargerProjet();
 *   ctx.parseHeure_('19h30'); // → '19:30'
 *
 * ⚠️ Les fonctions sont accessibles via ctx.nomDeLaFonction, mais pas les `const`
 * (ex. FUSEAU). Pour lire une constante : lireGlobal(ctx, 'FUSEAU').
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { creerFauxUtilities } = require('./fauxUtilities');

const DOSSIER_SRC = path.join(__dirname, '..', '..', 'src');

/**
 * @param {Object} [servicesSupplementaires] faux services à ajouter ou remplacer
 * @return {Object} le contexte, qui contient toutes les fonctions de src/
 */
function chargerProjet(servicesSupplementaires = {}) {
  const contexte = vm.createContext({
    console,
    // On fournit le Date de Node : sinon `instanceof Date` échoue entre le test et le bac à sable.
    Date,
    Utilities: creerFauxUtilities(),
    ...servicesSupplementaires,
  });

  const fichiers = fs.readdirSync(DOSSIER_SRC).filter((f) => f.endsWith('.js')).sort();
  for (const fichier of fichiers) {
    const chemin = path.join(DOSSIER_SRC, fichier);
    vm.runInContext(fs.readFileSync(chemin, 'utf8'), contexte, { filename: chemin });
  }
  return contexte;
}

/** Lit une constante globale (const/let) du projet chargé. */
function lireGlobal(contexte, nom) {
  return vm.runInContext(nom, contexte);
}

module.exports = { chargerProjet, lireGlobal };
