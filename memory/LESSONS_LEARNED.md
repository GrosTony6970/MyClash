# LESSONS_LEARNED.md

> Permanent, reusable rules distilled from past errors, corrections, oversights, and bad technical choices.
>
> **Maintenance rules:**
>
> - Only record useful, general, reusable lessons. Skip lessons too narrow to recur.
> - When a new lesson supersedes an older one, update the old one — don't create a duplicate.
> - Never record the same lesson twice.
> - Each lesson must be **actionable** — phrased as an instruction or a rule, not a description.
>
> See `AGENTS.md` for the protocol.

---

## Architecture & design

- Scores are always **derived** from per-exchange data via the ruleset engine, never stored as an independent source of truth. Storing computed scores invites drift; deriving them keeps stats and rankings consistent.
- When data is deeply relational (Tournament → Event → Phase → Match → Exchange + cross-cutting Fighter/Club), choose Postgres over a document store. Document stores fight relational queries and cost more per read.
- Use Supabase for what it's good at (auth, storage, realtime, the DB itself) and a dedicated backend (NestJS) for business logic. Don't cram domain code into Postgres functions.
- Three frontend apps with shared `packages/ui` is preferable to a single mega-app when one of them (the scoring app) has materially different UX constraints (offline-first PWA).
- Every Drizzle `uuid('foo_id')` that points at a public-schema table must have BOTH a `.references(...)` chain in the Drizzle column declaration AND a `REFERENCES ...` clause in the SQL migration that creates the column. PostgREST embeds (`/rest/v1/foo?select=*,bar(...)`) resolve through `information_schema.referential_constraints`; without the SQL FK, the embed returns 400 "Could not find a relationship". Without the Drizzle reference, future generated migrations and introspection drift away from the live DB. The `auth.users` references are the deliberate exception: they live in a different schema and we don't cross-schema FK on purpose.
- Never use `import type { Foo }` for a class-validator-decorated DTO that NestJS reads via `@Body() / @Query() / @Param()`. The `type` keyword erases the import at compile time, so `Reflect.getMetadata('design:paramtypes', ...)` reflects the parameter as `Object` instead of `Foo`. The global ValidationPipe then builds an empty whitelist, and `forbidNonWhitelisted: true` rejects every property the client sends with `property X should not exist`. The first declared field in the payload is the one cited in the error. Fix: drop `type` from the import. `import type` is only safe for return-type-only DTO references (response interfaces never bound through a NestJS param decorator). Note: a unit-test reflection check would be the natural regression guard, but vitest's default esbuild transform doesn't emit `design:paramtypes` — so the test surface is integration-shaped (deploy + manual PATCH/POST) unless someone wires a swc/tsc transformer into vitest later.

## Domain integrity

- The **TF_v1 golden test** against FAL 2026 reference data is sacred. A failing snapshot test is a red flag — fix the engine, do not adjust the snapshot.
- Voiding an exchange must never destroy the row. Set `voided=true` and recompute. Replays must be lossless.
- Hard constraints in scheduling (e.g. `enforce_fighter_referee_no_overlap`) are **not configurable**. Soft constraints are.
- Each scoring exchange carries a **client-generated UUID**. Server inserts are idempotent on this UUID. This is what makes offline-first sync safe.

## Offline & realtime

- Sports halls have hostile wifi. Anything that runs at the piste must work fully offline. Test on real tablets in real venues, not just CI.
- The scoring app must always show explicit network state (online / syncing / offline / sync_error). The scorekeeper must always know.
- Realtime broadcast piggybacks on Postgres row changes via `LISTEN/NOTIFY` (Supabase Realtime). Never broadcast as a separate publish step — that introduces "what's stored vs what's sent" inconsistency.

## Frontend & UX

