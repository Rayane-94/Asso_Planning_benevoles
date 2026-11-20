/**
 * sheets/schema.ts — La structure du Google Sheet : onglets et colonnes.
 *
 * C'est la référence unique : `npm run installer-sheet` crée le Sheet à partir d'ici,
 * et le code du bot utilise ces noms de colonnes (jamais de texte écrit en dur ailleurs).
 * Pour ajouter une colonne : l'ajouter ici, puis relancer `npm run installer-sheet`.
 */
import { COMMANDES, ONGLETS, STATUT_ACTION, STATUT_INSCRIPTION } from '../constantes.ts';
import type { ConfigColonne, SeparateurArguments } from '../ports/tableur.ts';

// ---------------------------------------------------------------------------
// Noms des colonnes, par onglet (à utiliser dans tout le code)
// ---------------------------------------------------------------------------

export const COLONNES_ACTIONS = {
  ID: 'ID', TYPE: 'Type', DATE: 'Date', HEURE: 'Heure', LIEU: 'Lieu',
  // Créneaux : choix du sondage séparés par des virgules (vide = « dispo » / « pas dispo »)
  CRENEAUX: 'Créneaux', PLACES: 'Places', STATUT: 'Statut', MESSAGE_ID: 'Message ID',
} as const;

export const COLONNES_BENEVOLES = {
  TELEPHONE: 'Téléphone', PRENOM: 'Prénom', NOM: 'Nom', NOM_WHATSAPP: 'Nom WhatsApp',
  NOM_DEMANDE_LE: 'Nom demandé le', INSCRIT_LE: 'Inscrit le',
} as const;

export const COLONNES_INSCRIPTIONS = {
  ID: 'ID', ACTION_ID: 'Action ID', TYPE: 'Type', DATE: 'Date', HEURE: 'Heure', LIEU: 'Lieu',
  // Créneau : le ou les créneaux cochés dans le sondage (vide si l'action n'a pas de créneaux)
  TELEPHONE: 'Téléphone', NOM: 'Nom', CRENEAU: 'Créneau', STATUT: 'Statut', DEMANDE_ID: 'Demande ID', MIS_A_JOUR: 'Mis à jour',
} as const;

export const COLONNES_PARAMETRES = {
  PARAMETRE: 'Paramètre', VALEUR: 'Valeur', DESCRIPTION: 'Description',
} as const;

export const COLONNES_COMMANDES = {
  COMMANDE: 'Commande', LANCER: 'Lancer', DERNIERE_EXECUTION: 'Dernière exécution', RESULTAT: 'Résultat',
} as const;

export const COLONNES_JOURNAL = {
  DATE: 'Date', NIVEAU: 'Niveau', MESSAGE: 'Message',
} as const;

export const COLONNES_ETAT = {
  ELEMENT: 'Élément', ETAT: 'État', DEPUIS: 'Depuis', QUE_FAIRE: 'Que faire',
} as const;

/** Lignes du tableau de bord « État du bot » (colonne Élément). */
export const ELEMENTS_ETAT = {
  WHATSAPP: 'WhatsApp',
  BOT: 'Bot',
  DERNIER_PASSAGE: 'Dernier passage',
} as const;

// ---------------------------------------------------------------------------
// Description complète des onglets « de données » (remplis par le bot ou l'équipe)
// ---------------------------------------------------------------------------

/**
 * Format des colonnes :
 *   - 'texte' : rien n'est converti (numéros gardent leur 0, « 19:00 » reste « 19:00 ») ;
 *   - 'date'  : vraie date affichée jj/mm/aaaa (colonne remplie à la main par le référent) ;
 *   - 'case'  : case à cocher.
 * `choix` = liste déroulante. `masquee` = colonne technique cachée à l'équipe.
 * `aRemplir` = colonne remplie par le responsable : en-tête VERT. Les autres en-têtes sont
 * GRIS : le bot les remplit tout seul (on n'y touche que pour corriger).
 *
 * Les dates écrites PAR LE BOT (Inscriptions, Bénévoles, Journal) sont du texte au format
 * '2026-11-28' : ce format se trie correctement, même en texte (utile pour les vues).
 */
