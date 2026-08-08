# Performance Review

Status: Pass with known issues
Date: 2026-05-13

Phase 7 covers backend latency, SQL Query Review, frontend budgets, Web Vitals, load testing, and caching. Repo-local checks now enforce the review artifacts and scripts. Live p95 latency, full 50-concurrent load evidence, and real-user INP evidence still require staging or production traffic.

## Automated Evidence

- `pnpm perf:review` checks Phase 7 artifacts, CI wiring, Playwright perf coverage, SQL review evidence, and root performance scripts.
- `pnpm perf:bundle` checks marketing static JavaScript immediately. Use `-- --include-next` after fresh Next.js builds, or `-- --require-build` to fail when app build artifacts are missing.
- `pnpm perf:load` runs a configurable HTTP load smoke test with p95 and error-rate thresholds.
- `pnpm db:perf:fixture` verifies the committed synthetic realistic dataset and EXPLAIN workload stay in sync.
- `pnpm db:perf:explain` runs the EXPLAIN workload against a disposable database when `DATABASE_URL` is provided.
- `pnpm test:e2e` includes Playwright performance checks for public, admin, and scoring shells.

## Backend Hot Paths

| Path or surface                            |                Target p95 | Evidence source                                | Status                                      |
| ------------------------------------------ | ------------------------: | ---------------------------------------------- | ------------------------------------------- |
| `GET /health`                              |                     50 ms | `pnpm perf:load -- --path /health`             | pass repo script, live evidence pending     |
| Public event/tournament data               |                    250 ms | Phase 4 EXPLAIN workload + staging logs        | pass with live evidence pending             |
| My Schedule/public schedule                |                    150 ms | Phase 4 EXPLAIN workload + API structured logs | pass with live evidence pending             |
| Live lice and match views                  |                    150 ms | Phase 4 EXPLAIN workload + event-day logs      | pass with live evidence pending             |
| Pool standings and bracket state           |                    200 ms | Phase 4 EXPLAIN workload                       | pass with live evidence pending             |
| Admin person/import lookup                 |                    300 ms | EXPLAIN + pg_trgm indexes                      | pass with live evidence pending             |
| Notifications and broadcast history        |                    250 ms | EXPLAIN + structured logs                      | pass with live evidence pending             |
| Natural-language query deterministic tools | 500 ms before LLM latency | tool execution logs + EXPLAIN                  | accepted v1 risk until staging tool timings |

API request logs from Phase 6 include route, status, duration, and request id. That gives p95 evidence without logging bodies, emails, tokens, AI prompts, or result payloads.

## SQL Query Review

Review standard: Supabase Postgres best-practices.

The Phase 7 SQL pass uses these rules:

- Index WHERE and JOIN columns, especially foreign-key sides.
- Prefer composite indexes that match common filter order such as event/tournament, status, phase, visibility, and scheduled time.
- Use partial indexes for common active/pending/unvoided filters when they keep indexes smaller.
- Avoid unbounded list queries; require limits, event/tournament scope, or pagination.
- Check RLS policies for repeated function calls or broad scans.
- Use `EXPLAIN ANALYZE` on the synthetic fixture for critical read paths.

| Query family                              | Classification   | Evidence and action                                                                                             |
| ----------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Public event lookup                       | pass             | Covered by Phase 4 EXPLAIN workload; event slug/id lookup is scoped and indexed in migrations.                  |
| Event roster and person listing           | pass             | Event-scoped person indexes and `pg_trgm`/`unaccent` search support admin/public lookup.                        |
| My Schedule match lookup                  | pass             | Tournament/event-scoped match and registration joins are represented in synthetic EXPLAIN.                      |
| Live lice queue                           | pass             | Lice/status/scheduled match path is covered by synthetic EXPLAIN.                                               |
| Pool standings and bracket state          | pass             | Phase and slot reads are scoped by tournament/phase; play-in round ordering does not require a table scan.      |
| Notifications and broadcast history       | pass             | Recipient history is user/event scoped and uses durable recipient rows.                                         |
| Audit log and backups/archive lists       | pass             | Admin-only list paths are scoped and sorted; Phase 4 workload includes audit log review.                        |
| Tournament-query tools                    | accepted v1 risk | Deterministic tools are read-only and scoped, but live timing must be reviewed after realistic organizer usage. |
| Future high-volume exports/import preview | needs index      | Add measured indexes only if staging logs show repeated slow scans.                                             |
| Any future unbounded admin search         | needs rewrite    | Must add pagination/limits before production exposure.                                                          |

No query is currently classified as `needs rewrite` based on repo-local evidence. That label is reserved for future findings from `pg_stat_statements`, slow-query logs, or EXPLAIN regressions.

## N+1 Detection

Use this method on staging before final production sign-off:

