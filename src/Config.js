/**
 * Config.js — Constantes du projet.
 *
 * Ici, on ne met que ce qui ne change pas : noms des onglets, statuts, mots-clés.
 * Tout ce que l'asso doit pouvoir régler (heures, textes des messages…) est dans
 * l'onglet « Paramètres » du Sheet ; PARAMETRES_DEFAUT ne sert qu'à le pré-remplir.
 *
 * ⚠️ Rappel Apps Script : tous les fichiers de src/ partagent le même espace global.
 * Une constante définie ici est donc visible dans tous les autres fichiers.
 * Règle du projet : aucun fichier n'exécute de code au chargement (seulement des
 * déclarations de constantes et de fonctions). Ainsi, l'ordre de chargement des
 * fichiers n'a aucune importance.
 */

/** Fuseau horaire utilisé pour tous les calculs de dates et d'heures. */
const FUSEAU = 'Europe/Paris';

/** Noms des onglets du Google Sheet. */
const ONGLETS = Object.freeze({
  ACTIONS: 'Actions',
  BENEVOLES: 'Bénévoles',
  INSCRIPTIONS: 'Inscriptions',
  PRESENTS: 'Présents',
  ABSENTS: 'Absents',
  PARAMETRES: 'Paramètres',
  JOURNAL: 'Journal',
});

/** Statuts possibles d'une action (colonne « Statut » de l'onglet Actions). */
const STATUT_ACTION = Object.freeze({
  A_ANNONCER: '', // cellule vide = pas encore annoncée
  ANNONCEE: 'Annoncée',
  CONFIRMATIONS_ENVOYEES: 'Confirmations envoyées',
  LISTE_PUBLIEE: 'Liste publiée',
  ANNULEE: 'Annulée', // mis à la main par le référent
});

/** Statuts possibles d'une inscription (colonne « Statut » de l'onglet Inscriptions). */
const STATUT_INSCRIPTION = Object.freeze({
  INSCRIT: 'Inscrit', // a répondu OUI à l'annonce
  EN_ATTENTE: 'En attente', // demande de confirmation envoyée (J-2)
  CONFIRME: 'Confirmé',
  DESISTE: 'Désisté',
  SANS_REPONSE: 'Sans réponse', // pas de réponse à la confirmation avant J-1 20:00
  NON_JOIGNABLE: 'Non joignable', // l'envoi du message privé a échoué
  RETIRE: 'Retiré', // a répondu NON à l'annonce
});

/** Résultat de la détection d'une réponse (voir detecterReponse_ dans Utils_Textes.js). */
const REPONSE = Object.freeze({
  OUI: 'OUI',
  NON: 'NON',
});

/**
 * Expressions reconnues dans les réponses des bénévoles.
 * Elles sont comparées au texte « normalisé » (minuscules, sans accents, sans ponctuation),
 * mot à mot : « non » ne se déclenche pas dans « nonne ».
 * Ordre de priorité : INCERTAIN, puis NON, puis OUI.
 * (« pas dispo » contient « dispo » : il faut donc tester NON avant OUI.)
 */
const EXPRESSIONS_REPONSE = Object.freeze({
  INCERTAIN: ['peut etre', 'je sais pas', 'je ne sais pas', 'sais pas', 'pas sur', 'pas sure', 'je verrai'],
  NON: [
    'non', 'nan', 'finalement non', 'peux plus', 'peux pas', 'pourrai pas', 'pourrais pas',
    'pas dispo', 'pas disponible', 'indispo', 'indisponible', 'viens pas', 'viendrai pas',
    'absent', 'absente', 'annule', 'desiste', 'desistement',
  ],
  OUI: [
    'oui', 'ouais', 'ok', 'okay', 'yes', 'yep', 'present', 'presente', 'je viens', 'dispo', 'disponible',
    'partant', 'partante', 'je serai la', 'avec plaisir', 'carrement', 'bien sur',
  ],
});

/** Emojis reconnus comme réponse (recherchés dans le texte brut). */
const EMOJIS_REPONSE = Object.freeze({
  NON: ['👎', '❌'],
  OUI: ['👍', '✅', '🙋'],
});

/** Noms des jours, dans l'ordre de Date.getDay() (0 = dimanche). */
const JOURS_SEMAINE = Object.freeze(['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']);

/**
 * Valeurs par défaut de l'onglet Paramètres (utilisées à l'installation).
 * Variables disponibles dans les textes : {type} {date} {heure} {lieu} {prenom} {limite}
 */
const PARAMETRES_DEFAUT = Object.freeze({
  JOURS_AVANT_ANNONCE: { valeur: '7', description: "Nombre de jours avant l'action pour publier l'annonce" },
  HEURE_ANNONCE: { valeur: '18:00', description: 'Heure de publication des annonces' },
  JOURS_AVANT_CONFIRMATION: { valeur: '2', description: "Nombre de jours avant l'action pour demander la confirmation" },
  HEURE_CONFIRMATION: { valeur: '10:00', description: "Heure d'envoi des demandes de confirmation" },
  HEURE_LISTE: { valeur: '20:00', description: 'Heure de publication de la liste finale (la veille)' },
  RECAP_ACTIF: { valeur: 'oui', description: 'oui / non : envoyer le récap de la semaine' },
  JOUR_RECAP: { valeur: 'vendredi', description: 'Jour du récap de la semaine' },
  HEURE_RECAP: { valeur: '20:30', description: 'Heure du récap de la semaine' },
  NUMERO_REFERENT: { valeur: '', description: 'Numéro du référent (prévenu des désistements tardifs)' },
  TYPES_ACTIONS: { valeur: 'Maraude, BP, Paniers anti-gaspi, Collecte, Événement, Ménage', description: "Types d'actions proposés dans la liste déroulante" },
  TEXTE_ANNONCE: {
    valeur: '📣 {type} – {date} à {heure} – {lieu}\nPour participer, répondez OUI en citant ce message (appui long → Répondre).',
    description: 'Annonce publiée dans le groupe',
  },
  TEXTE_CONFIRMATION: {
    valeur: "Bonjour {prenom} 👋 Tu t'es inscrit(e) pour : {type} – {date} à {heure} – {lieu}.\nTu confirmes ta présence ? Réponds OUI ou NON (avant {limite}).",
    description: 'Demande de confirmation en message privé (J-2)',
  },
  TEXTE_VALIDATION: {
    valeur: '✅ Nous vous confirmons votre participation à : {type} – {date} à {heure} – {lieu}. Merci et à demain !',
    description: 'Confirmation finale en message privé, la veille',
  },
});
