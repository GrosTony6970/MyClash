#!/usr/bin/env bash
# infra/scripts/vps-bootstrap.sh
#
# Idempotent bootstrap for a fresh OVH/Hetzner VPS running Ubuntu 24.04.
# Sets up everything needed to host MyClash.
#
# Run as root (or with sudo) on the VPS:
#   bash infra/scripts/vps-bootstrap.sh
#
# Re-running on an already-provisioned host is safe (idempotent).
#
# What it does:
#   1. System update + essential packages
#   2. Docker Engine + Compose v2
#   3. UFW firewall (22, 80, 443 open; rest denied)
#   4. fail2ban
#   5. Unattended security upgrades
#   6. Swap file (2 GB if RAM < 8 GB)
#   7. Deploy user (non-root, docker group)
#   8. /srv/myclash directory with correct ownership
#   9. Clone repo using deploy key
#  10. Nightly backup cron entry
#
# Tested on Ubuntu 24.04 LTS (Noble Numbat).

set -Eeuo pipefail

# ── Bootstrap logging (before lib/log.sh is available) ──────────
_ok()   { echo -e "\033[32m✓\033[0m $*"; }
_err()  { echo -e "\033[31m✗\033[0m $*" >&2; }
_warn() { echo -e "\033[33m!\033[0m $*"; }
_hdr()  { echo; echo -e "\033[36m\033[1m── $* ──\033[0m"; }
_info() { echo "  $*"; }

# ── Must run as root ─────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  _err "This script must be run as root (or with sudo)"
  exit 1
fi

# ── Configuration ────────────────────────────────────────────────
DEPLOY_USER="${DEPLOY_USER:-deploy}"
REPO_DIR="${REPO_DIR:-/srv/myclash}"
REPO_URL="${REPO_URL:-https://github.com/GrosTony6970/MyClash.git}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"

_hdr "MyClash VPS Bootstrap"
_info "Deploy user:  $DEPLOY_USER"
_info "Repo dir:     $REPO_DIR"
_info "Repo URL:     $REPO_URL"

# ── 1. System update ─────────────────────────────────────────────
_hdr "System update"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git jq \
  ca-certificates gnupg lsb-release \
  ufw fail2ban \
  unattended-upgrades apt-listchanges \
  htop ncdu \
  2>/dev/null

_ok "System packages installed"

# ── 2. Docker Engine ─────────────────────────────────────────────
_hdr "Docker Engine"

if command -v docker &>/dev/null; then
  DOCKER_VERSION=$(docker --version | awk '{print $3}' | tr -d ',')
  _ok "Docker already installed: $DOCKER_VERSION"
else
  _info "Installing Docker Engine..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  _ok "Docker Engine installed"
fi

# Verify Compose v2
if docker compose version &>/dev/null; then
  _ok "Docker Compose v2: $(docker compose version --short)"
else
  _err "Docker Compose v2 not available"
  exit 1
fi

# ── 3. UFW firewall ──────────────────────────────────────────────
_hdr "UFW firewall"

ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP (Traefik redirect)' >/dev/null
ufw allow 443/tcp comment 'HTTPS (Traefik)' >/dev/null
ufw --force enable >/dev/null
_ok "UFW enabled: 22, 80, 443 open; rest denied"
ufw status numbered

# ── 4. fail2ban ──────────────────────────────────────────────────
_hdr "fail2ban"

if ! systemctl is-active --quiet fail2ban; then
  systemctl enable --now fail2ban
fi

# Write a local jail config if not already present
JAIL_LOCAL="/etc/fail2ban/jail.local"
if [[ ! -f "$JAIL_LOCAL" ]]; then
  cat > "$JAIL_LOCAL" <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s
EOF
  systemctl reload fail2ban
  _ok "fail2ban configured (SSH jail, 5 retries, 1h ban)"
else
  _ok "fail2ban already configured"
fi

# ── 5. Unattended security upgrades ─────────────────────────────
_hdr "Unattended security upgrades"

UNATTENDED_CONF="/etc/apt/apt.conf.d/50unattended-upgrades"
AUTO_CONF="/etc/apt/apt.conf.d/20auto-upgrades"

