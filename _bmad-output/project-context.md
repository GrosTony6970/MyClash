---
project_name: 'MyClash'
user_name: 'Tony'
date: '2026-06-23'
sections_completed:
  [
    'technology_stack',
    'domain_vocabulary',
    'scoring_integrity',
    'security_data',
    'language_typescript',
    'frameworks',
    'database',
    'i18n',
    'testing',
    'code_quality_ci',
    'workflow',
    'gotchas',
    'adopted_standards',
  ]
existing_patterns_found: 14
status: 'complete'
rule_count: 53
optimized_for_llm: true
---

# Project Context for AI Agents

_Critical rules and patterns AI agents MUST follow when writing code in MyClash. Focus is on the **unobvious** — things an LLM would otherwise get wrong. The authoritative long-form sources are `CLAUDE.md` (rules), `docs/HIERARCHY.md` (vocabulary), `docs/ARCHITECTURE.md` (design). When any of those conflict, HIERARCHY wins for naming and ARCHITECTURE wins for design — but **verify versions against `package.json`, not ARCHITECTURE.md** (the doc has drifted; see below)._

---

## Technology Stack & Versions

**Monorepo:** pnpm 10.27 workspaces + Turborepo 2.1 · Node **≥26** · TypeScript 5.6 (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`; base `moduleResolution: bundler`).

**Apps** (`apps/*`): `api`, `web-admin`, `web-public`, `web-scoring`, `web-marketing` (static `index.html`, no Next runtime), `pictures`.
**Packages** (`packages/*`): `rulesets`, `db`, `types`, `i18n`, `ui`, `api-client`, `feature-flags`, `time`, `schedule-core`.

- **API** — **NestJS 11.1** on **Fastify 5** (`@nestjs/platform-fastify`) · BullMQ 5 / `@nestjs/bullmq` · `@nestjs/throttler` · `@nestjs/swagger` · `class-validator`/`class-transformer` · `jsonwebtoken` · `web-push` · `resend` (email) · `@supabase/supabase-js` · `pg` · `@sentry/nestjs`
- **Web** — **Next.js 16.2.6** (App Router) · **React 19.2** · **Tailwind v4** (`@tailwindcss/postcss`) · `@sentry/nextjs` · `@supabase/supabase-js`
- **DB** — **Drizzle ORM 0.45** + `drizzle-kit` 0.31 · `postgres` / `pg` · Postgres via **Supabase** (Auth, Storage, Realtime, RLS)
- **Rulesets** — **Zod 4.3** · TF_v1 engine · subpath export `@myclash/rulesets/scheduling`
- **AI** — `@anthropic-ai/sdk` · `@mistralai/mistralai` · `openai` (server-side only, in `api`)
- **Testing** — **Vitest 2** (unit) · **Playwright 1.59** (E2E, incl. offline) · `@axe-core/playwright` (a11y)

> ⚠️ **Version drift:** `docs/ARCHITECTURE.md` (draft v1.4) says NestJS 10 / Next 15. The code is **NestJS 11 / Next 16 / React 19 / Tailwind 4**. Trust `package.json`.

---

## Critical Implementation Rules

### Domain & Vocabulary (HIERARCHY.md is authoritative)

- Hierarchy: **Organization › Event › Tournament › (Pool | Bracket) › Match › Exchange**; Event also › Workshop › WorkshopSession.
- An **Event** is the public-facing gathering; a **Tournament** is what people register for and compete in. URLs mirror this: `/e/<event-slug>/t/<tournament-slug>`, `/e/<event-slug>/w/<workshop-slug>`.
- **Persons are scoped to the Event, not the Tournament.** One registration per event, then per-tournament registrations within it.
- Locked names — do not rename: tables `events, tournaments, workshops, workshop_sessions, pools, matches, exchanges, registrations`; routes `/api/v1/events/:id`, `/api/v1/tournaments/:id`, etc.
- French domain terms are fixed: Event→Événement, Tournament→Tournoi, Workshop→Atelier/Stage, Pool→Poule, Match→Assaut, Exchange→Échange.

### Scoring & Ruleset Integrity (the crown jewels — never compromise)

- **Never bypass the ruleset engine.** All scores derive from exchanges via `@myclash/rulesets`. **Do not store computed scores as the source of truth** — exchanges are the truth.
- **TF_v1 must reproduce the FAL 2026 reference data byte-for-byte.** If the golden test `packages/rulesets/test/tf_v1.fal2026.test.ts` (fixture `packages/rulesets/test/fixtures/fal2026.json`) fails, **fix the engine, never edit the snapshot.**
- **Offline scoring is non-negotiable.** Any change to `web-scoring` must preserve full offline functionality (IndexedDB queue → sync on reconnect). Offline E2E tests must pass.
- **No `eval` / `Function()` / dynamic code execution** for user-supplied formulas. Ruleset configs are validated with **Zod** and dispatched to **whitelisted** functions only.

### Security & Data

- **RLS first, application checks second.** Every new table gets an RLS policy. Never disable RLS in production code paths.
- **Hard constraint `enforce_fighter_referee_no_overlap` cannot be disabled** — a fighter may not referee a pool overlapping their own match (safety/integrity invariant).
- **Don't commit secrets.** `.env.example` is the canonical key list. Client-exposed env must respect the client-secret boundary — enforced by `pnpm security:client-secrets` (`scripts/check-client-secret-boundaries.mjs`).
- API route auth runs through a global AuthGuard: every route needs identity unless marked `@Public()`. (The old `security:routes` inventory gate was retired — do not look for it.)
- Auth is cookie/JWT based (Supabase Auth: magic-link + Google OAuth); `@fastify/cookie` + `jsonwebtoken` on the API.

### Language / TypeScript

- `noUncheckedIndexedAccess` is on: index access yields `T | undefined` — narrow before use; don't add non-null `!` to silence it.
- Cross-package shared types live in **`@myclash/types`** only. Leaking app-local types across the boundary is caught by `pnpm quality:shared-types` (`check-shared-type-leaks.mjs`).
- Library packages (`rulesets`, `db`, `types`, …) build to `dist/` via `tsc` and are consumed as `workspace:^`.
- **Module resolution is fixed per build target** (no per-package drift): browser/Next.js apps (`web-*`) use `module: ESNext` + `moduleResolution: bundler`; the Node API (`apps/api`) and all publishable libs use `Node16`. Libraries extend the shared **`tsconfig.lib.json`** (sets `Node16` + declaration emit) — a new lib MUST extend it, not `tsconfig.base.json` (whose `bundler` default suits apps, not libs). Path options (`outDir`/`rootDir`/`tsBuildInfoFile`) stay per-package (`extends` resolves them relative to the defining file). **Docker gotcha:** app Dockerfiles COPY root TS configs explicitly — any root config a package `tsconfig` extends (e.g. `tsconfig.base.json`, `tsconfig.lib.json`) MUST be in every builder's `COPY` line, or the in-image `tsc` build fails with `TS5083: Cannot read file`.

### Frameworks

- **API = NestJS on Fastify** (not Express). Use Nest DI/modules; request/response are Fastify types.
- **HTTP validation → Zod via `nestjs-zod`** (migration complete). **All** request DTOs use `createZodDto`. New API inputs: define `z.object({...}).strict()` (`.strict()` preserves `forbidNonWhitelisted`) and `export class XDto extends createZodDto(schema)`. **Never add a `class-validator` DTO.** The global `ZodOrClassValidationPipe` (`apps/api/src/common/zod-or-class-validation.pipe.ts`) routes `createZodDto` DTOs to Zod and anything else to the legacy `class-validator` pipe (kept as a defensive fallback; only the pipe test still exercises it). `main.ts` runs `cleanupOpenApiDoc()` so Zod DTOs render in OpenAPI (keeps `pnpm gen:api-client` isomorphic). Patterns: nested objects = nested `z.object` (use `.strict()` only where the original `@ValidateNested` forbade extras); `string | null` → `.nullish()`; query flags the handler parses itself (`parseInt`) stay `z.string()`. (Zod is also the rulesets/config validator.)
- **API error envelope = RFC 9457 `application/problem+json`** — the global `ApiExceptionFilter` (`apps/api/src/common/api-exception.filter.ts`, registered in `main.ts`) emits the standard `type`/`title`/`status`/`detail`/`instance` members plus legacy extension fields (`code`/`message`/`statusCode`/`details`) for back-compat, with `Content-Type: application/problem+json`. Throw standard Nest `HttpException`s and let the filter shape the body — don't hand-roll error responses. 5xx internals are never leaked.
- **Web = Next.js 16 App Router + React 19.** Default to Server Components; mark Client Components with `'use client'` only when needed. Public results pages are SSR for speed.
- Client/server data split: **mutations → NestJS API**; live reads → **Supabase Realtime**; aggregations → API endpoints. PostgREST/Supabase embeds are used for reads (see gotcha below).
- **Tailwind v4** (CSS-first config via `@tailwindcss/postcss`) — no `tailwind.config.js` v3 assumptions. Shared UI lives in `@myclash/ui`; tokens in `packages/ui/src/theme.css` (the `@myclash/design-tokens` package was deleted 2026-07-17).
- Heavy compute (bracket gen, ranking, stats) belongs off the main thread (Web Workers) so the scoring tablet never freezes.

### Database & Drizzle

- Schema, migrations, and client live in **`@myclash/db`**. Generate with `drizzle-kit generate`, apply with `drizzle-kit migrate`.
- Migrations are **forward-only and numbered** (e.g. `0058`, `0060`, `0061`). **Never edit a migration that has shipped** — add a new one.
- A `UNIQUE` constraint on a child table's FK-to-parent **flips** its PostgREST/Supabase `select(child(...))` embed from **array → object**. Normalize the shape (or `.map`) or you get runtime 500s. (See `memory/`.)
- DB review/perf is gated: `pnpm db:review`, `db:migrations:replay`, `db:perf:fixture`, `db:perf:explain`.

### Internationalization

- **All user-facing strings go through i18n** (`@myclash/i18n`). Never hardcode English.
- **Every `t()` key must resolve in both EN and FR.** Missing keys are caught by `packages/i18n/src/t-key-references.test.ts`. Add the key to both locales when you introduce it.
- **Translation keys are typed**: `t()` accepts `TranslationKey = KnownTranslationKey | (string & {})` — IDE autocomplete for all valid keys, while dynamically-built keys (template literals, variables) still compile. To catch typos at `tsc`, type key-bearing props/fields as the strict **`KnownTranslationKey`** union. Inline-literal typos are caught by the `t-key-references.test.ts` CI guard. Add new keys to **both** EN and FR.

### Testing

- Unit/integration: **Vitest** (`pnpm test` → `turbo run test`). E2E: **Playwright** (`pnpm test:e2e`), including the **offline** scoring suite.
- Acceptance criteria are **testable assertions** — if an AC says "X works", demonstrate X with a test.
- The **Golden Paths** (`docs/GOLDEN_PATHS.md`) GP-1…GP-4 are required passes before ship; matrix = desktop Chrome · mobile Safari · mobile Chrome.
- For the scoring engine, **write the test first** and guard with the FAL 2026 golden snapshot.
- **Coverage is gated in CI** (the `coverage` job runs `pnpm coverage`): enforced Vitest `coverage.thresholds` per package — **`@myclash/rulesets` holds the highest bar** (stmts/lines 78, branches 80, funcs 84), `apps/api` 70, `apps/web-scoring` 60. Don't lower a threshold to make CI pass — add tests. Packages without a `coverage` script (e.g. `db`, `web-admin`, `web-public`) aren't gated yet.

### Code Quality & CI Gates

- "Done" = `pnpm lint && pnpm typecheck && pnpm test` green (all via Turborepo). `--max-warnings 0` — warnings fail lint.
- Prettier is the formatter; a **pre-commit hook** (`simple-git-hooks` + `lint-staged`) auto-formats staged files.
- Custom repo rules live in `eslint-rules/`. Extra gates exist as scripts: `quality:todos`, `quality:api-docs`, `quality:complexity`, plus the security/db/infra/observability/perf checks in root `package.json` — run the relevant one when touching that area.

### Development Workflow

- Branch naming: `feat/<scope>-<short-name>` (also `fix/…`, `chore/…`). Commits follow **Conventional Commits** with a scope, e.g. `fix(schedule): …`, `feat(workshops): …` — **enforced by commitlint** via a `commit-msg` git hook (`@commitlint/config-conventional`; config in `commitlint.config.cjs`). A non-conforming message fails the commit.
- **One slice = one commit**, scoped to a single concern. Work lands directly on `main`; there is no branch-per-task or PR ritual, and `docs/BUILD_ORDER.md` is a historical record rather than a task queue.
- If a task is ambiguous or contradicts ARCHITECTURE/HIERARCHY, **stop and ask** — don't improvise. If it needs owner action (`[needs O-NNN]`), stop and notify.
- Before pushing, run the gate chain in `CONTRIBUTING.md` ("Before pushing") — `lint`/`typecheck`/`test` alone is not the CI check.
- Reusable rules learned the hard way live in `docs/ENGINEERING_LESSONS.md`; add to it when a slice uncovers one.

### Critical Don't-Miss Gotchas

- **PostgREST embed array↔object flip** on `UNIQUE(fk)` — normalize embeds (above).
- **Prod uses an untrusted dev cert on `api.myclash.fr`.** Prefer **same-origin `app.myclash.fr/api/*`** over cross-origin `api.myclash.fr` to avoid TLS/CORS failures in the browser.
- Don't trust `docs/ARCHITECTURE.md` for **versions** (drifted) — trust `package.json`.
- Don't store derived scores; don't disable RLS; don't edit shipped migrations; don't adjust the FAL golden snapshot to make a test pass.
- AI SDKs (Anthropic/Mistral/OpenAI) are **server-side only** (`apps/api`) — never ship their keys to a Next client bundle.

---

## Adopted Standards — Rollout Status

These conventions are **decided** (apply to all new code now). Each still needs a one-time _rollout_ task to enforce repo-wide; until that lands, follow the convention for new code and don't fight existing code that predates it.

- **Zod-via-`nestjs-zod` HTTP validation** — ✅ **shipped**: `nestjs-zod` 5.4 + dispatching `ZodOrClassValidationPipe` + `cleanupOpenApiDoc`; **every** request DTO migrated (all `modules/**/dto/*` + controller-inline DTOs + `staff/dto.ts`). class-validator remains only as the pipe's defensive fallback + its test. 1072 API tests green.
- **RFC 9457 `problem+json` error envelope** — ✅ **shipped** (API): `ApiExceptionFilter` emits the standard members + `application/problem+json`, as a superset of the legacy fields so existing clients keep working. _Follow-up:_ migrate FE consumers to read `detail`/`status` (today they read `message`).
- **Conventional Commits via commitlint** — ✅ **shipped** (`commitlint.config.cjs` + `commit-msg` hook via `simple-git-hooks`; `@commitlint/config-conventional`).
- **Per-package coverage thresholds** (`@myclash/rulesets` highest) — ✅ **shipped**: `rulesets` 78/80/84/78, `api` 70, `web-scoring` 60; enforced by the CI `coverage` job. _Follow-up:_ extend to `db`/`web-admin`/`web-public` (each needs a `coverage` script first).
- **Compile-time-typed i18n keys** — ✅ **shipped** (non-breaking): `@myclash/i18n` derives `KnownTranslationKey` from `en` and types `t()` as `KnownTranslationKey | (string & {})` (autocomplete + opt-in strict prop typing). _Follow-up (optional):_ refactor the ~100 dynamic call sites for full strict `t()` enforcement.
- **Module resolution: apps `bundler` / Node + libs `node16`** — ✅ **shipped**: added root `tsconfig.lib.json` (shared lib template: `Node16` + declaration); all 9 `packages/*` extend it (registered in Turbo `globalDependencies`). Web apps stay `bundler`; the Node API stays `node16`. (`node16` ≡ `nodenext` today.)

> Each rollout item is separate follow-up work (one PR each per "one task = one PR"). This file records the decision; it does not perform the migration.

---

## Usage Guidelines

**For AI agents:**

- Read this file before implementing any code; it supplements `CLAUDE.md`, `docs/HIERARCHY.md`, and `docs/ARCHITECTURE.md`.
- Follow all rules exactly. When in doubt, prefer the more restrictive option and **stop and ask** rather than improvise.
- Treat _adopted_ standards as binding for new code even where the rollout task is still _pending_.
- Verify versions against `package.json`, never against `docs/ARCHITECTURE.md`.

**For humans (maintenance):**

- Keep this file lean and agent-focused; update it when the stack or a convention changes.
- When a _pending_ rollout task ships, drop its "_rollout:_" note (the convention becomes plain reality).
- Remove rules that become obvious; review periodically for drift.

Last Updated: 2026-06-23
