# Sentinelle : e-mail si le bot s'arrête

Le bot ne peut pas prévenir lui-même qu'il est arrêté (machine éteinte, Docker planté…).
La **sentinelle** est un petit script Google Apps Script collé dans le Google Sheet :
il tourne **chez Google**, toutes les 10 minutes, même si la machine du bot est éteinte.

Il lit l'onglet **État du bot** et envoie un e-mail :

| Situation | E-mail |
|---|---|
| « Dernier passage » a plus de 30 min de retard | 🔴 Bot arrêté |
| Ligne WhatsApp en 🔴 | 🔴 WhatsApp déconnecté |
| Le problème est réglé | 🟢 Bot reparti / 🟢 WhatsApp reconnecté |

Un seul e-mail par changement d'état. Destinataires : paramètre **`EMAIL_ALERTE`** (onglet
Paramètres, plusieurs adresses séparées par des virgules) ; vide → le compte Google qui a
installé le script. Les e-mails partent de ce compte (limite Gmail : 100 par jour, largement assez).

## Installation (une fois, ~5 minutes)

À faire avec le compte Google **propriétaire du Sheet** (celui de l'asso en production).

1. Lancer `npm run installer-sheet` (crée le paramètre `EMAIL_ALERTE`), puis le remplir dans
   l'onglet Paramètres.
2. Dans le Sheet : **Extensions → Apps Script**.
3. Remplacer le contenu de `Code.gs` par celui de [`outils/sentinelle.gs`](../outils/sentinelle.gs),
   puis 💾 Enregistrer. Renommer le projet (en haut à gauche), par ex. « Sentinelle ».
4. Dans la liste des fonctions (en haut), choisir **`installerSentinelle`** → **Exécuter**.
   - Google demande des autorisations : *Examiner les autorisations* → choisir le compte →
     *Paramètres avancés* → *Accéder à Sentinelle (non sécurisé)* → *Autoriser*.
     (« non sécurisé » veut seulement dire que le script n'a pas été vérifié par Google : c'est
     notre propre script.) Autorisations demandées : lire ce Sheet uniquement, envoyer des
     e-mails, programmer l'exécution.
5. Choisir **`envoyerEmailDeTest`** → **Exécuter** : un e-mail « Test de la sentinelle » doit arriver.

Vérification : menu de gauche ⏰ **Déclencheurs** → une ligne `verifierBot`, toutes les 10 minutes.

## Au quotidien

- Rien à faire. Pour changer les destinataires : modifier `EMAIL_ALERTE` dans le Sheet.
- Après une modification de `outils/sentinelle.gs` : recoller le code (étape 3), enregistrer.
- Pour arrêter la sentinelle : ⏰ Déclencheurs → supprimer la ligne `verifierBot`.
- Les exécutions (et leurs erreurs éventuelles) sont visibles dans ☰ **Exécutions**.
