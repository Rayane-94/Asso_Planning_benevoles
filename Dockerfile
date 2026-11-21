# Dockerfile — La « recette » de l'image Docker du bot.
#
# Docker suit ces étapes une par une pour fabriquer une image (un « paquet » contenant
# Node.js + le code du bot), qui tourne ensuite à l'identique sur le PC et sur le VPS.
# On ne lance jamais ce fichier à la main : docker compose s'en sert (voir docker-compose.yml).

# Node.js 24, version « slim » (allégée). Image officielle disponible pour PC (amd64) ET pour
# les machines ARM d'Oracle (arm64) : Docker choisit tout seul la bonne.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# 1) Les dépendances d'abord : tant que package.json ne change pas, Docker réutilise cette
#    étape déjà faite (reconstruction en quelques secondes après une modification du code).
#    --omit=dev : pas besoin de TypeScript ni de Vitest pour FAIRE TOURNER le bot
#    (Node 24 lit directement les fichiers .ts).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 2) Le code du bot et les scripts (installer-sheet, lister-groupes)
COPY src ./src
COPY scripts ./scripts

# 3) Le dossier des données (état du bot) appartient à l'utilisateur « node » :
#    le bot ne tourne PAS en administrateur (root), par sécurité.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

CMD ["node", "src/index.ts"]
