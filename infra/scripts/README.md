# infra/scripts/

Operations toolkit that runs **on the OVH VPS** (not the developer's machine — those live
in [`scripts/`](../../scripts/README.md)). These manage the production Docker Compose stack:
deploy, rebuild, restart, roll back, back up, restore, inspect, and tear down.

## Two ways to run them

Every script resolves its own location and `cd`s to the repo root before doing anything, so
**the working directory never matters**. Both of these are equivalent:

```bash
# From the repo root
infra/scripts/deploy.sh --dev-certs --skip-backup

# From inside this directory (on the server)
cd /srv/myclash/infra/scripts
./deploy.sh --dev-certs --skip-backup
```

All scripts support `-h` / `--help`. From your machine, `deploy.sh` and `rollback.sh` are
also reachable over SSH via `pnpm deploy:prod` / `pnpm rollback:prod`
(see [`scripts/deploy.ts`](../../scripts/deploy.ts)).

## The scripts

| Script                                 | What it does                                                                                                                                           | Rebuilds images? |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `deploy.sh`                            | Full safe deploy: validate env → lock → pre-deploy DB backup → git reset → build all → migrate → `up -d` → health → bootstrap super admin → smoke test | yes (all)        |
| `redeploy.sh [svc…]`                   | Rebuild + recreate only the named app service(s); everything else keeps running                                                                        | yes (named)      |
| `refresh.sh [svc…]`                    | Restart running containers and wait for health — **no rebuild** (config/env reload)                                                                    | no               |
| `start.sh` / `stop.sh`                 | `up -d` / `stop` the whole stack without rebuilding                                                                                                    | no               |
| `rollback.sh`                          | Revert the last deploy from `.last-deploy.json` (restore DB + `git reset` + rebuild)                                                                   | yes (all)        |
| `backup.sh`                            | Nightly `pg_dump` + Supabase Storage volume → Scaleway S3 (optional GPG). Cron-driven                                                                  | no               |
| `restore.sh [file\|--from-s3]`         | Restore Postgres and/or Storage from a backup (hardened, integrity-checked)                                                                            | no               |
| `status.sh [--errors]`                 | Container health, last deploy, API/DB/Redis, disk, recent logs                                                                                         | no               |
| `destroy.sh [--wipe-db\|--full\|svc…]` | Tear down containers / images / volumes / data (tiered; `backups/` + `.env` never touched)                                                             | no               |
| `vps-bootstrap.sh [--all]`             | One-time fresh-VPS provisioning (packages, Docker, UFW, fail2ban, swap, deploy user)                                                                   | —                |
| `test-restore-roundtrip.sh`            | Disposable-container integration test proving the DB restore is atomic + schema-coherent                                                               | —                |
| `lib/log.sh`                           | Sourced helper: colors + `ok/err/warn/hdr/info`, `confirm`, `require_cmd`                                                                              | —                |

## Which one do I run?

| I want to…                                  | Run                                                        |
| ------------------------------------------- | ---------------------------------------------------------- |
| Ship the latest `origin/main` to production | `deploy.sh`                                                |
| Rebuild just one app after a code change    | `redeploy.sh <svc> --pull`                                 |
| Re-read `.env` / restart without rebuilding | `refresh.sh <svc>`                                         |
| Undo the deploy I just did                  | `rollback.sh`                                              |
| Check whether everything is healthy         | `status.sh` (add `--errors` for warn/error log lines only) |
| Pull a backup back after data loss          | `restore.sh` (lists local + S3 backups with no args)       |
| Wipe the stack to redeploy from clean       | `destroy.sh --full` then `deploy.sh`                       |

App services referenced by the default sets: `api web-public web-staff web-admin
web-marketing worker`. Infra/stateful services (`db redis traefik ops-runner supabase-*`)
are never rebuilt by these scripts — they use published images.

## Not a script: a psql shell on the production DB

`db` publishes no host port, so there is nothing to connect to from outside. From the repo root
on the server:

