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

# Format a duration in seconds as a human string, with no trailing newline so
# callers can embed it: "47s", "6m 41s", "1h 06m 41s".
# Usage: echo "Total time: $(fmt_duration 401)"
fmt_duration() {
  local total="${1:-0}"
  local h=$((total / 3600))
  local m=$(((total % 3600) / 60))
  local s=$((total % 60))
  if ((h > 0)); then
    printf '%dh %02dm %02ds' "$h" "$m" "$s"
  elif ((m > 0)); then
    printf '%dm %02ds' "$m" "$s"
  else
    printf '%ds' "$s"
  fi
}

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
