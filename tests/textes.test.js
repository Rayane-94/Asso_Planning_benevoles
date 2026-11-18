const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chargerProjet, lireGlobal } = require('./helpers/charger');

const ctx = chargerProjet();

test('remplirModele_ : remplace les variables connues', () => {
  const texte = ctx.remplirModele_('📣 {type} – {date} à {heure} – {lieu}', {
    type: 'BP', date: 'samedi 28/11', heure: '14:00', lieu: 'Entrepôt',
  });
  assert.equal(texte, '📣 BP – samedi 28/11 à 14:00 – Entrepôt');
});

test('remplirModele_ : laisse visibles les variables inconnues ou vides', () => {
  assert.equal(ctx.remplirModele_('Bonjour {prenon} !', { prenom: 'Bob' }), 'Bonjour {prenon} !');
  assert.equal(ctx.remplirModele_('Bonjour {prenom} !', { prenom: null }), 'Bonjour {prenom} !');
});

test('remplirModele_ : fonctionne avec le modèle d\'annonce par défaut', () => {
  const modele = lireGlobal(ctx, 'PARAMETRES_DEFAUT').TEXTE_ANNONCE.valeur;
  const texte = ctx.remplirModele_(modele, { type: 'BP', date: 'samedi 28/11', heure: '14:00', lieu: 'Entrepôt' });
  assert.ok(texte.startsWith('📣 BP – samedi 28/11 à 14:00 – Entrepôt\n'));
  assert.ok(!texte.includes('{'), 'aucune variable ne doit rester');
});

test('normaliserPourDetection_ : minuscules, sans accents ni ponctuation', () => {
  assert.equal(ctx.normaliserPourDetection_('Présente !!'), 'presente');
  assert.equal(ctx.normaliserPourDetection_('OUIIII'), 'oui');
  assert.equal(ctx.normaliserPourDetection_("Je  peux   plus..."), 'je peux plus');
});

// Les cas de test sont rangés dans des tableaux : pour ajouter un cas, il suffit
// d'ajouter une ligne.
const CAS_OUI = [
  'oui', 'Oui', 'OUI !', 'ouiiii', 'Ouais', 'ok', 'Okay', 'présent', 'Présente',
  'je viens', 'Dispo', 'partante', 'yes', 'Je serai là', 'oui je viens avec ma sœur',
  '👍', '👍🏽', '✅', 'Bien sûr !',
];

const CAS_NON = [
  'non', 'Non', 'NON', 'nan', 'finalement non', 'je peux plus', 'je ne peux plus',
  'Je peux pas finalement', 'pas dispo', 'indispo', 'je viens pas', 'je ne viendrai pas',
  'absente', 'désolé je me désiste', 'ok finalement je peux pas', '👎', '❌',
];

const CAS_INCONNUS = [
  '', 'peut-être', 'je sais pas encore', 'pas sûr', 'Bonjour à tous', 'Bob Durand',
  'à quelle heure ?', 'nonne', 'bookmark',
];

for (const message of CAS_OUI) {
  test(`detecterReponse_ : « ${message} » → OUI`, () => {
    assert.equal(ctx.detecterReponse_(message), 'OUI');
  });
}

for (const message of CAS_NON) {
  test(`detecterReponse_ : « ${message} » → NON`, () => {
    assert.equal(ctx.detecterReponse_(message), 'NON');
  });
}

for (const message of CAS_INCONNUS) {
  test(`detecterReponse_ : « ${message} » → rien (null)`, () => {
    assert.equal(ctx.detecterReponse_(message), null);
  });
}
