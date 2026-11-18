# Bot planning bénévoles (WhatsApp + Google Sheet)

Automatise le planning des bénévoles d'une association : annonce des actions dans le groupe WhatsApp, inscriptions par « OUI », confirmations, liste finale des présents. Le tout piloté depuis un Google Sheet.

> 🚧 Projet en cours de construction. Le contexte complet et les décisions sont dans [CLAUDE.md](CLAUDE.md).

## Stack

- **Node.js 24 + TypeScript** : Node exécute les fichiers `.ts` directement, sans compilation ; `tsc` sert seulement à vérifier les types.
- **WAHA** (API WhatsApp open source) et le bot tournent en **Docker** sur un VPS Oracle Cloud.
- **Google Sheets** comme interface pour l'équipe (accès via l'API Google).
- **Vitest** pour les tests, **GitHub Actions** pour la CI.

## Démarrage (développeur)

```bash
npm install          # installe les dépendances
npm test             # lance les tests
npm run types        # vérifie les types TypeScript
npm run verifier     # les deux (c'est ce que fait la CI)
npm run test:surveiller  # relance les tests à chaque modification
```

## Structure

```text
src/
  constantes.ts   statuts, onglets, mots-clés OUI/NON, paramètres par défaut
  config.ts       lecture et vérification du .env
  ports/          contrats Messagerie (WhatsApp), Tableur (Sheet), Horloge
  utils/          dates (fuseau Paris), téléphones, textes et détection OUI/NON, logger
tests/            tests Vitest (même arborescence que src/)
  faux/           versions de test des contrats : fausse messagerie, faux Sheet, horloge contrôlée
CLAUDE.md         cahier des charges et décisions du projet
```
