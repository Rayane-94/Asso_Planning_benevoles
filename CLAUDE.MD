# Projet : Bot planning bénévoles (WhatsApp + Google Sheet)

> Ce fichier contient tout le contexte du projet. Il est à la racine du repo : Claude Code le lit automatiquement à chaque session.
>
> **Version 2 (18/11/2026)** : messagerie WhatsApp via une API hébergée appelée en HTTP. Telegram est abandonné.

---

## 0. Mode de travail (à respecter)

- C'est moi (Rayane) qui code et qui commit. Tu m'accompagnes **étape par étape : une étape correspond à un commit**.
- Avant chaque étape, explique brièvement ce qu'on fait et pourquoi. Ensuite, on code. Puis tu me proposes un message de commit (**Conventional Commits, en français**).
- **Attends ma validation** avant de passer à l'étape suivante. Ne génère jamais tout le projet d'un coup.
- Si une décision n'est pas couverte par ce fichier, **pose-moi la question** au lieu de deviner.
- Le code doit rester lisible par un dev junior qui reprendrait le projet pour l'asso. **Commentaires en français.**

---

## 1. Contexte

Une association (humanitaire) organise des actions avec ses bénévoles. Il existe déjà un groupe WhatsApp qui réunit tous les bénévoles (10 à 50 personnes). Aujourd'hui, une responsable fait tout à la main : annonces, relevé des « oui », messages de confirmation, planning Excel, liste finale tapée à la main.

**Objectif** : automatiser ce process de bout en bout, de façon simple.

**Types d'actions** : Maraude, BP (Blue Project, la partie du projet où on fait le tri), Paniers anti-gaspi, Collecte, Événement / Salon, Ménage.

### Hors périmètre (phase 2, ne pas coder maintenant)

L'accueil des nouveaux bénévoles : message automatique, transcription et résumé IA de l'appel, redirection vers le bon pôle. Garder une architecture propre pour l'ajouter plus tard, sans plus.

---

## 2. Contraintes

