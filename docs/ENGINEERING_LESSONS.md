# Engineering lessons

Reusable rules distilled from past errors and bad calls in this repo. Read on demand — when you
are about to touch one of these areas — not cover-to-cover.

Each entry is phrased as an instruction. If one turns out to be wrong, **correct or delete it**;
a stale lesson is worse than none. Verification-gate rules live in the `myclash-gates` skill, not
here.

---

## Architecture & design

- Scores are **derived** from per-exchange data via the ruleset engine, never stored as an
  independent source of truth. Stored aggregates drift; derived ones keep stats and rankings
  consistent.
- Deeply relational data (Tournament → Event → Phase → Match → Exchange, plus cross-cutting
  Fighter/Club) belongs in Postgres, not a document store.
- Use Supabase for what it is good at (auth, storage, realtime, the DB) and NestJS for business
  logic. Don't push domain code into Postgres functions.
- Three frontend apps over a shared `packages/ui` beats one mega-app, because the scoring app has
  materially different constraints (offline-first PWA).
- Every `uuid` column pointing at a public-schema table needs a real `REFERENCES ...` clause in
  the migration, not just a naming convention. PostgREST embeds resolve through
  `information_schema.referential_constraints`, so without the FK the embed 400s with "Could not
  find a relationship" — the column works fine for reads and writes, and only the embed fails.
  `auth.users` references are the deliberate exception: different schema, no cross-schema FK on
  purpose. (This lesson used to require the same reference in a Drizzle column too; that mirror
  was deleted in 2026-08 — the SQL is now the only declaration, which is one fewer place to
  forget.)
- Never use `import type { Foo }` for a class-validator DTO that NestJS reads through
  `@Body()/@Query()/@Param()`. The `type` keyword erases the import, so
  `Reflect.getMetadata('design:paramtypes', …)` sees `Object` instead of `Foo`, the global
  ValidationPipe builds an empty whitelist, and `forbidNonWhitelisted: true` rejects every
  property the client sends with `property X should not exist` — citing whichever field came
  first in the payload. `import type` is safe only for return-type-only DTO references. A unit
  test won't guard this: vitest's default esbuild transform doesn't emit `design:paramtypes`.

## Domain integrity

- The **TF_v1 golden test** against FAL 2026 reference data is sacred. A failing snapshot means a
  broken engine — fix the engine, never the snapshot.
- Voiding an exchange must never delete the row. Set `voided=true` and recompute; replays stay
  lossless.
- Hard scheduling constraints (e.g. `enforce_fighter_referee_no_overlap`) are not configurable.
  Soft ones are.
- Every scoring exchange carries a **client-generated UUID**, and server inserts are idempotent on
  it. That is what makes offline-first sync safe.

## Offline & realtime

- Sports halls have hostile wifi. Anything running at the piste must work fully offline, verified
  on real tablets in real venues — not only in CI.
- The scoring app must always show explicit network state (online / syncing / offline /
  sync_error). The scorekeeper must never have to guess.
- Realtime broadcast piggybacks on Postgres row changes (Supabase Realtime). Never broadcast as a
  separate publish step — that creates a "what's stored vs what's sent" split.

## Frontend & UX

- For UI, **`DESIGN.md` is canonical** — the "Tournament Manual" language (Fraunces + Geist,
  `#b91c1c` accent, gold for placings, FoilMark as the only ornament). Per-surface deltas live in
  `docs/design/`; token values in `packages/ui/src/theme.css`, gated by `pnpm design:lint`.
  - **Why the gate exists (2026-07-17):** this line once claimed a Cinzel + Inter "prototype"
    language was canonical and pointed at `docs/prototype/`, a directory that only ever held a
    README. Three docs plus a dead `packages/design-tokens` all asserted a language the product
    had abandoned, and agents dutifully built UI in it. **A design doc that is not machine-checked
    against the tokens will drift, and every reader downstream inherits the drift.**
- Personas are non-exclusive: one user can be Competitor + Referee + Workshop attendee at the same
  event. Onboarding must be multi-select.
- "My Schedule" aggregates all of a user's commitments and surfaces conflicts. It is the most-used
  screen of the public PWA.
- `t('foo.bar') || 'fallback'` does **not** work here. The translator in
  `packages/i18n/src/index.ts` returns `[foo.bar]` — a truthy bracketed string — when a key is
  missing, so the `||` never fires and users see `[admin.x.y]`. Visible bracketed keys are always
  a missing-translation signal. Fix by adding the key to **both** `en` and `fr`; the
  `as const satisfies Messages` constraint turns a one-locale addition into a build failure.
- Accessibility tests should capture page errors, keep colour-contrast checks on, and assert
  keyboard activation on representative controls. An Axe-only smoke test passes while real runtime
  and keyboard regressions survive.

## Build & packaging

