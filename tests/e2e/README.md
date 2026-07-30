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
  hard-delete it instead. Two things have to happen in order for that to work:
  the event is first reclassified as a **club event**, then each tournament's
  pools (→ matches) are cleared before the tournament and finally the event go.
  - The **club flip** is what makes the delete possible at all. Six specs score
    real matches, and a `standard` event holding recorded results refuses both
    deletes ("Submit a deletion request instead") — correct for a real event,
    exactly wrong for a throwaway one. `allowsDirectHardDelete` is true for club
    and test kinds, and the flip is deliberately the LAST thing that happens:
    the event must stay `standard` all run, because club events do not count
    toward league standings and cannot be submitted to HEMA Ratings, which `11`
    and `12` depend on.
  - The **pool clearing** keeps the cascade from hitting the
    `registrations`/`matches` RESTRICT FKs.

## Running locally

```bash
cp .env.e2e.example .env.e2e          # then fill in the E2E_* values
pnpm exec playwright install chromium  # first time only
pnpm test:e2e:prod                    # runs all specs; preserves the event + prints its URL
E2E_CLEANUP=1 pnpm test:e2e:prod      # delete the test data afterwards
pnpm test:e2e:prod tests/e2e/07-*.spec.ts  # run one test by number (here: test 7)
```

Specs are numbered `01`…`15` (see the Status table), so you can run one by number —
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

Each workshop also gets a **random set of attendees** enrolled (most seats filled,
some waitlisted), with David / Robin / Anthony each guaranteed a seat in a workshop
they don't teach — via the organizer enroll endpoint
`POST /workshop-sessions/:id/enrollments/:personId` (workshop_lead+).

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

## Play a double-elimination bracket for real (opt-in)

`E2E_DOUBLE_ELIM=1 pnpm test:e2e:prod tests/e2e/09-*.spec.ts` runs
`09-double-elim.spec.ts` — the only test in the repo that generates a
`double_elim` phase **against a real database** and plays it to a champion.

It exists because double-elim advancement is **string matching**, not FK
traversal: the generator writes `source_a_ref: 'loser of WBR1P3'` and
`buildSelfRef` stamps the completed slot `WBR1P3`. Disagree by one character and
nothing fills the downstream slot, **nothing throws**, and the tournament stalls
forever (Slice 1 shipped exactly that bug). The in-memory harness
(`apps/api/src/modules/phases/double-elim-simulation.harness.ts`) catches ref
mismatches but re-implements propagation itself, so it never exercises the
persistence and advancement paths this spec does.

Five scenarios, ~78 matches:

| Scenario                              | Field | What only it proves                                                                                                    |
| ------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| A. play-in + grand-final reset played | 12    | Round-0 `WBR0P{n}` refs resolve; **the reset match row is created on demand** (it is the one slot with no placeholder) |
| B. reset skipped                      | 8     | `grandFinalEndsBracket` leaves the reset unplayed, and the tournament still ranks (the empty-ranking trap)             |
| C. bronze mode                        | 8     | No grand final at all; truncated ladder ends on a real bronze match                                                    |
| D. repechage cutoff (last 8)          | 16    | Re-indexed losers bracket; winners-round-1 losers are out on a single loss and never enter it                          |
| E. bronze mode, no bronze match       | 8     | Ladder truncated one round further; two survivors take distinct 3rd/4th without ever meeting                           |

Each scenario builds its own tournament in the throwaway event with **no pools** —
`populateBracket` then seeds straight from registration seeds, so the draw is
deterministic (the lower seed always wins, so seed 1 is always champion) and no
pool matches have to be played.

Matches are played the way the **pad** plays them: clean exchanges until one side
reaches the point cap (pinned to 5 per tournament), with the ruleset engine
completing the match and choosing the winner. The spec asserts that every
completed slot has a winner whose score sits exactly on the cap — proof the
engine ended it, not the test.

> This matters more than realism. An earlier version declared winners with
> `PATCH /matches/:id/status`, which **no frontend calls**: web-scoring posts
> exchanges and drives the clock. For a while that endpoint and forfeits were the
> only paths wired to `BracketAdvanceService`, so a bracket scored on the pad
> never advanced at all. Testing through the endpoint hid it; scoring for real is
> what covers the path an organizer actually uses.

