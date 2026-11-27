/**
 * @OnlyCurrentDoc
 *
 * outils/sentinelle.gs — La « sentinelle » du bot (Google Apps Script).
 *
 * Ce script n'est PAS exécuté par le bot : il se colle dans le Google Sheet
 * (Extensions → Apps Script) et tourne chez Google, toutes les 10 minutes.
 * Il surveille le tableau de bord « État du bot » et envoie un e-mail :
 *   - si « Dernier passage » a plus de 30 minutes de retard → le bot (ou la machine) est arrêté ;
 *   - si la ligne « WhatsApp » est 🔴 → la session WhatsApp est déconnectée ;
 *   - quand le problème est réglé → « c'est réparé ».
 * Un seul e-mail par changement d'état (jamais un e-mail toutes les 10 minutes).
 *
 * Destinataires : paramètre EMAIL_ALERTE de l'onglet Paramètres (plusieurs adresses
 * séparées par des virgules) ; vide → le compte Google qui a installé le script.
 *
 * Installation : voir docs/sentinelle.md.
 */

// Réglages (les noms doivent correspondre au Sheet créé par `npm run installer-sheet`)
var ONGLET_ETAT = 'État du bot';
var ONGLET_PARAMETRES = 'Paramètres';
var RETARD_MAX_MINUTES = 30;
var FUSEAU = 'Europe/Paris'; // le bot écrit ses heures dans ce fuseau
// Nom affiché dans l'objet et le texte des e-mails (à adapter librement)
var NOM_SERVICE = 'Ummanite · Automatisation des sondages bénévoles';

/** À lancer UNE fois à la main : programme la vérification toutes les 10 minutes. */
function installerSentinelle() {
  // Idempotent : on supprime d'abord les anciens déclencheurs de ce script
  ScriptApp.getProjectTriggers().forEach(function (declencheur) {
    if (declencheur.getHandlerFunction() === 'verifierBot') ScriptApp.deleteTrigger(declencheur);
  });
  ScriptApp.newTrigger('verifierBot').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().deleteAllProperties(); // repart de zéro
  verifierBot();
  Logger.log('Sentinelle installée. Destinataires : ' + destinataires());
}

/** À lancer à la main pour vérifier que les e-mails arrivent bien. */
function envoyerEmailDeTest() {
  envoyer('✅ Test de la sentinelle', 'Ceci est un e-mail de test : les alertes du bot arriveront à cette adresse.');
  Logger.log('E-mail de test envoyé à : ' + destinataires());
}

/** Appelée toutes les 10 minutes par le déclencheur. */
function verifierBot() {
  var etat = lireTableauDeBord();
  var passage = etat['Dernier passage'];
  var dernierPassage = passage ? lireHorodatage(passage.etat) : null;
  var retardMinutes = dernierPassage ? (Date.now() - dernierPassage.getTime()) / 60000 : Infinity;

  var botArrete = retardMinutes > RETARD_MAX_MINUTES;
  signaler('bot-arrete', botArrete,
    '🔴 Bot arrêté',
    'Le bot ne passe plus dans le Google Sheet depuis ' +
      (dernierPassage ? Utilities.formatDate(dernierPassage, FUSEAU, "dd/MM/yyyy 'à' HH:mm") : 'une date inconnue') +
      '.\n\nPlus aucune annonce, confirmation ni liste ne part.\n' +
      'À faire : vérifier la machine (console Oracle : instance « Running » ?), puis `docker compose ps` ' +
      'et `docker compose logs bot` (voir docs/deploiement-oracle.md).',
    '🟢 Bot reparti',
    'Le bot passe de nouveau dans le Google Sheet. Tout est revenu à la normale.');

  // Bot arrêté : la ligne WhatsApp n'est plus mise à jour, on ne peut pas s'y fier.
  if (botArrete) return;
  var whatsapp = etat['WhatsApp'];
  var deconnecte = Boolean(whatsapp && whatsapp.etat.indexOf('🔴') === 0);
  signaler('whatsapp', deconnecte,
    '🔴 WhatsApp déconnecté',
    'Le bot n\'est plus connecté à WhatsApp' + (whatsapp && whatsapp.depuis ? ' depuis le ' + whatsapp.depuis : '') +
      '.\n\nPlus aucun message ne part et les votes ne sont pas reçus.\n' +
      (whatsapp && whatsapp.queFaire ? 'À faire : ' + whatsapp.queFaire : 'À faire : rescanner le QR code (voir docs/deploiement-oracle.md, phase 6).'),
    '🟢 WhatsApp reconnecté',
    'Le bot est de nouveau connecté à WhatsApp.');
}

