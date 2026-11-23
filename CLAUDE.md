# Projet : Bot planning bénévoles (WhatsApp + Google Sheet)

> Document d'ingénierie du projet : contexte, architecture, règles métier, décisions et plan de développement. Il sert de référence à toute personne (ou tout assistant de code) qui travaille sur le projet.
>
> **Version 3 (18/11/2026)** : le bot devient un **serveur Node.js + TypeScript** hébergé sur un **VPS Oracle Cloud (Always Free)**, à côté de **WAHA** (API WhatsApp open source auto-hébergée). Le Google Sheet reste l'interface de l'équipe.
> Historique : v1 Telegram (abandonné) → v2 Google Apps Script + API WhatsApp hébergée payante (abandonné le 18/11/2026, voir §2) → v3.

---

## 0. Critères à respecter

- **Bonnes pratiques** : code simple et lisible, commenté en français, pour que d'autres bénévoles puissent reprendre le projet. TypeScript en mode strict, tests à chaque fonctionnalité, CI verte avant de fusionner.
- **Principes SOLID** : le code métier ne dépend pas directement de WhatsApp ni de Google ; il passe par des interfaces (ports et adaptateurs, voir §3.3). Un module = une responsabilité.
- **Fiabilité** : aucun message envoyé en double, même si le bot redémarre. En cas de doute, le bot ne fait rien et l'écrit dans le Journal.
- **Sécurité** : aucun secret dans le dépôt, rien d'exposé sur Internet, pas de vraies données personnelles dans les tests.
- **Simplicité** : le moins de dépendances possible ; les réglages courants dans le Sheet, pas dans le code.
- **Git** : Conventional Commits en français, une étape = un commit, une branche et une pull request par bloc.

---

## 1. Contexte

Une association (humanitaire) organise des actions avec ses bénévoles. Il existe déjà un groupe WhatsApp qui réunit tous les bénévoles (10 à 50 personnes). Aujourd'hui, une responsable fait tout à la main : annonces, relevé des « oui », messages de confirmation, planning Excel, liste finale tapée à la main.

**Objectif** : automatiser ce process de bout en bout, de façon simple.

**Types d'actions** : Maraude, BP (Blue Project, la partie du projet où on fait le tri), Paniers anti-gaspi, Collecte, Événement / Salon, Ménage.

### Hors périmètre (phase 2, ne pas coder maintenant)

L'accueil des nouveaux bénévoles : message automatique, transcription et résumé IA de l'appel, redirection vers le bon pôle. Garder une architecture propre pour l'ajouter plus tard (nouveau module dans `src/metier/`), sans plus.

---

## 2. Contraintes et décisions

- **Hébergement : VPS Oracle Cloud « Always Free »** (machine ARM). Coût visé : 0 €.
  - Compte passé en **« Pay As You Go »** (reste gratuit dans les limites Always Free) pour éviter qu'Oracle récupère la machine jugée inactive, avec une **alerte de budget à 1 €**.
- **WhatsApp via WAHA** (WhatsApp HTTP API, open source, version gratuite « Core », une seule session = un numéro), en Docker sur le même VPS. Connexion par QR code. API non officielle : risque de bannissement (voir §6).
- **Google Sheets comme interface** : l'équipe consulte et corrige. Exportable en `.xlsx`. Le bot y accède via l'API Google avec un **compte de service** (compte « robot » Google partagé en éditeur sur le Sheet).
- **Changer de fournisseur WhatsApp doit rester facile** (interface `Messagerie`, voir §3.3) : si WAHA casse, on peut brancher Evolution API ou un fournisseur hébergé payant (Green-API…) sans toucher au code métier.
- Format de la liste finale **volontairement minimaliste** (voir §4.5).
- Les réglages courants (heures, textes) se font **dans le Sheet** (onglet Paramètres), jamais dans le code.
- **Philosophie (validée le 19/11/2026)** : le bot automatise le cas normal ; les cas particuliers (changement de dernière minute, situation imprévue) sont gérés **à la main** par l'équipe et les bénévoles. Le bot ne devine jamais : en cas de doute, il ne fait rien et note dans le Journal.
- **Tests réels** : d'abord avec un numéro de test, dans un groupe de test séparé, avec un second testeur pour les réponses (les messages envoyés depuis le numéro du bot sont vus comme venant du bot). Le numéro dédié de l'asso vient ensuite.
- **Décisions écartées** (18/11/2026) :
  - Apps Script + fournisseur hébergé payant (v2) → remplacé par le VPS (gratuit, temps réel, prêt pour la phase 2).
  - Apps Script + WAHA sur le VPS → il aurait fallu exposer WAHA sur Internet et gérer la réception des messages entre Google et le VPS ; plus simple de tout mettre sur le VPS.
  - Mode « tout dans le groupe » → abandonné, on vise les messages privés.
  - GitHub Actions comme hébergement → contraire aux conditions de GitHub ; il sert uniquement à la CI.
  - Outils WhatsApp « maison » trouvés sur GitHub (ex. keepclose-fixed) → pas de licence, pas maintenus, fonctions manquantes.

---

## 3. Stack et architecture

### 3.1 Stack

| Besoin | Choix | Pourquoi |
|---|---|---|
| Langage | **TypeScript** (mode `strict`) sur **Node.js 24** | Typage = moins de bugs, lisible ; Node 24 = version LTS |
| Serveur HTTP (réception des webhooks WAHA) | **Express** | Le plus connu et documenté : facile à reprendre pour un autre développeur |
| Google Sheets | **@googleapis/sheets** (bibliothèque officielle, API Sheets seule : 0,8 Mo au lieu de 246 Mo pour `googleapis`) + compte de service | Officielle, maintenue par Google |
| Tests | **Vitest** | Gère TypeScript sans configuration, horloge simulée intégrée |
| Lancement | **Docker Compose** : 2 conteneurs, `waha` et `bot` | Une commande pour tout démarrer, redémarrage automatique |
| CI | **GitHub Actions** : `npm run verifier` (types + tests) à chaque push | Déjà en place |

Dépendances : le moins possible. Toute nouvelle dépendance doit être justifiée (besoin réel, maintenance, taille) et validée par les mainteneurs.

### 3.2 Vue d'ensemble

```text
                    VPS Oracle (Docker Compose)
   ┌──────────────────────────────────────────────────────────┐
   │                                                          │
   │   ┌──────────┐  webhook (message reçu)   ┌───────────┐   │
   │   │   WAHA   │ ────────────────────────▶ │    bot    │   │
   │   │ (session │ ◀──────────────────────── │  (Node)   │   │
   │   │ WhatsApp)│   API HTTP (envoi…)       └─────┬─────┘   │
   │   └────┬─────┘                                 │         │
   └────────┼───────────────────────────────────────┼─────────┘
            │                                       │ API Google
            ▼                                       ▼
     Serveurs WhatsApp                        Google Sheet (équipe)
```

