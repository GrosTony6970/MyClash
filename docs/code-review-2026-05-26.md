# Code review — 2026-05-26

**Snapshot type:** dated point-in-time audit (not a living doc).
**Scope:** full tree, last ~25 commits (referees R1–R7, brackets v2, schedule grid,
HEMA Ratings admin, leagues, migration 0063, Sentry hardening).
**Cross-references:** [`SECURITY_POSTURE.md`](SECURITY_POSTURE.md),
[`PERFORMANCE_REVIEW.md`](PERFORMANCE_REVIEW.md),
[`DATABASE_REVIEW.md`](DATABASE_REVIEW.md),
[`INFRASTRUCTURE_REVIEW.md`](INFRASTRUCTURE_REVIEW.md),
[`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 1. Executive summary

The codebase is healthy at the surface: tests stay green (now 659 API + 257
rulesets), all five packages typecheck clean, [`ARCHITECTURE.md`](ARCHITECTURE.md)
is current with every recent feature including R1–R7 referees, brackets v2,
schedule grid, HEMA Ratings admin, leagues.

Three parallel exploration passes (backend, frontend, docs/tests) returned
~40 findings. Three are **critical** and have been shipped alongside this
report; the remainder are tracked here as a remediation roadmap.

**Headline numbers**

| Metric                           | Value                                                              |
| -------------------------------- | ------------------------------------------------------------------ |
| API source modules               | ~88                                                                |
| API tests                        | 659 passing                                                        |
| Rulesets tests                   | 257 passing                                                        |
| Modules with **zero** unit tests | ~68                                                                |
| Frontend page LOC > 1 000 lines  | 3 (referees 1 849, clubs 1 689, persons 1 554)                     |
| Frontend component tests         | 0                                                                  |
| API DB migrations                | 63                                                                 |
| Background workers               | 4 (HEMA sync, notif scheduler, event-status ticker, event archive) |

**Top three risks (action this round — already shipped)**

1. **PostgREST `.or()` filter injection** on fighter + person search.
2. **HEMA daily-sync worker swallowed failures** — no retry, no log breadcrumb.
3. **`maskEmail` crash** on null email (already fixed earlier in the week,
   captured here for completeness).

The rest of this document is the full findings table, the remediation
roadmap (Phase 1–4), and an architecture/coverage snapshot.

---

## 2. Findings — full table

### Severity legend

- **Critical** — security or data-loss risk; ship now.
- **High** — robustness / correctness gap; ship in the next 2–4 PRs.
- **Medium** — tidy-up; ship in a focused sprint.
- **Low** — note when touching the area.

### Critical (3 — all shipped this PR)

| #   | Category   | File:line                                                                               | Finding                                                                                                                                                                                                                                                                 | Fix shipped                                                                                                                                                                                         |
| --- | ---------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Security   | [`fighters.service.ts:97,1003`](../apps/api/src/modules/fighters/fighters.service.ts)   | User-supplied `q` interpolated into PostgREST `.or()` filter — `,` `(` `)` `*` `\` break out of the ilike pattern and let the user inject sibling filter clauses, broadening the WHERE beyond the intended search. Same pattern repeated twice in this file.            | New helper [`postgrest-filter.ts`](../apps/api/src/common/postgrest-filter.ts) strips the five meta-characters. Applied to both occurrences.                                                        |
| 1b  | Security   | [`lookup.controller.ts:121`](../apps/api/src/modules/persons/lookup.controller.ts)      | Same `.or()` interpolation in `fallbackSearch` for the public event-scoped person lookup. RLS does not protect against this because the lookup is intentionally public (rate-limited + masked email) — the injection broadens the WHERE _within_ the throttled surface. | Same `sanitizePostgrestFilterValue` helper.                                                                                                                                                         |
| 3   | Robustness | [`hema-ratings-sync.worker.ts:82`](../apps/api/src/workers/hema-ratings-sync.worker.ts) | `process()` had no top-level try/catch + queue had no `attempts`/`backoff` config — a transient hemaratings.com failure vanished from app logs and was not retried.                                                                                                     | Wrapped in try/catch that logs the error via `this.logger.error` + rethrows. Added `defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } }` to the queue registration. |

### High (9 — backlog, listed for prioritisation)

| #   | Category        | File:line                                                                                                                                                                                                                                                        | Finding                                                                                             | Suggested fix                                                                                        |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 4   | Performance     | [`hema-ratings-sync.worker.ts:256-268`](../apps/api/src/workers/hema-ratings-sync.worker.ts)                                                                                                                                                                     | One sequential `fetch` per linked fighter (potentially hundreds).                                   | Add a small `pLimit(5)` helper to cap concurrency to 5 in flight.                                    |
| 5   | Error hygiene   | repeated ~30× across `apps/api/src/modules/admin/**/*.service.ts`                                                                                                                                                                                                | `throw new BadRequestException(error.message)` leaks Postgres internals.                            | Wrap to a sanitised user-facing message; keep `this.logger.warn(error.message)` for the audit trail. |
| 6   | Validation      | many controllers                                                                                                                                                                                                                                                 | `@Param('id') id: string` without `ParseUUIDPipe`.                                                  | Sweep + add `ParseUUIDPipe` everywhere a UUID is expected.                                           |
| 7   | Performance     | fighter / person list controllers                                                                                                                                                                                                                                | No pagination — OOM risk on a large org.                                                            | Add `?limit=50&offset=0` with `ParseIntPipe({ min: 1, max: 500 })`.                                  |
| 8   | Maintainability | [`referees/page.tsx`](../apps/web-admin/app/org/[slug]/events/[eventId]/referees/page.tsx) (1 849), [`clubs/page.tsx`](../apps/web-admin/app/org/[slug]/clubs/page.tsx) (1 689), [`persons/page.tsx`](../apps/web-admin/app/org/[slug]/persons/page.tsx) (1 554) | Each declares 20+ `useState` hooks; impossible to reason about state transitions.                   | Replace the worst (referees) with a `useReducer` driving a small state machine.                      |
| 9   | Reliability     | every `apps/web-admin/app/.../page.tsx`                                                                                                                                                                                                                          | No error boundaries — async errors crash the entire route silently.                                 | Add a single `<ErrorBoundary>` from `packages/ui` at the route layout level.                         |
| 10  | DRY             | FE/BE                                                                                                                                                                                                                                                            | `RefereeSkill`, `Person`, `FighterRow`, `ScheduleMatch` declared independently on both sides.       | Move shared shapes to [`packages/types/src/`](../packages/types/src/) and import on both sides.      |
| 11  | DX              | 40+ admin pages                                                                                                                                                                                                                                                  | `const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'` repeated everywhere. | Extract a `useApiUrl()` hook from `@myclash/ui` or a root context provider.                          |
| 12  | Test coverage   | `auth.service`, `events.service`, `fighters.service`, `schedule`, `programme`                                                                                                                                                                                    | Zero unit tests on high-value services.                                                             | Pick the three highest-risk (auth, events, schedule) and backfill.                                   |

