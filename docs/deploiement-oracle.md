# Déploiement sur un VPS Oracle Cloud (Always Free)

Ce guide installe le bot (WAHA + bot, via Docker Compose) sur une machine virtuelle gratuite
d'Oracle Cloud. Durée : environ 1 h la première fois.

**Résultat** : une machine Ubuntu (processeur ARM) qui fait tourner les deux conteneurs 24 h/24,
redémarre seule, et n'expose rien sur Internet à part SSH.

Prérequis sur le PC (Windows 10/11) : PowerShell, qui contient déjà `ssh` et `scp`.

---

## Phase 1 — Compte Oracle et garde-fous

1. **Créer le compte** sur https://www.oracle.com/cloud/free/ (« Start for free »).
   - Une carte bancaire est demandée pour vérifier l'identité (une petite autorisation, remboursée).
   - **Région d'origine (« Home Region »)** : elle est **définitive**. Prendre une région proche,
     par exemple France Central (Paris), France South (Marseille) ou Germany Central (Frankfurt).
2. **Passer en « Pay As You Go »** (recommandé) : menu ☰ → *Billing & Cost Management* →
   *Upgrade and Manage Payment*.
   - Ça reste **gratuit** tant qu'on reste dans les limites Always Free.
   - Pourquoi : Oracle peut récupérer une machine gratuite jugée inactive sur un compte
     gratuit, pas sur un compte Pay As You Go. Ces comptes obtiennent aussi plus facilement
     des machines ARM quand la région est saturée.
3. **Alerte de budget à 1 €** : menu ☰ → *Billing & Cost Management* → *Budgets* →
   *Create Budget*.
   - Cible : le compartiment racine (« root »), montant mensuel : **1**.
   - Règle d'alerte : type *Actual spend*, seuil **1 %** (soit 0,01 €), e-mail = ton adresse.
   - → au moindre centime facturé, tu reçois un e-mail.

⚠️ Pour rester à 0 € : ne créer **que** ce que décrit ce guide (une machine **Ampere A1**,
un disque de démarrage de 50 Go). Pas de base de données, pas de répartiteur de charge,
pas de disque supplémentaire.

---

## Phase 2 — Clé SSH (sur le PC)

SSH est le moyen de se connecter à la machine à distance, en ligne de commande. On s'identifie
avec une **paire de clés** plutôt qu'un mot de passe : la clé **privée** reste sur le PC (ne
jamais la partager), la clé **publique** est donnée à Oracle.

Dans PowerShell :

```powershell
ssh-keygen -t ed25519 -C "vps-benevoles" -f $HOME\.ssh\vps_benevoles
# (une phrase de passe est conseillée ; Entrée pour aucune)
Get-Content $HOME\.ssh\vps_benevoles.pub   # la clé PUBLIQUE, à copier à la phase 3
```

---

## Phase 3 — Créer la machine

Menu ☰ → *Compute* → *Instances* → **Create instance**.

| Réglage | Valeur |
|---|---|
| Name | `bot-benevoles` |
| Image | **Canonical Ubuntu 24.04** (bouton *Change image*) |
| Shape | *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, **2 OCPU, 12 Go** de mémoire (« Always Free-eligible » doit être affiché) |
| Networking | Créer un nouveau réseau (VCN) avec un **sous-réseau public**, et **attribuer une adresse IPv4 publique** |
| Add SSH keys | *Paste public keys* → coller la clé publique de la phase 2 |
| Boot volume | Taille par défaut (≈ 50 Go) |

Puis **Create**. Au bout de 1 à 2 minutes, l'état passe à *Running* : noter l'**adresse IP
publique** affichée.

- Le gratuit Ampere va jusqu'à 4 OCPU et 24 Go au total : 2 OCPU / 12 Go suffisent largement
  (WAHA en moteur GOWS + le bot consomment quelques centaines de Mo).
- Erreur **« Out of capacity »** : fréquente sur les machines ARM gratuites. Réessayer plus tard,
  choisir un autre *Availability Domain*, ou demander moins (1 OCPU / 6 Go).
- Le pare-feu par défaut n'ouvre que le **port 22 (SSH)** : c'est exactement ce qu'il faut.
  N'ouvrir **aucun** autre port.

---

## Phase 4 — Se connecter et installer Docker

