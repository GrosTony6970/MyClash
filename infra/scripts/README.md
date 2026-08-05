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

App services referenced by the default sets: `api web-public web-scoring web-admin
web-marketing worker`. Infra/stateful services (`db redis traefik ops-runner supabase-*`)
are never rebuilt by these scripts — they use published images.

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
- Two scripts are **standalone on purpose** and don't source `lib/log.sh`:
  `vps-bootstrap.sh` (needs an `_ask` prompt helper the lib lacks; runs at first
  provisioning) and `test-restore-roundtrip.sh` (self-contained test, plain PASS/FAIL).

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