### Medium (8)

| #   | Category       | Finding                                                                                                                                                                  | Suggested fix                                                                                                 |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 13  | Type safety    | `as unknown as` / `as never` casts at controller boundaries.                                                                                                             | Sweep + tighten with proper interface types.                                                                  |
| 14  | UI consistency | `overflow-x-auto` + fixed widths inconsistency across admin pages.                                                                                                       | Already started for the schedule grid; finish the pass on pools + bracket.                                    |
| 15  | E2E coverage   | `apps/web-public` has zero tests.                                                                                                                                        | Add a Playwright smoke test for the public event page + bracket view.                                         |
| 16  | DX             | Pre-commit only runs prettier — no ESLint, no typecheck.                                                                                                                 | Add `lint-staged` for ESLint on `*.{ts,tsx}` + `pnpm typecheck` on staged paths.                              |
| 17  | API ergonomics | `MatchCard` has 5 boolean props (`isReady`, `isLive`, `isCompleted`, `isChampionshipMatch`, `isBronzeMatch`).                                                            | Collapse to one `variant: 'ready' \| 'live' \| 'completed' \| 'championship' \| 'bronze' \| 'default'` union. |
| 18  | UX             | [`referees/page.tsx:1262-1290`](../apps/web-admin/app/org/[slug]/events/[eventId]/referees/page.tsx) — optimistic update before network ack; stale data on slow refetch. | Wait for the response before committing the optimistic edit.                                                  |
| 19  | a11y           | Colour-only status badges.                                                                                                                                               | Pair every coloured pill with a text label.                                                                   |
| 20  | Reliability    | Daily HEMA sync, notification scheduler, archive worker all run within minutes of each other on the same Redis.                                                          | Already keyed via `jobId`; consider staggering 03:30 / 03:45 / 04:00 if Redis contention shows up.            |