- When a workspace package becomes a new dependency of `@myclash/ui` (or any widely-imported
  shared package), audit **every** app Dockerfile: it must (a) `COPY packages/<new-pkg>/` into
  both the deps and builder stages, (b) add `--filter @myclash/<new-pkg>` to the install step, and
  (c) run `pnpm --filter @myclash/<new-pkg> build` **before** the consuming package's build.
  `tsc` resolves `workspace:^` deps from `dist/index.d.ts` on disk, not through the pnpm symlink,
  so the wrong order gives `TS2307: Cannot find module` despite a successful `pnpm install`.
  Local `pnpm typecheck` cannot catch this — it builds in topological order automatically; only
  Docker does it by hand.
- NestJS module cycles (`A → B → C → A`) can boot fine under vitest and `pnpm start:dev` yet crash
  in Docker with `UndefinedModuleException: The module at index [N] is undefined`. The cycle is
  often already present — adding any service that participates in cross-module DI just shifts init
  order. Fix by wrapping **one** side in `forwardRef(() => OtherModule)`, choosing the side where
  the module is consumed at provider-construction time rather than module-decoration time. Vitest
  never resolves the full module graph, so prove it by booting `docker compose up api` (or the
  compiled `node dist/main.js`) before merging.
- Next 15/16 server-component `params` and `searchParams` are Promises. Always
  `const { x } = await params;`. Reading `.x` synchronously yields `undefined`, which
  template-literals into the string `"undefined"` — producing redirects to `/org/undefined/...`
  and auth gates that bounce the user to `/login` while `/api/v1/me` still returns 200.
  `pnpm typecheck` does **not** catch it: the sync type is still legal in Next 16. After every
  Next major bump, `grep -rln "params: { " apps/*/app/` and convert every hit.
- When a build task references an `[O-NNN]` owner-side prerequisite that is not done, **stop and
  notify the user** (`docs/OWNER_TASKS.md`). Do not improvise around it.
- For local perf-budget builds of Next apps, allow a non-standalone build mode — it keeps budget
  scripts on route assets and avoids Windows/pnpm trace edge cases.

## Identity & auth

- The organizer is the source of truth for the roster. Participants never self-register; they find
  themselves in a list and confirm. That is what makes guest sessions safe.
- Guest sessions sign with a **separate** JWT secret from Supabase auth. Crossing the streams is
  an escalation vector.
- Mask emails on any endpoint a participant can hit anonymously. `j***@g***.com` is enough to
  recognise your own address and not enough to harvest a roster.
- Name + club is the HEMA disambiguator. Two "Jean Dupont" exist; "Jean Dupont · Lyon AMHE" and
  "Jean Dupont · Cercle PRMD" are distinct enough in practice.
- Treat `hema_ratings_id` as an external identity key only — never as a skill signal. Seeding uses
  weapon-specific HEMA Weighted Rating rows with a defined staleness fallback.
- Fuzzy-match with `pg_trgm` + `unaccent`, server-side. Accents and typos are language-specific and
  the index lives where the data lives.
- Draw the Guest/Claimed capability boundary at "crosses devices" or "edits". Casual users never
  need to claim; power users get a one-time magic link.
- **Migrate user-owned data atomically on claim** — follows, push subscriptions, workshop
  enrollments, persona selections all move from `guest_session_id` to `user_id` in the same
  transaction. Otherwise the user simply loses their state.
- **Default visibility follows physical reality.** What happens in shared physical space at the
  event (matches, referee slots, workshops) is public by default; personal contact details are
  private. The test is "would the user be surprised to learn this is visible?"
- **Follows are private and one-directional.** Don't notify the followed person, don't show
  "X is following you". It is a bookmark, not a social graph.
- **Store one-time confirmation tokens as hashes only** — persist a SHA-256 hash, never the raw
  bearer token.
- On any organizer-side route under `/organizations/:orgId/...` that does not use
  `@UseGuards(SuperAdminGuard)`, resolve the caller with the local `async getUserId(req, supabase)`
  helper that validates the Supabase JWT. Do **not** copy the sync `getActorId(req)` shortcut from
  super-admin controllers: `req.actorUserId` is only populated by `SuperAdminGuard`, so on a
  guard-less route it is undefined, the helper returns the literal `'unknown'`, and every
  `assertOrgRole(orgId, 'unknown', …)` 403s regardless of the caller's real role. Symptom: "403 on
  a page that should work for me as org admin" while other org-gated endpoints succeed in the same
  session.

## Auth & cookies

- **`@fastify/cookie` must be registered via `require()`** under the Fastify adapter — the ESM
  default import type-mismatches `app.register()`. Use
  `const fastifyCookie = require('@fastify/cookie')` and read `.default` if present.
