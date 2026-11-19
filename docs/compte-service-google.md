# Créer le compte de service Google (accès du bot au Sheet)

Le bot ne se connecte pas avec ton compte Google : il utilise un **compte de service**, un compte « robot » qui a sa propre adresse e-mail (`…@….iam.gserviceaccount.com`). On partage le Sheet avec cette adresse, exactement comme on le partagerait avec une personne.

Durée : environ 10 minutes, à faire une seule fois.

> Les intitulés exacts de la console Google changent de temps en temps. Si un bouton n'a pas tout à fait le même nom, cherche l'équivalent le plus proche.

## 1. Créer un projet Google Cloud

1. Va sur <https://console.cloud.google.com> et connecte-toi (compte de l'asso pour la production, ton compte pour les tests).
2. En haut à gauche, clique sur le sélecteur de projet → **Nouveau projet**.
3. Nom : `planning-benevoles` → **Créer**. Vérifie ensuite que ce projet est bien sélectionné en haut.

C'est gratuit : l'API Google Sheets n'est pas facturée.

## 2. Activer l'API Google Sheets

1. Menu ☰ → **API et services** → **Bibliothèque**.
2. Cherche **Google Sheets API** → clique dessus → **Activer**.

## 3. Créer le compte de service

1. Menu ☰ → **IAM et administration** → **Comptes de service** → **Créer un compte de service**.
2. Nom : `bot-benevoles` → **Créer et continuer**.
3. Étapes « Autorisations » et « Accès des utilisateurs » : **ne rien mettre**, cliquer **Continuer** puis **OK**. (Le bot n'a besoin d'aucun droit sur le projet : il aura seulement accès au Sheet qu'on lui partage.)
4. Note l'adresse e-mail du compte, du type `bot-benevoles@planning-benevoles.iam.gserviceaccount.com`.

## 4. Télécharger la clé

1. Clique sur le compte de service → onglet **Clés** → **Ajouter une clé** → **Créer une clé** → **JSON** → **Créer**.
2. Un fichier `.json` se télécharge. **C'est un secret** : quiconque l'a peut modifier le Sheet.
3. Place-le dans le projet sous le nom `secrets/compte-service.json` (crée le dossier `secrets/`). Ce dossier est ignoré par Git : la clé ne partira jamais sur GitHub.

> ⚠️ Ne jamais commiter ce fichier, ne jamais l'envoyer par messagerie ou par e-mail. En cas de fuite : supprimer la clé dans la console (onglet **Clés**) et en créer une nouvelle.

> Si la création de clé est **bloquée** (message sur une « règle d'administration » `iam.disableServiceAccountKeyCreation`) : c'est une protection appliquée à certains comptes Google Workspace. Avec un compte Gmail personnel, ça n'arrive normalement pas. Sinon, il faut qu'un administrateur du Workspace de l'asso lève cette règle pour le projet.

## 5. Partager le Sheet avec le compte de service

1. Crée un Google Sheet vide (pour les tests : un Sheet « Planning bénévoles (test) »).
2. Bouton **Partager** → colle l'adresse e-mail du compte de service → rôle **Éditeur** → décoche « Envoyer une notification » → **Partager**.
3. Copie l'**ID du Sheet** dans son URL :
   `https://docs.google.com/spreadsheets/d/`**`1AbC…xYz`**`/edit` → l'ID est la partie en gras.

## 6. Configurer et installer

```bash
cp .env.example .env
```

Dans `.env`, remplis `GOOGLE_SHEET_ID=` avec l'ID copié. (Les variables WhatsApp ne sont pas nécessaires pour cette étape.)

```bash
npm run installer-sheet
```

Résultat attendu : la liste des onglets créés, des paramètres ajoutés, etc. Ouvre le Sheet : tous les onglets sont là.

L'onglet **« Feuille 1 »** (créé par Google avec tout Sheet neuf) ne sert pas : supprime-le à la main (clic droit sur l'onglet → Supprimer). Le script ne supprime jamais d'onglet, par sécurité.

Relance la commande : elle doit répondre « Tout était déjà en place ». C'est normal, l'installation est **sans danger** et peut être relancée à tout moment (par exemple après avoir changé `TYPES_ACTIONS` dans Paramètres, pour mettre à jour la liste déroulante des types).

## En cas d'erreur

| Message | Solution |
|---|---|
| « Accès refusé au Google Sheet » | Le Sheet n'est pas partagé avec l'e-mail du compte de service (étape 5), ou pas en Éditeur. |
| « Google Sheet introuvable » | `GOOGLE_SHEET_ID` incorrect dans `.env`. |
| « Fichier de clé Google introuvable » | La clé n'est pas dans `secrets/compte-service.json`, ou `GOOGLE_FICHIER_CLE` pointe ailleurs. |
| « Google Sheets API has not been used in project… » | L'API n'est pas activée (étape 2). Attendre une minute après l'activation. |
