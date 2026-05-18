#!/usr/bin/env bash
# infra/scripts/vps-bootstrap.sh
#
# Interactive bootstrap for a fresh Ubuntu 24.04 VPS hosting MyClash.
# Presents a menu so you can run all steps or pick individual ones.
# Idempotent — safe to re-run.
#
# Usage:
#   bash infra/scripts/vps-bootstrap.sh          # interactive menu
#   bash infra/scripts/vps-bootstrap.sh --all    # run everything non-interactively

set -Eeuo pipefail

# ── Logging helpers (standalone — no lib/log.sh dependency) ─────
_ok()   { echo -e "\033[32m✓\033[0m $*"; }
_err()  { echo -e "\033[31m✗\033[0m $*" >&2; }
_warn() { echo -e "\033[33m!\033[0m $*"; }
_hdr()  { echo; echo -e "\033[36m\033[1m── $* ──\033[0m"; }
_info() { echo "  $*"; }

_ask() {
  # _ask "Prompt" default_value → prints prompt, reads into REPLY
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    read -r -p "  ${prompt} [${default}]: " REPLY
    REPLY="${REPLY:-$default}"
  else
    read -r -p "  ${prompt}: " REPLY
  fi
}

_confirm() {
  local prompt="${1:-Proceed?}"
  read -r -p "  ${prompt} [y/N] " _reply
  [[ "$_reply" =~ ^[Yy]$ ]]
}

# ── Must run as root ─────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  _err "This script must be run as root (or with sudo)"
  exit 1
fi

# ── Parse --all flag ─────────────────────────────────────────────
RUN_ALL=0
[[ "${1:-}" == "--all" ]] && RUN_ALL=1

# ── Configuration (interactive or defaults) ──────────────────────
echo
echo -e "\033[36m\033[1m╔══════════════════════════════════════════╗\033[0m"
echo -e "\033[36m\033[1m║     MyClash VPS Bootstrap                ║\033[0m"
echo -e "\033[36m\033[1m╚══════════════════════════════════════════╝\033[0m"
echo

if [[ "$RUN_ALL" -eq 0 ]]; then
  _hdr "Configuration"
  echo "  Press Enter to accept the default value shown in [brackets]."
  echo

  _ask "Deploy user" "deploy";       DEPLOY_USER="$REPLY"
  _ask "Repo directory" "/srv/myclash"; REPO_DIR="$REPLY"
  _ask "Repo URL" "https://github.com/GrosTony6970/MyClash.git"; REPO_URL="$REPLY"
  _ask "Swap size (MB, 0 to skip)" "2048"; SWAP_SIZE_MB="$REPLY"

  echo
  _info "Deploy user : $DEPLOY_USER"
  _info "Repo dir    : $REPO_DIR"
  _info "Repo URL    : $REPO_URL"
  _info "Swap size   : ${SWAP_SIZE_MB} MB"
  echo
else
  DEPLOY_USER="${DEPLOY_USER:-deploy}"
  REPO_DIR="${REPO_DIR:-/srv/myclash}"
  REPO_URL="${REPO_URL:-https://github.com/GrosTony6970/MyClash.git}"
  SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"
fi

# ── Step definitions ─────────────────────────────────────────────
# Each step is a function. The menu maps numbers to function names + labels.

step_system_update() {
  _hdr "1 · System update & essential packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get upgrade -y -qq
  apt-get install -y -qq \
    curl wget git jq \
    ca-certificates gnupg lsb-release \
    ufw fail2ban \
    unattended-upgrades apt-listchanges \
    htop ncdu \
    awscli \
    2>/dev/null
  _ok "System packages installed (includes awscli for S3 backups)"
}

step_docker() {
  _hdr "2 · Docker Engine + Compose v2"
  if command -v docker &>/dev/null; then
    _ok "Docker already installed: $(docker --version | awk '{print $3}' | tr -d ',')"
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
    apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    _ok "Docker Engine installed"
  fi
  if docker compose version &>/dev/null; then
    _ok "Docker Compose v2: $(docker compose version --short)"
  else
    _err "Docker Compose v2 not available after install"
    exit 1
  fi
}