- **Never hardcode `SUPABASE_URL`.** It is Traefik-fronted per environment
  (`https://api.myclash.localhost` in dev compose, `https://app.${DOMAIN}` in prod), not a
  container name — Kong was removed from the stack. Always read the env var.
- For self-hosted Supabase OAuth, provider redirect URIs point at **GoTrue**
  (`/auth/v1/callback`). App callback routes belong in `GOTRUE_URI_ALLOW_LIST`, never in the
  Google Cloud OAuth client.
- For server-side auth checks prefer the internal GoTrue URL (`SUPABASE_AUTH_INTERNAL_URL`).
  Public routing can be correct for browser OAuth flows and still be the wrong path for token
  exchange or `/user` validation.

## Email & transactional messaging

- Use the **Resend SDK directly** in NestJS, not SMTP: typed, structured errors, no connection
  management. GoTrue keeps its own SMTP for verification/reset mails — separate concern.
- Send **bilingual (FR + EN)** emails. The platform is French-first, not French-only.
- **Never reveal whether an email is registered** in magic-link endpoints. Return the same generic
  message either way, or the roster becomes enumerable.

## Ruleset engine

- **`doublePenalty(-0)` trap**: `n*(n-1)/3` returns `-0` at `n=0`. Guard with
  `if (n <= 1) return 0` — `-0 !== 0` breaks tests.
- **FAL 2026 golden fixture**: two entries carry `_published_score` notes where the source page
  shows a different value than the formula produces (rounding boundaries 1.545→1.5 and
  1.645→1.6). The fixture stores the formula-correct value; this is expected.
- Docker builds must copy workspace package **sources** and build them in the image — a local
  `dist/` can mask a missing Docker build input.

## Scheduling & bracket generation

- **Pool size math**: with K clubs × M fighters and P pools, zero same-club pairs is only possible
  when M ≤ P. At M=4, P=3 the minimum is 6 pairs — fixtures must assert what is mathematically
  achievable.
- **Bracket seeding**: build the standard recursive seeding by starting from `[1]` and repeatedly
  inserting `complement - seed` after each seed, where `complement = currentLength * 2 + 1`. The
  naive "double by inserting size+1-pos" approach produces wrong pairings.
- Expose both `poolCount` and `targetSize` for pools, and `bracketSize` for brackets — organizers
  think in target sizes, not counts.
- Keep scheduling algorithms as pure functions in `packages/rulesets/src/scheduling/`; the NestJS
  layer (`pool-generator.ts`) does DB access and orchestration. That keeps them independently
  testable and usable in a Web Worker.

## Testing

- **Do not use `Test.createTestingModule()` with `useValue` mocks in vitest.** The DI container
  needs `emitDecoratorMetadata` active at test runtime, which vitest doesn't guarantee — mocks
  silently fail to inject and dependencies land as `undefined`. Instantiate directly:
  `new MyService(mockDep1 as never, mockDep2 as never)`. Reserve `Test.createTestingModule()` for
  integration tests that genuinely need the module graph.
- **`@Global()` modules can re-instantiate unexpectedly** in test modules even with `useFactory`.
  Same remedy: direct instantiation.
- **NestJS Throttler named profiles are additive globally.** In `@nestjs/throttler` v6 every named
  throttler applies to every route unless skipped. For route-specific limits keep the module-level
  profile simple and override `global` with `@Throttle(...)` on the route.
- **Supabase mock chains** — never put a `then` property on a mock chain object, and never spread
  a Promise. ESLint's `no-misused-promises` treats any object with `then` as a Promise and flags
  it. Two patterns, chosen by how the service consumes the chain:
  1. **Plain chain** (service calls `.maybeSingle()`/`.single()` as terminal): `makeChain(result)`
     returns a plain object whose builder methods return `this`; terminals return
     `Promise.resolve(result)`.
  2. **Awaitable chain** (service does `const { data } = await q` with no terminal):
     `Object.assign(Promise.resolve(result), methods)`, where every builder method returns _the
     Promise object itself_. If a builder returns a different object,
     `await chain.select().eq()` awaits the wrong thing and resolves `undefined`.
- **TS2352 on `Promise & {...}` intersections**: cast through `unknown` first —
  `(chain as unknown as Record<string, unknown>)[key] = …`. Applies whenever you `Object.assign`
  onto a Promise and then mutate its properties.

## Lint rules that bite

- **`react-hooks/set-state-in-effect`**: never call `setState` synchronously in a `useEffect` body.
  Updates belong in async callbacks. For fetching, use AbortController + `.then()/.catch()` with a
  `cancelled` flag; to re-fetch, increment a `refreshKey` from a `refresh` callback.
- **`react-hooks/purity`**: no impure calls (`Date.now()`) in the render body or in values derived
  during render — move them into `useEffect`/`useCallback`.