### Low (5)

| #   | Finding                                                                               |
| --- | ------------------------------------------------------------------------------------- |
| 21  | `hemaratings.com` URL hard-coded — move to config.                                    |
| 22  | Migration runner has no transactional wrap; rely on the idempotent pattern from 0063. |
| 23  | Unused imports — enable `eslint-plugin-unused-imports`.                               |
| 24  | Icon-only buttons missing `aria-label`.                                               |
| 25  | Memoisation in `referees` / `persons` / `bracket` not applied; profile first.         |

---

## 3. Remediation roadmap

### Phase 1 — Critical (shipped this PR)

- ✅ Sanitise PostgREST `.or()` interpolation.
- ✅ HEMA worker try/catch + retry config.
- ✅ Tests for both fixes (8 new tests).

### Phase 2 — High (next 2–4 PRs)

1. `ParseUUIDPipe` sweep.
2. Backfill tests on `auth.service`, `events.service`, `schedule.service` (3 highest-risk).
3. Pagination on fighter / person list endpoints.
4. Lift FE/BE-duplicated DTOs into `packages/types`.

### Phase 3 — Medium (focused sprint)

1. Frontend error-boundary at every route layout.
2. Refactor `referees/page.tsx` with `useReducer`.
3. Pre-commit ESLint + typecheck (coordinates with dev experience, so do
   this in its own PR with reviewer agreement).
4. Replace the boolean-prop pile on `MatchCard` with a `variant` union.

### Phase 4 — Low (ship when touching the area)

1. Move hard-coded `hemaratings.com` URL to config.
2. Migration transactionality conventions documented + applied to 0064+.
3. `eslint-plugin-unused-imports` enabled.
4. `aria-label` sweep on icon-only buttons.

---

## 4. Architecture state snapshot

### 4.1 Module / service map

Mirrors [`ARCHITECTURE.md`](ARCHITECTURE.md) §9-11; trimmed to surface the
review-relevant modules.

```
apps/api/src/
├── modules/
│   ├── admin/                  ← super-admin + org-admin endpoints (✅ tested)
│   │   ├── hema-ratings-admin.controller.ts  ← NEW this sprint
│   │   ├── admin-audit-log.service.ts
│   │   ├── system-actions.service.ts
│   │   └── …
│   ├── auth/                   ← ❌ zero tests; high churn (R6/R7)
│   ├── events/                 ← ❌ zero tests; high churn
│   ├── fighters/               ← partial tests (controller + paginated + career)
│   │   └── fighters.service.ts ← SQL injection finding #1 (shipped)
│   ├── persons/
│   │   ├── csv-import.service.ts ← maskEmail null bug fixed earlier
│   │   ├── lookup.controller.ts  ← SQL injection finding #1b (shipped)
│   │   └── public-schedule.controller.ts ← RLS-only; verified safe
│   ├── referees/               ← R6/R7 path; partial tests
│   ├── schedule/               ← ❌ zero tests apart from grid service
│   │   └── schedule-grid.service.ts ← rewritten this sprint
│   ├── phases/                 ← bracket delete shipped this sprint
│   ├── hema-ratings/           ← profile fetcher + admin service
│   └── …
└── workers/
    ├── hema-ratings-sync.worker.ts ← finding #3 (shipped)
    ├── notification-scheduler.worker.ts (✅ tested)
    ├── event-status-ticker.worker.ts (✅ tested)
    └── event-archive.worker.ts (✅ tested)
```

### 4.2 Frontend page inventory (web-admin)

Top 10 by line count — proxies for refactor risk.