- WAHA et le bot communiquent **à l'intérieur du VPS** (réseau Docker interne). **Rien n'est exposé sur Internet**, à part SSH. Le tableau de bord WAHA (scan du QR code) s'ouvre via un tunnel SSH.
- **Réception = webhook** : WAHA appelle `POST /webhook/waha` du bot à chaque message. Le bot répond vite (200) puis traite le message.
- **Planificateur** : une fonction `tick()` toutes les minutes lance les jobs planifiés (annonces, confirmations, listes, récap, commandes manuelles). Un seul `tick` à la fois (verrou en mémoire). Chaque job est isolé dans un `try/catch` qui écrit dans l'onglet Journal.

### 3.3 Organisation du code : le métier ne dépend de rien

Le code métier ne parle **jamais directement** à WAHA, à Google ou à l'horloge système. Il reçoit des **interfaces** (« ports ») ; on lui branche les vraies implémentations en production et des **faux** dans les tests.

```ts
interface Messagerie {               // = l'ancienne interface « WA »
  envoyerTexte(destinataire: string, texte: string, options?: { citeId?: string }): Promise<string>; // → ID du message
  listerGroupes(): Promise<{ id: string; nom: string }[]>;
  verifierConnexion(): Promise<{ ok: boolean; numero?: string }>;
}
// La réception arrive par webhook : l'adaptateur transforme le JSON de WAHA en MessageRecu.

interface MessageRecu {
  id: string;
  discussionId: string;   // groupe ou privé
  estGroupe: boolean;
  telephone: string | null; // E.164 sans « + » ; null si WhatsApp ne donne qu'un LID (voir §6)
  idBrut: string;         // identifiant brut de l'expéditeur (JID ou LID)
  nomWhatsApp: string;
  texte: string;
  citeId: string | null;  // ID du message cité
  date: Date;
}

interface Horloge { maintenant(): Date }
```

- Accès au Sheet : un module par onglet (`actions`, `benevoles`, `inscriptions`, `parametres`, `journal`), qui lit et écrit **par nom de colonne**. En test, un faux Sheet en mémoire.
- Les formats d'ID propres à WAHA (`…@c.us`, `…@g.us`, `…@lid`) **restent dans l'adaptateur WAHA**.
- **Déduplication** par `MessageRecu.id` (WAHA peut renvoyer un webhook) : IDs déjà traités gardés dans l'état local.

Structure prévue :

```text
src/
  index.ts               point d'entrée : branche tout et démarre
  config.ts              lecture et vérification des variables d'environnement
  serveur.ts             Express : POST /webhook/waha, GET /sante
  planificateur.ts       tick() toutes les minutes
  constantes.ts          statuts, onglets, mots-clés OUI/NON, paramètres par défaut
  utils/                 dates, telephones, textes (fonctions pures)
  ports/                 interfaces Messagerie, Horloge, Tableur
  whatsapp/waha.ts       adaptateur WAHA (envoi + conversion des webhooks)
  sheets/                accès Google Sheets, un fichier par onglet + installation
  etat/                  état local du bot (fichier JSON dans un volume Docker)
  metier/                annonces, reception, confirmations, liste, recap, commandes
tests/                   tests Vitest + faux (messagerie, Sheet, horloge)
docker-compose.yml, Dockerfile, .env.example
```

### 3.4 Secrets, configuration et état

- **Secrets dans un fichier `.env`** sur le VPS, **jamais commité** (`.env.example` commité, sans valeurs) : `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `GOOGLE_SHEET_ID`, chemin de la clé du compte de service, `GROUPE_ID`.
- La **clé du compte de service Google** (fichier JSON) reste sur le VPS, hors du repo.
- **État interne** (IDs de messages traités, marqueurs « déjà fait aujourd'hui ») : fichier JSON dans un volume Docker (`data/etat.json`), écrit de façon atomique. Il survit aux redémarrages.
- Session WhatsApp de WAHA : volume Docker dédié, à **sauvegarder** (sinon il faut rescanner le QR code).

---

## 4. Déroulé fonctionnel (VALIDÉ)

### 4.1 Le référent crée l'action dans le Sheet (option B, *à confirmer*)

- Le référent ajoute une ligne dans l'onglet **Actions** : Type, Date, Heure, Lieu.
- **C'est le bot qui publie l'annonce.** Comme il envoie lui-même le message, il connaît son ID, et chaque réponse qui cite ce message est rattachée sans ambiguïté à la bonne action.
- Alternatives écartées :
  - le référent écrit l'annonce en texte libre (impossible à analyser de façon fiable) ;
  - un format imposé type `#BP 29/11 14h` (une faute de frappe et l'annonce est perdue).

### 4.2 J-7 : annonce dans le groupe

Chaque jour à `HEURE_ANNONCE` (par défaut 18:00), le bot publie **un message par action** (pas de regroupement : chaque action doit avoir son propre message pour que les citations fonctionnent) :

- pour toutes les actions pas encore annoncées dont la date est **≤ J+7** ;
- **rattrapage** : une action ajoutée tard est annoncée le soir même si sa date est **≥ J+3** ; plus proche que ça, seulement via la commande « Annoncer maintenant » (§5).

Texte de l'annonce (modifiable dans Paramètres) :

```text
📣 BP – samedi 29/11 à 14:00 – Entrepôt
Pour participer, répondez OUI en citant ce message (appui long → Répondre).
```

L'ID du message est stocké dans l'action, et le statut passe à **Annoncée**.

### 4.3 Réponses dans le groupe

- Le bot ne traite **que les messages du groupe qui citent une annonce** (`citeId` = ID d'une annonce). Tout le reste du groupe est ignoré.
- **Texte « oui »** (oui, ok, présent, je viens, dispo, 👍, ✅, insensible à la casse et aux accents) : on crée une inscription au statut **Inscrit**. Pas de doublon si la personne répond deux fois.
- **Texte « non »** (non, finalement non, je peux plus…) : statut **Retiré**.
- On ne demande **PAS** nom, prénom et numéro dans le groupe. Le numéro vient de l'expéditeur du message.
- Si le numéro est **inconnu** de l'onglet Bénévoles, le bot lui écrit **une seule fois** en privé : « Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ? ». Sa réponse (tout message privé qui n'est ni OUI ni NON) est enregistrée dans Bénévoles. En attendant, on utilise le nom WhatsApp.
- Une annonce dont l'action est **publiée ou annulée** : on ignore les réponses.
- Un « oui » arrivé **après l'envoi des confirmations** (entre J-2 et J-1 20:00) : on envoie tout de suite la demande de confirmation.

### 4.4 J-2 : demande de confirmation en privé

À J-2 à `HEURE_CONFIRMATION` (par défaut 10:00), message privé à chaque **Inscrit** :