Depuis PowerShell (remplacer `IP` par l'adresse publique) :

```powershell
ssh -i $HOME\.ssh\vps_benevoles ubuntu@IP
```

Puis, **sur la machine** :

```bash
# Mises à jour du système
sudo apt update && sudo apt upgrade -y

# Docker (script officiel) + droit d'utiliser docker sans sudo
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit   # se déconnecter, puis se reconnecter pour que le droit soit pris en compte
```

Après reconnexion, vérifier : `docker compose version`.

Les mises à jour de sécurité d'Ubuntu s'installent automatiquement (paquet
`unattended-upgrades`, actif par défaut).

---

## Phase 5 — Installer le bot

**Sur la machine** :

```bash
git clone https://github.com/Rayane-94/Asso_Planning_benevoles.git
cd Asso_Planning_benevoles
mkdir -p secrets
```

(Si le dépôt est privé, `git clone` demande un identifiant : utiliser un *personal access
token* GitHub en lecture seule comme mot de passe.)

**Depuis le PC** (PowerShell, à la racine du projet), copier les deux secrets :

```powershell
scp -i $HOME\.ssh\vps_benevoles .env ubuntu@IP:~/Asso_Planning_benevoles/.env
scp -i $HOME\.ssh\vps_benevoles secrets\compte-service.json ubuntu@IP:~/Asso_Planning_benevoles/secrets/
```

**Sur la machine**, adapter le `.env` (`nano .env`, Ctrl+O pour enregistrer, Ctrl+X pour quitter) :
- ajouter `WAHA_IMAGE=devlikeapro/waha:gows-arm-2026.10.1` (processeur ARM) ;
- **supprimer** (ou commenter) les lignes du mode développement, si elles sont présentes :
  `WAHA_URL=http://localhost:3001` et `WAHA_WEBHOOK_URL=…`.

Puis protéger les secrets et démarrer :

```bash
chmod 600 .env
chmod 644 secrets/compte-service.json   # lisible par le conteneur du bot (utilisateur « node »)
docker compose up -d --build
```

> ⚠️ **Un seul bot à la fois pour un même numéro WhatsApp** : arrêter le bot du PC
> (`docker compose down` sur le PC) avant de démarrer celui du VPS.

---

## Phase 6 — Connecter WhatsApp (QR code) par tunnel SSH

Le tableau de bord WAHA n'est **pas** ouvert sur Internet. On y accède par un **tunnel SSH** :
le port 3001 du PC est relié, de façon chiffrée, au port 3001 de la machine.

Depuis le PC :

```powershell
ssh -i $HOME\.ssh\vps_benevoles -L 3001:localhost:3001 ubuntu@IP
```

Tant que cette fenêtre reste ouverte, ouvrir sur le PC : http://localhost:3001/dashboard
(identifiant `admin`, mot de passe `WAHA_DASHBOARD_PASSWORD`), puis scanner le QR code avec le
téléphone du bot (WhatsApp → *Appareils connectés* → *Connecter un appareil*).

Si le PC avait déjà une session WAHA pour ce numéro, la supprimer dans WhatsApp
(*Appareils connectés*) pour ne garder que celle du VPS.

---

## Phase 7 — Vérifications

```bash
docker compose ps            # waha : Up ; bot : Up (healthy)
docker compose logs -f bot   # « Bot démarré », puis « WhatsApp connecté »
free -h                      # mémoire utilisée
```

Dans le Sheet, l'onglet **État du bot** doit être 🟢 et « Dernier passage » doit avancer
chaque minute. Faire enfin un test réel : une action, « Annoncer maintenant », un vote.

Puis : faire une **première sauvegarde** (voir « Sauvegarde » ci-dessous) et installer la
**Sentinelle** dans le Sheet ([sentinelle.md](sentinelle.md)) pour être prévenu par e-mail si la
machine s'arrête.

---

## Au quotidien

| Je veux… | Commande (sur la machine, dans `~/Asso_Planning_benevoles`) |
|---|---|
| Voir les logs du bot | `docker compose logs -f bot` |
| Mettre à jour le bot | `bash outils/mettre-a-jour.sh` |
| Sauvegarder (session WhatsApp + état) | `bash outils/sauvegarder.sh` |
| Restaurer une sauvegarde | `bash outils/restaurer.sh sauvegardes/sauvegarde-….tgz` |
| Redémarrer | `docker compose restart` |
| Lancer un script | `docker compose run --rm bot npm run installer-sheet` |

**Mise à jour** : `mettre-a-jour.sh` fait `git pull`, reconstruit le bot, attend qu'il soit
« healthy » puis supprime les anciennes images. Coupure de quelques secondes ; la session
WhatsApp n'est pas touchée.

---

## Sauvegarde de la session WhatsApp

La sauvegarde évite de rescanner le QR code si la machine est perdue ou réinstallée. Elle est
**manuelle** : la faire après l'installation (phase 7), puis avant toute opération risquée
(réinstallation, changement de machine) et de temps en temps (une fois par mois).

1. **Sur la machine** : `bash outils/sauvegarder.sh` (WAHA et le bot sont coupés ~15 s).
   Le fichier est créé dans `sauvegardes/` ; les 5 plus récentes sont gardées.
2. **Rapatrier sur le PC** (PowerShell, à la racine du projet) — une sauvegarde restée sur la
   machine ne sert à rien si la machine est perdue :

   ```powershell
   mkdir sauvegardes -Force
   scp -i $HOME\.ssh\vps_benevoles "ubuntu@IP:~/Asso_Planning_benevoles/sauvegardes/*.tgz" sauvegardes\
   ```

⚠️ Une sauvegarde **donne accès au compte WhatsApp** du bot : ne jamais la commiter (le dossier
`sauvegardes/` est ignoré par Git), ni l'envoyer par e-mail ou messagerie.

**Restaurer** (nouvelle machine, par ex.) : installer le bot jusqu'à la phase 5 **sans** scanner
le QR code, copier le fichier sur la machine (`scp` dans l'autre sens), puis
`bash outils/restaurer.sh sauvegardes/sauvegarde-….tgz` (demande de taper OUI).
- Une session ne doit tourner qu'à **un seul endroit** : arrêter l'ancienne machine d'abord.
- Prendre la sauvegarde **la plus récente**. Si WhatsApp a déconnecté la session entre-temps,
  le tableau de bord WAHA redemande le QR code : le rescanner (phase 6).