- **100 % gratuit** : projet associatif, aucun serveur payant.
- **WhatsApp via une API non officielle hébergée**, appelée en HTTP, gratuite. En plan B, un fournisseur payant du même type si la gratuite casse. Le code doit donc permettre de **changer de fournisseur facilement** (voir [§3.2](#32-couche-whatsapp-interchangeable-adaptateur)).
- **Google Sheets comme tableau** : l'équipe consulte et corrige. Exportable en `.xlsx`.
- Format de la liste finale **volontairement minimaliste** (voir [§4.5](#45-j-1-à-2000-heure_liste--confirmation-finale-et-liste)).
- **Aucune maintenance technique pour l'asso** : réglages dans le Sheet.

---

## 3. Stack et architecture

### 3.1 Base

- **Google Apps Script** attaché au Google Sheet (container-bound), runtime **V8**, fuseau **Europe/Paris**. Hébergement gratuit chez Google, sans serveur. Le script tourne sous le compte Google de l'asso.
- **Repo GitHub et clasp** (`@google/clasp`) : je code dans `src/`, puis `clasp push`. Le fichier `.clasp.json` (`"rootDir": "src"`) est gitignoré, avec un `.clasp.json.example` commité.
- **Tests locaux avec Node** (`node --test`, zéro dépendance) : faux `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`, `Utilities`, `LockService`, `ScriptApp`, plus un faux fournisseur WhatsApp, le tout dans un contexte `vm` avec une horloge contrôlée. On simule une semaine complète.
- **Déclencheur temporel toutes les minutes** qui lance `tick()` : réception des messages, puis jobs planifiés (annonces, confirmations, listes, récap).
  - `LockService` évite les exécutions simultanées.
  - Chaque étape de `tick()` est isolée dans un `try/catch` qui log dans l'onglet **Journal**.

### 3.2 Couche WhatsApp interchangeable (adaptateur)

Tout le code métier passe par une **interface unique `WA`**. Un fichier par fournisseur (`WA_<Fournisseur>.js`). Le fournisseur actif est choisi par la Script Property `WA_PROVIDER`.

```js
WA.sendText(to, text, { quotedId })  // -> messageId   (to = ID de groupe ou numéro E.164, ex. "33612345678")
WA.fetchIncoming()                   // -> [IncomingMessage]  messages reçus depuis le dernier appel
WA.listGroups()                      // -> [{ id, name }]
WA.ping()                            // -> { ok, number }     vérifie la connexion de l'instance
```

`IncomingMessage` normalisé :

```js
{
  id,
  chatId,
  isGroup,
  fromPhone,   // E.164 sans +
  fromRaw,     // JID brut
  pushName,
  text,
  quotedId,
  timestamp
}
```

- **Réception : polling** si le fournisseur le permet (endpoint de type « lire / acquitter les notifications » ou « lister les messages depuis X »). Les webhooks vers un Web App Apps Script posent problème : Apps Script répond par une **redirection 302**, que beaucoup de services prennent pour un échec, et ils renvoient alors le même message (doublons).
- Si le fournisseur n'offre que le webhook : `doPost(e)` dans un Web App, plus une **déduplication obligatoire** par ID de message.
- **Dans tous les cas, déduplication par `message.id`**, avec les IDs déjà traités conservés en cache (`CacheService` ou Script Properties, par exemple les 500 derniers).
- Les formats d'ID propres au fournisseur (`…@c.us`, `…@s.whatsapp.net`, `…@g.us`) **restent dans l'adaptateur uniquement**.

### 3.3 Secrets et état (Script Properties, jamais dans le code)

- `WA_PROVIDER`, `WA_API_URL`, `WA_INSTANCE_ID` (si besoin), `WA_API_TOKEN`, `GROUP_ID`
- L'état interne : offset ou curseur de réception, marqueurs « déjà fait aujourd'hui », cache d'IDs traités.

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
- **rattrapage** : une action ajoutée tard est annoncée le soir même si sa date est **≥ J+3** ; plus proche que ça, seulement via le menu « Annoncer maintenant ».

Texte de l'annonce (modifiable dans Paramètres) :

```text
📣 BP – samedi 29/11 à 14:00 – Entrepôt
Pour participer, répondez OUI en citant ce message (appui long → Répondre).
```

L'ID du message est stocké dans l'action, et le statut passe à **Annoncée**.

### 4.3 Réponses dans le groupe

- Le bot ne traite **que les messages du groupe qui citent une annonce** (`quotedId` = ID d'une annonce). Tout le reste du groupe est ignoré.
- **Texte « oui »** (oui, ok, présent, je viens, dispo, 👍, ✅, insensible à la casse et aux accents) : on crée une inscription au statut **Inscrit**. Pas de doublon si la personne répond deux fois.
- **Texte « non »** (non, finalement non, je peux plus…) : statut **Retiré**.
- On ne demande **PAS** nom, prénom et numéro dans le groupe. Le numéro vient de l'expéditeur du message.
- Si le numéro est **inconnu** de l'onglet Bénévoles, le bot lui écrit **une seule fois** en privé : « Bienvenue ! Pour la liste des présents, peux-tu me donner ton prénom et ton nom ? ». Sa réponse est enregistrée dans Bénévoles. En attendant, on utilise le `pushName` WhatsApp.
- Une annonce dont l'action est **publiée ou annulée** : on ignore les réponses.
- Un « oui » arrivé **après l'envoi des confirmations** (entre J-2 et J-1 20:00) : on envoie tout de suite la demande de confirmation.

### 4.4 J-2 : demande de confirmation en privé

À J-2 à `HEURE_CONFIRMATION` (par défaut 10:00), message privé à chaque **Inscrit** :

```text
Bonjour Bob 👋 Tu t'es inscrit(e) pour : BP – samedi 29/11 à 14:00 – Entrepôt.
Tu confirmes ta présence ? Réponds OUI ou NON (avant vendredi 20:00).
```

Le statut passe à **En attente**. Si l'envoi échoue : **Non joignable**.

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

3. **Liste finale dans le groupe**, au format hyper simple, une ligne par présent :

   ```text
   Maraude – 25/11 – Durand Bob – 06 12 34 56 78
   Maraude – 25/11 – Martin Alice – 06 11 22 33 44
   ```

   - Seuls les confirmés apparaissent. Les personnes sans réponse ou désistées sont retirées de la liste finale, mais restent visibles dans l'onglet **Absents** du Sheet.
   - S'il n'y a aucun confirmé : `⚠️ Maraude – 25/11 : personne n'a confirmé. Si tu peux venir, contacte le référent.`

4. Le statut de l'action passe à **Liste publiée**.

### 4.6 Désistement après 20:00 (*à confirmer*)

Une réponse « NON » (ou « je peux plus ») reçue en privé après la publication : statut **Désisté**, et le référent est prévenu en privé (`NUMERO_REFERENT` dans Paramètres).

### 4.7 Récap de la semaine : vendredi soir (déjà validé)

- `JOUR_RECAP` (vendredi) à `HEURE_RECAP` (20:30) : un message dans le groupe avec les actions du samedi au vendredi suivant et le nombre d'inscrits ou de confirmés pour chacune.
- Désactivable avec `RECAP_ACTIF = non`.
- **Pas de limite de places** pour l'instant (« plus il y en a, mieux c'est »). On ajustera plus tard si besoin, mais il faut garder une colonne **Places** facultative dans Actions.

---

## 5. Google Sheet : onglets

> Toutes les colonnes sont repérées **par leur en-tête**, pas par leur position.

| Onglet | Colonnes | Rempli par |
|---|---|---|
| **Actions** | ID, Type, Date, Heure, Lieu, Places (facultatif), Statut, Message ID (masqué) | Le référent (le reste par le bot) |
| **Bénévoles** | Téléphone (clé, E.164), Prénom, Nom, Nom WhatsApp, Nom demandé le, Inscrit le | Le bot. L'équipe peut corriger |
| **Inscriptions** | ID, Action ID, Type, Date, Heure, Lieu, Téléphone, Nom, Statut, Demande ID (masqué), Mis à jour | Le bot. **C'est la source de vérité** |
| **Présents** | Vue `QUERY` sur Inscriptions, Statut = 'Confirmé', triée par date | Formule |
| **Absents** | Vue `QUERY` sur Inscriptions, Statut parmi Désisté / Sans réponse / Non joignable (avec la raison) | Formule |
| **Paramètres** | Paramètre, Valeur, Description | L'équipe |
| **Journal** | Date, Niveau, Message (on garde les 1000 dernières lignes) | Le bot |

Le référent vérifie **Présents** et **Absents**. Pour corriger quelqu'un, il change le Statut dans **Inscriptions** (liste déroulante), et les vues se mettent à jour seules.

> **Point ouvert** : si on veut qu'il édite directement dans Présents/Absents, il faudra un `onEdit` qui répercute dans Inscriptions. Propose-moi l'option la plus simple avant de coder.

**Statuts d'action** : (vide = à annoncer) → Annoncée → Confirmations envoyées → Liste publiée ; Annulée (mise par le référent).

**Statuts d'inscription** : Inscrit → En attente → Confirmé / Désisté / Sans réponse ; Non joignable ; Retiré.

### Paramètres par défaut

Colonne Valeur au format texte (`@`).

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

### Menu « 🤖 Bénévoles » (`onOpen`)

- **Installer / réparer** : onglets, formats, validations, vues QUERY, déclencheur `tick` toutes les minutes. Idempotent.
- **Configurer l'API WhatsApp** : fournisseur, URL, token, test avec `WA.ping()`.
- **Choisir le groupe** : `WA.listGroups()`, puis saisie ou choix du groupe, stocké dans `GROUP_ID`.
- **Annoncer maintenant** / **Envoyer les confirmations maintenant** / **Publier la liste de demain maintenant** / **Envoyer le récap maintenant**.
- **Vérifier la configuration.**
- **Arrêter le bot.**

---

## 6. Pièges techniques et risques (à gérer dès le départ)

- ⚠️ **Numéros masqués (LID)** : WhatsApp remplace de plus en plus les numéros par des identifiants anonymes `…@lid` dans les groupes. Il faut vérifier **dès l'étape 0** que l'API renvoie bien le vrai numéro de l'expéditeur des messages du groupe. Sinon, prévoir une correspondance LID → numéro (via l'API si elle le permet, ou le premier échange en privé).
- ⚠️ **Bannissement du numéro** : une API non officielle est contraire aux conditions de WhatsApp. Il faut un **numéro dédié à l'asso** (jamais un numéro perso), ajouté au groupe. Espacer les messages privés (1 à 3 s entre deux, avec `Utilities.sleep`), éviter les rafales, personnaliser les messages avec le prénom.
- **Limites de l'offre gratuite** du fournisseur (messages par mois, nombre de chats, instance qui se déconnecte) : à vérifier et à documenter. `WA.ping()` dans « Vérifier la configuration », et une alerte au référent si l'instance est déconnectée.
- **Webhook et Apps Script, redirection 302** : risque de doublons. Préférer le polling, et dédupliquer par ID de message dans tous les cas.
- **La citation (`quotedId`) doit être fournie par l'API**, sinon impossible de rattacher les réponses. À vérifier à l'étape 0.
- **Numéros dans Sheets** : les écrire en texte (préfixe `'`), sinon `+33…` devient une formule et les longs nombres sont arrondis. Clé interne au format E.164 sans `+` (`33612345678`), affichage `06 12 34 56 78`.
- **Heures dans Sheets** : lire via `getDisplayValues()` (une cellule d'heure lue par `getValues()` donne une Date au 30/12/1899 avec un décalage bizarre). Parser `19:00` / `19h` / `19h30`. Colonnes Heure au format texte.
- **Dates** : comparer des clés `yyyy-MM-dd` calculées avec `Utilities.formatDate(d, 'Europe/Paris', …)`. Écrire les dates avec `Utilities.parseDate`.
- **`setFormula`** attend la syntaxe anglaise avec des virgules, même si le Sheet est en français.
- **Tests dans `vm`** : passer le `Date` de l'hôte dans le contexte (`ctx.Date = Date`), sinon `instanceof Date` échoue. Remplacer `now_()` pour contrôler l'horloge.
- **Idempotence** : un job ne s'exécute qu'une fois grâce aux statuts des actions et à des marqueurs par jour. Un tick qui plante puis se relance ne doit **jamais** renvoyer un message.
- **Quotas Apps Script** (compte gratuit) : 90 min par jour d'exécution des déclencheurs, et 6 min maximum par exécution. Un tick ≈ 1 s. Pour 50 messages privés espacés de 2 s, compter environ 100 s : OK.

---

## 7. Plan de développement (une étape = un commit)

0. **Spike API** (avant tout code métier) : avec le fournisseur gratuit, en script jetable, vérifier :
   - envoi dans le groupe et récupération de l'ID du message ;
   - réception d'un message du groupe qui cite ce message, avec le **vrai numéro** de l'expéditeur (et pas un LID) ;
   - envoi et réception en privé ;
   - polling ou webhook ;
   - limites de l'offre gratuite.

   Me faire un compte rendu avant de continuer.
1. **Init du repo** : `package.json`, `.gitignore`, `.clasp.json.example`, `src/appsscript.json` (V8, Europe/Paris, scopes : `spreadsheets.currentonly`, `script.external_request`, `script.scriptapp`, `script.container.ui`), README minimal.
2. **Config et utilitaires** : constantes, dates et heures, téléphones, modèles de texte avec variables, détection oui / non, Script Properties, Journal. Avec des tests unitaires.
3. **Harness de test** : faux services Google, faux fournisseur WhatsApp, horloge contrôlée.
4. **Couche Sheets** : lecture par en-têtes, écriture, paramètres, actions avec génération d'ID.
5. **Interface WA**, adaptateur du fournisseur gratuit et déduplication.
6. **Installation et menu** : onglets, validations, vues Présents/Absents, déclencheur, configuration de l'API, choix du groupe.
7. **Annonces J-7** (avec rattrapage).
8. **Réception** : réponses citées dans le groupe (oui / non), demande de nom en privé aux numéros inconnus.
9. **Confirmations J-2** et lecture des réponses en privé (cas d'une ou de plusieurs demandes en attente).
10. **J-1 à 20:00** : sans réponse, message « Nous vous confirmons… », liste finale simple dans le groupe.
11. **Désistement tardif** → référent, et **récap du vendredi**.
12. **Test de bout en bout** d'une semaine simulée, puis test réel dans un groupe WhatsApp de test (avec le numéro dédié).
13. **Adaptateur du fournisseur payant** (plan B), branché sur l'interface WA : bascule par `WA_PROVIDER`.
14. **README pour l'asso** : installation pas à pas, utilisation au quotidien par le référent, limites et procédure si l'API casse.

---

## 8. Critères de réussite

- [ ] Le référent ne fait que remplir l'onglet **Actions** et vérifier **Présents/Absents**.
- [ ] Les bénévoles n'ont qu'à répondre **OUI** à l'annonce, puis **OUI** à la confirmation.
- [ ] **Aucun doublon** de message, même si un tick plante ou se relance.
- [ ] On change de fournisseur WhatsApp en modifiant **une seule Script Property**.
- [ ] Tout est gratuit (hors plan B) et tourne sans serveur.
- [ ] `npm test` simule une semaine complète et passe.
