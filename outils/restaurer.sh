#!/usr/bin/env bash
# outils/restaurer.sh — Remet en place une sauvegarde faite par sauvegarder.sh.
#
#   bash outils/restaurer.sh sauvegardes/sauvegarde-2026-11-27_1530.tgz
#
# Cas d'usage : nouvelle machine, machine réinstallée, session WhatsApp abîmée.
# REMPLACE la session WhatsApp et l'état du bot actuels par ceux de la sauvegarde.
#
# ⚠️ Une session WhatsApp ne doit tourner qu'à UN endroit : arrêter WAHA sur l'ancienne
#    machine (docker compose down) AVANT de démarrer celle-ci.
# ⚠️ Prendre la sauvegarde la plus récente : une vieille session peut avoir été déconnectée
#    entre-temps par WhatsApp. Si le tableau de bord WAHA redemande le QR code, le rescanner.

source "$(dirname "$0")/commun.sh"

archive="${1:-}"
[ -n "$archive" ] || erreur "Indiquer le fichier : bash outils/restaurer.sh sauvegardes/sauvegarde-….tgz"
[ -f "$archive" ] || erreur "Fichier introuvable : $archive"
tar tzf "$archive" sessions >/dev/null 2>&1 || erreur "Ce fichier n'est pas une sauvegarde du bot : $archive"

echo "La session WhatsApp et l'état du bot actuels vont être REMPLACÉS par : $archive"
read -r -p "Taper OUI pour continuer : " reponse
[ "$reponse" = "OUI" ] || erreur "Annulé, rien n'a été modifié."

info "Préparation des conteneurs (sans les démarrer)"
docker compose up --no-start >/dev/null 2>&1
docker compose stop bot waha >/dev/null
mkdir -p data/waha-sessions

info "Remplacement de la session WhatsApp et de l'état du bot"
# Conteneur jetable du bot, en root : il reçoit l'archive sur son entrée standard (-T),
# vide les deux dossiers, y copie la sauvegarde, et rend l'état du bot à l'utilisateur « node ».
docker compose run --rm -T --no-deps --user root -v "$SESSIONS:/sessions" bot sh -c '
  set -e
  mkdir /tmp/restauration
  tar xzf - -C /tmp/restauration
  find /sessions -mindepth 1 -delete
  cp -a /tmp/restauration/sessions/. /sessions/
  find /app/data -mindepth 1 -delete
  if [ -d /tmp/restauration/app/data ]; then cp -a /tmp/restauration/app/data/. /app/data/; fi
  rm -f /app/data/bot.lock
  chown -R node:node /app/data
' < "$archive" || erreur "Restauration échouée (voir le message ci-dessus)."

info "Démarrage de WAHA et du bot"
docker compose up -d >/dev/null
info "✅ Sauvegarde restaurée. Vérifier : docker compose logs -f bot  (« WhatsApp connecté »)"