1. Run seeded organizer/public flows: public event page, My Schedule, live lice, pool standings, bracket, admin persons/import lookup, notifications, and tournament query tools.
2. Capture API structured request durations and database top-N query evidence from `pg_stat_statements` where available.
3. Flag any request whose query count grows with row count or whose repeated query signature appears more than 20 times for one request.
4. Convert confirmed N+1 paths into service-level batch queries or preloaded joins, then add regression tests.

## Connection Pool

Chosen v1 default: direct Postgres/Supabase connections, no PgBouncer yet.

- The API opens no direct Postgres connections — it goes through PostgREST over HTTP. Only
  `packages/db/scripts/migrate.mjs` connects with `postgres.js`, as a one-off deploy container.
- Supabase Auth, Realtime, Storage, and PostgREST use direct internal DB access.
- Worker and API are expected to run as single replicas for v1.

Add PgBouncer or Supabase pooler when `pg_stat_activity` consistently exceeds 60% of `max_connections`, connection acquisition appears in p95 latency, or additional API/worker replicas are introduced.

## Bundle Budgets

| App                 |      Budget | Check                                                                             |
| ------------------- | ----------: | --------------------------------------------------------------------------------- |
| Marketing static JS | 200 KB gzip | `pnpm perf:bundle`                                                                |
| Public critical JS  | 200 KB gzip | `pnpm --filter @myclash/web-public test` and `pnpm perf:bundle -- --include-next` |
| Scoring shell JS    | 500 KB gzip | `pnpm perf:bundle -- --include-next` after a fresh scoring build                  |
| Admin first-load JS | 800 KB gzip | `pnpm perf:bundle -- --include-next` after a fresh admin build                    |

The existing public app test builds the app before checking its landing budget. Admin and scoring budgets are artifact-aware so local or CI jobs can enforce them after intentional app builds without reading stale `.next` output during lightweight review gates.

## Web Vitals

Targets:

- LCP < 2.5 s.
- CLS < 0.1.
- INP < 200 ms.

Automated Playwright coverage measures LCP and CLS for:

- Public landing page.
- Public event page.
- Admin unauthenticated shell.
- Scoring shell.

INP is owner-side staging evidence for v1 because reliable field INP needs real interaction telemetry. A Playwright interaction-latency surrogate can be added later, but it should not be presented as field INP.

## Load Test

Repo command:

```bash
pnpm perf:load -- --base-url https://api.myclash.fr --path /health --duration 300 --concurrency 50 --max-p95-ms 500
```

Full sign-off run:

- 50 concurrent users.
- 5 minutes.
- Most-hit endpoint first: `https://api.myclash.fr/health`, then staging-specific public event/tournament and My Schedule endpoints when stable IDs are available.
- Success criteria: error rate <= 1%, p95 within the endpoint target, no container restart, no DB connection exhaustion.

## Caching

Current v1 posture is correctness-first:

- Live event-day public and participant pages may use `no-store` because schedules, match state, and notifications change quickly.
- Next.js hashed static assets are cacheable by the browser and edge.
- The scoring app service worker preserves offline-first behavior and must not be weakened.
- Marketing static assets are safe to cache aggressively at the edge.

There is no shared/edge HTTP cache, and adding one is a decided question — see [ADR-011](./decisions/ADR-011-no-edge-http-cache.md), which evaluated and rejected the Souin Traefik plugin. Caching lives in the browser, in Next.js, and in the scoring service worker.

Future cache candidates:

- Completed tournament results.
- Static public fighter/club pages.
- League standings after publication.
- Non-live archive pages.

Two preconditions gate every candidate on that list, and neither is met today:

- **The response must declare how it varies.** The repo emits essentially no `Vary` headers, but SSR output varies by the `mc_locale` cookie, `Accept-Language`, and the session cookie. A candidate is not cacheable until it emits correct `Vary` and marks per-user responses `Cache-Control: private`.
- **Most candidates are per-user until proven otherwise.** They sit behind the global AuthGuard, so "public results page" has to be verified against the actual route, not assumed from the name.

Do not cache live scoring or organizer mutation results unless invalidation is explicit and tested.

## Owner Evidence Checklist

- [ ] Run `pnpm db:perf:explain` against a disposable DB loaded with the Phase 4 synthetic fixture and record slowest paths.
- [ ] Enable or verify `pg_stat_statements` on staging/production and capture top-N total-time queries.
- [ ] Run the 50-concurrent, 5-minute `pnpm perf:load` check against staging/live.
- [ ] Record p95 latency from API structured logs for public event, My Schedule, live lice, standings/bracket, notifications, and query tools.
- [ ] Capture real Web Vitals or staged browser evidence for LCP, CLS, and INP.
- [ ] Review whether PgBouncer is still unnecessary after staging traffic.

## Known Issues

- Live p95 and full load-test evidence are not collectable from repo-local checks.
- INP needs real or staged interaction telemetry and is not fully represented by Playwright LCP/CLS tests.
- Tournament-query timing tools remain an accepted v1 risk until realistic event data and organizer usage are observed.
- `pg_stat_statements` may require provider/VPS configuration before top-N evidence is available.