```text
Bonjour Bob 👋 Tu t'es inscrit(e) pour : BP – samedi 29/11 à 14:00 – Entrepôt.
Tu confirmes ta présence ? Réponds OUI ou NON (avant vendredi 20:00).
```

Le statut passe à **En attente**. Si l'envoi échoue : **Non joignable**.

> **Depuis le 21/11/2026 (S6)** : le texte est suivi d'un **sondage Oui / Non** (« ✅ Oui, je serai là » / « ❌ Non, je ne peux plus »). Voter vaut réponse, sur la bonne action même si on en a plusieurs ; le OUI / NON écrit (règles ci-dessous) reste accepté en secours.

Lecture des réponses en privé :

- si la personne a **une seule** confirmation en attente, « OUI » / « NON » s'y appliquent ;
- si elle en a **plusieurs** : la réponse qui cite une demande s'applique à cette demande ; sinon, le bot répond « Tu as plusieurs actions en attente, réponds en citant le message concerné » ;
- OUI → **Confirmé** ; NON → **Désisté**. Le bot accuse réception (« C'est noté, merci ! »).
- **Pas de relance.**

### 4.5 J-1 à 20:00 (`HEURE_LISTE`) : confirmation finale et liste

1. Les inscriptions encore **En attente** passent à **Sans réponse**.
2. Message privé à chaque **Confirmé** :

   ```text
   ✅ Nous vous confirmons votre participation à : Maraude – mardi 25/11 à 19:00 – Gare de Lyon. Merci et à demain !
   ```

3. **Liste finale dans le groupe**, format « titre + liste » (décidé le 21/11/2026, remplace « une ligne par présent ») :

   ```text
   📋 Maraude – mardi 25/11 à 19:00 – Gare de Lyon
   • Durand Bob – 06 12 34 56 78
   • Martin Alice – 06 11 22 33 44
   ```

   Avec des créneaux : un bloc « 🕒 créneau » par créneau (ordre du sondage), les présents en dessous ; une personne sur deux créneaux est dans les deux ; créneau vide → « ⚠️ personne » ; créneau inconnu (renommé après le vote) → bloc « 🕒 autre créneau » à la fin.

   - Seuls les confirmés apparaissent. Les personnes sans réponse ou désistées sont retirées de la liste finale, mais restent visibles dans l'onglet **Absents** du Sheet.
   - S'il n'y a aucun confirmé : `⚠️ Maraude – 25/11 : personne n'a confirmé. Si tu peux venir, contacte le référent.`

4. Le statut de l'action passe à **Liste publiée**.

### 4.6 Désistement après 20:00 (*à confirmer*)

Une réponse « NON » (ou « je peux plus ») reçue en privé après la publication : statut **Désisté**, et le référent est prévenu en privé (`NUMERO_REFERENT` dans Paramètres).

### 4.7 Récap de la semaine : vendredi soir (déjà validé)

- `JOUR_RECAP` (vendredi) à `HEURE_RECAP` (20:30) : un message dans le groupe avec les actions du samedi au vendredi suivant et le nombre d'inscrits ou de confirmés pour chacune.
- Désactivable avec `RECAP_ACTIF = non`.
- **Pas de limite de places** pour l'instant (« plus il y en a, mieux c'est »). On ajustera plus tard si besoin, mais il faut garder une colonne **Places** facultative dans Actions.

### 4.8 Annulation et modification d'une action (décidé le 18/11/2026)

- **Annulation** : le référent met le statut **Annulée** et prévient les bénévoles **à la main**. Le bot ignore ensuite les réponses à cette annonce. Pas d'autre automatisation.
- **Modification** (date, heure, lieu) : les bénévoles sont prévenus **à la main**. Le bot ne renvoie aucun message automatique.

---

## 5. Google Sheet : onglets

> Toutes les colonnes sont repérées **par leur en-tête**, pas par leur position.

| Onglet | Colonnes | Rempli par |
|---|---|---|
| **État du bot** (1er onglet) | Élément, État, Depuis, Que faire — lignes WhatsApp (🟢/🔴), Bot (actif / en pause), Dernier passage (heure du dernier tick) | Le bot |
| **Actions** | ID, Type, Date, Heure, Lieu, Places (facultatif), Statut, Message ID (masqué) | Le référent (le reste par le bot) |
| **Bénévoles** | Téléphone (clé, E.164), Prénom, Nom, Nom WhatsApp, Nom demandé le, Inscrit le | Le bot. L'équipe peut corriger |
| **Inscriptions** | ID, Action ID, Type, Date, Heure, Lieu, Téléphone, Nom, Statut, Demande ID (masqué), Mis à jour | Le bot. **C'est la source de vérité** |
| **Présents** | Vue `QUERY` sur Inscriptions, Statut = 'Confirmé', triée par date | Formule |
| **Absents** | Vue `QUERY` sur Inscriptions, Statut parmi Désisté / Sans réponse / Non joignable (avec la raison) | Formule |
| **Paramètres** | Paramètre, Valeur, Description | L'équipe |
| **Commandes** | Commande, Lancer (case à cocher), Dernière exécution, Résultat | L'équipe coche, le bot exécute |
| **Journal** | Date, Niveau, Message (on garde les 1000 dernières lignes) | Le bot |

Le référent vérifie **Présents** et **Absents**. Pour corriger quelqu'un, il change le Statut dans **Inscriptions** (liste déroulante), et les vues se mettent à jour seules.

> **Point ouvert** : si on veut qu'il édite directement dans Présents/Absents, il faudrait répercuter dans Inscriptions. Choisir l'option la plus simple avant de coder.

> **Cohérence après modification d'une action** (date, heure, lieu changés dans Actions) : le bot recopie les nouvelles valeurs dans les inscriptions de cette action, sans envoyer de message (§4.8).

**Statuts d'action** : (vide = à annoncer) → Annoncée → Confirmations envoyées → Liste publiée ; Annulée (mise par le référent).

**Statuts d'inscription** : Inscrit → En attente → Confirmé / Désisté / Sans réponse ; Non joignable ; Retiré.

### Paramètres par défaut

Colonne Valeur au format texte.

| Paramètre | Défaut |
|---|---|
| `JOURS_AVANT_ANNONCE` | 7 |
| `HEURE_ANNONCE` | 18:00 |
| `JOURS_AVANT_CONFIRMATION` | 2 |
| `HEURE_CONFIRMATION` | 10:00 |
| `HEURE_LISTE` | 20:00 (la veille) |
| `RECAP_ACTIF` / `JOUR_RECAP` / `HEURE_RECAP` | oui / vendredi / 20:30 |
| `NUMERO_REFERENT` | (vide) |
| `TYPES_ACTIONS` | Maraude, BP, Paniers anti-gaspi, Collecte, Événement, Ménage |
| `TEXTE_ANNONCE`, `TEXTE_CONFIRMATION`, `TEXTE_VALIDATION` | Modèles avec des variables `{type}` `{date}` `{heure}` `{lieu}` `{prenom}` `{limite}` |