step_ufw() {
  _hdr "3 · UFW firewall"
  ufw --force reset >/dev/null 2>&1
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp   comment 'SSH'                    >/dev/null
  ufw allow 80/tcp   comment 'HTTP (Traefik redirect)' >/dev/null
  ufw allow 443/tcp  comment 'HTTPS (Traefik)'         >/dev/null
  ufw --force enable >/dev/null
  _ok "UFW enabled: 22, 80, 443 open; rest denied"
  ufw status numbered
}

step_fail2ban() {
  _hdr "4 · fail2ban"
  if ! systemctl is-active --quiet fail2ban; then
    systemctl enable --now fail2ban
  fi
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
}

step_unattended_upgrades() {
  _hdr "5 · Unattended security upgrades"
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
}

step_swap() {
  _hdr "6 · Swap file"
  if [[ "$SWAP_SIZE_MB" -eq 0 ]]; then
    _warn "Swap skipped (size = 0)"
    return
  fi
  TOTAL_RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  _info "Total RAM: ${TOTAL_RAM_MB} MB"
  if [[ "$TOTAL_RAM_MB" -ge 8192 ]]; then
    _ok "RAM >= 8 GB — skipping swap"
    return
  fi
  if swapon --show | grep -q /swapfile; then
    _ok "Swap already active: $(swapon --show --noheadings | awk '{print $3}')"
  else
    _info "Creating ${SWAP_SIZE_MB} MB swap file..."
    fallocate -l "${SWAP_SIZE_MB}M" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -w vm.swappiness=10 >/dev/null
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
    _ok "Swap created: ${SWAP_SIZE_MB} MB"
  fi
}

step_deploy_user() {
  _hdr "7 · Deploy user: $DEPLOY_USER"
  if id "$DEPLOY_USER" &>/dev/null; then
    _ok "User $DEPLOY_USER already exists"
  else
    useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
    _ok "User $DEPLOY_USER created"
  fi
  if ! groups "$DEPLOY_USER" | grep -q docker; then
    usermod -aG docker "$DEPLOY_USER"
    _ok "$DEPLOY_USER added to docker group"
  else
    _ok "$DEPLOY_USER already in docker group"
  fi
}

step_repo_dir() {
  _hdr "8 · Repo directory: $REPO_DIR"
  if [[ ! -d "$REPO_DIR" ]]; then
    mkdir -p "$REPO_DIR"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"
    _ok "Created $REPO_DIR"
  else
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"
    _ok "$REPO_DIR already exists (ownership updated)"
  fi
}

step_clone_repo() {
  _hdr "9 · Clone repository"
  if [[ -d "$REPO_DIR/.git" ]]; then
    _ok "Repo already cloned at $REPO_DIR"
    _info "To update: cd $REPO_DIR && git fetch && git reset --hard origin/main"
  else
    _info "Cloning $REPO_URL → $REPO_DIR"
    sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$REPO_DIR"
    _ok "Repo cloned"
  fi
}

step_backup_cron() {
  _hdr "10 · Backup scheduler"
  CRON_FILE="/etc/cron.d/myclash-backup"
  if [[ -f "$CRON_FILE" ]]; then
    rm -f "$CRON_FILE"
    _ok "Removed legacy host backup cron; ops-runner manages the editable schedule"
  else
    _ok "No legacy host backup cron found; ops-runner manages backups"
  fi
}