```bash
docker compose --env-file .env -f infra/docker-compose.prod.yml \
  exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Desktop clients need an SSH tunnel to the container IP, and publishing 5432 would bypass UFW —
both covered in [`docs/ARCHITECTURE.md` §17.6](../../docs/ARCHITECTURE.md#176-reaching-postgres-directly).

## Shared conventions

- **`lib/log.sh`** — every script (except the two standalone ones below) sources this for
  consistent output and helpers. Colors auto-disable when stdout isn't a TTY.
- **`.env`** — loaded with `set -a; source ./.env; set +a`. Compose is always invoked with
  `--env-file "$ROOT_DIR/.env"` (absolute) so build args interpolate regardless of cwd.
- **Compose command** — built once as an array:
  `COMPOSE=(docker compose --env-file "$ROOT_DIR/.env" -f infra/docker-compose.prod.yml)`.
  `--dev-certs` appends the `infra/docker-compose.staging-certs.yml` overlay
  (Let's Encrypt **staging** certs — use while iterating to avoid rate limits).
  Staging certs break **realtime**, not just page loads: a browser lets you click
  through the interstitial to navigate, but does not extend that exception to the
  WebSocket handshake, so every live surface sits on "Reconnecting…". Devices that
  must see live data need the staging root installed once —
  `node scripts/trust-staging-ca.mjs` (see [scripts/README.md](../../scripts/README.md)).
- **`.deploy.lock`** — `deploy.sh`, `redeploy.sh`, and `rollback.sh` share one `flock` so
  they can't race each other.
- **`up -d` timeout** — `deploy.sh`/`redeploy.sh` bound `up -d` and treat the health poll,
  not the compose exit code, as the source of truth (compose's renderer can hang over SSH).
  `deploy.sh` allows 240s (the web tier waits on `api: service_healthy`) and retries once
  on an abnormal exit: a timeout that leaves a gated service un-recreated keeps its **old**
  container running and healthy, which the poll would happily accept.
- Two scripts are **standalone on purpose** and don't source `lib/log.sh`:
  `vps-bootstrap.sh` (needs an `_ask` prompt helper the lib lacks; runs at first
  provisioning) and `test-restore-roundtrip.sh` (self-contained test, plain PASS/FAIL).

## Linting

CI runs this in its own job (`Shellcheck infra scripts`), outside the Lint chain — nothing in
`pnpm`-land covers these files, so run it yourself after editing one:

```bash
shellcheck -x infra/scripts/*.sh infra/scripts/lib/*.sh
```

Three things about it are not guessable:

- **`-x` alone follows nothing.** ShellCheck reduces `source "$SCRIPT_DIR/lib/log.sh"` to
  `./lib/log.sh` and searches the source path, which defaults to the CWD. The repo-root
  `.shellcheckrc` sets `source-path=SCRIPTDIR` to resolve it against the script instead. Without
  that the job reports "Not following:" once per script and exits non-zero — which it did, for as
  long as the job existed.
- **A `# shellcheck` directive must sit immediately above the `source` line itself.** Above
  `set -a; source ./.env; set +a` it attaches to `set -a` and silences nothing, so those get split
  across three lines with `# shellcheck source=/dev/null` on the middle one.
- **Lint a clean checkout, not your working tree.** `.env`, `.env.e2e` and friends are gitignored
  but present on a real box, so ShellCheck follows them locally and stays quiet about sources that
  are unresolvable in CI. `git archive HEAD | tar -x -C "$(mktemp -d)"` and run it there.

## Cron

`backup.sh` is intended to run nightly. The editable schedule is now managed by the
ops-runner (`/admin/backups`); the legacy host cron entry was:

```cron
0 3 * * *  deploy  bash /srv/myclash/infra/scripts/backup.sh >> /srv/myclash/logs/backup.log 2>&1
```

## Related

- **Disaster recovery drill:** [`docs/DISASTER_RECOVERY.md`](../../docs/DISASTER_RECOVERY.md)
- **Infra review / rationale:** [`docs/INFRASTRUCTURE_REVIEW.md`](../../docs/INFRASTRUCTURE_REVIEW.md)
- **Compose stack:** [`infra/docker-compose.prod.yml`](../docker-compose.prod.yml)
- **Developer-side wrappers:** [`scripts/`](../../scripts/README.md)
