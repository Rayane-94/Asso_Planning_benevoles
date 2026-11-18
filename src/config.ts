/**
 * config.ts — Lecture et vérification de la configuration technique.
 *
 * Les réglages techniques et les secrets viennent des « variables d'environnement » :
 *   - sur le VPS : fichier `.env` (jamais commité), chargé par Docker Compose ;
 *   - en local   : fichier `.env` chargé au démarrage par process.loadEnvFile().
 * Le modèle à copier est `.env.example`.
 *
 * Les réglages « métier » (heures, textes…) ne sont PAS ici : ils sont dans l'onglet
 * Paramètres du Sheet, pour que l'équipe puisse les changer sans développeur.
 */
import { NIVEAUX_LOG, type NiveauLog } from './utils/logger.ts';

export interface Config {
  waha: {
    url: string; // adresse de WAHA, ex. http://waha:3000 (réseau Docker interne)
    cleApi: string; // clé partagée entre WAHA et le bot (secret)
    session: string; // nom de la session WhatsApp dans WAHA
  };
  google: {
    idSheet: string; // l'ID dans l'URL du Sheet : docs.google.com/spreadsheets/d/<ID>/edit
    fichierCle: string; // chemin du fichier JSON du compte de service (secret)
  };
  /** ID du groupe WhatsApp des bénévoles. null tant qu'il n'est pas choisi (npm run lister-groupes). */
  groupeId: string | null;
  port: number; // port du serveur HTTP qui reçoit les webhooks de WAHA
  dossierDonnees: string; // où le bot range son état local (data/etat.json)
  niveauLog: NiveauLog;
}

/** Erreur levée quand la configuration est incomplète ou invalide. Liste TOUS les problèmes d'un coup. */
export class ErreurConfig extends Error {
  readonly problemes: string[];

  constructor(problemes: string[]) {
    super(
      'Configuration invalide :\n' +
      problemes.map((p) => `  - ${p}`).join('\n') +
      '\n→ Vérifiez le fichier .env (modèle : .env.example).',
    );
    this.name = 'ErreurConfig';
    this.problemes = problemes;
  }
}

/** Variables d'environnement : un dictionnaire de textes, éventuellement absents. */
type Environnement = Record<string, string | undefined>;

/**
 * Lit et vérifie la configuration.
 * On passe l'environnement en paramètre (par défaut process.env) pour pouvoir tester
 * facilement avec un faux environnement.
 * @throws ErreurConfig si au moins une variable manque ou est invalide
 */
export function chargerConfig(env: Environnement = process.env): Config {
  const problemes: string[] = [];

  /** Variable obligatoire : on note un problème si elle est absente ou vide. */
  const obligatoire = (nom: string): string => {
    const valeur = env[nom]?.trim();
    if (!valeur) problemes.push(`${nom} est obligatoire mais absente ou vide`);
    return valeur ?? '';
  };
  /** Variable facultative avec une valeur par défaut. */
  const facultative = (nom: string, parDefaut: string): string => env[nom]?.trim() || parDefaut;

  const wahaUrl = facultative('WAHA_URL', 'http://waha:3000');
  if (!estUneUrl(wahaUrl)) problemes.push(`WAHA_URL n'est pas une adresse valide : « ${wahaUrl} »`);

  const port = Number(facultative('PORT', '3000'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problemes.push(`PORT doit être un nombre entre 1 et 65535 : « ${env.PORT} »`);
  }

  const niveauLog = facultative('NIVEAU_LOG', 'info');
  if (!estNiveauLog(niveauLog)) {
    problemes.push(`NIVEAU_LOG doit valoir ${NIVEAUX_LOG.join(', ')} : « ${niveauLog} »`);
  }

  const config: Config = {
    waha: {
      url: wahaUrl.replace(/\/+$/, ''), // sans « / » final, pour coller les chemins proprement
      cleApi: obligatoire('WAHA_API_KEY'),
      session: facultative('WAHA_SESSION', 'default'),
    },
    google: {
      idSheet: obligatoire('GOOGLE_SHEET_ID'),
      fichierCle: facultative('GOOGLE_FICHIER_CLE', './secrets/compte-service.json'),
    },
    groupeId: env.GROUPE_ID?.trim() || null,
    port,
    dossierDonnees: facultative('DOSSIER_DONNEES', './data'),
    niveauLog: estNiveauLog(niveauLog) ? niveauLog : 'info',
  };

  if (problemes.length > 0) throw new ErreurConfig(problemes);
  return config;
}

/**
 * Version affichable de la configuration : les secrets sont masqués.
 * À utiliser pour « Vérifier la configuration » et au démarrage, jamais `config` brut.
 */
export function resumerConfig(config: Config): Record<string, string> {
  return {
    'WhatsApp (WAHA)': `${config.waha.url} — session « ${config.waha.session} » — clé ${masquer(config.waha.cleApi)}`,
    'Google Sheet': `${config.google.idSheet} — clé ${config.google.fichierCle}`,
    'Groupe WhatsApp': config.groupeId ?? '(pas encore choisi : npm run lister-groupes)',
    'Serveur': `port ${config.port}`,
    'Données locales': config.dossierDonnees,
    'Niveau de log': config.niveauLog,
  };
}

/** 'abcdef123456' → 'abcd…' : assez pour reconnaître une clé, pas assez pour la voler. */
export function masquer(secret: string): string {
  if (secret.length <= 8) return '••••';
  return secret.slice(0, 4) + '…';
}

// ---------------------------------------------------------------------------

function estUneUrl(texte: string): boolean {
  try {
    const url = new URL(texte);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function estNiveauLog(texte: string): texte is NiveauLog {
  return (NIVEAUX_LOG as readonly string[]).includes(texte);
}