The driver (`_bracket.ts`) is a **fixed-point loop**, not a round walk: in double
elim a losers slot's readiness depends on a winners round it doesn't follow
numerically, and the reset slot doesn't exist until the grand final is decided.
Its termination condition **is** the stall detector — when a pass plays nothing
and slots remain, it fails with each stalled slot's round/position and the exact
`source_a_ref` / `source_b_ref` that never resolved.

Each scenario finishes on the admin final-ranking page
(`/org/<slug>/events/<id>/finalranking?tournamentId=<id>`), which runs the same
`computeFinalRanking` every product surface uses — that is what proves an
enabled-but-unplayed reset doesn't return an empty ranking for the whole
tournament.

> Like the populator, this spec **completes matches**, so the event can no longer
> be hard-deleted afterwards. Run it on a sandbox org.

## Score a league season for real (opt-in)

`E2E_LEAGUE=1 pnpm test:e2e:prod tests/e2e/11-*.spec.ts` runs `11-league.spec.ts`
— the only test in the repo that drives `TournamentPlacementService` and the
shared `computeFinalRanking` **against a played tournament**. Both are heavily
unit-tested over hand-built slot arrays, but nothing had ever asked them "given
a tournament that was actually played, who finished where" — and league points,
medals, club standings and the season report all hang off that one answer.

What makes the assertions exact: `playDoubleElim` lets the **lower seed win every
match**, and the fighters are named in seed order (`League 01 … League 08`), which
is also how `computeFinalRanking` breaks ties between fighters knocked out in the
same round. So the finishing order of the 8-fighter bronze-mode bracket is known
in advance — seeds 1..8, no ties — and the league table has to reproduce it.

The league is created with its own `customPointsByRank` (100/50/30/20/12/9/6/3)
rather than the FFAMHE table, so a placement read one row off is a visible
100-vs-50 diff and the spec never has to track what the shared registry says
today.

Two tournaments, ~24 matches, ~30 s. The second exists for the freeze contract:

| Stage                  | What only it proves                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| link, before recompute | An approved-but-uncounted tournament reads as **pending**, not as missing              |
| recompute              | Standings are the bracket's placements, scored through the league's points table       |
| club standings         | Points aggregate by `global_persons.club_id`, with a separate unaffiliated bucket      |
| publish → CSV → draft  | Public standings + `final-report.csv` ride the `status`/`public_visibility` pair       |
| finalize               | Manual recompute 400s, and a **late event ticking over leaves the frozen table alone** |
| clone                  | A new season copies config + groups as new rows, and **no links, results or rankings** |
| reopen                 | Recompute resumes and the second event finally counts — every total exactly doubles    |

Fighters are a dedicated `League NN` roster (not the shared `Seed NN` one) because
club standings needs club affiliations: seeds 1–3 in one club, 4–5 in another,
6–8 unaffiliated. Both clubs are created once by name and reused on every rerun.

> A league is not owned by an event, so it survives the throwaway event's
> teardown. The spec returns it to `draft` before finishing — nothing it creates
> is ever left publicly visible — and deletes both leagues when `E2E_CLEANUP` is
> set, printing their admin URLs otherwise.

## Generate and parse every export (opt-in)

`E2E_EXPORTS=1 pnpm test:e2e:prod tests/e2e/12-*.spec.ts` runs
`12-exports.spec.ts`. Exports fail **silently**: a CSV with the wrong winner, a
dropped match or the wrong escaper still parses, still opens, still looks right,
and the mistake surfaces months later in someone else's database. A unit test
over hand-built rows cannot catch that, because the rows it checks are the rows
it wrote.

So every assertion reconciles the export against something the spec knows
independently — the bracket the API returned, the exchanges the pad posted, and
arithmetic that has to balance:

| Export                          | What it is reconciled against                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `exports/matches.csv`           | Every winner must equal the **bracket's** `winnerRegistrationId`; every score is 5–3       |
| `exports/exchanges.csv`         | The exported hits must **add up to** the exported scores, match by match                   |
| `exports/rankings.csv`          | One win per match; points scored == points conceded, in total                              |
| `hema-ratings/preview` + `.zip` | The pre-flight's file list must equal the zip's entries — it is a promise about a download |

