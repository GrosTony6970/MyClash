# Contributing to MyClash

MyClash is built slice by slice, largely by AI coding agents working against a live test event.
This document covers the contribution process, required status checks, and development setup.

---

## Required status checks

Every pull request targeting `main` runs the following GitHub Actions jobs, all of which must pass before merging:

| Check                     | Workflow                                                 | What it does                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Install dependencies**  | `CI / Install dependencies`                              | `pnpm install --frozen-lockfile`                                                                                                                                                                                                     |
| **Build shared packages** | `CI / Build shared packages`                             | `pnpm turbo run build`, filtered to the 6 shared packages: `@myclash/types`, `rulesets`, `db`, `ui`, `i18n`, `api-client`                                                                                                            |
| **Typecheck**             | `CI / Typecheck`                                         | `pnpm turbo run typecheck` across all workspaces                                                                                                                                                                                     |
| **Lint**                  | `CI / Lint`                                              | `pnpm turbo run lint` **plus nineteen further independent gates and one build** — see [Before pushing](#before-pushing) for the full list. Each runs as its own step with `if: '!cancelled()'`, so one failure never hides the rest. |
| **Test**                  | `CI / Test`                                              | `pnpm turbo run test` (Vitest)                                                                                                                                                                                                       |
| **Dependency audit**      | `CI / Dependency audit`                                  | `pnpm audit --audit-level high`                                                                                                                                                                                                      |
| **Coverage**              | `CI / Coverage`                                          | `pnpm coverage` (enforced coverage thresholds)                                                                                                                                                                                       |
| **Playwright and Axe**    | `CI / Playwright and Axe`                                | `pnpm test:e2e` — Playwright end-to-end + Axe accessibility checks                                                                                                                                                                   |
| **Secret scan**           | `CI / Secret scan`                                       | Gitleaks secret scan                                                                                                                                                                                                                 |
| **Trivy image scan**      | `CI / Trivy production image scan`                       | Builds the api / web-admin / web-public / web-staff production images and scans them with Trivy (HIGH,CRITICAL)                                                                                                                      |
| **CodeQL**                | `CodeQL Security Scan / Analyze (javascript-typescript)` | Static security analysis                                                                                                                                                                                                             |

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
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d db redis supabase-auth supabase-rest supabase-realtime supabase-storage traefik

# 5. Start apps in dev mode (hot reload)
pnpm dev
```

Local URLs:

- `http://localhost:3001` — web-public
- `http://localhost:3002` — web-staff
- `http://localhost:3003` — web-admin
- `http://localhost:4000` — NestJS API
- `http://localhost:4000/api/docs` — Swagger UI

---

## Before pushing

`pnpm lint && pnpm typecheck && pnpm test` is **not** the full check — CI's Lint job runs twenty
further steps, and shared packages must be built first or a local pass proves nothing (`tsc`
resolves workspace deps from `dist/` on disk, not through the pnpm symlink).

`.github/workflows/ci.yml` is the source of truth. If this list and that file disagree, the
workflow wins.

```bash
# 1. Shared packages first — the API and apps typecheck against their dist/
pnpm turbo run build --filter="@myclash/types" --filter="@myclash/rulesets" \
  --filter="@myclash/db" --filter="@myclash/ui" --filter="@myclash/i18n" --filter="@myclash/api-client"

# 2. The three everyone knows about
pnpm turbo run typecheck
pnpm turbo run lint
pnpm turbo run test

# 3. The gates that actually fail CI, in the order CI runs them
pnpm quality:peers               # peerDependencyRules — a non-camelCase key no-ops silently
pnpm security:client-secrets     # no server secrets reachable from client bundles
pnpm quality:todos               # untracked debt markers
pnpm quality:source-bytes        # a raw NUL makes git call the file binary — no diff, no rg hit
pnpm quality:api-docs            # API doc coverage
pnpm quality:complexity          # per-function/file line budget
pnpm quality:test-code-leak      # test code kept out of the emit surface
pnpm quality:client-env          # client env build-arg contract
pnpm --filter @myclash/api build # required: OpenAPI is emitted by booting dist/app.module
pnpm quality:openapi-drift       # generated client vs live routes
pnpm quality:shared-types        # shared-type leaks
pnpm design:lint                 # designmd's own lint of DESIGN.md
pnpm quality:design-drift        # DESIGN.md vs packages/ui/src/theme.css
pnpm db:review                   # schema / RLS review gates
pnpm db:realtime-bindings        # an unpublished table in any binding kills the channel
pnpm db:perf:fixture
pnpm infra:review
pnpm observability:review
pnpm perf:review
pnpm test:scripts                # root scripts/ — outside the turbo graph
pnpm docs:mermaid                # a broken diagram renders as grey text, it does not throw
pnpm format:check
```

Run them as separate commands, not as one `&&` chain: each is an independent verdict, and chaining
is exactly how eight of these silently stopped running in CI for six weeks.

CI is the second line of defense, not the first.

---

## Workflow

Work is slice-based: the maintainer runs a live test event, reports issues, and each slice lands as
a scoped commit on `main`. `docs/BUILD_ORDER.md` is the historical build plan — it records how the
project was built, not what happens next.

Human contributions are welcome — open an issue first for non-trivial changes so the work can be
coordinated.

See `CLAUDE.md` for the full agent contract.

---

## Code style

- TypeScript strict mode everywhere.
- ESLint flat config (`eslint.config.mjs`) — no `any` without justification.
- Prettier for formatting (`.prettierrc`).
- All user-facing strings through `@myclash/i18n` — no hardcoded English.
- No `eval`, no `Function()`, no dynamic code execution.

---

## Code review tooling

The repository is analyzed by [code-review-graph](https://github.com/tirth8205/code-review-graph), which maintains a local knowledge graph of the codebase (files, symbols, and their relationships) at `.code-review-graph/graph.db`. It runs transparently and is gitignored — there is nothing to install or configure to contribute; it's an optional navigation aid for reviewers and AI agents working in the repo.

---

## Commit messages

**Conventional Commits**, enforced by commitlint through the `commit-msg` hook
(`commitlint.config.cjs`). A message in any other shape is rejected before the commit is created.

```text
feat(persons): add person lookup endpoint with pg_trgm fuzzy search

- GET /events/:id/persons/lookup?q=... returns masked email
- pg_trgm index on unaccent(given_name) + unaccent(family_name)
- Rate limited: 30 req/min per IP
```

Body and footer line length are unconstrained, so detailed bodies and long trailers are fine.

---

## Security

- Never commit secrets. Use `.env.example` as the canonical key list.
- RLS policies required on every new Postgres table.
- Report security vulnerabilities privately via GitHub Security Advisories.