- For UI, **`/DESIGN.md` is canonical** — the "Tournament Manual" language (Fraunces + Geist, `#b91c1c` accent, gold for placings, FoilMark as the only ornament). Per-surface deltas live in `docs/design/`; token values in `packages/ui/src/theme.css`, gated by `pnpm design:lint`.
  - **Lesson (2026-07-17):** this line previously read _"the prototype design language (Cinzel + Inter, red/blue + gold, shield motifs) is canonical"_ and pointed at `docs/prototype/` — a directory that **only ever contained a README**. Three docs (`AGENTS.md`, `myclash.md`, here) plus a dead `packages/design-tokens` all asserted a Cinzel/Inter language the product had abandoned. Agents obeyed `AGENTS.md` and produced UI in it. **A design doc that isn't machine-checked against the tokens will drift, and every reader downstream inherits the drift.** That is why `design:lint` now diffs `DESIGN.md` against `theme.css` in CI.
- Personas are non-exclusive: a single user can be Competitor + Referee + Workshop attendee at the same event. Onboarding must be multi-select.
- The "My Schedule" view aggregates all of a user's commitments and surfaces conflicts. It is the most-used screen of the public PWA.
- Never use `localStorage` / `sessionStorage` in artifacts running in Claude.ai (these APIs aren't supported there). For real production code, use IndexedDB for offline state.
- Accessibility tests should capture page errors, keep color-contrast checks enabled, and assert keyboard activation on representative controls; an Axe-only smoke test can pass while runtime and keyboard regressions still exist.
- `t('foo.bar') || 'fallback'` does NOT work in this project's i18n. The translator at `packages/i18n/src/index.ts` returns `[foo.bar]` (a truthy bracketed string) when a key is missing — so the `||` short-circuits and the user sees the literal `[admin.x.y]` in the UI. Visible bracketed keys are a missing-translation signal, never a naming choice. Fix: add the key to **both** `en` and `fr` in `packages/i18n/src/index.ts`. The `as const satisfies Messages` constraint enforces structural parity; a build failure means you added it to one locale but not the other.

## Build process

- One task = one PR. Bundling unrelated changes makes review impossible and rollback expensive.
- Acceptance criteria are testable assertions. If you can't write the test, the AC is wrong, not the implementation.
- Run `pnpm lint && pnpm typecheck && pnpm test` before opening every PR. CI is the second line of defense, not the first.
- When a build task references an `[O-NNN]` owner-side prerequisite that's not done, **stop and notify the user**. Do not improvise around it.
- For local perf-budget builds of Next apps, allow a non-standalone build mode when standalone Docker output is irrelevant. It keeps budget scripts focused on route assets and avoids Windows/pnpm trace edge cases in local verification.
- When a workspace package becomes a new `dependency` of `@myclash/ui` (or any other widely-imported shared package), audit **every** app Dockerfile that builds it. Each Dockerfile must (a) `COPY packages/<new-pkg>/` into both the deps and builder stages, (b) include `--filter @myclash/<new-pkg>` in the install step, and (c) place `pnpm --filter @myclash/<new-pkg> build` **before** the consuming package's build step. `tsc` resolves `workspace:^` deps from `dist/index.d.ts` on disk, not via the pnpm symlink — wrong build order produces `TS2307: Cannot find module` even though `pnpm install` succeeded. Local `pnpm typecheck` won't catch this because it builds packages in topological order automatically; only Docker does it manually.
- NestJS module cycles (`A imports B → B imports C → C imports A`) sometimes boot fine in `vitest` and on local `pnpm start:dev` but crash at runtime in Docker with `UndefinedModuleException: The module at index [N] is undefined.` The cycle may already be there before you cause the crash — adding any new service that participates in cross-module DI shifts the init order. Fix: wrap **one** side of the cycle in `forwardRef(() => OtherModule)` — pick the side where the imported module is only consumed at provider-construction time (service injection), not at module-decoration time. Vitest is not a sufficient proof: it never resolves the full module graph. Test by booting `docker compose up api` (or running the compiled `node dist/main.js` locally) before merging any change that adds a cross-module `provider/inject`.
- Next 15/16 server-component `params` (and `searchParams`) is a `Promise`. Always `const { x } = await params;` in async server pages — reading `.x` synchronously on a Promise yields `undefined`, which template-literals to the string `"undefined"`. Symptoms in production: redirects to URLs like `/org/undefined/...`, downstream auth gates that compare the bogus slug to membership fail and bounce the user to `/login` (looks like "logged out", but `/api/v1/me` still returns 200). `pnpm typecheck` does **not** catch this — the sync type `{ params: { slug: string } }` is still TypeScript-legal in Next 16. After every Next major bump, grep `grep -rln "params: { " apps/*/app/` and convert every hit to `params: Promise<...>` + `await params`.

## Identity & auth

- The organizer is the source of truth for the roster. Participants never self-register; they only "find themselves" in a list and confirm. This is what makes guest sessions safe.
- Guest sessions sign with a separate JWT secret from Supabase auth. Crossing the streams creates an escalation vector — keep them strictly bounded.
- Mask emails in any endpoint a participant can hit anonymously. `j***@g***.com` is enough to recognize your own email; not enough for an attacker to harvest a roster.
- Name + club is the disambiguator for HEMA. Two "Jean Dupont" exist; "Jean Dupont · Lyon AMHE" and "Jean Dupont · Cercle PRMD" are distinct enough in 99% of cases.
- Treat `hema_ratings_id` as an external identity key only. Never use the numeric ID as a skill signal; seeding must use weapon-specific HEMA Weighted Rating rows, with defined staleness fallback.
- Fuzzy match with `pg_trgm` and `unaccent`. Don't try to do this client-side — accents and typos are language-specific and the index lives where the data lives.
- Capability boundaries between Guest and Claimed should be drawn at "anything that crosses devices" or "anything that edits." Casual users never need to claim; power users get a one-time magic link.
- **Migrate user-owned data atomically on claim.** Follow rows, push subscriptions, workshop enrollments, persona selections — all transfer from `guest_session_id` to `user_id` in the same transaction as the claim. Otherwise the user "loses" their state, which is terrible UX.
- **Default visibility follows the physical reality.** Anything that happens in shared physical space at the event (matches, referee slots, workshops) is public by default — the data just makes visible what's already visible IRL. Personal contact info (email, phone) is private by default. The opt-in/opt-out direction follows from "would the user be surprised to learn this is visible?"
- **Following relationships are private and one-directional.** Don't notify the followed person. Don't show "X is following you." This isn't a social network; the follow is just a personal bookmark.
- **Store one-time confirmation tokens as hashes only.** Email-change and similar workflows must persist a SHA-256 token hash, never the raw bearer token.
- When adding an organizer-side controller (any route under `/organizations/:orgId/...` that doesn't use `@UseGuards(SuperAdminGuard)`), resolve the caller via the local `async getUserId(req, supabase)` helper that validates the Supabase JWT — see ai-providers, leagues, persons, events, exports, organizations controllers. DO NOT copy the sync `getActorId(req)` shortcut from super-admin controllers: `req.actorUserId` is ONLY populated by `SuperAdminGuard`, so on a guard-less organizer route it's always undefined, the helper returns the literal string `'unknown'`, and every downstream `assertOrgRole(orgId, 'unknown', ...)` call 403s regardless of the caller's real role. Symptom: "403 on a page that should work for me as org admin" while other admin-gated endpoints on the same org succeed in the same session.

## Process & communication

- Read `AGENTS.md`, `MEMORY.md`, and `LESSONS_LEARNED.md` at the start of every session, in that order.
- Append every user instruction to `PROMPT_LOG.md` at session start.
- When information becomes obsolete in `MEMORY.md`, **delete or correct it**. Stale memory is worse than no memory.
- When an architectural question is silent or ambiguous in `ARCHITECTURE.md`, **ask before guessing**. Improvising 500 lines that need to be unwound costs more than a 30-second clarification.

## Cross-platform & deployment

- The owner's local OS is Windows. Repo scripts must be cross-platform — prefer Node-based scripts (`scripts/*.ts` invoked via pnpm) over bash for anything that runs on the developer machine.
- Bash scripts are fine for things that _only_ run server-side (on the OVH VPS). Place them in `infra/scripts/` and label them clearly.
- Enforce LF line endings via `.gitattributes` from day 1 — Windows checkouts will silently corrupt Docker entrypoint shell scripts otherwise.
- Migrations run **before** new code containers replace old ones, never after. Migration failure must abort the deploy and leave the previous version running.
- Docker images that run a workspace package script must package that workspace's production dependencies and execute the script from its package path; copying the script to `/app` can break Node module resolution for package-local dependencies.
- Do not use Drizzle's metadata migrator for hand-maintained raw SQL migration folders; production runners must match the repository's migration format and track applied raw files explicitly.
- Self-hosted Supabase migrations must bootstrap `auth.uid()` and `auth.jwt()` compatibility helpers before defining app RLS policies that reference them.
- Self-hosted Supabase Realtime must run its internal migrations with `DB_AFTER_CONNECT_QUERY='SET search_path TO _realtime'` and a provisioned `_realtime` schema; otherwise its internal tables can collide with application tables in `public`.
- Take a `pg_dump` immediately before every production migration. Without this, "rolling back a bad deploy" is a marketing slogan, not a procedure.
- Don't write a deploy script from scratch when the owner already has a working one for a similar app — read it first, adapt it, document what changed and why.
- Production deploy stays manual at v1; auto-deploy is for staging only. Friction on prod is a feature, not a bug.
- Deploy automation may generate cryptographic secrets, but must never invent external/provider-owned configuration such as DNS domains, email addresses, API keys, or OAuth credentials; prompt or fail instead.
- Validate file bind-mount sources before `docker compose up`: if a host file path is missing, Docker may create a directory and mount it into the container, so generated file artifacts must be recreated as files and checked with `-f`/`-s`.

## MyFAL scripting conventions (reused for MyClash)

The owner's MyFAL deployment uses a polished set of bash scripts. MyClash inherits these conventions verbatim:

- **Shared `lib/log.sh`** sourced by every script — colors auto-disabled on non-TTY, helpers are `ok`/`err`/`warn`/`hdr`/`info`. One source of truth for output style.
- `set -Eeuo pipefail` on every bash script — fail fast, fail loud.
- `ROOT_DIR` resolution via `cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd` — script can be run from anywhere.
- `docker compose --env-file .env` flag is **always** explicit, never relying on default detection.
- `.env` is validated up front; missing critical variables abort with a clear message.
- Idempotent file initialization (`[[ -f X ]] || touch X`, `: > log.txt`) so re-runs don't fail.
- Health check loops use `RETRIES × DELAY` pattern with clear progress logging.
- Auto-generate VAPID keys if missing — never block the deploy on a manual setup step that can be automated.

When in doubt about a deploy/ops convention: look at the MyFAL scripts first. They're in production, they work.

---

_(New lessons added below as they are learned.)_

## NestJS + Vitest testing

- **Do not use `Test.createTestingModule()` with `useValue` mocks in Vitest** — the NestJS DI container requires `emitDecoratorMetadata` to be active at test runtime, which Vitest doesn't guarantee. `useValue` mocks silently fail to inject, leaving `this.dependency` as `undefined`. Use direct instantiation instead: `new MyService(mockDep1 as never, mockDep2 as never)`. This is simpler, faster, and avoids the DI resolution problem entirely.
- **`@Global()` modules in test modules** — even with `useFactory`, global modules can cause unexpected re-instantiation. Prefer direct instantiation for unit tests; reserve `Test.createTestingModule()` for integration tests where the full module graph is needed.

- **NestJS Throttler named profiles are additive globally.** In `@nestjs/throttler` v6, every configured named throttler applies to every route unless skipped. For route-specific limits, keep the module-level profile simple and override `global` with `@Throttle(...)` on the route; do not add named profiles expecting them to apply only when referenced.

## Ruleset engine

- **Build before typecheck**: `@myclash/rulesets` must be built (`pnpm --filter @myclash/rulesets build`) before the API can typecheck. The API uses `moduleResolution: node` → resolves to `dist/`. In CI, `build-packages` runs before `typecheck`.
- **Docker builds must copy workspace package sources, not rely on local `dist/`**: if an app imports a workspace package, its production Dockerfile must copy that package manifest/source and build it inside the image. Local `dist/` output can mask missing Docker build inputs.
- **`doublePenalty(-0)` trap**: `n*(n-1)/3` returns `-0` for `n=0`. Guard with `if (n <= 1) return 0` to avoid `-0 !== 0` test failures.
- **FAL 2026 golden test**: 2 entries have `_published_score` notes where the source page shows a different value than the formula produces (rounding boundary at 1.545→1.5 and 1.645→1.6). The fixture stores the formula-correct value. This is expected and documented.

## Email & transactional messaging

- **Use Resend SDK directly in NestJS** (not SMTP) for transactional emails. The SDK is typed, gives structured error objects, and avoids SMTP connection management. GoTrue (Supabase Auth) can still use SMTP for its own internal emails (email verification, password reset) — those are separate from NestJS-sent magic links.
- **Always send bilingual emails (FR + EN)** for MyClash — the HEMA community is international and the platform is French-first but not French-only.
- **Never reveal whether an email is registered** in magic-link endpoints. Always return the same generic message regardless of whether the email exists. This prevents email enumeration attacks on the participant roster.

## Auth & cookies

- **`@fastify/cookie` must be registered via `require()` in NestJS** when using the Fastify adapter — the ESM default import (`import fastifyCookie from '@fastify/cookie'`) produces a TypeScript type mismatch with `app.register()`. Use `const fastifyCookie = require('@fastify/cookie')` and access `.default` if present.
- **`SUPABASE_URL` in Docker is `http://kong:8000`** (internal network name), not `http://localhost:8000`. In dev without Docker it's `http://localhost:8000`. Always use the env var, never hardcode.
- **For self-hosted Supabase OAuth, provider redirect URIs point to GoTrue** (`/auth/v1/callback`). App callback routes belong in `GOTRUE_URI_ALLOW_LIST`; do not put app callback URLs in the Google Cloud OAuth client.
- **For server-side self-hosted Supabase Auth checks, prefer the internal GoTrue URL** (`SUPABASE_AUTH_INTERNAL_URL`) over browser/public app URLs. Public routing can be correct for OAuth/browser flows while still being the wrong path for API token exchange or `/user` validation.

## Scheduling & bracket generation

- **Pool size math**: with K clubs × M fighters each and P pools, 0 same-club pairs is only achievable if M ≤ P (1 fighter per club per pool). With M=4 and P=3, minimum is 6 pairs — the test fixture must reflect what's mathematically achievable.
- **Bracket seeding algorithm**: the standard recursive bracket seeding (1 vs size, 2 vs size-1) is built by starting with `[1]` and repeatedly inserting `complement - seed` after each seed, where `complement = currentLength * 2 + 1`. The naive "positions = [1,2]; double by inserting size+1-pos" approach produces wrong pairings.
- **Configurable sizes**: always expose both `poolCount` and `targetSize` for pool generation, and `bracketSize` for elimination brackets. Organizers think in target sizes, not counts.
- **Pure scheduling functions**: keep all scheduling algorithms in `packages/rulesets/src/scheduling/` as pure functions. The NestJS service layer (`pool-generator.ts`) handles DB access and orchestration. This makes the algorithms independently testable and usable client-side (Web Worker).

## Vitest mock chains for Supabase (ESLint-safe pattern)

- **Never put a `then` property on a mock chain object.** ESLint's `no-misused-promises` rule treats any object with a `then` method as a Promise, and flags it when spread (`{ ...chain }`) or used in certain async contexts. The `then` property was used to make chains awaitable — remove it entirely.
- **Never spread a Promise** (`{ ...somePromise, extra: ... }`). This also triggers `no-misused-promises`. Use `Object.assign(promise, extraMethods)` instead.
- **Two mock chain patterns** — choose based on how the service uses the chain:
  1. **Plain chain** (service calls `.maybeSingle()` or `.single()` as terminal): `makeChain(result)` returns a plain object with all builder methods returning `this`. Terminal methods return `Promise.resolve(result)`.
  2. **Awaitable chain** (service does `const { data } = await q` with no terminal call): `makeAwaitableChain(result)` = `Object.assign(Promise.resolve(result), methods)` where every builder method returns the Promise object itself (not a separate base object). This is the critical fix — if builder methods return a different object, `await chain.select().eq()` awaits the wrong thing and resolves to `undefined`.
- **`makeAwaitableChain` double-cast**: when assigning to keys of a `Promise & {...}` intersection type, TypeScript rejects `(chain as Record<string, unknown>)` with TS2352 because the types don't overlap enough. Always cast through `unknown` first: `(chain as unknown as Record<string, unknown>)[key] = ...`. This applies any time you use `Object.assign(Promise.resolve(...), methods)` and then try to mutate the result's properties in a loop.

## React hooks ESLint rules (eslint-plugin-react-hooks v5+)

- **`react-hooks/set-state-in-effect`**: do NOT call `setState` synchronously in a `useEffect` body. All state updates must happen inside async callbacks (`.then()`, `setTimeout`, event handlers). For data fetching, use the AbortController + `.then()/.catch()` pattern with a `cancelled` flag. For triggering re-fetches, use a `refreshKey` state incremented by a `refresh` callback.
- **`react-hooks/purity`**: do NOT call impure functions like `Date.now()` directly in the render body or in derived values computed during render. Move them into `useEffect` or `useCallback`.
- **`react-hooks/refs`**: do NOT write to `ref.current` during render (`ref.current = value` in the component body). Use `useEffect(() => { ref.current = value; }, [value])` instead.
- **`@next/next/no-html-link-for-pages`**: always use `<Link href="...">` from `next/link` for internal navigation. Never use `<a href="...">` for same-app routes.

## Prettier / formatting

- **Always run `pnpm format` (prettier --write) before the first commit on a new repo or after adding many new files.** The CI `format:check` step will fail if files were never formatted. A one-time bulk pass fixes it; after that, lint-staged keeps everything clean automatically.
- **Use lint-staged + simple-git-hooks for pre-commit auto-format**, not a CI auto-commit step. CI committing back to branches is fragile and creates merge conflicts. Pre-commit hooks are the right layer.
- **After a fresh clone, run `pnpm install`** — the `prepare` script re-registers the git hooks via `simple-git-hooks`. Without this, the pre-commit hook won't fire on a new machine.
- **TypeScript TS2352 on `Promise & {...}` intersections**: casting a `Promise<T> & { methods... }` intersection directly to `Record<string, unknown>` fails because the types don't overlap enough. Always cast through `unknown` first: `(chain as unknown as Record<string, unknown>)`.

## Pre-push verification (MANDATORY)

- **Always run `pnpm turbo run typecheck` AND `pnpm turbo run lint` locally before every `git push`.** CI is the second line of defense, not the first. Pushing broken code wastes CI minutes and creates noise.
- **Never rely on per-package checks alone** (`pnpm --filter X typecheck`). Always run the full turbo pipeline — other packages may be affected by changes in shared packages or imports.
- **When removing an import from a line**, check whether removing that symbol empties the entire import statement. An empty `import {} from 'module'` or a deleted import line will silently break other symbols from the same module (e.g. removing `useRouter` from `import { useParams, useRouter } from 'next/navigation'` must leave `import { useParams } from 'next/navigation'`, not delete the line).
