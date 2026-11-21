# Bot planning bénévoles (WhatsApp + Google Sheet)

Bot qui automatise le planning des bénévoles d'une association : le référent ajoute une
action dans un Google Sheet, le bot gère tout le reste dans WhatsApp (annonce avec sondage,
inscriptions, confirmations, liste finale, récap).

**Stack** : Node.js 24 + TypeScript · Express · [WAHA](https://waha.devlike.pro/) (API WhatsApp) ·
API Google Sheets · Docker Compose · Vitest · GitHub Actions. Hébergement : VPS Oracle Cloud (Always Free).

## Architecture

```text
┌──────────────── Docker Compose (VPS) ────────────────┐
│                                                      │
│   ┌──────────┐   webhooks (messages, votes)   ┌─────┐│
│   │   WAHA   │ ─────────────────────────────▶ │ bot ││
│   │(WhatsApp)│ ◀───────────────────────────── │     ││
│   └────┬─────┘        API (envois)            └──┬──┘│
└────────┼─────────────────────────────────────────┼───┘
         ▼                                         ▼
   Groupe + messages privés               Google Sheet (interface de l'équipe
        WhatsApp                           + base de données)
```

- Le **code métier** (`src/metier/`) ne dépend que de contrats (`src/ports/`) : WAHA, Google
  et l'horloge sont branchés au démarrage, et remplacés par des faux dans les tests.
- Un **tick** chaque minute lance ce qui est dû ; les messages et votes arrivent par webhook.
- Rien n'est exposé sur Internet ; aucun message en double, même après un redémarrage.

## Ce que fait le bot

| Quand | Action |
|---|---|
| J-7, 18:00 | Annonce + sondage dans le groupe (créneaux ou « dispo / pas dispo ») |
| À chaque vote | Inscription / retrait, demande du nom aux nouveaux bénévoles |
| J-2, 10:00 | Demande de confirmation en privé (sondage Oui / Non) |
| J-1, 20:00 | Liste finale des confirmés dans le groupe, confirmation en privé |
| Après la liste | Désistement → le référent est prévenu |
| Vendredi, 20:30 | Récap de la semaine |

Heures, textes et libellés réglables dans l'onglet **Paramètres** du Sheet. L'onglet
**Commandes** permet de tout lancer à la main (annoncer, confirmer, publier, pause…).

## Installation

Prérequis : Docker, Node.js 24, un Google Sheet + un compte de service
([guide](docs/compte-service-google.md)), un numéro WhatsApp dédié au bot.

```bash
npm install
cp .env.example .env              # à remplir (chaque variable est expliquée)
# clé du compte de service → secrets/compte-service.json
npm run installer-sheet           # crée les onglets du Sheet
docker compose up -d --build      # démarre WAHA + le bot
```

Puis scanner le QR code sur http://localhost:3001/dashboard, récupérer l'ID du groupe
(`lister-groupes`, ci-dessous) dans `GROUPE_ID`, et relancer `docker compose up -d`.
Sur le VPS Oracle (ARM) : `WAHA_IMAGE=devlikeapro/waha:gows-arm-2026.10.1` dans le `.env`.

## Commandes

| Commande | Rôle |
|---|---|
| `docker compose up -d --build` | Démarrer / mettre à jour |
| `docker compose logs -f bot` | Logs du bot |
| `docker compose ps` | État (`bot` doit être *healthy*) |
| `docker compose down` | Arrêter |
| `docker compose run --rm bot npm run lister-groupes` | Groupes WhatsApp et leur ID |
| `docker compose run --rm bot npm run installer-sheet` | Créer / réparer le Sheet |
| `npm run verifier` | Types + tests (lancé par la CI) |

## Structure

```text
src/
  index.ts, serveur.ts, planificateur.ts   démarrage, webhooks, tick
  metier/      annonces, votes, confirmations, liste finale, récap, commandes…
  ports/       contrats : Messagerie, Tableur, Horloge, Alertes
  whatsapp/    adaptateur WAHA
  sheets/      accès Google Sheets, un module par onglet
  etat/, utils/
tests/         Vitest, dont une quinzaine complète simulée (semaine.test.ts)
```

Le détail des règles et des décisions est dans [CLAUDE.md](CLAUDE.md).
