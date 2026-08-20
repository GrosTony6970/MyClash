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
pnpm e2e:cleanup --dry-run            # list every leftover event from ANY past run
pnpm e2e:cleanup                      # …and delete them
pnpm test:e2e:prod tests/e2e/07-*.spec.ts  # run one test by number (here: test 7)
```

Specs are numbered `01`…`37` (see the index below and the Status table), so you can run one by number.

### Cleaning up leftovers — `pnpm e2e:cleanup`

`E2E_CLEANUP=1` only disposes of **the event the current run created**. Every run that
finishes without it — the default — leaves its event behind, and no later run can see it.
Spec `17` makes this sharper: it creates its own disposable events (an archive source and
its restored copy) that the run context never records at all.

`pnpm e2e:cleanup` sweeps the whole org instead of one run, so it collects leftovers
regardless of which run made them or whether that run finished. `--dry-run` lists without
touching anything and always exits `0`; a real sweep exits non-zero if anything survives.

Two things it is careful about, both learned the hard way:

- **It verifies against `GET /organizations/:orgId/events`, never a per-id lookup.**
  `GET /events/:slug` is the _public_ resolver and 404s an event whose `event_kind` is
  `test` — by design. A checker built on it reports "already gone" for exactly the rows it
  failed to delete, which is the worst way for a cleanup to fail.
- **It reuses the stored session** (`tests/e2e/.auth/admin.json`) when it is fresh, and only
  logs in otherwise. Password login is throttled 3/hour per email, and a cleanup run must
  not spend the budget the next test run needs.

It matches an `^e2e-` slug prefix, anchored: a real event merely containing "e2e" is never
touched, because this deletes hard and does not ask.

### Spec index

Generated from `tests/e2e/*.spec.ts`. Section headings below are prose titles, so this table is
the way to get from a spec number to what it does. The Status table at the end of the file carries
the pass/fail record.

<div style="overflow-x:auto">

| #    | Spec                   | Opt-in flag                                                                                                                                                                                                              |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01` | participants import    | `E2E_PARTICIPANTS_CSV`                                                                                                                                                                                                   |
| `02` | create tournament      | — always runs                                                                                                                                                                                                            |
| `03` | create event           | — always runs                                                                                                                                                                                                            |
| `04` | schedule               | — always runs                                                                                                                                                                                                            |
| `05` | referee board          | — always runs                                                                                                                                                                                                            |
| `06` | offline sync           | `E2E_STAFF_URL`                                                                                                                                                                                                          |
| `07` | populate event         | `E2E_LIVE_DURATION_S`, `E2E_LIVE_SIDESWORD`, `E2E_PACE_MS`, `E2E_PARTICIPANTS_CSV`, `E2E_POPULATE`                                                                                                                       |
| `08` | offline custom ruleset | `E2E_STAFF_URL`                                                                                                                                                                                                          |
| `09` | double elim            | `E2E_DOUBLE_ELIM`                                                                                                                                                                                                        |
| `10` | scoring pad            | `E2E_SCORING_PAD`                                                                                                                                                                                                        |
| `11` | league                 | `E2E_LEAGUE`                                                                                                                                                                                                             |
| `12` | exports                | `E2E_EXPORTS`                                                                                                                                                                                                            |
| `13` | privacy                | `E2E_PRIVACY`                                                                                                                                                                                                            |
| `14` | compensation           | `E2E_COMPENSATION`                                                                                                                                                                                                       |
| `15` | public site            | `E2E_PUBLIC_SITE`, `E2E_PUBLIC_URL`, `E2E_SCORING_URL`                                                                                                                                                                   |
| `16` | pad ui                 | `E2E_PAD_UI`, `E2E_STAFF_URL`                                                                                                                                                                                            |
| `17` | archive restore        | `E2E_ARCHIVE`                                                                                                                                                                                                            |
| `18` | staff pad              | `E2E_STAFF`, `E2E_STAFF_URL`                                                                                                                                                                                             |
| `19` | workshops              | `E2E_WORKSHOPS`                                                                                                                                                                                                          |
| `20` | schedule               | `E2E_SCHEDULE`                                                                                                                                                                                                           |
| `21` | referee assign         | `E2E_SCHEDULE`                                                                                                                                                                                                           |
| `22` | swiss                  | `E2E_SWISS`                                                                                                                                                                                                              |
| `23` | swiss seeding          | `E2E_SWISS`                                                                                                                                                                                                              |
| `24` | swiss public           | `E2E_PUBLIC_URL`, `E2E_SWISS`                                                                                                                                                                                            |
| `25` | swiss data             | `E2E_SWISS`                                                                                                                                                                                                              |
| `26` | print pack             | — always runs                                                                                                                                                                                                            |
| `27` | super admin            | `E2E_PLATFORM_ADMIN_EMAIL`, `E2E_PLATFORM_ADMIN_PASSWORD`, `E2E_PLATFORM_VIEWER_EMAIL`, `E2E_PLATFORM_VIEWER_PASSWORD`, `E2E_SUPER_ADMIN`; the console half also reads `E2E_SUPERADMIN_EMAIL`, `E2E_SUPERADMIN_PASSWORD` |
| `28` | live control room      | `E2E_LIVE_BOARD`                                                                                                                                                                                                         |
| `29` | league multi event     | `E2E_LEAGUE`                                                                                                                                                                                                             |
| `30` | ai settings            | `E2E_AI`, `E2E_SUPERADMIN_EMAIL`, `E2E_SUPERADMIN_PASSWORD`                                                                                                                                                              |
| `31` | ai generation          | `E2E_AI`, `E2E_AI_KEY`, `E2E_AI_PROVIDER`                                                                                                                                                                                |
| `32` | ai organiser tools     | `E2E_AI`, `E2E_AI_KEY`, `E2E_AI_MODEL`, `E2E_AI_PROVIDER`                                                                                                                                                                |
| `33` | staff desk             | `E2E_STAFF`                                                                                                                                                                                                              |
| `34` | seeding drift          | `E2E_DRIFT`                                                                                                                                                                                                              |
| `35` | forfeit cascade        | `E2E_FORFEIT`                                                                                                                                                                                                            |
| `36` | uncomplete cascade     | `E2E_UNCOMPLETE`                                                                                                                                                                                                         |
| `37` | api failure seam       | none for venues; `E2E_SUPERADMIN_EMAIL` / `E2E_SUPERADMIN_PASSWORD` for the backup console                                                                                                                               |

</div>

Note that **PowerShell does not expand globs and Playwright reads its argument as
a regex**, so `tests/e2e/18-*.spec.ts` silently matches nothing there — pass the
literal path (`pnpm test:e2e:prod tests/e2e/18-staff-pad.spec.ts`).

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
> `PATCH /matches/:id/status`, which **no frontend calls**: web-staff posts
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
> `person_id`). Shipped in 0163 (commit 64330c4f) and long since redeployed — the assertion is
> green; this note is kept for the bug's provenance, not as a standing excuse.

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

## The pad's other buttons (opt-in)

`E2E_PAD_UI=1 pnpm test:e2e:prod tests/e2e/16-*.spec.ts` runs
`16-pad-ui.spec.ts`. It exists because of `4075243e`: the pad could not record a
single exchange, and the fault broke **all four** exchange types — the pad fills
the fields a type does not use with `?? null`, Zod's `.optional()` accepts
undefined only, so every POST 400d and `SyncEngine` DROPPED the entry with a
console warning. It survived to production because the only exchange any browser
test ever clicked was `clean-hit-button` (`06`/`08`).

`10-scoring-pad.spec.ts` covers the same endpoints and cannot close that gap: it
composes its own request bodies. What was missing is proof the **pad** composes
them correctly. So this spec clicks — double, no exchange, afterblow, a penalty
card, and the clock through `start → halt → resume → end` — and asserts what the
server ended up holding after each one.

Things worth knowing before touching it:

- **The clock goes last.** Ending it completes the match and raises the result
  overlay, which is `fixed inset-0 z-overlay` and intercepts every later click.
- **A running clock LOCKS scoring** (`canScore = scoringEnabled &&
!clockRunning`) — a real product rule that had no coverage. Steps 6–7 assert
  the buttons go disabled and come back.
- **Every control exists twice**, once per side. Assertions go through
  `[data-testid="scoring-column"][data-side="…"]`, never a bare `.first()` —
  clicking blue's penalty picker must card BLUE, and that is only provable if the
  locator is side-scoped.
- **The score expectation is derived, not restated**: the persisted
  `red_score`/`blue_score` is compared against the sum of the engine's own
  per-row deltas plus each penalty's `score_delta`. A click that lands the wrong
  type, side or value fails there rather than quietly matching a literal.
- **The penalty entry is read from the deployed ruleset**
  (`GET matches/:id/penalty-ruleset`, which falls back to the built-in FFAMHE
  set) and the first entry that actually issues a card is used. Naming one by ref
  number would break the day the rulebook is revised.

It needs the `data-testid`s in `apps/web-staff` — added with it — so a
**web-staff redeploy** is a precondition for it going green.

## Archive export → restore round-trip (opt-in)

`E2E_ARCHIVE=1 pnpm test:e2e:prod tests/e2e/17-*.spec.ts` runs
`17-archive-restore.spec.ts`. `archive.service.ts` is ~1300 lines and had no
end-to-end coverage: `archive.migration-coverage.test.ts` proves tables are
**listed**, never that a restore reproduces anything, and `archive.service.test.ts`
mocks Supabase — a mock inserts any column without caring what it references,
which is exactly how `matches.referee_id` stayed unmapped.

It plays a tournament to a champion, exports the archive, restores it, and holds
the copy to the original: persons **copied under new ids** (and reset to
`unclaimed`), the registrations, the bracket slot by slot with its scores, the
champion **by name** — every id was regenerated, so a name is the only comparable
identity — and every match result plus every exchange, compared through the
archive's own `resultsCsv`/`exchangesCsv` reports. Then it checks the **source is
untouched**.

Both restore paths, because they are different code with different rules:

| path                                 | what only it does                                            |
| ------------------------------------ | ------------------------------------------------------------ |
| event scope                          | forces the copy to `draft`, **copies** the person rows       |
| tournament scope, into its own event | forces the tournament to `draft`, **shares** the person rows |
| tournament scope, into another event | copies the persons instead (the clone-last-year flow)        |

Two things it checks that no unit test can:

- **Nothing in the copy still names the source.** After each restore it
  deep-walks every archived row and refuses any string equal to a SOURCE row id.
  `mapFk` returns early on anything that is not a top-level string, so every id
  nested in an array or an object used to survive verbatim — with the FK
  satisfied, because the source rows still exist, so nothing ever complained.
  There is a unit-level version of this sweep, but it runs against the mocked
  Supabase described above; this one walks rows a real restore really wrote.
  Source ids are collected as the `id` column of archived rows and nothing else,
  which keeps the legitimate pass-throughs (a global person, an org-level venue
  or plan, an auth user) out of the set by construction.
- **A second-black-card review names the COPY's penalties.**
  `tournament_penalty_reviews.payload_json` holds `{ penaltyIds: [...] }` —
  `match_penalties.id`s, inside a JSON column. There is no FK on a JSON key, so
  a copy that kept the source's ids satisfied every constraint and looked fine,
  while confirming or dismissing the copy's review reasoned about another
  event's black cards. Found by the schema-scan gate rather than by review, and
  this is where it is exercised end to end — on its own disposable event, so it
  perturbs none of the exact counts the main test asserts.

Notes worth having before touching it:

- **`GET events/:slug` resolves by SLUG and is public** — the wrong door for an
  id-addressed draft. The restored event row is read from the copy's own archive
  export, which is the org-admin route and returns the raw row.
- **Row order is not part of the contract.** `listRowsByIds` has no `ORDER BY`,
  so the CSV comparisons are multisets of sorted rows, and `exchangesCsv` has its
  two id columns dropped first.
- It builds its **own `event_kind: 'test'` event**: an event-scope archive of the
  shared throwaway event would drag in every other spec's tournaments and vary
  run to run, and `test` is the one kind that stays hard-deletable with results
  recorded — which the copy inherits, since `restoreEventCopy` spreads the source
  row. `E2E_CLEANUP` deletes both; otherwise both URLs are printed.

## The referee's real login (opt-in)

`E2E_STAFF=1 pnpm test:e2e:prod tests/e2e/18-staff-pad.spec.ts` runs
`18-staff-pad.spec.ts`. Every other scoring spec (`06`, `08`, `10`, `16`)
authenticates with the **organizer's** cookie from `global-setup`, which takes
the first branch of `authorizeMatchScoring`. A referee at an event does not have
that cookie — they sign in on a shared tablet with a PIN
(`POST /api/v1/staff-auth/login`), landing in the second branch, whose **five**
rules nothing had ever driven:

| rule                                          | the failure it describes                                |
| --------------------------------------------- | ------------------------------------------------------- |
| `requireStaffFromRequest(req, SCORING_ROLES)` | a check-in or gear volunteer on a scoring surface       |
| `match.eventId !== staff.event_id`            | a tablet signed into yesterday's event                  |
| `!match.liceId`                               | **the organizer never assigned the piste** — a live 403 |
| `!isLiceAssigned(...)`                        | the referee reaching for someone else's piste           |
| `canOverrideLocked: false`                    | staff may never reopen a locked match                   |

The role gate arrived with the staff roles in `fa15528f` and fires **first** — a
desk account is refused before the piste checks it could never pass anyway.

Things worth knowing before touching it:

- **The storage state is the whole trick.** `playwright.e2e.config.ts` applies
  the organizer's `storageState` to every context, and the organizer branch wins
  whenever `sb-access-token` resolves — so calling the staff login from the
  shared fixtures would re-prove the branch already covered four times. The
  staff half runs in `browser.newContext({ storageState: undefined })`, and
  `context.request` shares that context's cookie jar, so the **browser's** PIN
  login is what authenticates the API assertions too.
- **The refusals are asserted by their REASON, not their status.** All three
  lice/event rules return 403; matching only the status would let any of them
  stand in for any other. A 4xx carries its real message in `detail`/`message` —
  only a 5xx hides it.
- **There is no `POST /matches/:id/lock`.** Locking is `MatchAutoLockService`, a
  60 s interval that locks a completed group once `autoLockDelayMinutes` has
  elapsed. The spec builds a one-match pool with the delay at 0 and polls, which
  makes it the only test that proves that scan runs in production at all. It
  skips a group whose latest `ended_at` is null, so if that poll ever times out,
  suspect completion not stamping `ended_at` before suspecting the spec.
- **Both login legs carry `?event=`, and that is load-bearing.**
  `StaffPinForm` renders the `#eventSlugOrCode` input only on the deep-link
  branch, or when the event picker came back empty. The spec creates an active
  staff account before it navigates, which is exactly what puts the event in the
  picker — so a bare `/login` shows the picker and that input never mounts. The
  wrong-PIN leg used to navigate bare, and had been failing since the picker
  shipped in `e3464cd1`. Worse, with a picker rendered and nothing tapped the
  form posts an empty event slug and gets a **400**, which it renders in the
  same generic alert as the **401** the leg means to prove — so that assertion
  would have gone green on the wrong failure. The deep link makes 401 the only
  reachable outcome.
- **The picker is asserted at the API, not in the UI.** `GET staff-auth/events`
  is `@Public()`, and the spec pins its six-field projection because that
  projection is the security boundary. Membership is deliberately not asserted:
  the list is capped at 50 ordered by `start_date`, and the run event's `2099`
  date sorts last behind every sibling a failed teardown left behind.
- It creates its own `event_kind: 'test'` event for the wrong-event case, and
  disables the staff account as its **last** act — nothing after that can log in.
  That event is deleted by the spec's **own** `afterAll`: `global-teardown` only
  ever removes the run's shared event, so this spec leaked one event per nightly
  until the hook existed.

## The desk, the gear table and the pass (opt-in)

`E2E_STAFF=1 pnpm test:e2e:prod tests/e2e/33-staff-desk.spec.ts` runs
`33-staff-desk.spec.ts` — the staff surfaces that are not the scoring pad. The
check-in desk, per-weapon gear checks and personal event passes all shipped on
2026-08-08 with no E2E coverage at all.

**Its value is wiring, and the header says so.** The services underneath are
thoroughly unit-tested and this spec does not re-litigate them. What a mock can
never tell you is that the module is mounted at the real paths, that a real
`mc_staff` cookie round-trips Fastify and the real JWT, that migrations
0174–0176 are actually deployed (the UNIQUE index behind an idempotent
double-arrive, the CHECK behind a reason-less conditional), that a base64url
pass token survives a real path parameter, and that the weapon chain resolves
against the real `weapon_catalog`.

Things worth knowing before touching it:

- **It builds its own event, and that is not fastidiousness.**
  `GET staff/checkin/missing` assembles a PostgREST `.or()` filter from every
  registration id in the event; on the shared event, which ends a full run at
  ~200 people, that is a ~22 KB query string a proxy rejects before PostgREST
  sees it. `summary` also counts every person in the event, so shared-event
  numbers are meaningless, and the roster is capped at 40 rows by family name,
  which hides a fixture outright. Its own event makes `total` an exact number.
- **The weapon name is load-bearing.** Gear resolves
  `registrations → tournaments.weapon → slugify → weapon_catalog.slug`, and the
  catalog seeds exactly ten slugs. An invented weapon fails **silently** — the
  fighter still appears, with `weapons: []`, and there is no id to check
  against. The spec uses capitalised `Longsword` so the slugify hop does real
  work, and names the catalog in the failure message.
- **Four cookie jars, none of them the `request` fixture by accident.** The
  organizer jar is `request`; the desk, gear and participant jars are
  `playwright.request.newContext(...)`, which inherits **neither** `baseURL` nor
  `ignoreHTTPSErrors` from the config — both must be passed or every call dies
  at the TLS handshake against prod's dev cert.
- **The participant jar must carry no organizer cookie.** `resolvePersonId`
  tries the claimed user first, and the login auto-link can attach the E2E admin
  to a person row — so a stray organizer cookie could issue somebody else's
  pass.
- It never touches `POST events/:id/passes/mail`: that emails real people.

## Workshops: who actually got the seat (opt-in)

`E2E_WORKSHOPS=1 pnpm test:e2e:prod tests/e2e/19-workshops.spec.ts` runs
`19-workshops.spec.ts`. Workshops are **31 endpoints that had zero assertions**:
`07` touches them, but its `step()` helper catches every error and carries on
(1714 lines, 10 `expect`s, excluded from the nightly).

That gap matters more here than almost anywhere else, because **the failure mode
is silent mis-allocation, not a throw**. A seat given to the wrong person reads
exactly like a seat given to the right one, and a waitlist promoted out of order
looks identical to one promoted in order. So every assertion is about **which
person ended up in which slot** — the whole roster compared as one object, keyed
by name — never about counts.

A 2-seat workshop and five people, enrolled one at a time (position is derived
from how many are already waiting, so a batch would prove nothing about order):

| step                    | what only it proves                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| enrol 5                 | the first two sit; the rest queue 1, 2, 3 in arrival order                                                                               |
| refuse a seated one     | the freed seat goes to the **top** of the queue, and `recompactWaitlist` closes the gap behind them rather than leaving a hole           |
| re-enrol the refused    | 403, and the row is **not** resurrected                                                                                                  |
| promote a seated person | 400 — promote only applies to someone waiting                                                                                            |
| accept the last waiter  | a deliberate override: seats **past capacity**                                                                                           |
| instructors             | `workshops.instructors` keys on `global_persons.id` while enrolment keys on the event-scoped `persons.id` — two identities for one human |
| breaks, public list     | the public read is status-gated; a **draft** workshop must not leak                                                                      |

> **`POST workshops/:id/notify` is deliberately out of scope** — it messages real
> people, the same rule that keeps `15` on a club-kind event.
>
> Promotion _does_ notify, but safely: `waitlistPromoted` returns early unless
> the person has a `claimed_by_user_id`, and every attendee here comes from
> `ensureRoster` unclaimed. That is a precondition, not a coincidence — **never
> enrol a claimed person in this spec.**

## The schedule and the referee board, held to their own rules (opt-in)

`E2E_SCHEDULE=1` runs **`20-schedule.spec.ts`** and **`21-referee-assign.spec.ts`**.
`04` asserts `matchesScheduled > 0` and nothing else — which a generator that
dumped every match onto one piste at the same instant would satisfy — and `05`
has six assertions for 33 referee endpoints.

**`20`** holds the generator to the contract written in
`match-scheduler.ts`'s own header, as four independent invariants over real
generated rows:

| invariant                                                      | the day it saves                                          |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| one piste runs one match at a time                             | two bouts called to the same strip                        |
| no fighter is in two matches at once                           | a fighter called to two pistes and able to answer neither |
| consecutive bouts are ≥ `minRestMinutes` apart                 | the rest promise the block itself makes                   |
| a pool stays on one piste (and the two pools do not share one) | "pool 2 is over there" stops being true                   |

It also pins the one validation `resize` actually performs (end after start) and
does **not** pretend overlap is validated, because it isn't.

**`21`** covers what `05` never asks: whether the board respects the two facts an
organiser curates. A referee cast of three qualified, one qualified-but-marked-
unavailable, and one with no qualification at all — then manual assign refuses
the unqualified one **by message**, auto-assign's applied board contains neither
the unqualified nor the unavailable referee, and everyone it _did_ place is from
the eligible set (so the two exclusions cannot pass by assigning nobody).
Finally the lock: `DELETE` 409s while confirmed, and succeeds after unlock —
which is what proves the 409 came from the lock and not from the row.

> **Both build their own `event_kind: 'test'` event.** `programme/generate` and
> referee auto-assign are **event-wide**, so run inside the shared throwaway
> event they would be grading whatever `04`, `05` and `18` happened to leave
> behind rather than what the spec set up.
>
> `lock-referee-assignments` fires three notification paths. All three return
> early without a `claimed_by_user_id` (and the follow path needs a follower),
> and every referee here is a fresh unclaimed `ensureRoster` person — so nothing
> is sent. **Never put a claimed person on this board.**
>
> `20` found a production bug on its first run: **moving a programme block never
> moved its matches** on any non-UTC container. The scheduler writes
> `scheduled_at` with `setHours` (container-local `TZ`) and `moveBlock` read it
> back with `getUTCHours()`, so a 09:00 block stored as 08:00Z failed the
> "at or after the block start" filter and every match was skipped — silently.
> Fixed in `ef5b4e74`; `deleteBlock`'s comment had predicted it.

## Swiss rounds pair themselves (opt-in)

`E2E_SWISS=1 pnpm test:e2e:prod tests/e2e/22-swiss.spec.ts` runs
**`22-swiss.spec.ts`**, the only test that plays a Swiss phase against a real
database.

Swiss earns this more than any other format, because **round N+1 does not exist
until round N is scored**. `SwissAdvanceService.onMatchCompleted` pairs it, from
inside `MatchCompletionService`, wrapped in a catch that swallows — a completion
side effect must never fail the exchange that triggered it. So a broken advance
edge throws nothing, logs a warning nobody is watching, and the tournament
simply stops after round 1. That is the double-elim `source_a_ref` failure mode
again: silent, permanent, and invisible to every unit test, because the unit
tests mock Supabase and never let the edge run.

Two more things only real rows reach:

- **the DI graph.** `SwissCoreModule` is a leaf precisely so `PhasesModule` can
  import it for auto-advance without closing a cycle. A NestJS module cycle is
  invisible to `tsc` **and** to vitest (esbuild emits no decorator metadata) —
  it surfaces only when the API boots. Calling these endpoints against a
  deployed API is the check.
- **`swiss_rounds UNIQUE (phase_id, round_number)`**, the backstop for two
  near-simultaneous completions both seeing "round complete".

Five scenarios over a 13-fighter, 4-round phase (~24 bouts each):

| Scenario                | What only it proves                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A. plays itself through | The next round pairs itself **off the pad**, four times running; one bye per round, nobody twice, no unflagged rematch           |
| B. standings            | Points and **Buchholz recomputed independently** agree — the one column that cannot be right by accident                         |
| C. override             | A swap preserves the round; a rematch-creating swap **409s with `creates-rematch`** and proceeds on confirm                      |
| D. withdrawal           | Played results stand: the opponent keeps the win **and** the Buchholz contribution, and the already-drawn round keeps the leaver |
| E. cut                  | `finalise` freezes the standings, and `by-swiss-rank` maps rank K onto **seed K** for the whole cut                              |

The round-1 draw is random (the default), so who plays whom differs per run.
Determinism comes from the winner **rule** instead — the lower seed always wins —
which makes `Seed 01` unbeaten in every run whoever they were drawn against, and
makes every assertion an invariant rather than a hardcoded table. Where a random
draw can legitimately produce two unbeaten fighters, the spec asserts "holds the
maximum score" rather than "is rank 1", so a correct outcome can never fail it.

Bouts are played the way the **pad** plays them — clean exchanges until the
ruleset engine trips `first_to_points` — reusing `scoreMatch` from `_bracket.ts`.
`expectEngineDecided` then asserts every winner sits exactly on the cap, which is
what separates "the test decided" from "the engine decided". A bout completed
with a **null** winner (both sides at the cap) can never close its round, so the
phase would stall; catching it at the bout beats a missing-round timeout four
rounds later.

> The driver (`_swiss.ts`) is **resumable**: it sequences on the latest round
> number and skips finished bouts, rather than counting from 1. Scenarios C and D
> score round 1 by hand — to set up a rematch swap, and to withdraw someone who
> fought — then hand over mid-phase.
>
> Like the other playthrough specs it **completes matches**, so the event can no
> longer be hard-deleted afterwards. Run it on a sandbox org.

## Swiss: seeding refusals, a broken round, and the data that escapes (opt-in)

`E2E_SWISS=1` also runs **`23-swiss-seeding.spec.ts`**, **`24-swiss-public.spec.ts`**
and **`25-swiss-data.spec.ts`** alongside `22`.

**`23`** covers the two edges around the playthrough. Every seeding strategy
shares one rule, written into `swiss-seeding.service.ts`'s own header: REFUSE
rather than degrade, because a draw that quietly falls back to registration order
looks seeded, gets defended as one, and nobody finds out until somebody checks.
Two refusals implement it (`by-pool-rank` without a finished pool phase,
`by-rating` under the coverage threshold) and neither had ever run. It also
breaks a round on purpose with `setMatchSides` — the one override that can leave
a fighter in two bouts — and proves the next round will not pair on top of it.

**`24`** RENDERS the admin route and the public tab. `22` never opens a page, so
between them `next build` proved the components compile and `t-key-references`
proved every static key resolves, but nothing proved they render. It builds its
own `event_kind: 'club'` event (publishing a `standard` event announces it to the
organisation's real followers) and **plays before it publishes**, because
`swiss_round_published` fires per round once the tournament is public. Its
`expectNoRawKeys` is the only check that catches a dynamically-composed `t()` key
the i18n sweep is blind to.

**`25`** follows Swiss data OUT of the app — the archive round-trip and the HEMA
Ratings bundle. Both had zero Swiss coverage despite slices 1/7/8 changing them.

Between them these found four real bugs on their first runs:

| bug                                                                                                  | why nothing caught it                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An invalid round paired the next one anyway                                                          | `swiss.dto.ts` DOCUMENTED the guard ("an invalid round blocks the next one from being committed"); nothing implemented it. `validateSwissRound` had only ever been called for reporting                                                        |
| `by-pool-rank` with no explicit `sourcePhaseId` persisted a phase whose config failed its own schema | The seeder resolves the pool phase itself, but the config recorded the request's `null`. The phase row and its entrants were written, THEN every read of it 400'd                                                                              |
| `swiss_rounds.bye_registration_id` was never remapped on restore                                     | Every other registration FK is in the list. The constraint is satisfied — the SOURCE row still exists — so a restored phase's byes silently point into another event, the holder renders blank, and their bye points vanish from the standings |
| The swap-confirm dialog could not name the warning                                                   | Found earlier by `22`; the RFC 9457 envelope moves `warnings` under `details` and `swissMutate` never read them                                                                                                                                |

> Like the other playthrough specs these **complete matches**, so their events
> cannot be hard-deleted afterwards. `24` and `25` build and tear down their own;
> `23` writes into the shared throwaway event.

## A league across several events (opt-in)

`E2E_LEAGUE=1` also runs **`29-league-multi-event.spec.ts`** alongside `11`.

`11` links two tournaments to a league, but both sit in the **same event**, with
the **same roster** finishing in the **same order** — so every total doubles and
no two fighters are ever tied. It proves placement → points. It cannot prove
aggregation, because there is nothing to aggregate that is not a duplicate.

Three events, eight fighters seeded differently in each, and the expected table
is knowable in advance because the lower seed wins every match:

| rung asserted         | how the pair is built                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `total_points`        | ordinary different sums                                                  |
| `participation_count` | 100 from one event against 50 + 50 from two                              |
| `medal_count`         | 3rd + 5th (30 + 20) against 4th + 4th (25 + 25) — one medal against none |
| `double_hit_average`  | level on all of the above, separated by one deliberate double            |

Three things worth knowing before touching it:

- **Identity is name + club.** A contribution's `fighterId` is
  `persons.global_person_id`, resolved by HEMA Ratings id, then name + club +
  DOB. A club-less fighter mints a FRESH identity in every event, so a season
  would silently split into one single-event row per person. Every fighter here
  has a club, and the spec asserts the global ids really did match before it
  asserts anything about points.
- **The two recomputes are not interchangeable.** `admin/leagues/:id/recompute`
  re-ranks from rows already in `league_tournament_results`; only the per-event
  one reads tournaments and writes those rows. A spec calling just the first
  watches an empty season forever.
- **The table is asserted in TIERS, not one flat order.** `compareRankings` ends
  in `fighterName.localeCompare`, but the path that builds standings sets
  `fighterName: ''` on every contribution — so names are all equal and fully-tied
  fighters are ordered by their global person **UUID**. Arbitrary, but stable;
  the spec pins the tier boundaries and then that the order does not reshuffle
  on a second recompute.

> **It found a real defect on its first run.** `removeEventTournamentLinks`
> marked links `removed` and nothing more — it never dropped that tournament's
> `league_tournament_results`, and `recomputeForEvent` only walks `approved`
> links, so the unlinked event could never clean up its own rows. Removing an
> event from a season left every total still carrying its points, silently.
> Fixed in `leagues.service.ts`; **that assertion is red until the API carrying
> the fix is deployed.**

## The platform console, and who is refused (opt-in)

`E2E_SUPER_ADMIN=1 pnpm test:e2e:prod tests/e2e/27-super-admin.spec.ts` runs
`27-super-admin.spec.ts`. 42 pages under `apps/web-admin/app/admin` and ~30
`PlatformRoleGuard` controllers had **no coverage at all** — `13` proves an org
owner is refused on three destructive privacy routes and nothing else.

**Four halves, and each needs its own account.** One per platform tier plus the
ordinary organizer, because a tier system is only proven by accounts that
actually hold the tiers:

**Half A** sweeps every guarded controller as the ordinary organizer — an
account with **no platform role at all** — and asserts each refuses with **403
specifically**. Not "some 4xx": a 404 means the route
moved, which is a different bug wearing the same colour, and a sweep that
accepted it would go green the day a controller is renamed. It asserts the
account is _not_ a super admin first, because otherwise the whole half is
vacuous.

> The sweep found on its first run that `admin/league-scoring-systems` guards
> **per method, not per class** — its two GETs are open on purpose so an org
> admin can pick a scoring system when creating a league, while every mutation
> carries the guard. Probing its list would have asserted the opposite of the
> truth, so that controller is probed with a write instead, sent with a
> deliberately invalid body: if the guard ever vanished, validation answers 400,
> the assertion fails loudly, and no row is created.
>
> **Adding an admin controller means adding a row to `GUARDED_ROUTES`.** The
> sweep can only catch what it names.
>
> Note what the list means now the guard has tiers: every row refuses an
> account holding **no** platform role. It says nothing about which tier
> passes — that is Halves C and D, and
> `apps/api/src/modules/admin/guards/platform-role-coverage.test.ts` pins it
> per route offline.

**Half B** drives the console — the reads, one inert write, and the audit row
that write must leave. It needs a **dedicated platform account**
(`E2E_SUPERADMIN_EMAIL` / `E2E_SUPERADMIN_PASSWORD` plus a `platform_roles` row)
and runs in its own browser context, because `playwright.e2e.config.ts` applies
the organizer's `storageState` everywhere. Without those vars it **skips**.

> **Never promote the shared E2E account to super admin to save a login.**
> `13-privacy` refuses to invoke retention/anonymise for real when the caller is
> a super admin — promoting the organizer silently disarms that interlock and
> empties its refusal assertions.

**Half C** is the platform admin
(`E2E_PLATFORM_ADMIN_EMAIL` / `E2E_PLATFORM_ADMIN_PASSWORD`, a `platform_roles`
row with `role='platform_admin'`). It asserts **both** directions: the
super-admin reserve refuses it (AI keys, AI settings, backups, feature flags,
audit-log export, data retention — plus one reserved _write_), and its own
domain admits it (review queue, organisations, rulesets, ratings, weapons,
dashboard, logs, versions, runtime health, AI usage, audit log, users). Asserting
only one direction is how a tier that is secretly a super-admin — or secretly
nothing — still goes green.

> Half C is **reads only**, deliberately. Every write in the admin domain is
> genuinely destructive here (approve a claim, sync ratings, delete a club), and
> Half B's inert write-back target is a feature flag, which is now reserved. A
> probe that has to break something to prove a tier is not worth the tier.

**Half D** is read-only
(`E2E_PLATFORM_VIEWER_EMAIL` / `E2E_PLATFORM_VIEWER_PASSWORD`,
`role='platform_viewer'`). The tier is defined by what it cannot do, so the
write probes are the point: `POST admin/weapons` with an empty body, and a
`PATCH .../disable`. The empty body is chosen for the same reason as Half A's
league-scoring-systems probe — if the guard ever vanished, validation would
answer **400**, the assertion fails loudly, and nothing is created.

Each half **skips** without its own credentials, so running the spec with only
`E2E_SUPERADMIN_*` set still behaves exactly as it did before.

The write is `disable_hema_sync` set to the value it already has, then re-read to
prove it did not move. Every registry flag is behavioural, so the choice is about
blast radius: a misbehaving write path there pauses an external sync, where
`admin_lockdown` or `read_only_mode` would take the platform out from under a
live event. Then the audit-log export must carry a row **attributed to the actor
who made the change** — `audit_log` has one writer and masking happens at write
time, so an action that succeeds and records nothing is invisible to every unit
test.

Out of scope on purpose, the same line `13` draws: retention runs, person
anonymisation, backups, AI keys and budgets, org deletion, HEMA Ratings
submission.

## The live control room, and whether its realtime is alive (opt-in)

`E2E_LIVE_BOARD=1 pnpm test:e2e:prod tests/e2e/28-live-control-room.spec.ts` runs
`28-live-control-room.spec.ts`. `live-board-merge.test.ts` and
`live-board-state.test.ts` cover the merge and health derivation as pure
functions; nothing proved a channel ever **subscribes**.

That gap is dangerous here because the failure is silent by construction.
`useLiveBoard` runs a 7 s structural poll that is the source of truth, and
`LiceRealtime`'s own fallback is deliberately a no-op because of it — so a board
with every socket dead still fills in, still updates, still looks right, roughly
seven seconds late. This project has already shipped that twice: the realtime
tenant taken from the Host's first label, and an unpublished table in a
`postgres_changes` binding.

**So the proof is the channel's console line, not the score.** Asserting the
board eventually shows `2–0` passes identically whether realtime delivered it or
the poll did. `useRealtimeWithFallback` logs `[realtime] connected: <channel>` on
SUBSCRIBED and `[realtime] dropped (<status>): <channel>` otherwise, and those
are the only signals that tell the two apart (web-admin sets no `removeConsole`,
so they survive the production build).

Three assertions over two pistes with one bout each:

| assertion                                 | what only it proves                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| a `connected` line per lice, no `dropped` | the channel reached SUBSCRIBED — the binding and the publication agree     |
| the scored piste shows the new score      | the realtime patch merges into the row it belongs to                       |
| the untouched piste does not move         | `filter: lice_id=eq.<id>` is per lice; a leaking filter shows up only here |

Two things worth knowing before touching it:

- **The bout is left unfinished on purpose.** The board queries
  `status in (running, paused, scheduled)`, so completing it removes the bout
  from the piste and the row falls back to Idle. It scores two clean hits rather
  than reusing `scoreMatch`, which plays to the cap.
- **Websocket opens are recorded but not asserted** — they exist so a failure can
  name the layer: no socket at all is the transport (cert chain, realtime tenant,
  proxy), while a socket that opened and a channel that never subscribed is the
  binding or the publication.
- It skips itself when `disable_realtime` is on for the environment — that is a
  decision, not a defect, and the spec says so rather than failing.

## The AI stack: configuration for free, generation for money (opt-in)

`E2E_AI=1 pnpm test:e2e:prod tests/e2e/30-ai-settings.spec.ts` runs the whole AI
configuration surface. Adding `E2E_AI_PROVIDER` + `E2E_AI_KEY` also runs
`31-ai-generation.spec.ts`, **one of the two specs in this suite that spend money** — `32-ai-organiser-tools.spec.ts` carries the same `E2E_AI_PROVIDER` + `E2E_AI_KEY` gate and also bills tokens.

Six API modules (`ai-providers`, `ai-usage`, `generated-content`,
`organizer-ai-assistant`, `organizer-chat`, and the platform `admin/ai-*`
controllers) and four admin pages had no E2E coverage at all. The only AI in the
suite was three `admin/ai-*` rows in `27`'s guard sweep — whose header ruled AI
keys and budgets out of scope as "handles real secrets". Right call for a sweep,
wrong as a permanent state: the key store is the one place in this codebase that
encrypts a user secret, and nothing checked that the secret stays in.

**Why the split is by cost and not by feature.** `30` proves everything that can
be proved without a provider, and creating a key is one of those things: `apiKey`
is validated as `z.string().min(10)` and never sent anywhere on create, so the
AES-256-GCM round-trip, the one-active-key invariant, masking, model validation,
the two kill-switches and the no-key refusals all run on a fake string. `31` is
the part that cannot be faked, and it is separated so that enabling AI coverage
is never accidentally a decision to bill tokens.

What `31` asserts, and deliberately does not:

| asserted                                                       | not asserted                                  |
| -------------------------------------------------------------- | --------------------------------------------- |
| a row lands in the usage log — the call is METERED             | the wording, tone or length of the output     |
| the facts pipeline had real data to narrate                    | that the champion's name appears in the prose |
| content is stored as a **draft**                               | that the model chose a good draft             |
| publish/unpublish moves it in and out of the public projection | how the public page renders it                |

Model output is nondeterministic and the cheap models are cheap. An assertion
that fails when a model paraphrases is testing the model, not MyClash.

Three things worth knowing before touching these:

- **Every key install is snapshot → install → run → restore.** Activating a key
  goes through the scope's `set_active_*_ai_key` RPC, which deactivates every
  other key in that scope. A spec that installs its own key and walks away
  leaves the operator's real key switched off, and nothing reports it — the
  settings page just quietly says the wrong thing. `_ai.ts` owns that dance for
  all three scopes (org, fighter, platform); deleting the active key promotes
  some _other_ key on its own, which is why restore deletes first and
  re-activates second.
- **The data-quality scan runs in `mode: 'deterministic'`.** The default `ai`
  mode scans the entire real platform through an LLM at unbounded cost and
  writes findings about real people on every run. The deterministic mode
  exercises the same scan → findings → dismiss pipeline for nothing, which is
  what it was added for.
- **The kill-switch assertions check the STATUS only, on purpose.** The services
  throw `ServiceUnavailableException` with a message that says which switch is
  off, but `api-exception.filter.ts` replaces the message of every response with
  a status `>= 500` with a flat `"Internal server error"`. So all four AI
  kill-switch messages reach the client as a generic crash, and an organizer who
  turned AI off for their own org is told the server broke. Right scrubbing for a
  real 500, wrong for a 503 the product throws deliberately — worth fixing in the
  filter, but it is a repo-wide change, not a test change. Don't re-add a message
  assertion here; it will fail.
  `32-ai-organiser-tools` covers the organiser tools that _do_ something rather
  than write prose: applying a reviewed setup draft, confirming or dismissing an
  action the chatbot proposed, the natural-language tournament query, and the two
  organiser AI pages. Two of those had never worked in production — apply was
  unreachable because no draft could parse, and the NL query 400'd on every
  request — so this spec is the first thing that has ever asserted them.

**Its apply test edits the draft before applying, on purpose.** It creates a real
AI draft, then PATCHes `proposedActions` to a known action. That is the product's
own flow ("organizers review or edit drafts before applying") and the only way to
assert the _apply_ path rather than the model's choice of slug. The AI half still
has to parse and validate first.

- **The fighter-insight leg needs a claimed profile.** `E2E_ADMIN_EMAIL` must own
  a `global_persons` row or the personal-space AI has no identity to work from.
  The spec cannot claim one for itself — claiming goes through a
  super-admin-reviewed request, and a test must not self-approve that — so it
  skips with the reason until the account is claimed once by hand.

## A bracket seeded from standings that then changed (opt-in)

`E2E_DRIFT=1 pnpm test:e2e:prod tests/e2e/34-seeding-drift.spec.ts` runs
`34-seeding-drift.spec.ts`, which walks a bracket through all four
`seedingDrift` states against real pool results.

`seedingDrift` is computed on a READ by recomputing the seeding plan and diffing
it against the slots. Its whole claim is that the plan it recomputes is the plan
`populateBracket` would actually WRITE — and the unit tests mock the standings
service, so they prove the state machine and the wiring but never that the two
code paths agree. Only a real playthrough can.

The walk is the feature, not a sequence of independent checks:

| Step                            | Drift                                            |
| ------------------------------- | ------------------------------------------------ |
| pools played, bracket populated | `fresh`                                          |
| an R1 bout is started           | `fresh`, `blockingMatchIds` now names it         |
| a pool bout is put back on      | `pending` — the bracket will heal itself         |
| it is replayed the other way    | `stale` — the auto re-seed was refused, silently |
| the started R1 bout is reset    | `stale`, unblocked                               |
| the bracket is re-populated     | `fresh`, and the slots really moved              |

The last row is what makes the rest mean anything: drift said the draw disagreed
with the standings, and re-seeding moved **exactly the slots `changedSlotIds`
named**. Without it every earlier assertion only proves the endpoint agrees with
itself.

The page assertion reads `data-drift-state` and `data-remedy` rather than the
banner's text. Every label on that page exists in English and French, so a text
assertion would really be asserting on whichever language the session happens to
be in — `09-double-elim.spec.ts` sidesteps the same problem by asserting on
fighter names. What must hold is the ORDER: the cheap remedy (reset the one
started bout) is offered before Regenerate, which deletes every bout already
fought.

> The fixture flips the head-to-head between a POOL's top two, not the overall
> top two — pool assignment spreads the seeds, so the two fighters at the top of
> the overall standings are usually in different pools and never met. The spec
> asserts the flip actually reordered the standings, so a fixture that stops
> creating drift fails loudly instead of passing vacuously.

## A withdrawal, undone (opt-in)

`E2E_FORFEIT=1 pnpm test:e2e:prod tests/e2e/35-forfeit-cascade.spec.ts` runs
`35-forfeit-cascade.spec.ts`: one pool of four, an injury that withdraws a
fighter, one of the cascaded bouts put back on, a fresh forfeit written on it,
and then the whole withdrawal undone.

Two invariants, neither checkable against a mocked Supabase because both are
about what OTHER rows say afterwards:

- **the thread holds.** A forfeit re-recorded on a reopened bout hangs off the
  ROOT withdrawal, not off the child it replaced. `cascadeVoidChildren` is one
  query deep, so a tree of depth 2 strands grandchildren active when the root is
  voided — an F standing in the standings for a fighter who is back in the
  tournament, with nothing left pointing at it. The spec asserts
  `cascaded_forfeit_count` covers the re-recorded record too, and that every
  bout is playable again afterwards.
- **the cascade context is honest.** `GET /matches/:id/forfeit` reports
  `{role, childCount, parentActive}`, which the admin page branches its void
  confirmation on. `parentActive` cannot be derived on the frontend: the row
  says a parent EXISTS, never whether it still stands.

Nothing is played first — an injury in the first bout of the day is the
realistic shape, and it keeps every count in the spec exact.

## A result undone, and replayed the other way (opt-in)

`E2E_UNCOMPLETE=1 pnpm test:e2e:prod tests/e2e/36-uncomplete-cascade.spec.ts` runs
`36-uncomplete-cascade.spec.ts`: a bracket played forward, a decided bout reset,
and the same bout replayed with the other fighter winning.

Two things it holds that a unit test cannot, because both are about what the rest
of the bracket says afterwards:

- **the replay's winner is the one who advances.** Score R1P1 for red, reset it,
  replay it for blue — the final must carry blue and must no longer carry red. On
  `4ba8ce63` the final still named red, which is the defect in one assertion. It
  also covers a quieter invariant: exchange sequences continue past the voided
  ones, so `UNIQUE(match_id, sequence)` still holds across a replay.
- **the pre-flight tells the truth about risk.** `GET /matches/:id/uncomplete-preflight`
  reports `blocked`, `foughtCount` and `affected`. With nothing downstream played it
  must not block yet must still name the final as affected; once the final has been
  fought it must say so, and the reset then needs an explicit confirmation.

## Status

| #   | Flow                                  | Spec                                | State                                    |
| --- | ------------------------------------- | ----------------------------------- | ---------------------------------------- |
| 1   | CSV participant import                | `01-participants-import.spec.ts`    | active                                   |
| 2   | Create tournament (wizard step 1)     | `02-create-tournament.spec.ts`      | active                                   |
| 3   | Create event (wizard)                 | `03-create-event.spec.ts`           | active (step 1 + full happy path)        |
| 4   | Schedule / programme                  | `04-schedule.spec.ts`               | active (page load + generate)            |
| 5   | Referee auto-assign board             | `05-referee-board.spec.ts`          | active                                   |
| 6   | Offline scoring sync (PWA)            | `06-offline-sync.spec.ts`           | active                                   |
| 7   | Populate rich demo event              | `07-populate-event.spec.ts`         | opt-in (`E2E_POPULATE=1`); see above     |
| 8   | Offline scoring on a custom ruleset   | `08-offline-custom-ruleset.spec.ts` | active                                   |
| 9   | Double-elimination playthrough        | `09-double-elim.spec.ts`            | opt-in (`E2E_DOUBLE_ELIM=1`); see above  |
| 10  | Scoring-pad server contract           | `10-scoring-pad.spec.ts`            | opt-in (`E2E_SCORING_PAD=1`)             |
| 11  | League season                         | `11-league.spec.ts`                 | opt-in (`E2E_LEAGUE=1`); see above       |
| 12  | Exports + HEMA Ratings bundle         | `12-exports.spec.ts`                | opt-in (`E2E_EXPORTS=1`); see above      |
| 13  | Subject export + deletion requests    | `13-privacy.spec.ts`                | opt-in (`E2E_PRIVACY=1`); see above      |
| 14  | Referee compensation                  | `14-compensation.spec.ts`           | opt-in (`E2E_COMPENSATION=1`); see above |
| 15  | Public site on real data              | `15-public-site.spec.ts`            | opt-in (`E2E_PUBLIC_SITE=1`); see above  |
| 16  | The pad's other buttons + the clock   | `16-pad-ui.spec.ts`                 | opt-in (`E2E_PAD_UI=1`); see above       |
| 17  | Archive export → restore round-trip   | `17-archive-restore.spec.ts`        | opt-in (`E2E_ARCHIVE=1`); see above      |
| 18  | Staff PIN login + the staff rules     | `18-staff-pad.spec.ts`              | opt-in (`E2E_STAFF=1`); see above        |
| 19  | Workshops: seats, waitlist, staff     | `19-workshops.spec.ts`              | opt-in (`E2E_WORKSHOPS=1`); see above    |
| 20  | Schedule generator invariants         | `20-schedule.spec.ts`               | opt-in (`E2E_SCHEDULE=1`); see above     |
| 21  | Referee qualification + availability  | `21-referee-assign.spec.ts`         | opt-in (`E2E_SCHEDULE=1`); see above     |
| 22  | Swiss rounds, auto-advance, the cut   | `22-swiss.spec.ts`                  | opt-in (`E2E_SWISS=1`); see above        |
| 23  | Swiss seeding refusals + set-sides    | `23-swiss-seeding.spec.ts`          | opt-in (`E2E_SWISS=1`); see above        |
| 24  | Swiss admin route + public tab render | `24-swiss-public.spec.ts`           | opt-in (`E2E_SWISS=1`); see above        |
| 25  | Swiss archive + HEMA Ratings labels   | `25-swiss-data.spec.ts`             | opt-in (`E2E_SWISS=1`); see above        |
| 26  | Print pack route builds its document  | `26-print-pack.spec.ts`             | always                                   |
| 27  | Platform tier sweep + the console     | `27-super-admin.spec.ts`            | opt-in (`E2E_SUPER_ADMIN=1`); see above  |
| 28  | Live control room + its realtime      | `28-live-control-room.spec.ts`      | opt-in (`E2E_LIVE_BOARD=1`); see above   |
| 29  | League across several events          | `29-league-multi-event.spec.ts`     | opt-in (`E2E_LEAGUE=1`); see above       |
| 30  | AI keys, budgets, kill-switches       | `30-ai-settings.spec.ts`            | opt-in (`E2E_AI=1`); see above           |
| 31  | AI generation against a real provider | `31-ai-generation.spec.ts`          | opt-in (`E2E_AI=1` + key); **spends**    |
| 32  | Organiser AI tools + their pages      | `32-ai-organiser-tools.spec.ts`     | opt-in (`E2E_AI=1` + key); **spends**    |
| 33  | Check-in desk, gear table, passes     | `33-staff-desk.spec.ts`             | opt-in (`E2E_STAFF=1`); see above        |
| 34  | Bracket seeding drift, all 4 states   | `34-seeding-drift.spec.ts`          | opt-in (`E2E_DRIFT=1`); see above        |
| 35  | Pool forfeit cascade + re-record      | `35-forfeit-cascade.spec.ts`        | opt-in (`E2E_FORFEIT=1`); see above      |
| 36  | Un-completing a bracket match         | `36-uncomplete-cascade.spec.ts`     | opt-in (`E2E_UNCOMPLETE=1`); see above   |
| 37  | The api-failure seam in a browser     | `37-api-failure-seam.spec.ts`       | always (backup half needs super-admin)   |

Every spec in the table above runs — there are no `test.fixme` flows left. The
opt-in ones are gated purely on their env flag. The nightly does **not** set all of
them: `07` is excluded on purpose, and `34` (`E2E_DRIFT`), `35` (`E2E_FORFEIT`) and
`36` (`E2E_UNCOMPLETE`) are simply absent from `.github/workflows/e2e-prod.yml`. Those
three are documented here as active specs that nothing schedules — run them by hand, or
add the flag to the workflow.

`31` is the one exception to "gated purely on their env flag": it also needs
`E2E_AI_PROVIDER` + `E2E_AI_KEY`, which are opt-in by **secret** rather than by
flag precisely because setting them means every nightly bills tokens.
