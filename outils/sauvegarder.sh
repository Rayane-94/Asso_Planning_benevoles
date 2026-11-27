#!/usr/bin/env bash
# outils/sauvegarder.sh — Sauvegarde la session WhatsApp et l'état du bot dans UN fichier.
#
#   bash outils/sauvegarder.sh      (depuis n'importe où ; dure ~15 s)
#
# Contenu de la sauvegarde (sauvegardes/sauvegarde-AAAA-MM-JJ_HHMM.tgz) :
#   - sessions/  : la session WhatsApp de WAHA → pas besoin de rescanner le QR code ;
#   - app/data/  : l'état du bot (etat.json : messages déjà traités, votes, récap envoyé…).
# WAHA et le bot sont arrêtés pendant la copie (sinon des fichiers à moitié écrits), puis relancés.
#
# ⚠️ Ce fichier donne accès au compte WhatsApp : ne jamais le commiter ni le partager.
#    Le rapatrier sur le PC (voir docs/deploiement-oracle.md, « Sauvegarde »).

source "$(dirname "$0")/commun.sh"

GARDER=5 # nombre de sauvegardes gardées sur la machine (les plus récentes)

verifier_conteneurs
mkdir -p sauvegardes
fichier="sauvegardes/sauvegarde-$(date +%Y-%m-%d_%H%M).tgz"

# Relancer à la fin seulement si ça tournait avant (et même si la copie échoue)
etait_lance=$(docker compose ps --status running --services | grep -cx waha || true)
relancer() {
  if [ "$etait_lance" -gt 0 ]; then info "Redémarrage de WAHA et du bot"; docker compose start >/dev/null; fi
}
trap relancer EXIT

info "Arrêt de WAHA et du bot (quelques secondes)"
docker compose stop bot waha >/dev/null

info "Copie de la session WhatsApp et de l'état du bot"
# Conteneur jetable du bot, en root (les fichiers de session appartiennent à root),
# qui envoie l'archive sur sa sortie standard (-T : sans terminal, sinon l'archive est abîmée).
docker compose run --rm -T --no-deps --user root -v "$SESSIONS:/sessions:ro" bot \
  tar czf - --exclude=app/data/bot.lock -C / sessions app/data > "$fichier" ||
  { rm -f "$fichier"; erreur "Sauvegarde échouée."; }

# Ménage : on garde les $GARDER plus récentes
ls -1t sauvegardes/sauvegarde-*.tgz | tail -n +$((GARDER + 1)) | xargs -r rm --

info "✅ Sauvegarde créée : $fichier ($(du -h "$fichier" | cut -f1))"