### Commandes manuelles (remplacent le menu Apps Script)

Onglet **Commandes** : l'équipe coche « Lancer », le bot l'exécute au tick suivant (≤ 1 min), décoche la case et écrit le résultat.

- **Annoncer maintenant** / **Envoyer les confirmations maintenant** / **Publier la liste de demain maintenant** / **Envoyer le récap maintenant**.
- **Vérifier la configuration** (connexion WhatsApp, accès au Sheet, groupe trouvé).
- **Mettre le bot en pause** / **Reprendre**.

Côté développeurs (terminal du VPS) :

- `npm run installer-sheet` : crée ou répare les onglets, en-têtes, formats texte, listes déroulantes, vues QUERY, paramètres par défaut. **Idempotent** (on peut le relancer sans risque).
- `npm run lister-groupes` : affiche les groupes WhatsApp du numéro, pour trouver `GROUPE_ID`.

---

## 6. Pièges techniques et risques (à gérer dès le départ)

- ⚠️ **Numéros masqués (LID)** : WhatsApp remplace de plus en plus les numéros par des identifiants anonymes `…@lid` dans les groupes. Il faut vérifier **dès le spike** ce que WAHA renvoie pour l'expéditeur d'un message de groupe. Si on n'a qu'un LID : correspondance LID → numéro (via WAHA si possible, ou via le premier échange en privé). C'est pour ça que `MessageRecu.telephone` peut être `null`.
- ⚠️ **Bannissement du numéro** : WAHA est non officiel, contraire aux conditions de WhatsApp. **Numéro dédié à l'asso** (jamais un numéro perso), ajouté au groupe. Espacer les messages privés (1 à 3 s entre deux), éviter les rafales, personnaliser avec le prénom.
- ⚠️ **Session WhatsApp** : le téléphone du numéro dédié doit rester actif ; si la session WAHA se déconnecte, il faut rescanner le QR code. Le bot vérifie la connexion régulièrement et **prévient le référent** (et écrit dans le Journal) si elle est perdue.
- **Oracle Cloud** : machine récupérée si jugée inactive (→ compte Pay As You Go) ; pénuries de machines ARM dans certaines régions ; vérifier que les images Docker de WAHA existent pour ARM (moteur NOWEB ou GOWS, sans navigateur Chrome).
- **Webhooks** : WAHA peut renvoyer le même événement → **déduplication par ID de message** obligatoire. Le bot répond 200 tout de suite, puis traite.
- **Citations** (`citeId`) : WAHA doit fournir l'ID du message cité, sinon impossible de rattacher les réponses. À vérifier au spike.
- **Quotas de l'API Google Sheets** (≈ 60 lectures par minute et par utilisateur) : regrouper les lectures (une lecture de tous les onglets utiles par tick, `batchGet`), garder un cache court, regrouper les écritures.
- **Numéros dans le Sheet** : écrire en mode « RAW » / colonnes au format texte, sinon `0612…` devient un nombre et perd son 0. Clé interne E.164 sans `+` (`33612345678`), affichage `06 12 34 56 78`.
- **Heures et dates dans le Sheet** : lire les **valeurs affichées** (`FORMATTED_VALUE`), parser `19:00` / `19h` / `19h30` et `28/11/2026`. Comparer des clés `yyyy-MM-dd` et des heures `HH:mm` calculées dans le fuseau **Europe/Paris** (jamais l'heure du serveur, qui est en UTC).
  - Décision (étape 4a) : le bot écrit tout en **RAW** (texte tel quel, jamais de formule ni de conversion) ; les dates qu'il écrit (Inscriptions, Bénévoles, Journal) sont au format texte **`2026-11-28`** (se trie correctement dans les vues QUERY). Seule la colonne Date d'Actions, remplie à la main, est une vraie date affichée `jj/mm/aaaa` (format imposé par l'installation, quel que soit le pays du Sheet). Le code qui lit une date doit donc accepter les deux formats.
- **Formules QUERY** : écrites en syntaxe anglaise avec des virgules, même si le Sheet est en français.
- **Idempotence** : un job ne s'exécute qu'une fois grâce aux statuts des actions et à des marqueurs par jour. Un redémarrage du bot au milieu d'un job ne doit **jamais** renvoyer un message.
- **Secrets** : `.env` et clé Google jamais dans Git (vérifier `.gitignore`), jamais dans les logs.

---

## 7. Plan de développement (une étape = un commit)

> Étapes 1 à 3 de la v2 déjà faites en JavaScript Apps Script (utilitaires, harness). La v3 repart de ces acquis : la logique des utilitaires et leurs cas de test sont **portés en TypeScript**, le harness Apps Script est remplacé par des faux plus simples (on injecte les dépendances au lieu de simuler Google).
> Pas encore de numéro de test : on code d'abord tout ce qui se teste avec les faux (étapes 1 à 4, puis 6 à 11), et on fait le spike WAHA dès qu'un numéro est disponible, **avant l'étape 5**.

### Organisation Git : une branche par bloc d'étapes (décidé le 19/11/2026)

- Une **branche par bloc** ; à l'intérieur, toujours **une étape = un commit**. En fin de bloc : pull request vers `main`, fusion quand la CI est verte, suppression de la branche.
- `main` doit toujours rester propre et fonctionnel.

| Bloc | Branche | Étapes | Statut |
|---|---|---|---|
| 1 | `migration-vps-typescript` | 1, 2 | ✅ fusionné (PR #1) |
| 2 | `donnees-sheet` | 3, 4 | ✅ fusionné (PR #2) |
| 3 | `Integration_WhatsApp` | 0, 5 — **en local** (Docker Desktop, numéro de test, groupe de test) | ✅ test réel réussi le 20/11/2026 — PR à fusionner |
| 4 | `bloc-4-fonctionnalites` | 6 à 11 | terminé (fait avant le bloc 3 : pas encore de numéro de test) — PR à fusionner |
| 5 | `bloc-5-mise-en-production` | 12, 13 | |

Les blocs 3 et 4 peuvent être inversés si le numéro de test n'est pas prêt.

> **Décision (19/11/2026)** : tout le bloc 3 se fait d'abord **en local**, avec **Docker Desktop** (WAHA en conteneur, le bot lancé avec Node, webhook vers `http://host.docker.internal:3000/webhook/waha`), avec un numéro de test et un groupe de test. Le VPS Oracle n'arrive qu'au bloc 5, avec le **même** `docker-compose.yml`. Raisons : gratuit, itérations rapides, un problème à la fois (WhatsApp d'abord, serveur ensuite).

0. **Spike WAHA en local** (script jetable) : lancer WAHA dans Docker Desktop, scanner le QR code avec le numéro de test, puis vérifier :
   - envoi dans un groupe de test et récupération de l'ID du message ;
   - réception par webhook d'un message de groupe qui cite ce message : présence de l'ID cité, **vrai numéro ou LID** de l'expéditeur ;
   - envoi et réception en privé ;
   - format exact du JSON des webhooks (pour écrire l'adaptateur) ;
   - consommation mémoire et CPU sur la machine ARM.

   Compte rendu obligatoire avant de continuer.

   **Compte rendu du spike (19/11/2026, WAHA 2026.10.1 CORE, moteur GOWS, Docker Desktop)** :
   - ✅ **Citations** : une réponse citée arrive avec `payload.replyTo.id` = ID **court** du message cité (ex. `AC43B61D…`). WAHA a aussi un ID **long** (`true_<chat>_<IDcourt>_<expéditeur>`) : l'adaptateur doit toujours manipuler l'ID court (`payload._data.Info.ID`).
   - ⚠️ **LID confirmé** : dans les groupes ET en privé, l'expéditeur arrive en `…@lid` (`participant` en groupe, `from` en privé ; `AddressingMode: "lid"`).
   - ✅ **Mais le vrai numéro est fourni** par GOWS dans `payload._data.Info.SenderAlt` (`…@s.whatsapp.net`), en groupe comme en privé. → **on garde le moteur GOWS**. Si `SenderAlt` manque : `telephone = null` (déjà géré : avertissement, inscription à la main).
   - ✅ **Vérifié (démo du 23/11/2026)** : le vrai numéro arrive aussi pour un bénévole **absent des contacts** du bot (vote dans le groupe de test). Inutile d'enregistrer les bénévoles en contact. Reste à vérifier dans une **communauté** (voir plus bas).
   - ✅ Nom WhatsApp dans `payload._data.Info.PushName`. Groupe : `payload.from` = `…@g.us`. Privé : `_data.Info.IsGroup = false`.
   - ✅ Les messages envoyés par le compte du bot arrivent aussi (`fromMe: true`) → en production, s'abonner à l'événement `message` (sans les siens) et filtrer `fromMe` par sécurité.
   - Événement `session.status` : STARTING → SCAN_QR_CODE → WORKING (utile pour la surveillance).
   - Non testé : l'ENVOI par l'API (format de la réponse de `sendText`) → vérifié pendant l'étape 5. Consommation sur ARM → au bloc 5.

7b. ~~**OUI sans citation dans le groupe**~~ — **remplacé le 20/11/2026 par le sondage seul (S3)** : les messages texte du groupe sont désormais tous ignorés. Seul reste valable : un **NON en privé** d'un « Inscrit » (avant les confirmations) le retire. Ancienne règle, pour mémoire (compromis validé le 19/11/2026) : un message **court** (≤ 3 mots) détecté comme OUI, **sans citation**, est accepté **s'il n'y a qu'une seule action ouverte** (Annoncée ou Confirmations envoyées, pas encore passée) ; le bot inscrit et envoie en privé « ✅ C'est noté, tu es inscrit(e) pour … Si ce n'était pas pour ça, réponds NON. » (sauf si la demande de confirmation part déjà). S'il y a **plusieurs** actions ouvertes : pas d'inscription, message privé demandant de citer l'annonce. Un NON sans citation dans le groupe reste ignoré (trop ambigu en conversation) ; un **NON en privé** d'un « Inscrit » (avant les confirmations) le retire.
1. **Migration vers TypeScript** : `package.json`, `tsconfig.json` (strict), Vitest, scripts `npm run verifier` (types + tests), CI mise à jour ; suppression des fichiers Apps Script (`appsscript.json`, clasp, harness Google) ; portage des utilitaires (dates, téléphones, textes, détection oui/non) et de leurs tests.
2. **Configuration** : `config.ts` (lecture et vérification du `.env`, message clair si une variable manque), `constantes.ts`, `.env.example`, logger console.
3. **Ports et faux** : interfaces `Messagerie`, `Horloge`, `Tableur` ; faux en mémoire pour les tests (faux Sheet, fausse messagerie, horloge contrôlée).
4. **Couche Google Sheets**, en deux commits :
   - **4a — connexion et installation** : implémentation Google du `Tableur` (lecture des valeurs affichées, écriture RAW), schéma des onglets (`sheets/schema.ts`), `npm run installer-sheet` (idempotent), guide `docs/compte-service-google.md`.
   - **4b — modules par onglet** : Actions, Bénévoles, Inscriptions, Paramètres (lecture typée), Journal (écriture + 1000 lignes max), génération d'ID.
5. **Adaptateur WAHA + serveur** : envoi, citation, groupes, vérification de connexion, conversion des webhooks en `MessageRecu`, gestion des LID, déduplication, état local ; serveur Express (`/webhook/waha`, `/sante`) ; script `lister-groupes`.
   - **Test réel réussi (20/11/2026, en local, numéro perso + 1 testeuse)** : annonce dans le groupe → OUI cité → inscription + demande de confirmation et de nom en privé → nom enregistré → OUI en privé → Confirmé → liste finale dans le groupe + confirmation finale en privé. Corrigé pendant le test : verrou contre deux bots lancés en même temps (`data/bot.lock`), résultat explicite quand « Annoncer maintenant » ne publie rien, ligne « Bot » du tableau de bord mise à 🟢 au démarrage, cases à cocher limitées aux 7 commandes.
   - **Correction (20/11/2026)** : `src/metier/synchronisation.ts` — à chaque tick (même en pause), les copies type / date / heure / lieu des inscriptions sont remises d'accord avec leur action modifiée par le référent, en une seule écriture, sans aucun message (§4.8) ; statuts et noms jamais touchés.
   - Fait : `src/whatsapp/waha.ts` (`MessagerieWaha` + `convertirWebhook`, numéro via `SenderAlt`, ID court, `fromMe` ignoré, groupes GOWS `JID`/`Name`), `src/serveur.ts` (répond 200 avant de traiter), `src/index.ts` (assemble tout : `npm start`), `npm run lister-groupes`, mémoire anti-doublon persistée dans `data/etat.json`. Tests sur des webhooks anonymisés reproduisant la structure réelle ; vérifié sur les vrais enregistrements du spike (supprimés ensuite). WAHA abonné aux événements `message,session.status`.
6. **Planificateur et annonces J-7** (avec rattrapage). Décisions : rattrapage automatique jusqu'à J+(`JOURS_AVANT_CONFIRMATION` + 1) ; aucun envoi automatique après 22:00 (`HEURE_FIN_ENVOIS_AUTO`) ; marqueur « envoi-en-cours » écrit avant chaque annonce pour ne jamais renvoyer en double après un plantage ; un même avertissement n'est écrit qu'une fois par heure dans le Journal.
7. **Réception** : réponses citées dans le groupe (oui / non), demande de nom en privé aux numéros inconnus. Décisions : NON dans le groupe → « Retiré » si Inscrit, « Désisté » si déjà En attente / Confirmé ; OUI après un NON → la même ligne repasse à Inscrit ; après réception du nom, le bot répond « Merci {prenom}, c'est noté ! » ; un message privé qui ne ressemble pas à un nom est ignoré (noté dans le Journal) ; tick et messages passent par une file d'attente commune (jamais deux écritures simultanées dans le Sheet).
8. **Confirmations J-2** et lecture des réponses en privé (une ou plusieurs demandes en attente). Décisions : rattrapage si le bot était arrêté (envoi dès que possible, au plus tard la veille avant `HEURE_LISTE`) ; aucun envoi automatique avant 08:00 ni après 22:00 ; marqueur posé sur toutes les inscriptions en une écriture, résultats écrits par paquets de 10 (quota Google) ; changement d'avis en privé possible tant que la liste n'est pas publiée ; après la liste, plus de changement automatique (le référent corrige à la main) ; plusieurs demandes sans citation → le bot demande de citer ; un « Désisté » qui redit OUI dans le groupe reçoit une nouvelle demande.
9. **J-1 à 20:00** : sans réponse, message « Nous vous confirmons… », liste finale dans le groupe. Décisions : ordre = Sans réponse → statut « Liste publiée » (écrit AVANT l'envoi, anti-doublon ; remis si l'envoi échoue) → liste dans le groupe (triée par nom) → messages privés aux confirmés ; rattrapage le jour même de 08:00 jusqu'à l'heure de l'action ; si les confirmations ne sont jamais parties (action encore « Annoncée »), pas de liste vide trompeuse : avertissement à l'équipe.
10. **Désistement tardif** → référent, **récap du vendredi**, **onglet Commandes**, alerte si WhatsApp déconnecté. En deux commits : **10a** (désistement tardif + récap) et **10b** (commandes + alerte).
   - 10b, décisions : commande décochée + « en cours… » AVANT exécution (jamais relancée en boucle) ; case lue « TRUE » ou « VRAI » (langue du Sheet), décochée en vidant la cellule ; pause = plus d'envoi automatique (commandes manuelles et réception des réponses continuent) ; tableau de bord « État du bot » en 1er onglet, alerte WhatsApp seulement au changement d'état (contrat `Alertes` + `combinerAlertes` prêt pour l'e-mail) ; « Dernier passage » écrit à chaque tick (détecte un bot/VPS arrêté).
   - 10a, décisions : NON en privé d'un Confirmé après la liste (action pas encore passée) → Désisté + accusé + message au référent (avertissement Journal si pas de `NUMERO_REFERENT`) ; OUI après la liste → rien (le référent gère) ; récap = demain → J+7, sans les actions annulées, « N confirmés » / « N inscrits » / « pas encore annoncée » ; semaine vide → pas de message ; anti-doublon du récap via l'état local `data/etat.json` (créé dès 10a, écriture atomique). Décision (19/11/2026) : l'alerte « WhatsApp déconnecté » est d'abord **visible dans le Sheet** (bandeau rouge bien en vue, avec l'heure de la déconnexion, + Journal) ; un envoi d'e-mail au référent pourra être ajouté plus tard si besoin (WhatsApp étant justement indisponible, on ne peut pas prévenir par WhatsApp).
11. **Test de bout en bout** : une semaine complète simulée avec les faux (`npm test`). Fait dans `tests/semaine.test.ts` : une quinzaine réelle (tick toutes les 15 min pendant 12 jours), 5 bénévoles, 2 actions, changements d'avis, inscription tardive, désistement tardif ; vérifie chaque message envoyé dans l'ordre exact. Vérifié qu'il attrape un bug d'annonce en double (164 messages au lieu de 6).
12. **Déploiement** : `Dockerfile`, `docker-compose.yml` (WAHA + bot, volumes, redémarrage automatique), installation sur le VPS Oracle, sauvegarde de la session WAHA ; test réel dans un groupe WhatsApp de test avec le numéro dédié. En trois commits :
   - **12a — le bot dans Docker** (testé en local) : `Dockerfile` (node:24-slim, `npm ci --omit=dev`, utilisateur `node`, sans .env ni secrets dans l'image), `.dockerignore`, service `bot` dans `docker-compose.yml` (réseau interne : bot → `http://waha:3000`, WAHA → `http://bot:3000/webhook/waha` ; aucun port du bot ouvert ; clé Google montée en lecture seule ; état dans le volume Docker `donnees-bot` ; `init: true` ; healthcheck sur `/sante` ; logs limités à 3 × 10 Mo). **Les images WAHA ne sont pas multi-architecture** : `WAHA_IMAGE` = `devlikeapro/waha:gows-2026.10.1` (PC) ou `gows-arm-2026.10.1` (Oracle ARM), version fixée, jamais `latest`. Swagger protégé par le mot de passe du tableau de bord. Mode développement (`npm start` + WAHA seul) décrit dans `.env.example`.
   - **12b — VPS Oracle** : guide pas à pas et déploiement.
   - **12c — exploitation** : sauvegarde de la session WhatsApp, mise à jour du bot.
   - README (architecture + utilisation) refait à l'étape 13, une fois les commandes de production définitives.
13. **Documentation** : README pour l'asso (utilisation au quotidien par le référent) + guide d'exploitation pour les mainteneurs (mise à jour, rescanner le QR code, sauvegardes, que faire si WhatsApp casse).

### À faire avant la mise en production (décidé le 20/11/2026)

- **Le groupe de l'asso est une Communauté WhatsApp** (« Ummanite », canal *Announcements* : seuls les admins publient, les membres peuvent répondre). Conséquences :
  - le **numéro dédié du bot** doit être ajouté à la communauté puis **nommé administrateur** (par un admin actuel) ;
  - dans une communauté, les numéros des membres sont souvent **masqués** (visibles des admins seulement) → **à tester** : le bot admin obtient-il le vrai numéro (`SenderAlt`) des membres qui répondent ou votent ? (Dans un groupe classique, c'est vérifié, même pour des non-contacts.)
  - à tester aussi : réponses citées et votes dans un canal d'annonces (comportement possiblement différent d'un groupe classique).
  - **Test en communauté (23/11/2026)** : l'annonce et le sondage partent bien dans le canal d'annonces (`GROUPE_ID` = le sous-groupe `IsAnnounce: true`, `IsDefaultSubGroup: true` ; pas la communauté elle-même, `IsParent: true`). Mais le canal est **incognito** : les votes arrivent avec un LID **sans** `SenderAlt`, et la liste des participants ne donne pas les numéros, même au bot admin.
  - **S9 fait — numéro masqué** : (A) `Messagerie.retrouverTelephone(idBrut)` → annuaire LID → numéro de WAHA (`GET /api/{session}/lids/{lid}` → `{ lid, pn }`, appris au fil des échanges : contacts, conversations privées, groupes classiques) ; (B) sinon, le vote est mis de côté (état local `votes-en-attente:<LID>`, un vote par sondage, le plus récent) et le bot envoie la demande de nom **en privé à l'identifiant masqué** ; quand la personne répond en privé, WhatsApp donne son vrai numéro → fiche Bénévoles créée (nom déjà demandé), votes rejoués (`rejouerVotesEnAttente`), puis sa réponse traitée comme un nom. Si le message privé ne part pas : avertissement « à inscrire à la main » avec l'identifiant. Même traduction appliquée aux messages privés reçus sans numéro.
  - ✅ (A) vérifié en réel le 23/11/2026 : un vote masqué dans le canal d'annonces → numéro retrouvé par l'annuaire WAHA, inscription normale, messages privés OK.
  - ⚠️ À vérifier en réel : (B) avec un membre de la communauté qui n'a **jamais** échangé avec le numéro du bot (envoi d'un message privé à un LID, et `SenderAlt` présent dans sa réponse).
  - **Nom plus strict (23/11/2026, test réel : « tcdjib » seul était enregistré comme prénom)** : `lireNomComplet` exige **prénom ET nom** (2 à 4 mots) ; chaque mot de 3 lettres ou plus doit contenir une voyelle (« Ng » reste accepté). Sinon → message « je suis un robot » (S7). Un charabia de 2 mots plausibles reste indétectable : l'équipe corrige dans Bénévoles (S8).
- **Sondages WhatsApp** (demandé le 20/11/2026, à valider avec la responsable) : remplacer (ou compléter) le « OUI en citant l'annonce » par un **vrai sondage WhatsApp**, comme ceux que la responsable fait à la main (ex. « dispo de 10h à 13h / dispo de 13h à 16h / pas dispo :/ »).
  - Côté Sheet : nouvelle colonne facultative **Créneaux** dans Actions (ex. `10h-13h, 13h-16h`) ; vide → « dispo / pas dispo ». Nouvelle colonne **Créneau** dans Inscriptions (et dans Présents / la liste finale, regroupée par créneau).
  - Côté WAHA : `POST /api/sendPoll` (envoi) et événement `poll.vote` (votes, y compris changement ou retrait de vote) — présents dans WAHA 2026.10.1, **support par le moteur GOWS à vérifier**.
  - Vote pour un créneau → inscription (avec le créneau) ; « pas dispo » ou vote retiré → Retiré ; le « OUI » cité reste en secours.
  - Étapes : **spike sondages** (groupe de test, puis communauté de test) → adaptateur (envoi + votes) → code métier (créneaux partout). Estimation : 2 à 3 étapes.
  - **Spike sondages (20/11/2026, groupe de test, GOWS) — concluant** :
    - `POST /api/sendPoll` `{ session, chatId, poll: { name, options, multipleAnswers } }` → ID long ; ID court du sondage = 3e morceau (ex. `3EB06AE4…`).
    - Événement `poll.vote` : `payload.vote.selectedOptions` = **libellés en clair** (WAHA déchiffre) ; `payload.poll.id` = ID du sondage (court au 3e morceau, aussi dans `_data.Message.pollUpdateMessage.pollCreationMessageKey.ID`) ; vrai numéro dans `_data.Info.SenderAlt`, nom dans `PushName`.
    - **Chaque vote = l'état COMPLET des choix** de la personne (ajout d'un créneau → les deux ; décocher tout → `[]`). Donc : créneaux cochés → inscrit(e) sur ces créneaux ; `[]` ou « pas dispo » → Retiré.
    - Plusieurs votes peuvent arriver dans la même seconde → garder l'horodatage du dernier vote par (sondage, personne) et ignorer un vote plus ancien.
    - Les votes du compte du bot arrivent aussi (`vote.fromMe = true`) → à ignorer.
    - Pas de `poll.vote.failed` observé. Reste à tester : **dans une communauté** (canal d'annonces).
  - **Décisions (20/11/2026)** : **sondage seul** (plus d'inscription par « OUI » en texte dans le groupe ; les réponses en privé restent en texte) ; **plusieurs créneaux par personne** (inscrite une fois, colonne Créneau = « créneau 1, créneau 2 », visible sur chaque créneau dans la liste finale).
  - **S1 fait** (Sheet) : colonne verte **Créneaux** (Actions, ≤ 11 créneaux, pas de doublon), colonne **Créneau** (Inscriptions, Présents, Absents), paramètres `OPTION_DISPO` (« dispo !! ») et `OPTION_PAS_DISPO` (« pas dispo :/ »), nouveau `TEXTE_ANNONCE` (« 👇 Votez dans le sondage ci-dessous ») ; l'installation remplace l'ancien texte d'annonce seulement s'il n'a pas été personnalisé (`ANCIENNES_VALEURS_PAR_DEFAUT`).
  - **S2 fait** : l'annonce = TEXTE_ANNONCE puis, 2 s après, le **sondage** (question « {type} – {date} à {heure} » ; créneaux + « pas dispo », plusieurs réponses si ≥ 2 créneaux ; sinon « dispo » / « pas dispo », une réponse) ; l'action garde l'**ID du sondage** dans Message ID ; si le texte part mais pas le sondage → pas de renvoi automatique (marqueur conservé, erreur claire au Journal). Contrat `Messagerie.envoyerSondage`.
  - **S3 fait** : les votes deviennent des inscriptions (`src/metier/votes.ts`, logique commune dans `src/metier/inscription.ts`) ; plus aucune inscription par texte dans le groupe (`reception.ts` ignore tout message de groupe, sans même lire le Sheet).
    - Vote = état complet : créneau(x) coché(s) → inscrit(e), colonne Créneau = « c1, c2 » (ordre du sondage) ; « dispo » → inscrit(e) sans créneau ; « pas dispo » ou `[]` → Retiré (Désisté si déjà En attente / Confirmé). Un créneau ET « pas dispo » cochés : le créneau l'emporte.
    - Changement de créneau d'un Inscrit / En attente / Confirmé : statut gardé, créneau mis à jour (« Créneau modifié » au Journal). Un Retiré garde son dernier créneau (on voit quel créneau a perdu quelqu'un).
    - Vote après l'envoi des confirmations → demande de confirmation immédiate (comme l'ancien « OUI » tardif). Vote sur une action Annulée / Liste publiée, autre groupe, sondage inconnu → ignoré (info Journal). Numéro masqué → avertissement.
    - Anti-doublon par ID de vote + horodatage du dernier vote par (sondage, personne) dans `data/etat.json` (clé `votes:<sondage>`) : un vote plus ancien arrivé en retard est ignoré. `poll.vote.failed` → avertissement au Journal.
    - Créneaux affichés : ligne « 🕒 Créneau : … » dans la demande de confirmation et la validation finale ; liste finale regroupée par créneau (une personne sur 2 créneaux apparaît 2 fois ; créneau inconnu → listé à la fin) ; récap « 2 confirmés (c1 : 1, c2 : 2) ».
    - Tests : `votes.test.ts`, `creneaux.test.ts`, `convertirWebhookVote` (exemple anonymisé `voteSondage`), routage des votes dans le serveur, quinzaine réécrite avec des votes (BP à 2 créneaux).
    - Corrigé au test réel (20/11) : un créneau « pas dispo » écrit par le référent dans Créneaux est ignoré (`veutDirePasDispo`), sinon le voter réinscrivait la personne.
  - **Décisions (21/11/2026), après le test réel** :
    - **S4 fait** : liste finale au format « titre + liste » (voir §4.5).
    - **S5 fait** : quand « Envoyer les confirmations maintenant » ou « Publier la liste de demain maintenant » n'envoie rien, la colonne Résultat explique pourquoi (`expliquerAucuneConfirmation`, `expliquerAucuneListe`, calculées sur l'état des actions AVANT la commande) : trop tôt (à partir de quelle date), personne d'inscrit, confirmations pas encore parties, liste déjà publiée, prochaine action.
    - **S6 fait** : demande de confirmation à J-2 = texte (`TEXTE_CONFIRMATION`, « 👇 … Réponds dans le sondage ci-dessous ») + 2 s + **sondage privé** « {type} – {date} à {heure} : tu confirmes ? » avec `OPTION_CONFIRMER_OUI` (« ✅ Oui, je serai là ») / `OPTION_CONFIRMER_NON` (« ❌ Non, je ne peux plus »), une seule réponse.
      - « Demande ID » de l'inscription = ID du **sondage** ; un vote hors du groupe est cherché parmi les Demande ID (`traiterVoteConfirmation` dans `votes.ts`) → pas besoin du numéro (marche même avec un LID), ni de citation quand on a plusieurs demandes.
      - Mêmes règles que le texte (`appliquerReponse`) : avant la liste, Oui → Confirmé / Non → Désisté (changement d'avis possible) ; accusé seulement si le statut change (pas un message par clic) ; vote retiré → rien. Après la liste : Non d'un Confirmé → désistement tardif + référent (`enregistrerDesistementTardif`) ; le reste → ignoré (info).
      - Le **OUI / NON écrit reste accepté** en secours. Si le texte part mais pas le sondage : « En attente » avec l'ID du texte (avertissement), la personne répond par écrit.
      - L'ancien `TEXTE_CONFIRMATION` (« Réponds OUI ou NON ») est remplacé à l'installation s'il n'a pas été personnalisé.
      - ⚠️ Sondages en **conversation privée jamais testés en réel** (seulement dans un groupe) → à vérifier au prochain test.
  - **Démo à l'équipe (23/11/2026)** : réussie. Retours → S7.
    - **S7 fait — demande de nom plus robuste** : un nouveau bénévole = numéro absent de Bénévoles (la question n'est posée qu'une fois, « Nom demandé le »). Une réponse qui n'est pas un nom (question, emoji, chiffres, plus de 4 mots, ou un mot de `MOTS_PAS_UN_NOM` : « salut », « merci », « je sais pas »…) n'est pas enregistrée ; le bot répond `MESSAGES.NOM_INCOMPRIS` (« Je suis un robot 🤖… écris juste ton prénom et ton nom… pour une question, contacte le référent au … »), **2 fois maximum** par personne (clé `nom-incompris:<tél>` de l'état local). Le numéro du référent (`NUMERO_REFERENT`) n'apparaît QUE dans ce message, pour qu'il ne soit pas sollicité pour rien ; sans numéro → « un responsable de l'association ». Nom déjà connu → les messages privés quelconques restent sans réponse.
    - **S8 fait — les noms se corrigent dans Bénévoles** : à chaque tick (même en pause, sans aucun message), `synchronisation.ts` recopie le nom de Bénévoles (`nomPourListe`) dans les inscriptions **d'aujourd'hui et à venir** (l'historique ne bouge pas), seulement si le bénévole a un prénom ou un nom. Une correction faite directement dans Inscriptions est donc remplacée par celle de Bénévoles. Une seule écriture pour tous les changements (actions + noms).

### Améliorations prévues (après la mise en service)

14. **Alerte par e-mail au référent** (demandé le 19/11/2026 ; adresse du référent à fournir) : quand WhatsApp est déconnecté ou qu'une erreur grave se répète, envoyer un e-mail en plus de l'alerte dans le Sheet.
   - Préparé dès l'étape 10 : contrat `Alertes` (comme `Messagerie`), première implémentation « Sheet » ; l'e-mail sera une seconde implémentation branchée à côté, sans toucher au code métier.
   - Pistes (à valider le moment venu, nouvelle dépendance à justifier) : SMTP Gmail d'un compte de l'asso avec un « mot de passe d'application » (validation en 2 étapes obligatoire) + bibliothèque `nodemailer` ; ou un service d'envoi gratuit (ex. Brevo, quelques centaines d'e-mails/jour). Le compte de service Google ne peut pas envoyer d'e-mails Gmail (sauf Google Workspace avec délégation).
   - Variables `.env` à prévoir : `ALERTE_EMAIL_DESTINATAIRE`, identifiants SMTP (secrets).
   - Anti-spam : une alerte par problème et par période (comme l'anti-répétition du Journal), plus un e-mail « c'est réparé ».
15. **Données des actions passées** (évoqué le 21/11/2026, reporté : « du détail, on verra plus tard ») : aujourd'hui rien ne s'efface, Présents / Absents montrent tout l'historique.
   - Option A (recommandée d'abord) : filtrer les vues QUERY sur les actions d'aujourd'hui et à venir (garder ~3 jours après l'action), sans rien supprimer.
   - Option B (plus tard, selon le volume réel) : archivage automatique des actions passées depuis plus de N jours vers des onglets « Archive Actions » / « Archive Inscriptions ».
   - Écarté : supprimer les données (perte de l'historique, utile pour la phase 2).

---

## 8. Critères de réussite

- [ ] Le référent ne fait que remplir l'onglet **Actions** et vérifier **Présents/Absents**.
- [ ] Les bénévoles n'ont qu'à **voter dans le sondage** de l'annonce, puis répondre **OUI** à la confirmation.
- [ ] **Aucun doublon** de message, même si le bot redémarre ou si WAHA renvoie un webhook.
- [ ] On change de fournisseur WhatsApp en écrivant un nouvel adaptateur, **sans toucher au code métier**.
- [ ] Tout tourne sur le VPS gratuit ; aucun secret dans le repo.
- [ ] `npm test` simule une semaine complète et passe ; la CI est verte.
