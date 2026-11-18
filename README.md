# Bot planning bénévoles (WhatsApp + Google Sheet)

Automatise le planning des bénévoles d'une association : annonce des actions dans le groupe WhatsApp, inscriptions par « OUI », confirmations, liste finale des présents. Le tout piloté depuis un Google Sheet.

> 🚧 Projet en cours de construction. Le contexte complet et les décisions sont dans [CLAUDE.MD](CLAUDE.MD).

## Stack

- **Google Apps Script** (JavaScript, runtime V8) attaché au Google Sheet : aucun serveur à gérer.
- **clasp** pour envoyer le code de `src/` vers Apps Script.
- **Node.js** (≥ 20) pour lancer les tests en local, sans dépendance (`node --test`).
- **API WhatsApp hébergée** appelée en HTTP, derrière un adaptateur interchangeable.

## Démarrage (développeur)

```bash
npm install            # installe clasp en local
npm test               # lance les tests
npx clasp login        # connexion au compte Google (une seule fois)
cp .clasp.json.example .clasp.json   # puis coller l'ID du script
npm run push           # envoie src/ vers Apps Script
```

## Structure

```text
src/            Code envoyé à Apps Script (+ appsscript.json : le manifeste)
tests/          Tests locaux Node
CLAUDE.MD       Cahier des charges et décisions du projet
```
