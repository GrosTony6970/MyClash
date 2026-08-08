#!/usr/bin/env bash
# infra/scripts/lib/system-versions.sh
#
# ONE owner for the deploy manifest (data/system-versions.json) — the file
# infra/docker-compose.prod.yml bind-mounts into the api container and the admin
# command center reads for its Deploy group.
#
# It used to be written in exactly one place, deploy.sh. Every other entrypoint
# that changes what is running left the manifest untouched, so the board reported
# the previous deploy's metadata as if it were current. On a rollback that is not
# merely stale: it names the commit you rolled back FROM, which is the worst
# possible answer to "what is running right now?".
#
# The path is deliberately repo-root-relative. Compose resolves relative bind
# sources against its project directory — the directory of the first -f file,
# i.e. infra/ — so the compose mount says `../data/system-versions.json` to reach
# the same file these scripts write from the repo root. check-infra-review.mjs
# asserts the two resolve to one path, and that every caller sources this lib.
#
# Requires: ROOT_DIR set and cd'd into by the caller, plus lib/log.sh.

# UTC, seconds precision, matching what the manifest and .last-deploy.json both
# carry. One owner for the format so a caller cannot invent a variant the API's
# Date.parse silently rejects into "unknown".
mc_now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# The commit the CURRENT manifest claims is deployed, or "unknown". Lets an
# entrypoint that does not itself move the checkout (redeploy.sh) record a
# truthful previousCommit. node rather than jq: node is already required to run
# the generator, jq is not installed everywhere.
mc_manifest_deployed_commit() {
  node -e '
    const fs = require("node:fs");
    try {
      const m = JSON.parse(fs.readFileSync("data/system-versions.json", "utf8"));
      process.stdout.write(m?.deploy?.deployedCommit || "unknown");
    } catch {
      process.stdout.write("unknown");
    }
  ' 2>/dev/null || printf 'unknown'
}

# mc_write_system_versions_manifest <kind> <previous-commit> <deployed-commit> \
#                                  <deployed-at> <deployed-by> <backup-file>
#
# <deployed-at> is a parameter rather than stamped here so a caller that does not
# actually know when the running code was deployed can say "unknown" instead of
# writing a confident lie. Use "$(mc_now_utc)" when it does know.
mc_write_system_versions_manifest() {
  local kind="${1:-unknown}"
  local previous_commit="${2:-unknown}"
  local deployed_commit="${3:-unknown}"
  local deployed_at="${4:-unknown}"
  local deployed_by="${5:-unknown}"
  local backup_file="${6:-none}"

  hdr "Generating system version manifest ($kind)"

  mkdir -p data
  # `docker compose up` creates a DIRECTORY at a bind-mount source that does not
  # exist yet, and the API reader treats a directory as "no manifest" (EISDIR is
  # swallowed on purpose). Clear it before writing or the file never appears and
  # the whole Deploy group silently reads "unknown".
  if [[ -d data/system-versions.json ]]; then
    warn "Replacing accidental directory at data/system-versions.json with a manifest file"
    rm -rf -- data/system-versions.json
  fi

  node scripts/generate-system-versions.mjs \
    --output data/system-versions.json \
    --kind "$kind" \
    --previous-commit "$previous_commit" \
    --deployed-commit "$deployed_commit" \
    --deployed-at "$deployed_at" \
    --deployed-by "$deployed_by" \
    --backup-file "$backup_file"

  if [[ ! -f data/system-versions.json || ! -s data/system-versions.json ]]; then
    err "System version manifest was not generated as a non-empty file"
    return 1
  fi
  ok "System version manifest written to data/system-versions.json ($kind)"
}

# Idempotent repair for entrypoints that bring containers UP without deploying.
# Compose binds the manifest by path at container-create time: if the path is
# missing, Compose creates a directory there and the api container spends its
# whole life reading a directory. Never overwrites a healthy manifest — it only
# fills a hole, and it records what it genuinely knows (HEAD) while leaving the
# deploy time and deployer as "unknown" rather than claiming this was a deploy.
mc_ensure_system_versions_manifest() {
  if [[ -f data/system-versions.json && -s data/system-versions.json ]]; then
    return 0
  fi
  warn "No deploy manifest at data/system-versions.json — writing one so the mount binds a file"
  mc_write_system_versions_manifest \
    unknown \
    unknown \
    "$(git rev-parse HEAD 2>/dev/null || printf 'unknown')" \
    unknown \
    unknown \
    none
}
