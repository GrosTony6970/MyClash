# Prod E2E tests (`tests/e2e/`)

Browser tests that run against a **deployed** MyClash admin app and **write real
data**. They are isolated from the local a11y/perf suites (`tests/a11y`,
`tests/perf`), which boot the apps locally via `scripts/run-e2e.mjs`.

## How it works

- **`playwright.e2e.config.ts`** (repo root) — targets `E2E_BASE_URL`,
  `ignoreHTTPSErrors`, single worker, reuses one session.
- **`global-setup.ts`** — logs in once (cookie session), resolves the org from
  its slug, and creates a uniquely-named **throwaway event** that scopes every
  test's writes. Writes the session + run context under `.auth/` (git-ignored).
- **specs** — read the run context via `_context.ts` and drive the flows.
- **`global-teardown.ts`** — `DELETE /events/:id?mode=hard`, which cascades to
  the event's tournaments, persons, registrations, lices and matches. Runs even
  if specs fail, so prod is never left polluted.

## Running locally

```bash
cp .env.e2e.example .env.e2e          # then fill in the E2E_* values
pnpm exec playwright install chromium  # first time only
pnpm test:e2e:prod
```

> Login is rate-limited (3/hour per email) — the suite logs in **once** per run.
> Don't loop runs rapidly on the same account.

## Participants CSV

The import spec resolves its CSV in this order: `E2E_PARTICIPANTS_CSV` →
`fixtures/participants.local.csv` → `fixtures/participants.sample.csv`. Drop
your **real roster** at `fixtures/participants.local.csv` — it is git-ignored
(contains PII) and picked up automatically. Only the synthetic
`participants.sample.csv` is committed and used in CI.

## Status

| Flow                              | Spec                          | State                                    |
| --------------------------------- | ----------------------------- | ---------------------------------------- |
| CSV participant import            | `participants-import.spec.ts` | active                                   |
| Create tournament (wizard step 1) | `create-tournament.spec.ts`   | active                                   |
| Create event (wizard)             | `create-event.spec.ts`        | step 1 active; full flow `test.fixme`    |
| Schedule / programme              | `schedule.spec.ts`            | load smoke active; generate `test.fixme` |

The `test.fixme` flows are scaffolded and finalized during the interactive
Playwright-MCP validation pass (which confirms the venue/lice wizard selectors,
the date-picker fill behaviour, and the schedule generate preconditions).
