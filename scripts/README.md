# scripts/

Cross-platform Node scripts that run on the **developer's machine** (Windows, macOS, Linux).

Distinct from [`infra/scripts/`](../infra/scripts/README.md) which runs **on the OVH VPS**.

| Script                       | Purpose                                                                               | Wired to                     |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| `deploy.ts`                  | SSHes to the VPS and invokes `infra/scripts/deploy.sh`                                | `pnpm deploy:prod`           |
| `rollback.ts`                | SSHes to the VPS and invokes `infra/scripts/rollback.sh` (needs an interactive TTY)   | `pnpm rollback:prod`         |
| `seed-min.ts`                | Seeds minimum data (super admin + one org)                                            | `pnpm seed:min`              |
| `gen-api-client.ts`          | Regenerates `@myclash/api-client` from a **running** API                              | `pnpm gen:api-client`        |
| `gen-ffamhe-penalty-seed.ts` | Emits the FFAMHE penalty-ruleset seed SQL                                             | run when the catalogue moves |
| `trust-staging-ca.mjs`       | Installs the LE **staging** root so a Windows device can use prod under `--dev-certs` | run per device               |

The five `.ts` scripts above run via `tsx` (TypeScript executor with no separate compile step). The
rest of this directory is `.mjs` run through `node` — 49 of them, plus their tests — and three
shell scripts that only CI runs (below).

`gen-api-client.ts` is not the gated way to refresh the API client: it needs a running API. The
committed client is checked by `pnpm quality:openapi-drift` (`check-openapi-drift.mjs`), which
emits the spec from a built `apps/api/dist`, and `pnpm openapi:client` is the same script with
`--write`. Use that one after an API change.

## The gate harness

Twenty-seven of the `.mjs` files are `check-*.mjs` CI gates, and **twenty-two of them run through
`defineGate`** in [`lib/gate.mjs`](lib/gate.mjs), which owns reporting, exit codes and
anti-vacuity. The five that do not are `check-bundle-budgets.mjs`, `check-edge-tls.mjs`,
`check-infra-review.mjs`, `check-performance-review.mjs` and `check-service-db-users.mjs`. Two
invariants there are easy to break and expensive when broken:

- **A gate that examined nothing must say so by name.** `defineGate` refuses a bare `scanned: 0`;
  declare it through `nothingToCount(reason)`. Otherwise a gate that silently scans zero files
  reports success. Beware the weaker version of the same bug: a `scanned` count over _files_ is
  blind to a collapsed _rule_ — a gate can read a thousand files, match nothing and exit 0. Count
  comparisons, not inputs.
- **A gate module must be inert on import.** `build-app-bundles.mjs` imports `parseRequiredEnv`
  out of `check-client-env-contract.mjs` on the production bundle path, so a gate that ran at
  import time would fire during a build.

`lib/` holds 54 modules, 12 of them with a test file beside them. The shared ones a new gate
reaches for are `gate.mjs`, `repo-scan.mjs` (the repo walker and its ignore list), `db-rules.mjs`,
`migrations.mjs`, `pinned-file.mjs` and `sql.mjs`. Forty carry `probe` in their name: 39 are the
checks and fixtures of the database probes (below), proved by the probe's own run in CI and not
by a unit test, and `realtime-edge-probe.mjs` belongs to `check-edge-tls.mjs`.
`pnpm test:scripts` runs `node --test` over `scripts/*.test.mjs`, `scripts/lib/*.test.mjs`,
`infra/ops-runner/*.test.mjs` and `eslint-rules/*.test.mjs`: a glob over **`.mjs`**, so a test
written as `.test.ts` is silently never run. It is also where a test lands that binds as hard as a
gate but does not want a gate's four registrations — the ESLint rules and the package manifests
both sit here for that reason.

Adding a gate takes four registrations — the `package.json` script (the gate **alone**, never
`&&`-chained), the `ci.yml` step with `if: '!cancelled()'`, an entry in `CI_GATES`
(`apps/api/src/modules/admin/ci-health/gates.ts`), and `CONTRIBUTING.md`. Only the first three are
gated, by `gates.drift.test.ts`.

## The database probes

Five scripts run SQL against a freshly replayed database and fail on any rule it breaks. CI's
Database replay job runs `pnpm db:migrations:replay` (`replay-db-migrations.mjs`) and then each of
them:

| Script                        | Wired to                       | Holds                                                                 |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `db-rls-probe.mjs`            | `pnpm db:rls-probe`            | What the anonymous visitor may read, and that no web role writes      |
| `db-merge-probe.mjs`          | `pnpm db:merge-probe`          | `merge_fighters` and `revert_fighter_merge`                           |
| `db-fightbook-probe.mjs`      | `pnpm db:fightbook-probe`      | The FightBook functions, one call after another                       |
| `db-fightbook-race-probe.mjs` | `pnpm db:fightbook-race-probe` | Two FightBook calls at once, on two connections                       |
| `db-cascade-probe.mjs`        | `pnpm db:cascade-probe`        | Deleting an Event, a Tournament, a phase or a club, on committed rows |

## Scripts other tools call

- **CI's Deploy migration run job** runs three shell scripts against the production image and the
  prod compose file: `check-service-db-users.sh` (each Supabase service logs in as its own
  database user), `check-realtime-socket.sh` (a browser socket receives a database change; it
  drives `realtime-socket-probe.mjs`) and `check-api-boot.sh` (the API starts, and a broken start
  exits 1; `check-api-boot.mjs` reads its log). They are bash because they drive `docker compose`
  on the CI runner, and the Shellcheck job lints them.
- **The VPS deploy** (`infra/scripts/deploy.sh`) calls `ensure-prod-env.mjs`,
  `ensure-vapid-env.mjs`, `bootstrap-super-admin.mjs`, `create-demo-org.mjs` and
  `install-e2e-ai-key.mjs`; `generate-system-versions.mjs` is called through
  `infra/scripts/lib/system-versions.sh`.
- **The E2E suite**: `run-e2e.mjs` is `pnpm test:e2e`, and `e2e-cleanup.mjs` is
  `pnpm e2e:cleanup`.

The FAL 2026 golden fixture has **no generator**. It lives at
`packages/rulesets/test/fixtures/fal2026.json`, is maintained by hand, and two of its entries carry
`_published_score` notes where the published source disagrees with the engine
(`docs/ENGINEERING_LESSONS.md`). An importer was planned early on and never written; do not go
looking for one.

`deploy.ts` and `rollback.ts` share one `.env.deploy` contract and one post-run verification path;
`rollback.ts` imports both from `deploy.ts` rather than restating them.

Use Node-based scripts here whenever a task could otherwise be a bash one-liner — Node works on Windows PowerShell without WSL.
