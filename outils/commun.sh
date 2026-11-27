# outils/commun.sh — Morceaux communs aux scripts d'exploitation (chargé par « source »).
# Ne se lance pas seul.

set -euo pipefail
umask 077 # les fichiers créés (sauvegardes) ne sont lisibles que par leur propriétaire

# Toujours travailler depuis la racine du projet (là où est docker-compose.yml)
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Sous Windows (Git Bash), empêche la conversion automatique des chemins « /app/... » passés
# à Docker ; sans effet sur Linux.
export MSYS_NO_PATHCONV=1

# Chemin absolu d'un dossier du projet, au format compris par Docker
# (Linux : /home/ubuntu/... ; Windows/Git Bash : C:/Users/...).
chemin_absolu() {
  if pwd -W >/dev/null 2>&1; then echo "$(pwd -W)/$1"; else echo "$PWD/$1"; fi
}

# Dossier de la session WhatsApp (même chemin que dans docker-compose.yml)
SESSIONS="$(chemin_absolu data/waha-sessions)"

info() { echo "▶ $*"; }
erreur() { echo "❌ $*" >&2; exit 1; }

# Les conteneurs existent-ils ? (créés par « docker compose up »)
verifier_conteneurs() {
  docker compose ps -a --services 2>/dev/null | grep -qx bot ||
    erreur "Conteneurs introuvables : lancer d'abord « docker compose up -d --build »."
}