The **two escapers** are the sharpest edge, and one fighter is named
`=Export 08` for that reason alone:

- `escapeCsvCell` (RFC 4180 **+ formula neutralisation**) for files a person
  opens in a spreadsheet — `rankings.csv` must carry `"'=Export 08"`;
- `escapeCsvField` (RFC 4180 only) for the HEMA Ratings bundle, which no person
  reads — `fighters.csv` must carry `=Export 08` **raw**, because an injected
  apostrophe would corrupt the name their importer stores.

One roster, one run, both proved. The bundle is also checked against HEMA
Ratings' own contract: **no header row** (their reference exporter, HEMA
Scorecard, drops straight into the row loop), fighter names byte-identical
between `fighters.csv` and the tournament file, club names likewise between
`clubs.csv` and the fighters' club column, round labels in their vocabulary
(`Final`, `Bronze Final`, `Winners Semi Final`, …), and the tournament name
preserved verbatim in the filename — spaces, case and all — because that is
where they read it from.

Finally it flips the event to `event_kind: 'test'` and asserts both HEMA
endpoints 400, then restores it in a `finally`: only standard events may reach a
global rating pool.

## Subject export + deletion requests (opt-in)

`E2E_PRIVACY=1 pnpm test:e2e:prod tests/e2e/13-*.spec.ts` runs
`13-privacy.spec.ts`. It holds the GDPR subject bundle
(`GET /me/data-export.zip`) to its **own** promises — every file the manifest
names exists, carries the row count it claims, and stamps each row with the
`_table` its README advertises — and drives the deletion-request lifecycle that
is the one thing allowed through the archived-event read-only guard.

> **It found three production bugs on its first run**, all fixed and awaiting a
> redeploy: the subject export 500d for every user (a column dropped by
> migration 0063 was still declared), archived events were never actually
> read-only (the guard never read the `:id` param its own routes bind), and the
> deletion-request "has scored matches" fallback queried a column that does not
> exist. Until the API is redeployed those three assertions are red — check
> `/api/v1/version` against `main` before blaming the spec.

The event-target lifecycle creates its **own** `event_kind: 'test'` event rather
than using the shared one: archiving is one-way, and only that kind stays
hard-deletable while archived, so the spec can clean up after itself.

Deliberately out of scope: retention runs and person anonymisation. Both are
destructive well beyond a throwaway event and both sit behind `SuperAdminGuard`,
which the E2E account (an org owner) cannot pass — so the spec pins the
**boundary** instead, asserting all three admin privacy routes refuse it, and
skips itself if the credentials ever gain platform rights.

## Referee compensation (opt-in)

`E2E_COMPENSATION=1 pnpm test:e2e:prod tests/e2e/14-*.spec.ts` runs
`14-compensation.spec.ts` — the only surface in MyClash that produces a number
somebody is **paid**, derived through four hops no test had ever run together:
assignment → completed matches in that scope → tokens at the plan's rate → a
tier band → clamped to the event's floor and cap.

The payout is knowable in advance rather than read back: a 4-fighter round robin
is exactly **six** matches, the spec plays exactly **four**, and one referee is
assigned to that pool at three tokens a match. Twelve tokens lands in a band
worth 40. The two unplayed matches are the control — a report that counted
scheduled matches would read eighteen tokens and land in a different band. The
plan also carries extravagant bracket and finals rates that must never appear,
since this referee only worked a pool.

Then the clamps, including the case an organiser reaches by mistake: a floor
**above** the cap, where the floor wins (`clampCompensationAmount` applies it
last).

> **It found the fourth production bug of this spec family.** The report emitted
> `userId: claimed_by_user_id ?? person_id` while payments keyed on the auth uid
> only, so marking an **unclaimed** referee paid — nearly every referee at a real
> event — wrote a row nothing could read back, and the UI's optimistic checkbox
> hid it until the next reload. Fixed by migration 0163 (payments now key on
> `person_id`); that assertion is red until the API is redeployed.