|   LOC | Page                                                                          |
| ----: | ----------------------------------------------------------------------------- |
| 1 849 | `app/org/[slug]/events/[eventId]/referees/page.tsx`                           |
| 1 689 | `app/org/[slug]/clubs/page.tsx`                                               |
| 1 554 | `app/org/[slug]/persons/page.tsx`                                             |
| 1 142 | `app/org/[slug]/events/[eventId]/schedule/grid.tsx`                           |
| 1 088 | `app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/bracket/page.tsx` |
|   980 | `app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/pools/page.tsx`   |
|   867 | `app/admin/hema-ratings/page.tsx`                                             |
|   790 | `app/org/[slug]/events/[eventId]/staffing/page.tsx`                           |
|   720 | `app/org/[slug]/events/[eventId]/registrations/page.tsx`                      |
|   680 | `app/org/[slug]/rulesets/page.tsx`                                            |

### 4.3 Test coverage matrix

Per top-level API module — `has unit tests` Y/N. Asterisk = partial.

| Module           | Tests         |
| ---------------- | ------------- |
| admin            | Y             |
| ai-providers     | Y\*           |
| auth             | **N**         |
| clubs            | Y\*           |
| common           | Y             |
| compensation     | Y\*           |
| events           | **N**         |
| exports          | Y\*           |
| fighters         | Y\*           |
| health           | Y             |
| hema-ratings     | **N**         |
| leagues          | Y\*           |
| mail             | Y             |
| persons          | Y\*           |
| phases           | Y\*           |
| pool-standings   | Y             |
| programme        | **N**         |
| realtime         | Y             |
| referees         | Y\*           |
| rulesets         | Y\*           |
| schedule         | Y\*           |
| security         | Y             |
| staff            | Y\*           |
| tournament-query | Y             |
| workers          | Y (all 4 now) |

### 4.4 Migration sequence + risk flags

| File                                    | Risk                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001`–`0062`                           | Stable; CI proven                                                                                                                                                                                                                                                                            |
| `0063_referee_identity_unification.sql` | **HIGH** — drops `user_id` from 3 tables + a view + 3 RLS policies. The first attempt failed on `cannot drop column user_id because other objects depend on it`. Fix: drop policies + view BEFORE the columns, recreate after. **Lesson:** drop dependents BEFORE the column they reference. |
| `0064+`                                 | Future migrations should follow the same idempotent pattern (`IF EXISTS` everywhere).                                                                                                                                                                                                        |

---

## 5. Recommended ongoing hygiene

1. **Pre-commit ESLint + typecheck** — add a `lint-staged` config; ~10 lines
   in `package.json`.
2. **`packages/types` adoption** for shared DTOs — start with `RefereeSkill`,
   `Person`, `FighterRow`, `ScheduleMatch`.
3. **Component test harness for web-admin** — Vitest + Testing Library;
   start with one smoke test per route to prove the wiring.
4. **A weekly "monster page" review** — set a LOC ceiling (target 800) and
   refactor anything that drifts over.
5. **Doc maintenance cadence** — re-run this audit quarterly; keep dated
   files (don't overwrite this one).

---

## 6. Appendix — raw findings (links into the existing docs)

When a finding falls cleanly under an existing doc, cross-link rather than
duplicate the content.

- RLS-bypass risk on `supabase.service` usage → `SECURITY_POSTURE.md`.
- Bundle-size + perf audit → `perf:bundle` already exists; consume its
  output in a separate pass. Track in `PERFORMANCE_REVIEW.md`.
- Migration-ordering checklist (lesson from 0063) → add to
  `DATABASE_REVIEW.md` as a "before merging a new migration" gate.
- Cron-overlap monitoring → `INFRASTRUCTURE_REVIEW.md`.

---

## 7. Verification (shipped this PR)

- `pnpm -F @myclash/api typecheck` — ✅ clean.
- `pnpm -F @myclash/api test` — ✅ 659 passing (was 651, +8 new tests).
- 8 new tests:
  - `apps/api/src/common/postgrest-filter.test.ts` — 6 tests for the
    sanitiser (legitimate names pass through; `,` `(` `)` `*` `\` stripped;
    whitespace trimmed; full malicious payload reduced to safe substring).
  - `apps/api/src/workers/hema-ratings-sync.worker.test.ts` — 2 tests for
    rethrow on non-2xx + network error.
- Manual A — call `GET /api/v1/fighters?q=,or.id.neq.0` → returns the unfiltered
  list as if `q` were empty (rather than leaking rows via injection).
- Manual B — local job invocation with hemaratings.com unreachable → log
  carries the error message; BullMQ surfaces the failure to the failed list
  after 3 attempts.
