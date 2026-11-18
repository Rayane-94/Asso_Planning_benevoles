const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chargerProjet } = require('./helpers/charger');

const ctx = chargerProjet();

test('normaliserTelephone_ : numéros français écrits de toutes les façons', () => {
  const attendu = '33612345678';
  assert.equal(ctx.normaliserTelephone_('06 12 34 56 78'), attendu);
  assert.equal(ctx.normaliserTelephone_('06.12.34.56.78'), attendu);
  assert.equal(ctx.normaliserTelephone_('+33 6 12 34 56 78'), attendu);
  assert.equal(ctx.normaliserTelephone_('+33 (0)6 12 34 56 78'), attendu);
  assert.equal(ctx.normaliserTelephone_('0033612345678'), attendu);
  assert.equal(ctx.normaliserTelephone_('33612345678'), attendu);
  assert.equal(ctx.normaliserTelephone_(612345678), attendu); // nombre : le Sheet a mangé le 0
});

test('normaliserTelephone_ : numéros étrangers', () => {
  assert.equal(ctx.normaliserTelephone_('+32 470 12 34 56'), '32470123456');
  assert.equal(ctx.normaliserTelephone_('0032470123456'), '32470123456');
});

test('normaliserTelephone_ : valeurs invalides', () => {
  assert.equal(ctx.normaliserTelephone_(''), null);
  assert.equal(ctx.normaliserTelephone_(null), null);
  assert.equal(ctx.normaliserTelephone_('123'), null);
  assert.equal(ctx.normaliserTelephone_('pas de numéro'), null);
});

test('formaterTelephone_ : affichage lisible', () => {
  assert.equal(ctx.formaterTelephone_('33612345678'), '06 12 34 56 78');
  assert.equal(ctx.formaterTelephone_('32470123456'), '+32470123456');
});

test('aller-retour : normaliser puis formater redonne le numéro lisible', () => {
  assert.equal(ctx.formaterTelephone_(ctx.normaliserTelephone_('+33612345678')), '06 12 34 56 78');
});