if [[ ! -f "$AUTO_CONF" ]]; then
  cat > "$AUTO_CONF" <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  _ok "Auto-upgrades enabled"
else
  _ok "Auto-upgrades already configured"
fi

# Ensure security updates are enabled in the unattended config
if grep -q '"${distro_id}:${distro_codename}-security"' "$UNATTENDED_CONF" 2>/dev/null; then
  _ok "Security upgrades already enabled in unattended-upgrades"
else
  _warn "Check $UNATTENDED_CONF manually to ensure security updates are enabled"
fi

# ── 6. Swap file ─────────────────────────────────────────────────
_hdr "Swap"

TOTAL_RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
_info "Total RAM: ${TOTAL_RAM_MB} MB"

if [[ "$TOTAL_RAM_MB" -lt 8192 ]]; then
  if swapon --show | grep -q /swapfile; then
    _ok "Swap already active: $(swapon --show --noheadings | awk '{print $3}')"
  else
    _info "Creating ${SWAP_SIZE_MB} MB swap file..."
    fallocate -l "${SWAP_SIZE_MB}M" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    # Persist across reboots
    if ! grep -q '/swapfile' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    # Tune swappiness for a server (prefer RAM)
    sysctl -w vm.swappiness=10 >/dev/null
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
    _ok "Swap created: ${SWAP_SIZE_MB} MB"
  fi
else
  _ok "RAM >= 8 GB — skipping swap creation"
fi

# ── 7. Deploy user ───────────────────────────────────────────────
_hdr "Deploy user: $DEPLOY_USER"

if id "$DEPLOY_USER" &>/dev/null; then
  _ok "User $DEPLOY_USER already exists"
else
  useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
  _ok "User $DEPLOY_USER created"
fi

# Add to docker group (allows running docker without sudo)
if ! groups "$DEPLOY_USER" | grep -q docker; then
  usermod -aG docker "$DEPLOY_USER"
  _ok "$DEPLOY_USER added to docker group"
else
  _ok "$DEPLOY_USER already in docker group"
fi

# ── 8. Repo directory ────────────────────────────────────────────
_hdr "Repo directory: $REPO_DIR"

if [[ ! -d "$REPO_DIR" ]]; then
  mkdir -p "$REPO_DIR"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"
  _ok "Created $REPO_DIR"
else
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"
  _ok "$REPO_DIR already exists"
fi

# ── 9. Clone repo ────────────────────────────────────────────────
_hdr "Repository"

if [[ -d "$REPO_DIR/.git" ]]; then
  _ok "Repo already cloned at $REPO_DIR"
  _info "To update: cd $REPO_DIR && git fetch && git reset --hard origin/main"
else
  _info "Cloning $REPO_URL into $REPO_DIR..."
  # Clone as the deploy user
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$REPO_DIR"
  _ok "Repo cloned"
fi

# ── 10. Nightly backup cron ──────────────────────────────────────
_hdr "Nightly backup cron"

CRON_LINE="0 3 * * * $DEPLOY_USER bash $REPO_DIR/infra/scripts/backup.sh >> $REPO_DIR/logs/backup.log 2>&1"
CRON_FILE="/etc/cron.d/myclash-backup"

if [[ -f "$CRON_FILE" ]] && grep -qF "$REPO_DIR/infra/scripts/backup.sh" "$CRON_FILE"; then
  _ok "Backup cron already installed"
else
  echo "$CRON_LINE" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
  _ok "Backup cron installed: daily at 03:00 UTC"
fi

# ── Summary ──────────────────────────────────────────────────────
_hdr "Bootstrap complete"

echo
_ok "VPS is ready to host MyClash"
echo
echo "  Next steps:"
echo "  1. Copy .env.example to $REPO_DIR/.env and fill in values"
echo "  2. Run the first deploy:"
echo "       cd $REPO_DIR && bash infra/scripts/deploy.sh"
echo
echo "  Deploy user:  $DEPLOY_USER"
echo "  Repo:         $REPO_DIR"
echo "  Backup cron:  daily at 03:00 UTC → $REPO_DIR/logs/backup.log"
echo
_warn "Remember to set up SSH key auth and disable root SSH login if not done yet."
_warn "Reboot recommended to apply all kernel updates."