export interface DefinitionOnglet {
  nom: string;
  colonnes: ConfigColonne[];
}

const texte = (nom: string, options: Partial<ConfigColonne> = {}): ConfigColonne => ({ nom, format: 'texte', ...options });

/** Statuts proposés dans les listes déroulantes (la valeur vide n'est pas un choix). */
const statutsAction = Object.values(STATUT_ACTION).filter((statut) => statut !== '');
const statutsInscription = Object.values(STATUT_INSCRIPTION);

/**
 * @param typesActions les types d'actions (lus dans le paramètre TYPES_ACTIONS)
 */
export function definitionsOnglets(typesActions: string[]): DefinitionOnglet[] {
  const A = COLONNES_ACTIONS;
  const B = COLONNES_BENEVOLES;
  const I = COLONNES_INSCRIPTIONS;
  const P = COLONNES_PARAMETRES;
  const C = COLONNES_COMMANDES;
  const J = COLONNES_JOURNAL;
  const E = COLONNES_ETAT;

  return [
    {
      nom: ONGLETS.ETAT,
      colonnes: [texte(E.ELEMENT), texte(E.ETAT), texte(E.DEPUIS), texte(E.QUE_FAIRE)],
    },
    {
      nom: ONGLETS.ACTIONS,
      colonnes: [
        texte(A.ID, { aide: 'Rempli automatiquement par le bot (ex. A-0001). Ne pas modifier.' }),
        texte(A.TYPE, { choix: typesActions, aRemplir: true, aide: 'Choisir dans la liste déroulante. Exemple : BP' }),
        { nom: A.DATE, format: 'date', aRemplir: true, aide: 'Une vraie date au format jj/mm/aaaa. Exemple : 28/11/2026 (pas « samedi » ni « dans 4 jours »)' },
        texte(A.HEURE, { aRemplir: true, aide: 'Heure de début. Exemples : 14:00, 14h, 14h30' }),
        texte(A.LIEU, { aRemplir: true, aide: 'Exemple : Local, 5 rue Charles Gounod, Créteil' }),
        texte(A.CRENEAUX, {
          aRemplir: true,
          aide: 'Facultatif. Les choix du sondage, séparés par des virgules. Exemple : dispo de 10h à 13h, dispo de 13h à 16h\n' +
            'Laisser vide pour un sondage simple « dispo !! / pas dispo :/ ».\n' +
            '⚠️ Ne pas écrire « pas dispo » : le bot l\'ajoute tout seul à la fin du sondage. 11 créneaux maximum.',
        }),
        texte(A.PLACES, { aRemplir: true, aide: 'Facultatif. Nombre de places, pour information. Exemple : 10' }),
        texte(A.STATUT, { choix: statutsAction, aide: 'Rempli par le bot. Pour annuler une action : choisir « Annulée » (puis prévenir les bénévoles à la main).' }),
        texte(A.MESSAGE_ID, { masquee: true }),
      ],
    },
    {
      nom: ONGLETS.BENEVOLES,
      colonnes: [texte(B.TELEPHONE), texte(B.PRENOM), texte(B.NOM), texte(B.NOM_WHATSAPP), texte(B.NOM_DEMANDE_LE), texte(B.INSCRIT_LE)],
    },
    {
      nom: ONGLETS.INSCRIPTIONS,
      colonnes: [
        texte(I.ID), texte(I.ACTION_ID), texte(I.TYPE), texte(I.DATE), texte(I.HEURE), texte(I.LIEU),
        texte(I.TELEPHONE), texte(I.NOM), texte(I.CRENEAU),
        texte(I.STATUT, { choix: statutsInscription, aide: 'Rempli par le bot. Pour corriger quelqu\'un : choisir le bon statut dans la liste (ex. Confirmé). Présents et Absents se mettent à jour seuls.' }),
        texte(I.DEMANDE_ID, { masquee: true }), texte(I.MIS_A_JOUR),
      ],
    },
    {
      nom: ONGLETS.PARAMETRES,
      colonnes: [
        texte(P.PARAMETRE, { aide: 'Ne pas modifier le nom des paramètres.' }),
        texte(P.VALEUR, { aRemplir: true, aide: 'La valeur à modifier. Le format attendu est expliqué dans la colonne Description. Exemple pour une heure : 18:00' }),
        texte(P.DESCRIPTION),
      ],
    },
    {
      nom: ONGLETS.COMMANDES,
      colonnes: [
        // Une case à cocher seulement en face de chaque commande (pas sur 1000 lignes vides)
        texte(C.COMMANDE, { aide: 'Ne pas modifier le texte des commandes.' }),
        {
          nom: C.LANCER, format: 'case', aRemplir: true, lignes: Object.keys(COMMANDES).length,
          aide: 'Cocher pour lancer la commande. Le bot l\'exécute dans la minute, décoche la case et écrit le résultat.',
        },
        texte(C.DERNIERE_EXECUTION), texte(C.RESULTAT),
      ],
    },
    { nom: ONGLETS.JOURNAL, colonnes: [texte(J.DATE), texte(J.NIVEAU), texte(J.MESSAGE)] },
  ];
}

