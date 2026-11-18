/**
 * Tests du harness lui-même : on vérifie que les faux services se comportent comme
 * les vrais. Si un faux ment, tous les tests du bot mentent avec lui.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { creerEnvironnement } = require('./helpers/environnement');
const { lireGlobal } = require('./helpers/charger');
const { GROUPE_TEST } = require('./helpers/fauxWhatsApp');

describe('Horloge contrôlée', () => {
  test('le code du bot voit l\'heure réglée par le test', () => {
    const env = creerEnvironnement({ depart: '2026-11-21 18:00' });
    assert.equal(env.ctx.cleDate_(env.ctx.now_()), '2026-11-21');
    assert.equal(env.ctx.heureDe_(env.ctx.now_()), '18:00');
  });

  test('avancer de jours, d\'heures et de minutes', () => {
    const env = creerEnvironnement({ depart: '2026-11-21 18:00' });
    env.horloge.avancer({ jours: 2, heures: 1, minutes: 30 });
    assert.equal(env.horloge.texte(), '2026-11-23 19:30');
  });

  test('« 1 jour » garde la même heure lors du passage à l\'heure d\'hiver', () => {
    const env = creerEnvironnement({ depart: '2026-10-24 18:00' }); // nuit du 24 au 25/10 : on recule d'1 h
    env.horloge.avancer({ jours: 1 });
    assert.equal(env.horloge.texte(), '2026-10-25 18:00');
  });

  test('Utilities.sleep fait avancer l\'horloge sans attendre', () => {
    const env = creerEnvironnement({ depart: '2026-11-21 18:00' });
    lireGlobal(env.ctx, 'Utilities.sleep(90 * 1000)');
    assert.equal(env.horloge.texte(), '2026-11-21 18:01');
  });

  test('Utilities.parseDate lit une heure de Paris', () => {
    const env = creerEnvironnement();
    const date = lireGlobal(env.ctx, "Utilities.parseDate('2026-11-28 18:00', 'Europe/Paris', 'yyyy-MM-dd HH:mm')");
    assert.equal(date.toISOString(), '2026-11-28T17:00:00.000Z'); // hiver : Paris = UTC+1
  });
});

describe('Faux Google Sheet', () => {
  test('le code du bot accède au Sheet via SpreadsheetApp', () => {
    const env = creerEnvironnement();
    lireGlobal(env.ctx, "SpreadsheetApp.getActive().insertSheet('Actions').appendRow(['ID', 'Type'])");
    const onglet = env.classeur.getSheetByName('Actions');
    assert.deepEqual(onglet.getDataRange().getValues(), [['ID', 'Type']]);
  });

  test('getLastRow, appendRow, getRange / setValues', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    assert.equal(onglet.getLastRow(), 0);
    onglet.appendRow(['a', 'b']);
    onglet.appendRow(['c', 'd']);
    assert.equal(onglet.getLastRow(), 2);
    onglet.getRange(2, 2).setValue('D');
    assert.deepEqual(onglet.getRange(1, 1, 2, 2).getValues(), [['a', 'b'], ['c', 'D']]);
    assert.deepEqual(onglet.getRange(5, 1).getValues(), [['']]); // cellule vide = ''
  });

  test('setValues refuse un tableau de la mauvaise taille (comme le vrai)', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    assert.throws(() => onglet.getRange(1, 1, 1, 3).setValues([['a', 'b']]), /colonnes/);
  });

  test('PIÈGE : un numéro écrit tel quel perd son 0 (devient un nombre)', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    onglet.getRange(1, 1).setValue('0612345678');
    assert.equal(onglet.getRange(1, 1).getValue(), 612345678);
  });

  test('… sauf avec une apostrophe devant, ou au format texte « @ »', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    onglet.getRange(1, 1).setValue("'0612345678");
    onglet.getRange(2, 1).setNumberFormat('@').setValue('0612345678');
    assert.equal(onglet.getRange(1, 1).getValue(), '0612345678');
    assert.equal(onglet.getRange(2, 1).getValue(), '0612345678');
  });

  test('PIÈGE : une heure devient une Date de 1899, mais l\'affichage reste lisible', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    onglet.getRange(1, 1).setValue('19:00');
    const valeur = onglet.getRange(1, 1).getValue();
    assert.ok(valeur instanceof Date);
    assert.equal(valeur.getUTCFullYear(), 1899);
    assert.equal(onglet.getRange(1, 1).getDisplayValue(), '19:00:00'); // → lire via getDisplayValues
  });

  test('une date tapée « 28/11/2026 » devient une Date à minuit (Paris)', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    onglet.getRange(1, 1).setValue('28/11/2026');
    assert.equal(env.ctx.cleDate_(onglet.getRange(1, 1).getValue()), '2026-11-28');
    assert.equal(onglet.getRange(1, 1).getDisplayValue(), '28/11/2026');
  });

  test('une formule est gardée en texte (non calculée)', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    onglet.getRange(1, 1).setValue('=QUERY(Inscriptions!A:K, "select *", 1)');
    assert.equal(onglet.getRange(1, 1).getFormula(), '=QUERY(Inscriptions!A:K, "select *", 1)');
  });

  test('deleteRows fait remonter les lignes du dessous', () => {
    const env = creerEnvironnement();
    const onglet = env.classeur.insertSheet('Test');
    ['1', '2', '3', '4'].forEach((x) => onglet.appendRow(['ligne ' + x]));
    onglet.deleteRows(2, 2);
    assert.deepEqual(onglet.getDataRange().getValues(), [['ligne 1'], ['ligne 4']]);
  });

  test('deux onglets ne peuvent pas avoir le même nom', () => {
    const env = creerEnvironnement();
    env.classeur.insertSheet('Actions');
    assert.throws(() => env.classeur.insertSheet('Actions'), /existe déjà/);
  });
});

describe('Autres services Google', () => {
  test('PropertiesService : tout est stocké en texte, null si absent', () => {
    const env = creerEnvironnement();
    const valeur = lireGlobal(env.ctx, `
      const p = PropertiesService.getScriptProperties();
      p.setProperty('COMPTEUR', 42);
      [p.getProperty('COMPTEUR'), p.getProperty('INCONNUE')];
    `);
    assert.equal(valeur[0], '42');
    assert.equal(valeur[1], null);
  });

  test('PropertiesService : PIÈGE, une valeur de plus de 9 Ko est refusée', () => {
    const env = creerEnvironnement();
    assert.throws(() => env.proprietes.setProperty('GROS', 'x'.repeat(10 * 1024)), /too large/);
  });

  test('CacheService : une valeur expire après sa durée de vie', () => {
    const env = creerEnvironnement();
    const cache = lireGlobal(env.ctx, 'CacheService.getScriptCache()');
    cache.put('cle', 'valeur', 60);
    assert.equal(cache.get('cle'), 'valeur');
    env.horloge.avancer({ minutes: 2 });
    assert.equal(cache.get('cle'), null);
  });

  test('LockService : un 2e tick ne peut pas prendre le verrou tant que le 1er le tient', () => {
    const env = creerEnvironnement();
    const premier = lireGlobal(env.ctx, 'LockService.getScriptLock()');
    const second = lireGlobal(env.ctx, 'LockService.getScriptLock()');
    assert.equal(premier.tryLock(1000), true);
    assert.equal(second.tryLock(1000), false);
    premier.releaseLock();
    assert.equal(second.tryLock(1000), true);
  });

  test('ScriptApp : créer, lister et supprimer un déclencheur', () => {
    const env = creerEnvironnement();
    lireGlobal(env.ctx, "ScriptApp.newTrigger('tick').timeBased().everyMinutes(15).create()");
    const liste = lireGlobal(env.ctx, 'ScriptApp.getProjectTriggers()');
    assert.equal(liste.length, 1);
    assert.equal(liste[0].getHandlerFunction(), 'tick');
    lireGlobal(env.ctx, 'ScriptApp.deleteTrigger(ScriptApp.getProjectTriggers()[0])');
    assert.equal(env.declencheurs.declencheurs.length, 0);
  });

  test('ScriptApp : everyMinutes(7) est refusé, comme chez Google', () => {
    const env = creerEnvironnement();
    assert.throws(() => lireGlobal(env.ctx, "ScriptApp.newTrigger('tick').timeBased().everyMinutes(7)"));
  });

  test('UrlFetchApp : réponse programmée, appels enregistrés, erreur HTTP', () => {
    const env = creerEnvironnement();
    env.urlFetch.definirRepondeur((url) => (url.endsWith('/ok') ? { corps: { ok: true } } : { code: 500, corps: 'panne' }));
    const texte = lireGlobal(env.ctx, "UrlFetchApp.fetch('https://api.test/ok').getContentText()");
    assert.equal(texte, '{"ok":true}');
    assert.throws(() => lireGlobal(env.ctx, "UrlFetchApp.fetch('https://api.test/ko')"), /code 500/);
    const code = lireGlobal(env.ctx, "UrlFetchApp.fetch('https://api.test/ko', { muteHttpExceptions: true }).getResponseCode()");
    assert.equal(code, 500);
    assert.equal(env.urlFetch.appels.length, 3);
  });
});

describe('Faux WhatsApp', () => {
  test('le bot envoie : le message est noté avec un ID', () => {
    const env = creerEnvironnement();
    const id = lireGlobal(env.ctx, `WA.sendText('${GROUPE_TEST}', 'Bonjour le groupe')`);
    const envoi = env.whatsapp.dernierEnvoi();
    assert.equal(envoi.id, id);
    assert.equal(envoi.a, GROUPE_TEST);
    assert.equal(envoi.texte, 'Bonjour le groupe');
  });

  test('le test fait « recevoir » un message ; fetchIncoming le donne une seule fois', () => {
    const env = creerEnvironnement();
    env.whatsapp.recevoir({ de: '33612345678', nom: 'Bob', texte: 'oui', groupe: GROUPE_TEST, cite: 'envoye-1' });
    const lot = lireGlobal(env.ctx, 'WA.fetchIncoming()');
    assert.equal(lot.length, 1);
    assert.equal(lot[0].fromPhone, '33612345678');
    assert.equal(lot[0].isGroup, true);
    assert.equal(lot[0].quotedId, 'envoye-1');
    assert.equal(lireGlobal(env.ctx, 'WA.fetchIncoming()').length, 0);
  });

  test('un envoi vers un numéro en échec plante (pour tester « Non joignable »)', () => {
    const env = creerEnvironnement();
    env.whatsapp.faireEchouerEnvoisVers('33699999999');
    assert.throws(() => lireGlobal(env.ctx, "WA.sendText('33699999999', 'coucou')"), /Envoi impossible/);
  });

  test('instance déconnectée : ping le signale', () => {
    const env = creerEnvironnement();
    assert.equal(lireGlobal(env.ctx, 'WA.ping().ok'), true);
    env.whatsapp.deconnecter();
    assert.equal(lireGlobal(env.ctx, 'WA.ping().ok'), false);
  });
});
