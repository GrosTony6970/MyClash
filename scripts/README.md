# scripts/

Cross-platform Node scripts that run on the **developer's machine** (Windows, macOS, Linux).

Distinct from [`infra/scripts/`](../infra/scripts/README.md) which runs **on the OVH VPS**.

| Script                       | Purpose                                                                               | Wired to                     |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| `deploy.ts`                  | SSHes to the VPS and invokes `infra/scripts/deploy.sh`                                | `pnpm deploy:prod`           |
| `rollback.ts`                | SSHes to the VPS and invokes `infra/scripts/rollback.sh` (needs an interactive TTY)   | `pnpm rollback:prod`         |
| `seed-min.ts`                | Seeds minimum data (super admin + one org)                                            | `pnpm seed:min`              |
| `gen-api-client.ts`          | Regenerates `@myclash/api-client` from running API                                    | run after API changes        |
| `gen-ffamhe-penalty-seed.ts` | Emits the FFAMHE penalty-ruleset seed SQL                                             | run when the catalogue moves |
| `trust-staging-ca.mjs`       | Installs the LE **staging** root so a Windows device can use prod under `--dev-certs` | run per device               |

The five `.ts` scripts above run via `tsx` (TypeScript executor with no separate compile step). The
rest of this directory is `.mjs` run through `node` — 34 of them, plus their tests.

## The gate harness

Nineteen of the `.mjs` files are `check-*.mjs` CI gates, and **fourteen of them run through
`defineGate`** in [`lib/gate.mjs`](lib/gate.mjs), which owns reporting, exit codes and
anti-vacuity. Two invariants there are easy to break and expensive when broken:

- **A gate that examined nothing must say so by name.** `defineGate` refuses a bare `scanned: 0`;
  declare it through `nothingToCount(reason)`. Otherwise a gate that silently scans zero files
  reports success. Beware the weaker version of the same bug: a `scanned` count over _files_ is
  blind to a collapsed _rule_ — a gate can read a thousand files, match nothing and exit 0. Count
  comparisons, not inputs.
- **A gate module must be inert on import.** `build-app-bundles.mjs` imports `parseRequiredEnv`
  out of `check-client-env-contract.mjs` on the production bundle path, so a gate that ran at
  import time would fire during a build.

`lib/` holds six shared modules — `gate.mjs`, `repo-scan.mjs` (the repo walker and its ignore
list), `db-rules.mjs`, `migrations.mjs`, `pinned-file.mjs`, `sql.mjs` — each with its own test.
`pnpm test:scripts` runs `node --test` over `scripts/*.test.mjs` and `scripts/lib/*.test.mjs`: a
glob over **`.mjs`**, so a test written as `.test.ts` is silently never run.

Adding a gate takes four registrations — the `package.json` script (the gate **alone**, never
`&&`-chained), the `ci.yml` step with `if: '!cancelled()'`, an entry in `CI_GATES`
(`apps/api/src/modules/admin/ci-health/gates.ts`), and `CONTRIBUTING.md`. Only the first three are
gated, by `gates.drift.test.ts`.

The FAL 2026 golden fixture has **no generator**. It lives at
`packages/rulesets/test/fixtures/fal2026.json`, is maintained by hand, and two of its entries carry
`_published_score` notes where the published source disagrees with the engine
(`docs/ENGINEERING_LESSONS.md`). An importer was planned early on and never written; do not go
looking for one.

`deploy.ts` and `rollback.ts` share one `.env.deploy` contract and one post-run verification path;
`rollback.ts` imports both from `deploy.ts` rather than restating them.

Use Node-based scripts here whenever a task could otherwise be a bash one-liner — Node works on Windows PowerShell without WSL.
