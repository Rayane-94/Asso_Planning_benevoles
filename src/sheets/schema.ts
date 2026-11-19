/**
 * sheets/schema.ts — La structure du Google Sheet : onglets et colonnes.
 *
 * C'est la référence unique : `npm run installer-sheet` crée le Sheet à partir d'ici,
 * et le code du bot utilise ces noms de colonnes (jamais de texte écrit en dur ailleurs).
 * Pour ajouter une colonne : l'ajouter ici, puis relancer `npm run installer-sheet`.
 */
import { ONGLETS, STATUT_ACTION, STATUT_INSCRIPTION } from '../constantes.ts';
import type { ConfigColonne, SeparateurArguments } from '../ports/tableur.ts';

// ---------------------------------------------------------------------------
// Noms des colonnes, par onglet (à utiliser dans tout le code)
// ---------------------------------------------------------------------------

export const COLONNES_ACTIONS = {
  ID: 'ID', TYPE: 'Type', DATE: 'Date', HEURE: 'Heure', LIEU: 'Lieu',
  PLACES: 'Places', STATUT: 'Statut', MESSAGE_ID: 'Message ID',
} as const;

export const COLONNES_BENEVOLES = {
  TELEPHONE: 'Téléphone', PRENOM: 'Prénom', NOM: 'Nom', NOM_WHATSAPP: 'Nom WhatsApp',
  NOM_DEMANDE_LE: 'Nom demandé le', INSCRIT_LE: 'Inscrit le',
} as const;

export const COLONNES_INSCRIPTIONS = {
  ID: 'ID', ACTION_ID: 'Action ID', TYPE: 'Type', DATE: 'Date', HEURE: 'Heure', LIEU: 'Lieu',
  TELEPHONE: 'Téléphone', NOM: 'Nom', STATUT: 'Statut', DEMANDE_ID: 'Demande ID', MIS_A_JOUR: 'Mis à jour',
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

// ---------------------------------------------------------------------------
// Description complète des onglets « de données » (remplis par le bot ou l'équipe)
// ---------------------------------------------------------------------------

/**
 * Format des colonnes :
 *   - 'texte' : rien n'est converti (numéros gardent leur 0, « 19:00 » reste « 19:00 ») ;
 *   - 'date'  : vraie date affichée jj/mm/aaaa (colonne remplie à la main par le référent) ;
 *   - 'case'  : case à cocher.
 * `choix` = liste déroulante. `masquee` = colonne technique cachée à l'équipe.
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

  return [
    {
      nom: ONGLETS.ACTIONS,
      colonnes: [
        texte(A.ID), texte(A.TYPE, { choix: typesActions }), { nom: A.DATE, format: 'date' },
        texte(A.HEURE), texte(A.LIEU), texte(A.PLACES), texte(A.STATUT, { choix: statutsAction }),
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
        texte(I.TELEPHONE), texte(I.NOM), texte(I.STATUT, { choix: statutsInscription }),
        texte(I.DEMANDE_ID, { masquee: true }), texte(I.MIS_A_JOUR),
      ],
    },
    { nom: ONGLETS.PARAMETRES, colonnes: [texte(P.PARAMETRE), texte(P.VALEUR), texte(P.DESCRIPTION)] },
    {
      nom: ONGLETS.COMMANDES,
      colonnes: [texte(C.COMMANDE), { nom: C.LANCER, format: 'case' }, texte(C.DERNIERE_EXECUTION), texte(C.RESULTAT)],
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
  const colonnesAffichees = [I.TYPE, I.DATE, I.HEURE, I.LIEU, I.NOM, I.TELEPHONE].map(lettre).join(', ');
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