// ---------------------------------------------------------------------------
// Vues Présents et Absents (formules QUERY sur Inscriptions)
// ---------------------------------------------------------------------------

/**
 * Formules des vues. Une formule QUERY désigne les colonnes par leur LETTRE (A, B…) :
 * on calcule donc les lettres à partir des en-têtes actuels d'Inscriptions.
 * Si l'équipe déplace des colonnes d'Inscriptions, relancer `npm run installer-sheet`.
 *
 * ⚠️ Le séparateur d'arguments dépend de la langue du Sheet : ',' en anglais, ';' en
 * français. Les virgules À L'INTÉRIEUR de la requête ("select C, D") ne changent jamais :
 * elles font partie du langage QUERY, pas de la formule.
 */
export function formulesVues(
  entetesInscriptions: string[],
  separateur: SeparateurArguments = ',',
): { presents: string; absents: string } {
  const I = COLONNES_INSCRIPTIONS;
  const lettre = (colonne: string): string => {
    const index = entetesInscriptions.indexOf(colonne);
    if (index < 0) throw new Error(`Onglet Inscriptions : colonne « ${colonne} » introuvable`);
    return lettreColonne(index);
  };
  const plage = `'${ONGLETS.INSCRIPTIONS}'!A:${lettreColonne(entetesInscriptions.length - 1)}`;
  const statut = lettre(I.STATUT);
  const colonnesAffichees = [I.TYPE, I.DATE, I.HEURE, I.CRENEAU, I.LIEU, I.NOM, I.TELEPHONE].map(lettre).join(', ');
  const tri = `order by ${lettre(I.DATE)}, ${lettre(I.HEURE)}, ${lettre(I.NOM)}`;
  const S = STATUT_INSCRIPTION;
  /** =QUERY(plage ; "requête" ; 1) avec le bon séparateur ; le 1 = une ligne d'en-têtes. */
  const query = (requete: string): string => `=QUERY(${plage}${separateur} "${requete}"${separateur} 1)`;

  return {
    presents: query(`select ${colonnesAffichees} where ${statut} = '${S.CONFIRME}' ${tri}`),
    absents: query(
      `select ${colonnesAffichees}, ${statut} where ` +
      `${statut} = '${S.DESISTE}' or ${statut} = '${S.SANS_REPONSE}' or ${statut} = '${S.NON_JOIGNABLE}' ${tri}`,
    ),
  };
}

/** 0 → 'A', 25 → 'Z', 26 → 'AA' (lettre de colonne du Sheet à partir d'un index commençant à 0). */
export function lettreColonne(index: number): string {
  let lettres = '';
  let n = index + 1;
  while (n > 0) {
    const reste = (n - 1) % 26;
    lettres = String.fromCharCode(65 + reste) + lettres;
    n = Math.floor((n - 1) / 26);
  }
  return lettres;
}
