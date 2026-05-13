#!/usr/bin/env bash
# infra/scripts/lib/log.sh
# Shared output helpers for MyClash scripts.
#
# Source this from every script:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/log.sh"
#
# Conventions inherited from the MyFAL deploy scripts. Keep this file tiny
# and dependency-free so it can be sourced very early.

# ── Colors ──────────────────────────────────────────────────────
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  RED=$(tput setaf 1)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  CYAN=$(tput setaf 6)
  BOLD=$(tput bold)
  RESET=$(tput sgr0)
else
  RED="" GREEN="" YELLOW="" CYAN="" BOLD="" RESET=""
fi

ok()   { echo "${GREEN}✓${RESET} $*"; }
err()  { echo "${RED}✗${RESET} $*" >&2; }
warn() { echo "${YELLOW}!${RESET} $*"; }
hdr()  { echo; echo "${CYAN}${BOLD}── $* ──${RESET}"; }
info() { echo "  $*"; }

# Confirm prompt; returns 0 on yes, 1 on anything else.
# Usage: confirm "Proceed?" || exit 1
confirm() {
  local prompt="${1:-Proceed?}"
  read -r -p "${prompt} [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

# Require a command to be present, else exit with a helpful message.
# Usage: require_cmd docker
require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    err "Required command not found: $cmd"
    exit 1
  fi
}

# Resolve the repo root from any script that sources this library.
# Usage: ROOT_DIR=$(repo_root); cd "$ROOT_DIR"
repo_root() {
  cd "$(dirname "${BASH_SOURCE[1]}")/../.." && pwd
}