// ---------------------------------------------------------------------------
// Fonctions internes
// ---------------------------------------------------------------------------

/**
 * Envoie un e-mail seulement quand l'état d'un problème CHANGE (apparition ou réparation).
 * L'état précédent est gardé dans les propriétés du script.
 */
function signaler(cle, problemeActuel, sujetProbleme, texteProbleme, sujetRepare, texteRepare) {
  var proprietes = PropertiesService.getScriptProperties();
  var problemeAvant = proprietes.getProperty(cle) === 'oui';
  if (problemeActuel === problemeAvant) return;
  if (problemeActuel) envoyer(sujetProbleme, texteProbleme);
  else envoyer(sujetRepare, texteRepare);
  proprietes.setProperty(cle, problemeActuel ? 'oui' : 'non');
}

function envoyer(sujet, texte) {
  MailApp.sendEmail({
    to: destinataires(),
    subject: sujet + ' — ' + NOM_SERVICE,
    body:
      'Bonjour,\n\n' +
      'Ceci est un message automatique, envoyé à titre informatif par la Sentinelle : elle surveille ' +
      'le robot qui gère le planning des bénévoles (annonces et sondages WhatsApp, demandes de ' +
      'confirmation, listes des présents).\n\n' +
      '────────────────────\n' + texte + '\n────────────────────\n\n' +
      'Tableau de bord (onglet « État du bot ») : ' + SpreadsheetApp.getActive().getUrl() + '\n\n' +
      'Merci de ne pas répondre à cet e-mail.\n' +
      '— ' + NOM_SERVICE,
  });
}

/** Adresses du paramètre EMAIL_ALERTE, ou celle du propriétaire du script si vide. */
function destinataires() {
  var onglet = SpreadsheetApp.getActive().getSheetByName(ONGLET_PARAMETRES);
  if (onglet) {
    var lignes = lireParEnTete(onglet);
    for (var i = 0; i < lignes.length; i++) {
      if (String(lignes[i]['Paramètre']).trim() === 'EMAIL_ALERTE') {
        var adresses = String(lignes[i]['Valeur']).split(/[,;\s]+/).filter(function (a) { return a.indexOf('@') > 0; });
        if (adresses.length > 0) return adresses.join(',');
      }
    }
  }
  return Session.getEffectiveUser().getEmail();
}

/** { 'Dernier passage': { etat, depuis, queFaire }, 'WhatsApp': {…}, … } */
function lireTableauDeBord() {
  var onglet = SpreadsheetApp.getActive().getSheetByName(ONGLET_ETAT);
  if (!onglet) throw new Error('Onglet « ' + ONGLET_ETAT + ' » introuvable : lancer `npm run installer-sheet`.');
  var resultat = {};
  lireParEnTete(onglet).forEach(function (ligne) {
    resultat[String(ligne['Élément']).trim()] = {
      etat: String(ligne['État']).trim(),
      depuis: String(ligne['Depuis']).trim(),
      queFaire: String(ligne['Que faire']).trim(),
    };
  });
  return resultat;
}

/** Les lignes d'un onglet, repérées par en-tête (valeurs affichées, comme le bot). */
function lireParEnTete(onglet) {
  var valeurs = onglet.getDataRange().getDisplayValues();
  var entetes = valeurs[0].map(function (e) { return String(e).trim(); });
  return valeurs.slice(1).map(function (ligne) {
    var objet = {};
    entetes.forEach(function (entete, i) { objet[entete] = ligne[i]; });
    return objet;
  });
}

/** '2026-11-27 14:45:00' (heure de Paris, écrite par le bot) → Date ; null si illisible. */
function lireHorodatage(texte) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texte)) return null;
  return Utilities.parseDate(texte, FUSEAU, 'yyyy-MM-dd HH:mm:ss');
}
