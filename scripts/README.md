# scripts/

Cross-platform Node scripts that run on the **developer's machine** (Windows, macOS, Linux).

Distinct from [`infra/scripts/`](../infra/scripts/README.md) which runs **on the OVH VPS**.

| Script                 | Purpose                                                                               | Wired to              |
| ---------------------- | ------------------------------------------------------------------------------------- | --------------------- |
| `deploy.ts`            | SSHes to the VPS and invokes `infra/scripts/deploy.sh`                                | `pnpm deploy:prod`    |
| `rollback.ts`          | SSHes to the VPS and invokes `infra/scripts/rollback.sh` (needs an interactive TTY)   | `pnpm rollback:prod`  |
| `seed-min.ts`          | Seeds minimum data (super admin + one org)                                            | `pnpm seed:min`       |
| `gen-api-client.ts`    | Regenerates `@myclash/api-client` from running API                                    | run after API changes |
| `trust-staging-ca.mjs` | Installs the LE **staging** root so a Windows device can use prod under `--dev-certs` | run per device        |

The five `.ts` scripts above run via `tsx` (TypeScript executor with no separate compile step). The
rest of this directory is `.mjs` run through `node` — 34 of them, plus their tests.

The FAL 2026 golden fixture has **no generator**. It lives at
`packages/rulesets/test/fixtures/fal2026.json`, is maintained by hand, and two of its entries carry
`_published_score` notes where the published source disagrees with the engine
(`docs/ENGINEERING_LESSONS.md`). `docs/BUILD_ORDER.md` T-203 planned an importer that was never
written; do not go looking for one.

`deploy.ts` and `rollback.ts` share one `.env.deploy` contract and one post-run verification path;
`rollback.ts` imports both from `deploy.ts` rather than restating them.

Use Node-based scripts here whenever a task could otherwise be a bash one-liner — Node works on Windows PowerShell without WSL.
