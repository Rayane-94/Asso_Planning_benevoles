/**
 * constantes.ts — Ce qui ne change pas : noms des onglets, statuts, mots-clés.
 *
 * Tout ce que l'asso doit pouvoir régler (heures, textes des messages…) est dans
 * l'onglet « Paramètres » du Sheet ; PARAMETRES_DEFAUT ne sert qu'à le pré-remplir.
 *
 * Astuce TypeScript : « as const » fige les valeurs ET permet d'en déduire des types.
 * Par exemple, StatutAction n'accepte que les 5 statuts listés : une faute de frappe
 * comme 'Anoncée' est refusée par `npm run types`.
 */

/** Fuseau horaire de tous les calculs de dates (le serveur, lui, est en UTC). */
export const FUSEAU = 'Europe/Paris';

/** Pause entre deux messages envoyés à la suite (évite les rafales, suspectes pour WhatsApp). */
export const PAUSE_ENTRE_MESSAGES_MS = 2000;

/**
 * Aucun envoi AUTOMATIQUE après cette heure (on ne réveille pas les bénévoles la nuit).
 * Les commandes manuelles de l'onglet Commandes ne sont pas concernées.
 */
export const HEURE_FIN_ENVOIS_AUTO = '22:00';

/** Aucun envoi AUTOMATIQUE avant cette heure (rattrapage après une panne de nuit, par ex.). */
export const HEURE_DEBUT_ENVOIS_AUTO = '08:00';

/**
 * Écrit dans « Message ID » juste AVANT d'envoyer une annonce. Si le bot plante entre
 * l'envoi et l'enregistrement, ce marqueur empêche de renvoyer l'annonce en double.
 */
export const MARQUEUR_ENVOI_EN_COURS = 'envoi-en-cours';

/** Noms des onglets du Google Sheet. */
export const ONGLETS = {
  ACTIONS: 'Actions',
  BENEVOLES: 'Bénévoles',
  INSCRIPTIONS: 'Inscriptions',
  PRESENTS: 'Présents',
  ABSENTS: 'Absents',
  PARAMETRES: 'Paramètres',
  COMMANDES: 'Commandes',
  JOURNAL: 'Journal',
} as const;

/** Statuts possibles d'une action (colonne « Statut » de l'onglet Actions). */
export const STATUT_ACTION = {
  A_ANNONCER: '', // cellule vide = pas encore annoncée
  ANNONCEE: 'Annoncée',
  CONFIRMATIONS_ENVOYEES: 'Confirmations envoyées',
  LISTE_PUBLIEE: 'Liste publiée',
  ANNULEE: 'Annulée', // mis à la main par le référent
} as const;
export type StatutAction = (typeof STATUT_ACTION)[keyof typeof STATUT_ACTION];

/** Statuts possibles d'une inscription (colonne « Statut » de l'onglet Inscriptions). */
export const STATUT_INSCRIPTION = {
  INSCRIT: 'Inscrit', // a répondu OUI à l'annonce
  EN_ATTENTE: 'En attente', // demande de confirmation envoyée (J-2)
  CONFIRME: 'Confirmé',
  DESISTE: 'Désisté',
  SANS_REPONSE: 'Sans réponse', // pas de réponse à la confirmation avant J-1 20:00
  NON_JOIGNABLE: 'Non joignable', // l'envoi du message privé a échoué
  RETIRE: 'Retiré', // a répondu NON à l'annonce
} as const;
export type StatutInscription = (typeof STATUT_INSCRIPTION)[keyof typeof STATUT_INSCRIPTION];

/** Messages privés fixes du bot (les textes réglables par l'équipe sont dans Paramètres). */
export const MESSAGES = {
  DEMANDE_NOM: 'Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ?',
  /** {prenom} est remplacé par le prénom reçu. */
  MERCI_NOM: "Merci {prenom}, c'est noté !",
  /** Après un OUI / NON en privé à une demande de confirmation. */
  ACCUSE_RECEPTION: "C'est noté, merci !",
  /** La personne a plusieurs demandes en attente et n'a pas cité laquelle. */
  CITER_LE_MESSAGE: 'Tu as plusieurs actions en attente, réponds en citant le message concerné (appui long → Répondre).',
  /** Au référent, quand un confirmé se désiste après la publication de la liste. */
  ALERTE_DESISTEMENT: '⚠️ Désistement de dernière minute : {nom} ({telephone}) ne viendra pas à {type} – {date} à {heure} – {lieu}.',
} as const;

/** Commandes manuelles de l'onglet Commandes (remplacent le menu Apps Script, voir CLAUDE.md §5). */
export const COMMANDES = {
  ANNONCER: 'Annoncer maintenant',
  CONFIRMATIONS: 'Envoyer les confirmations maintenant',
  LISTE: 'Publier la liste de demain maintenant',
  RECAP: 'Envoyer le récap maintenant',
  VERIFIER: 'Vérifier la configuration',
  PAUSE: 'Mettre le bot en pause',
  REPRENDRE: 'Reprendre',
} as const;
export type Commande = (typeof COMMANDES)[keyof typeof COMMANDES];

/** Résultat de la détection d'une réponse (voir detecterReponse dans utils/textes.ts). */
export const REPONSE = {
  OUI: 'OUI',
  NON: 'NON',
} as const;
export type Reponse = (typeof REPONSE)[keyof typeof REPONSE];

/**
 * Expressions reconnues dans les réponses des bénévoles.
 * Elles sont comparées au texte « normalisé » (minuscules, sans accents, sans ponctuation),
 * mot à mot : « non » ne se déclenche pas dans « nonne ».
 * Ordre de priorité : INCERTAIN, puis NON, puis OUI.
 * (« pas dispo » contient « dispo » : il faut donc tester NON avant OUI.)
 */
export const EXPRESSIONS_REPONSE = {
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
} as const;

/** Emojis reconnus comme réponse (recherchés dans le texte brut). */
export const EMOJIS_REPONSE = {
  NON: ['👎', '❌'],
  OUI: ['👍', '✅', '🙋'],
} as const;

/** Noms des jours, dans l'ordre de Date.getDay() (0 = dimanche). */
export const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;

/**
 * Valeurs par défaut de l'onglet Paramètres (utilisées par `npm run installer-sheet`).
 * Variables disponibles dans les textes : {type} {date} {heure} {lieu} {prenom} {limite}
 */
export const PARAMETRES_DEFAUT = {
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
} as const;
export type NomParametre = keyof typeof PARAMETRES_DEFAUT;