step_s3_credentials() {
  _hdr "11 · Scaleway S3 credentials for backups"
  _info "The backup script reads credentials from .env (BACKUP_SCW_ACCESS_KEY etc.)."
  _info "No separate ~/.aws/credentials file is needed — credentials are passed as env vars."
  _info ""
  _info "To verify S3 connectivity after deploy, run:"
  _info "  source $REPO_DIR/.env"
  _info "  AWS_ACCESS_KEY_ID=\$BACKUP_SCW_ACCESS_KEY \\"
  _info "  AWS_SECRET_ACCESS_KEY=\$BACKUP_SCW_SECRET_KEY \\"
  _info "  aws s3 ls s3://\$BACKUP_SCW_BUCKET/ --endpoint-url \$BACKUP_SCW_ENDPOINT"
  _info ""
  _info "Required .env vars:"
  _info "  BACKUP_SCW_ACCESS_KEY   — Scaleway IAM API key ID"
  _info "  BACKUP_SCW_SECRET_KEY   — Scaleway IAM API key secret"
  _info "  BACKUP_SCW_BUCKET       — bucket name (e.g. myclash-backups)"
  _info "  BACKUP_SCW_REGION       — region (e.g. fr-par)"
  _info "  BACKUP_SCW_ENDPOINT     — https://s3.fr-par.scw.cloud"
  _ok "S3 credentials are env-based — no extra config needed on this host"
}

# ── Step registry ────────────────────────────────────────────────
STEP_FUNCS=(
  step_system_update
  step_docker
  step_ufw
  step_fail2ban
  step_unattended_upgrades
  step_swap
  step_deploy_user
  step_repo_dir
  step_clone_repo
  step_backup_cron
  step_s3_credentials
)

STEP_LABELS=(
  "System update & essential packages"
  "Docker Engine + Compose v2"
  "UFW firewall (22/80/443)"
  "fail2ban (SSH brute-force protection)"
  "Unattended security upgrades"
  "Swap file (2 GB if RAM < 8 GB)"
  "Deploy user ($DEPLOY_USER)"
  "Repo directory ($REPO_DIR)"
  "Clone repository"
  "Backup scheduler"
  "Scaleway S3 credentials info"
)

# ── Run all (--all flag) ─────────────────────────────────────────
if [[ "$RUN_ALL" -eq 1 ]]; then
  _hdr "Running all steps"
  for fn in "${STEP_FUNCS[@]}"; do
    "$fn"
  done
  _hdr "Bootstrap complete"
  _ok "All steps done. Next: copy .env.example to $REPO_DIR/.env and run deploy.sh"
  exit 0
fi

# ── Interactive menu ─────────────────────────────────────────────
run_menu() {
  while true; do
    echo
    echo -e "\033[36m\033[1m  Select steps to run\033[0m"
    echo "  ─────────────────────────────────────────"
    for i in "${!STEP_LABELS[@]}"; do
      printf "  \033[1m%2d\033[0m  %s\n" "$((i+1))" "${STEP_LABELS[$i]}"
    done
    echo
    echo "   a  Run ALL steps"
    echo "   q  Quit"
    echo
    echo "  You can enter multiple numbers separated by spaces (e.g. 1 2 3)"
    echo
    _ask "Choice"
    local choice="$REPLY"

    [[ "$choice" == "q" || "$choice" == "Q" ]] && { echo; _ok "Bye."; exit 0; }

    if [[ "$choice" == "a" || "$choice" == "A" ]]; then
      for fn in "${STEP_FUNCS[@]}"; do "$fn"; done
      echo
      _ok "All steps complete."
      continue
    fi

    # Parse space-separated numbers
    local ran=0
    for token in $choice; do
      if [[ "$token" =~ ^[0-9]+$ ]]; then
        local idx=$((token - 1))
        if [[ "$idx" -ge 0 && "$idx" -lt "${#STEP_FUNCS[@]}" ]]; then
          "${STEP_FUNCS[$idx]}"
          ran=$((ran + 1))
        else
          _warn "Invalid step number: $token (valid: 1–${#STEP_FUNCS[@]})"
        fi
      else
        _warn "Ignoring invalid input: $token"
      fi
    done

    [[ "$ran" -gt 0 ]] && { echo; _ok "$ran step(s) complete."; }
  done
}

run_menu
