# scripts/

Cross-platform Node scripts that run on the **developer's machine** (Windows, macOS, Linux).

Distinct from [`infra/scripts/`](../infra/scripts/README.md) which runs **on the OVH VPS**.

| Script                 | Purpose                                                                               | Wired to              |
| ---------------------- | ------------------------------------------------------------------------------------- | --------------------- |
| `deploy.ts`            | SSHes to the VPS and invokes `infra/scripts/deploy.sh`                                | `pnpm deploy:prod`    |
| `rollback.ts`          | SSHes to the VPS and invokes `infra/scripts/rollback.sh`                              | `pnpm rollback:prod`  |
| `seed.ts`              | Seeds the local dev DB with sample data                                               | `pnpm seed`           |
| `seed-min.ts`          | Seeds minimum data (super admin + one org)                                            | `pnpm seed:min`       |
| `import-fal2026.ts`    | Builds the FAL 2026 fixture for the TF_v1 golden test                                 | run manually          |
| `gen-api-client.ts`    | Regenerates `@myclash/api-client` from running API                                    | run after API changes |
| `trust-staging-ca.mjs` | Installs the LE **staging** root so a Windows device can use prod under `--dev-certs` | run per device        |

All scripts run via `tsx` (TypeScript executor with no separate compile step).

Use Node-based scripts here whenever a task could otherwise be a bash one-liner — Node works on Windows PowerShell without WSL.
