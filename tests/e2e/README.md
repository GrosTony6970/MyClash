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
pnpm test:e2e:prod                    # runs all specs; preserves the event + prints its URL
E2E_CLEANUP=1 pnpm test:e2e:prod      # delete the test data afterwards
pnpm test:e2e:prod tests/e2e/07-*.spec.ts  # run one test by number (here: test 7)
```

Specs are numbered `01`…`07` (see the Status table), so you can run one by number —
`pnpm test:e2e:prod tests/e2e/0N-*.spec.ts`.

> Login is rate-limited (10/hour per IP, and 10/hour per email) — the suite logs
> in **once** per run and reuses the session for 45 min. Don't loop runs rapidly
> on the same account.
>
> Data is **kept by default** for inspection; CI sets `E2E_CLEANUP=1`. Each run
> creates a fresh, uniquely-slugged event, so preserved events accumulate until
> you clean up / redeploy.

## Rate limits & pacing

The API throttles **every request** per client IP (120/min), not just writes. IPs
listed in the API's `THROTTLE_IP_WHITELIST` env var skip throttling entirely, so
runs from a whitelisted network are **unpaced** (fast).

> The organizer's IP used to be hardcoded in `apps/api/src/app.module.ts`; it now
> has to be present in `THROTTLE_IP_WHITELIST` in the API's deployed environment.
> If unpaced runs suddenly start returning 429s, that env var is the first thing
> to check.

From a **non-whitelisted IP** (or CI), set `E2E_PACE_MS=550` to pace writes under
the limit, e.g. `E2E_PACE_MS=550 pnpm test:e2e:prod`. Login throttling is separate
and applies regardless of pacing; the suite logs in once per run.

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

`E2E_POPULATE=1 pnpm test:e2e:prod` additionally runs `07-populate-event.spec.ts`
(**test 7**; run it alone with `E2E_POPULATE=1 pnpm test:e2e:prod tests/e2e/07-*.spec.ts`),
which builds a fully-featured, **published** tournament + workshop in the test
event: registers a fighter who is also a referee (with skills + pool
assignment), runs the pool matches, creates + populates a bracket, tags an
instructor, and creates + publishes a workshop. Each step logs `✓`/`✗` and the
end prints links to the tournament / schedule / referees / workshops tabs.

It **scores matches**, so the event can no longer be hard-deleted (by the
recorded-results guard) — keep it for inspection or recreate the env.

Every completed match is driven through the match clock (`start → adjust → end`),
giving `matches.duration_active_ms` a realistic **random 5–10 min** active time —
the one field every referee time stat reads. Without it, "Average/Total time
refereed" (`/me/profile?tab=referee`) and the admin referee-workload "Avg time"
column render _None/—_. It costs ~2 extra API calls per match and adds no real
wall-clock time.

### Watch the "Live now" section update in real time

`E2E_LIVE_SIDESWORD=1` (with `E2E_POPULATE=1`) leaves the **Sidesword** bracket at
the semi-finals and, as the last step, runs **one semifinal live** — posting a
clean hit every ~6–22s in real wall-clock time and then leaving the match
**running**. With the event published, open the public `/e/<slug>/home` (or
`/e/<slug>/live`) and watch the "Live now" card climb. Longsword still plays
through to a champion (the finished reference). `E2E_LIVE_DURATION_S` (default
`240`) tunes how long it climbs.

```bash
E2E_POPULATE=1 E2E_LIVE_SIDESWORD=1 pnpm test:e2e:prod tests/e2e/07-*.spec.ts
```

## Status

| #   | Flow                                | Spec                                | State                                    |
| --- | ----------------------------------- | ----------------------------------- | ---------------------------------------- |
| 1   | CSV participant import              | `01-participants-import.spec.ts`    | active                                   |
| 2   | Create tournament (wizard step 1)   | `02-create-tournament.spec.ts`      | active                                   |
| 3   | Create event (wizard)               | `03-create-event.spec.ts`           | step 1 active; full flow `test.fixme`    |
| 4   | Schedule / programme                | `04-schedule.spec.ts`               | load smoke active; generate `test.fixme` |
| 5   | Referee auto-assign board           | `05-referee-board.spec.ts`          | active                                   |
| 6   | Offline scoring sync (PWA)          | `06-offline-sync.spec.ts`           | active                                   |
| 7   | Populate rich demo event            | `07-populate-event.spec.ts`         | opt-in (`E2E_POPULATE=1`); see above     |
| 8   | Offline scoring on a custom ruleset | `08-offline-custom-ruleset.spec.ts` | active                                   |

The `test.fixme` flows are scaffolded and finalized during the interactive
Playwright-MCP validation pass (which confirms the venue/lice wizard selectors,
the date-picker fill behaviour, and the schedule generate preconditions).
