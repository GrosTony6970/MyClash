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
- **`global-teardown.ts`** — by default **preserves** the test event and prints
  its admin URL so you can inspect what was created. Set `E2E_CLEANUP=1` to
  hard-delete it instead (it clears each tournament's pools → matches first, so
  the cascade isn't blocked by the `registrations`/`matches` RESTRICT FKs).

## Running locally

```bash
cp .env.e2e.example .env.e2e          # then fill in the E2E_* values
pnpm exec playwright install chromium  # first time only
pnpm test:e2e:prod                    # preserves the test event + prints its URL
E2E_CLEANUP=1 pnpm test:e2e:prod      # delete the test data afterwards
```

> Login is rate-limited (3/hour per email) — the suite logs in **once** per run.
> Don't loop runs rapidly on the same account.
>
> Data is **kept by default** for inspection; CI sets `E2E_CLEANUP=1`. Each run
> creates a fresh, uniquely-slugged event, so preserved events accumulate until
> you clean up / redeploy.

## Participants CSV

The import spec resolves its CSV in this order: `E2E_PARTICIPANTS_CSV` →
`fixtures/participants.local.csv` → `fixtures/participants.sample.csv`. Drop
your **real roster** at `fixtures/participants.local.csv` — it is git-ignored
(contains PII) and picked up automatically. Only the synthetic
`participants.sample.csv` is committed and used in CI.

> To use the real roster, leave `E2E_PARTICIPANTS_CSV` **blank** in `.env.e2e`
> (it auto-resolves to `participants.local.csv`). If it's set to the sample path,
> the import uses the sample instead.

## Populate a rich demo event (opt-in)

`E2E_POPULATE=1 pnpm test:e2e:prod` additionally runs `populate-event.spec.ts`,
which builds a fully-featured, **published** tournament + workshop in the test
event: registers a fighter who is also a referee (with skills + pool
assignment), runs the pool matches, creates + populates a bracket, tags an
instructor, and creates + publishes a workshop. Each step logs `✓`/`✗` and the
end prints links to the tournament / schedule / referees / workshops tabs.

It **scores matches**, so the event can no longer be hard-deleted (by the
recorded-results guard) — keep it for inspection or recreate the env.

## Status

| Flow                              | Spec                          | State                                    |
| --------------------------------- | ----------------------------- | ---------------------------------------- |
| CSV participant import            | `participants-import.spec.ts` | active                                   |
| Create tournament (wizard step 1) | `create-tournament.spec.ts`   | active                                   |
| Create event (wizard)             | `create-event.spec.ts`        | step 1 active; full flow `test.fixme`    |
| Schedule / programme              | `schedule.spec.ts`            | load smoke active; generate `test.fixme` |
| Referee auto-assign board         | `referee-board.spec.ts`       | active                                   |
| Offline scoring sync (PWA)        | `offline-sync.spec.ts`        | active                                   |

The `test.fixme` flows are scaffolded and finalized during the interactive
Playwright-MCP validation pass (which confirms the venue/lice wizard selectors,
the date-picker fill behaviour, and the schedule generate preconditions).
