# Contributing to MyClash

MyClash follows a strict build-order workflow driven by an AI coding agent. This document covers the contribution process, required status checks, and development setup.

---

## Required status checks

Every pull request targeting `main` runs the following GitHub Actions jobs, all of which must pass before merging:

| Check                     | Workflow                                                 | What it does                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Install dependencies**  | `CI / Install dependencies`                              | `pnpm install --frozen-lockfile`                                                                                                                                                                                                          |
| **Build shared packages** | `CI / Build shared packages`                             | `pnpm turbo run build`, filtered to the 7 shared packages: `@myclash/types`, `rulesets`, `db`, `ui`, `design-tokens`, `i18n`, `api-client`                                                                                                |
| **Typecheck**             | `CI / Typecheck`                                         | `pnpm turbo run typecheck` across all workspaces                                                                                                                                                                                          |
| **Lint**                  | `CI / Lint`                                              | `pnpm turbo run lint` + `pnpm format:check`, plus the security (`security:routes`, `security:client-secrets`), code-quality (`quality:*`), `db:review`/`db:perf:fixture`, `infra:review`, `observability:review`, and `perf:review` gates |
| **Test**                  | `CI / Test`                                              | `pnpm turbo run test` (Vitest)                                                                                                                                                                                                            |
| **Dependency audit**      | `CI / Dependency audit`                                  | `pnpm audit --audit-level high`                                                                                                                                                                                                           |
| **Coverage**              | `CI / Coverage`                                          | `pnpm coverage` (enforced coverage thresholds)                                                                                                                                                                                            |
| **Playwright and Axe**    | `CI / Playwright and Axe`                                | `pnpm test:e2e` — Playwright end-to-end + Axe accessibility checks                                                                                                                                                                        |
| **Secret scan**           | `CI / Secret scan`                                       | Gitleaks secret scan                                                                                                                                                                                                                      |
| **Trivy image scan**      | `CI / Trivy production image scan`                       | Builds the api / web-admin / web-public / web-scoring production images and scans them with Trivy (HIGH,CRITICAL)                                                                                                                         |
| **CodeQL**                | `CodeQL Security Scan / Analyze (javascript-typescript)` | Static security analysis                                                                                                                                                                                                                  |

To configure these as required checks in GitHub:

1. Go to **Settings → Branches → Branch protection rules** for `main`.
2. Enable **Require status checks to pass before merging**.
3. Add each job name from the table above.
4. Enable **Require branches to be up to date before merging**.

---

## Development setup

```bash
# Prerequisites: Node 26+, pnpm 10.27+, Docker Desktop

# 1. Clone
git clone https://github.com/GrosTony6970/MyClash.git
cd MyClash

# 2. Install
pnpm install

# 3. Environment
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD and SUPABASE_JWT_SECRET

# 4. Start data services (Postgres, Redis, Supabase)
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d db redis supabase-auth supabase-rest supabase-realtime supabase-storage kong

# 5. Start apps in dev mode (hot reload)
pnpm dev
```

Local URLs:

- `http://localhost:3001` — web-public
- `http://localhost:3002` — web-scoring
- `http://localhost:3003` — web-admin
- `http://localhost:4000` — NestJS API
- `http://localhost:4000/api/docs` — Swagger UI

---

## Before opening a PR

Run the full check suite locally:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All three must exit 0. CI is the second line of defense, not the first.

---

## Workflow

This project follows the build order in `docs/BUILD_ORDER.md`. Tasks are picked in order by the AI coding agent. Human contributions are welcome — open an issue first for non-trivial changes so the work can be coordinated with the build order.

See `AGENTS.md` for the full agent contract and `docs/BUILD_ORDER.md` for the task list.

---

## Code style

- TypeScript strict mode everywhere.
- ESLint flat config (`eslint.config.mjs`) — no `any` without justification.
- Prettier for formatting (`.prettierrc`).
- All user-facing strings through `@myclash/i18n` — no hardcoded English.
- No `eval`, no `Function()`, no dynamic code execution.

---

## Commit messages

Reference the BUILD_ORDER task ID in every commit:

```
T-104b: add person lookup endpoint with pg_trgm fuzzy search

- GET /events/:id/persons/lookup?q=... returns masked email
- pg_trgm index on unaccent(given_name) + unaccent(family_name)
- Rate limited: 30 req/min per IP
```

---

## Security

- Never commit secrets. Use `.env.example` as the canonical key list.
- RLS policies required on every new Postgres table.
- Report security vulnerabilities privately via GitHub Security Advisories.
