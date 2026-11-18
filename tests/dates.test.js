const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chargerProjet } = require('./helpers/charger');

const ctx = chargerProjet();

test('cleDate_ et heureDe_ : vus depuis Paris, pas depuis UTC', () => {
  // 23:30 UTC le 28/11 = 00:30 à Paris le 29/11 (hiver, UTC+1)
  const instant = new Date('2026-11-28T23:30:00Z');
  assert.equal(ctx.cleDate_(instant), '2026-11-29');
  assert.equal(ctx.heureDe_(instant), '00:30');
});

test("cleDate_ et heureDe_ : l'heure d'été est prise en compte", () => {
  // 16:00 UTC en juillet = 18:00 à Paris (été, UTC+2)
  assert.equal(ctx.heureDe_(new Date('2026-07-10T16:00:00Z')), '18:00');
});

test('ajouterJours_ : calcule J-7, J+3, change de mois et d\'année', () => {
  assert.equal(ctx.ajouterJours_('2026-11-29', -7), '2026-11-22');
  assert.equal(ctx.ajouterJours_('2026-11-29', 3), '2026-12-02');
  assert.equal(ctx.ajouterJours_('2026-12-30', 2), '2027-01-01');
  // Le week-end du changement d'heure ne décale rien
  assert.equal(ctx.ajouterJours_('2026-03-28', 1), '2026-03-29');
});

test('ecartJours_ : nombre de jours entre deux dates', () => {
  assert.equal(ctx.ecartJours_('2026-11-22', '2026-11-29'), 7);
  assert.equal(ctx.ecartJours_('2026-11-29', '2026-11-22'), -7);
  assert.equal(ctx.ecartJours_('2026-10-24', '2026-10-26'), 2); // passage à l'heure d'hiver
});

test('jourSemaine_, dateCourte_, dateLongue_', () => {
  assert.equal(ctx.jourSemaine_('2026-11-28'), 'samedi');
  assert.equal(ctx.dateCourte_('2026-11-28'), '28/11');
  assert.equal(ctx.dateLongue_('2026-11-28'), 'samedi 28/11');
});

test('parseDateFr_ : formats acceptés', () => {
  assert.equal(ctx.parseDateFr_('28/11/2026'), '2026-11-28');
  assert.equal(ctx.parseDateFr_('1/2/26'), '2026-02-01');
  assert.equal(ctx.parseDateFr_(' 28-11-2026 '), '2026-11-28');
});

test('parseDateFr_ : dates invalides refusées', () => {
  assert.equal(ctx.parseDateFr_('31/02/2026'), null); // le 31 février n'existe pas
  assert.equal(ctx.parseDateFr_('2026-11-28'), null);
  assert.equal(ctx.parseDateFr_('demain'), null);
});

test('parseHeure_ : toutes les façons d\'écrire une heure', () => {
  assert.equal(ctx.parseHeure_('19:00'), '19:00');
  assert.equal(ctx.parseHeure_('19h'), '19:00');
  assert.equal(ctx.parseHeure_('19h30'), '19:30');
  assert.equal(ctx.parseHeure_('9H05'), '09:05');
  assert.equal(ctx.parseHeure_('19 h 30'), '19:30');
  assert.equal(ctx.parseHeure_('19:00:00'), '19:00'); // affichage Sheets avec secondes
  assert.equal(ctx.parseHeure_('19'), '19:00');
});

test('parseHeure_ : heures invalides refusées', () => {
  assert.equal(ctx.parseHeure_('25h'), null);
  assert.equal(ctx.parseHeure_('19h75'), null);
  assert.equal(ctx.parseHeure_('19h5'), null);
  assert.equal(ctx.parseHeure_('midi'), null);
  assert.equal(ctx.parseHeure_(''), null);
});