- **`react-hooks/refs`**: never write `ref.current` during render; do it in a `useEffect`.
- **`@next/next/no-html-link-for-pages`**: internal navigation uses `<Link>`, never `<a>`.

## Cross-platform & deployment

- The owner's machine is **Windows**. Anything that runs on a developer machine must be
  cross-platform — prefer Node scripts (`scripts/*.ts` via pnpm) over bash.
- Bash is fine for server-only work on the VPS. Keep it in `infra/scripts/` and label it.
- Enforce LF via `.gitattributes` — Windows checkouts otherwise corrupt Docker entrypoint scripts.
- Migrations run **before** new containers replace old ones, never after. A failed migration aborts
  the deploy and leaves the previous version serving.
- Docker images running a workspace package script must package that workspace's production
  dependencies and execute from its package path; copying the script to `/app` breaks
  package-local module resolution.
- Don't use Drizzle's metadata migrator for hand-maintained raw SQL folders. Production runners
  must match the repo's migration format and track applied raw files explicitly.
- Self-hosted Supabase migrations must bootstrap `auth.uid()`/`auth.jwt()` compatibility helpers
  before any RLS policy references them.
- Supabase Realtime must run its internal migrations with
  `DB_AFTER_CONNECT_QUERY='SET search_path TO _realtime'` against a provisioned `_realtime` schema,
  or its internal tables collide with application tables in `public`.
- Take a `pg_dump` immediately before every production migration. Without it, "roll back the bad
  deploy" is a slogan, not a procedure.
- Production deploy stays manual; auto-deploy is for staging. Friction on prod is a feature.
- Deploy automation may generate cryptographic secrets but must never invent provider-owned
  configuration (DNS names, addresses, API keys, OAuth credentials) — prompt or fail.
- Validate file bind-mount sources before `docker compose up`: a missing host path makes Docker
  create a _directory_ and mount it, so generated file artifacts must be recreated as files and
  checked with `-f`/`-s`.
- A containerised Next.js **standalone** server binds to `process.env.HOSTNAME`, and the container
  runtime injects `HOSTNAME=<container id>` — so it listens on its own eth0 address, not
  `127.0.0.1`. Traefik and published ports still reach it (DNAT lands on the container IP), so the
  service looks healthy from outside while every loopback healthcheck is refused. Our own images
  set `ENV HOSTNAME="0.0.0.0"` in their Dockerfiles; a third-party Next image (`supabase/studio`)
  must be given `HOSTNAME: '0.0.0.0'` in compose. Pinned by `pnpm infra:review`.
- A healthcheck that asserts a **cross-service** invariant needs a matching `depends_on` gate on
  that service (`condition: service_healthy`), or it cannot do anything but fail on every cold
  start. `web-public`'s probe is an SSR fetch of the API; ungated, it ran while the API was still
  booting and left two `[health/api-reachable] … ECONNREFUSED` lines at the tail of `status.sh` for
  the life of the container — a healthy stack that reads as an outage. Dev had gated all three web
  apps from the start and prod had not: **check dev/prod compose pairs for ordering drift**, nothing
  reports it. Pinned by `pnpm infra:review`. Note `depends_on` only applies to `up`; Docker's restart
  policy ignores it, so a host reboot still races.
- Adding a `service_healthy` dependency lengthens `docker compose up -d`, and a timeout there is not
  harmless: compose exits with the gated services never recreated, their **old** containers still
  running and healthy, and a health poll passes on them — a deploy that reports success while
  services run the previous image. Give `up -d` headroom and retry it once before trusting the poll.
- `docker compose logs` without `--timestamps` makes a line written at boot indistinguishable from
  one written ten seconds ago. Any tool that shows a log tail to an operator must date it.

## Ops script conventions (inherited from MyFAL)

The owner's MyFAL deployment scripts are in production and work; MyClash follows them verbatim.

- A shared `lib/log.sh` sourced by every script — colours auto-disabled off-TTY, helpers
  `ok`/`err`/`warn`/`hdr`/`info`. One owner for output style.
- `set -Eeuo pipefail` everywhere.
- `ROOT_DIR` via `cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd`, so scripts run from anywhere.
- `docker compose --env-file .env` always explicit, never relying on default detection.
- `.env` validated up front; missing critical variables abort with a clear message.
- Idempotent initialisation (`[[ -f X ]] || touch X`, `: > log.txt`) so re-runs don't fail.
- Health checks use the `RETRIES × DELAY` loop with progress logging.
- Auto-generate VAPID keys when missing — never block a deploy on an automatable manual step.

When in doubt about a deploy convention, read the MyFAL scripts first.

## Formatting

- Use **lint-staged + simple-git-hooks** for pre-commit formatting, not a CI auto-commit step. CI
  committing back to branches is fragile and breeds merge conflicts.
- After adding many new files at once, run `pnpm format` — `format:check` fails on files that were
  never formatted.
