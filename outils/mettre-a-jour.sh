#!/usr/bin/env bash
# outils/mettre-a-jour.sh — Installe la dernière version du bot (branche main) sur la machine.
#
#   bash outils/mettre-a-jour.sh
#
# Étapes : récupère le code (git pull), reconstruit l'image du bot, le redémarre, attend qu'il
# réponde (« healthy »), puis supprime les anciennes images (le disque de la machine est limité).
# La session WhatsApp et l'état du bot ne sont pas touchés (ils sont hors de l'image).
# Coupure du bot : quelques secondes. WAHA n'est redémarré que si sa configuration a changé.

source "$(dirname "$0")/commun.sh"

info "Récupération de la dernière version"
# --ff-only : refuse de mélanger si des fichiers ont été modifiés à la main sur la machine
git pull --ff-only || erreur "git pull impossible (modification locale ?). Voir « git status »."
echo "   Version : $(git log -1 --format='%h %s')"

info "Reconstruction et redémarrage du bot"
docker compose up -d --build

info "Attente du démarrage du bot (2 min maximum)"
for _ in $(seq 1 24); do
  sante=$(docker inspect -f '{{.State.Health.Status}}' bot 2>/dev/null || echo "absent")
  if [ "$sante" = "healthy" ]; then
    docker image prune -f >/dev/null # anciennes images du bot, devenues inutiles
    docker compose ps
    info "✅ Bot à jour et en bonne santé."
    exit 0
  fi
  sleep 5
done

docker compose ps
erreur "Le bot ne répond pas (état : $sante). Voir : docker compose logs --tail 50 bot"