## The public site, showing real data (opt-in)

`E2E_PUBLIC_SITE=1 pnpm test:e2e:prod tests/e2e/15-*.spec.ts` runs
`15-public-site.spec.ts`. `tests/a11y` already opens these pages, but it stubs
`**/api/**` — it proves the markup is reachable and says nothing about whether
the site can show a real tournament. This is the other half.

Every assertion is on a string that did not exist before the run started, so no
fixture, cache or stub can satisfy it. The sharpest is the **champion's name in
the gold-medal row** of the final-ranking tab: that ranking is computed in the
BROWSER by `computeFinalRanking` from bracket rows the API served, so seeing it
proves the whole chain from scored exchanges to rendered podium.

Two things this spec had to learn the hard way, both worth knowing before
touching it:

- **A draft tournament hides the bracket and final-ranking tabs** (`!isDraft`),
  and the ranking content gates a second time on `status === 'completed'`. An
  unpublished tournament falls back to the participants tab — where every
  fighter's name is listed, so a bare "is the champion's name on the page" check
  passes while proving nothing. The spec drives the real flow instead: publish
  the event, publish the tournament, mark it completed.
- **Every tab panel stays in the DOM**, inactive ones marked `hidden`. A
  page-wide text lookup matches a name on a tab nobody is looking at, and
  `.first()` returns that hidden copy. Assertions are scoped to `#panel-<key>`.

It builds its **own** `event_kind: 'club'` event. The shared throwaway event is
`standard`, and publishing a standard event ANNOUNCES it to the organisation's
followers — a test run must never do that to real people. Club is the one kind
that is fully public, silent on publish, and hard-deletable with results
recorded. Teardown deletes it under `E2E_CLEANUP`, and otherwise flips it to
`event_kind: 'test'` — the public resolver gates on KIND, not status, so merely
unpublishing would leave it reachable by slug.

Set `E2E_PUBLIC_URL` if web-public is not at `https://app.myclash.fr`.

## Status

| #   | Flow                                | Spec                                | State                                    |
| --- | ----------------------------------- | ----------------------------------- | ---------------------------------------- |
| 1   | CSV participant import              | `01-participants-import.spec.ts`    | active                                   |
| 2   | Create tournament (wizard step 1)   | `02-create-tournament.spec.ts`      | active                                   |
| 3   | Create event (wizard)               | `03-create-event.spec.ts`           | active (step 1 + full happy path)        |
| 4   | Schedule / programme                | `04-schedule.spec.ts`               | active (page load + generate)            |
| 5   | Referee auto-assign board           | `05-referee-board.spec.ts`          | active                                   |
| 6   | Offline scoring sync (PWA)          | `06-offline-sync.spec.ts`           | active                                   |
| 7   | Populate rich demo event            | `07-populate-event.spec.ts`         | opt-in (`E2E_POPULATE=1`); see above     |
| 8   | Offline scoring on a custom ruleset | `08-offline-custom-ruleset.spec.ts` | active                                   |
| 9   | Double-elimination playthrough      | `09-double-elim.spec.ts`            | opt-in (`E2E_DOUBLE_ELIM=1`); see above  |
| 10  | Scoring-pad server contract         | `10-scoring-pad.spec.ts`            | opt-in (`E2E_SCORING_PAD=1`)             |
| 11  | League season                       | `11-league.spec.ts`                 | opt-in (`E2E_LEAGUE=1`); see above       |
| 12  | Exports + HEMA Ratings bundle       | `12-exports.spec.ts`                | opt-in (`E2E_EXPORTS=1`); see above      |
| 13  | Subject export + deletion requests  | `13-privacy.spec.ts`                | opt-in (`E2E_PRIVACY=1`); see above      |
| 14  | Referee compensation                | `14-compensation.spec.ts`           | opt-in (`E2E_COMPENSATION=1`); see above |
| 15  | Public site on real data            | `15-public-site.spec.ts`            | opt-in (`E2E_PUBLIC_SITE=1`); see above  |

Every spec in the table above runs — there are no `test.fixme` flows left. The
opt-in ones are gated purely on their env flag, and the nightly sets all six.
