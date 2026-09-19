# ADR-017 — A Match owns its time window; a Pool is the span of its Matches; the plan is the window

**Date:** 2026-09-13
**Status:** Accepted
**Amended:** 2026-09-14 — the planned length is read live from the Event's planner sheet, not copied
onto the Match when it is placed. See ADR-018.
**Amended:** 2026-09-18 — when the sheet cannot be read, a person's schedule ends a Match at its
next bout, as a fallback shown and checked on that schedule only. See "The window".

## Context

A Match stores one planned time, `matches.scheduled_at`, and no planned end or length. Everything
that needs an end invents one. Fifteen places in the code mint a bout length, and six different
meanings of "when does it end" are in use at once:

- the referee board ends a Pool at its last Match's start plus the median gap between its Matches'
  starts (`apps/api/src/modules/schedule/run-end.ts`), and a single Match at start plus five
  minutes;
- the schedule grid sends a constant five minutes on every card
  (`apps/api/src/modules/schedule/schedule-grid.service.ts`), and the shared block builder reads
  that before it tries its own median (`packages/schedule-core/src/schedule-blocks.ts`);
- Lice occupancy, both conflict detectors, the public "my schedule" and the staff live board each
  carry their own five (`apps/api/src/modules/matches/lice-occupancy.ts`,
  `apps/api/src/modules/phases/conflict-check-inputs.ts`,
  `apps/web-admin/app/org/[slug]/events/[eventId]/schedule/detect-overlaps.ts`,
  `apps/web-public/src/components/me/conflicts.ts`,
  `apps/web-admin/src/lib/live-board/live-board-timing.ts`);
- the public event page ends a Tournament at its last Match's start, with no length at all
  (`apps/api/src/modules/events/events.service.ts`);
- the public "my schedule" page tests how close two starts are, not whether they overlap.

The answers disagree on the same Pool at the same instant. Four Matches at 10:00, 10:08, 10:16 and
10:24: the grid says the Pool ends at 10:29, the referee board says 10:32. Drag the 10:16 Match to
another Lice at 14:00 and the board says 14:16, the grid 14:05, and occupancy has no Pool end at
all. The board's end moved because a middle Match left: the median changed, not the Pool.

The referee board also freezes its computed end into `referee_assignments.starts_at` and
`ends_at`, and the public schedule reads that copy back. It is stale the moment one Match moves.

Only Workshop sessions store a real end. `pools`, `phases`, `swiss_rounds` and `bracket_slots`
store no time. The programme stores a length per bar (`event_programme_blocks.match_duration_minutes`)
and `generate` uses it to space Matches, but the number never reaches a Match: the grid, occupancy
and the referee board never read it.

The ruleset's fight clock (`timeLimitsSeconds`) is read by nothing in scheduling. Actual times
(`started_at`, `ended_at` and the two durations) are written by the match clock, online only, and
reach no window: they drive the per-Lice drift badge and the running-late controls, which move the
plan by an organiser's click.

ADR-016 makes an overlap between two commitments Impossible, with no override, and measures it on
these windows. An end that is wrong by a median refuses a referee who is free.

## Decision

**The Match owns its time window. The window is planned. Everything else with a time is a set of
Matches.**

### The window

- A Match with a scheduled time occupies `[scheduled_at, scheduled_at + planned length)`. The
  interval is half-open: a Match that ends at 10:30 and one that starts at 10:30 do not overlap.
- **The planned length is the Event's number for the Match's kind.** The organiser types four
  lengths on the planner's sheet, for pool, swiss, elimination and finals bouts, and every Match of
  that kind in the Event reads the one that applies, live. Change the sheet and every Match of that
  kind changes with it; Generate re-spaces the day. The one exception is a length typed on a Pool's
  window, which those Matches keep until the day is generated again. A Match's length never depends
  on the Match next to it, on the bar under it, or on the fight clock. The sheet, the override and
  what the bars stop carrying are [ADR-018](ADR-018-match-planned-length.md).
- **A sheet that cannot be read leaves no length at all.** The grid, the referee board and the
  placement checks then refuse. A person's schedule — the public pages and the `/me` lists — keeps
  showing ends and checking clashes with a FALLBACK: a Match ends at the next bout on its Lice
  that Event day, or at the day's next break or admin bar, whichever is earlier; with neither it
  has no end, and the page says how many commitments it cannot check (operator, 2026-09-18;
  `schedule/next-bout-end.ts`). A Pool, a duty, or a card folding several duties then ends only
  when every Match it covers has such an end. The fallback is never a length, and no reader but a
  person's schedule uses it.
- The gap between Matches belongs to nobody. "Too close" is rest, not overlap. Rest is measured in
  minutes between windows and is decided separately (W7).
- A Match with no scheduled time has no window.

### The plan is the window

- Before, during and after a Match runs, its window is the planned one. It changes only when
  someone moves the Match or edits its length. The running-late controls, the per-Lice "+N" and
  the whole-day delay, are the doors: they move `scheduled_at`. Nothing moves a plan by itself.
- Actual times are a record on the Match, written by the match clock only. The readers of the
  record are the drift badge, the live board's timing, statistics and the AI "which Lices are
  late" tool. A Pool's actual span is derived on read where a reader wants it. The record is never
  a window: the referee checker, Lice occupancy, the grid and the public schedule do not read it.
- The fight clock plays no part. A planner that suggests a default length from it is a planner
  feature, not a window rule.

### A Pool is where its Matches are

- A Pool has no time of its own. Its window is the **hull** of its timed Matches: earliest start to
  latest end. The same holds for a Swiss round on one Lice. A Match assigned on its own is its own
  window.
- One hull per Pool, whatever the spread. A Pool with one Match postponed to 14:00 spans until
  14:05, and its referee is committed for the whole span, because a referee on a Pool is on the
  Lice between its Matches too. The remedy for the straggler is a per-Match assignment for it.
  Splitting a Pool's window by Lice or by day is a crew-grain question (W5), not a window question.
- A partly placed Pool is the hull of its placed Matches. Unplaced Matches contribute nothing, and
  the board says how many are missing. When they land the hull grows, and ADR-016's later-changes
  rule shows the result.
- **A Lice is occupied by Matches, not by hulls.** Two Pools may alternate their Matches on one
  Lice. A postponed Match may land anywhere free, including later on its own Lice. The refusal
  fires only when two Matches overlap. People are judged on hulls; Lices are judged on Matches.

### One function, every reader

- One pure function computes a Match's window and the hull of a set of Matches. It lives in
  `@myclash/schedule-core`, which depends only on `@myclash/time` and is already imported by the
  admin and public apps; the API adds the dependency. The referee checker of ADR-016 receives
  commitments already windowed and computes nothing about time.
- Every reader that computes an end, an overlap, an occupancy or a drift calls it: the referee
  board's Pools and picker, the checker's commitments, the auto-assign engine's start and end, the
  grid's cards and Pool bars, Lice occupancy, the staff live board's planned length, the public
  "my schedule" and its conflicts, the public event page's Tournament end, the drift badge, and
  `generate`.
- Presentation may differ from the window; nothing else may. A card keeps a minimum height on the
  grid. The Detailed view's per-Lice bands label adjacent cards and claim no end.
- The frozen copy goes: `referee_assignments.starts_at` and `ends_at` are dropped, and the public
  schedule computes the window like everyone else.

### What goes

- `runEndIso` and the median gap, and the second copy of it in `schedule-blocks.ts`;
- the constant `durationMinutes: 5` on grid cards, and every other private five:
  `DEFAULT_MATCH_DURATION_MINUTES` used as a length, `ASSUMED_MATCH_MINUTES`, `DEFAULT_DURATION_MS`,
  the `?? 5` in `match-scheduler.ts`, the `?? 5` in `programme.service.ts`, the `5` handed to the
  assigner in `assignment-board.service.ts`, the `5` in `live-board-timing.ts`'s fallback;
- the proximity test on the public "my schedule" page;
- the Tournament end that adds no length;
- the columns `referee_assignments.starts_at` and `ends_at`;
- the unimplemented "±15 min buffer" promise in `docs/ARCHITECTURE.md`.

`SLOT_MINUTES` stays. It is grid geometry, not a length: the schedule board draws a Match in
5-minute rows, and moves it by its exact start and its planned length.

## Consequences

- **Easy:** the referee board, the grid, occupancy and the public app agree, because they cannot
  disagree. A Pool's end moves only when one of its Matches moves.
- **Easy:** ADR-016's Impossible verdicts are measured on a window the organiser set. They are fixed
  by editing a Match, not by arguing with a median.
- **Easy:** W3 has a rule: one sheet per Event, read live, one override per Pool. W7 has edges to
  measure between: hull to hull, in minutes.
- **Hard:** a Pool with a straggler blocks its referee across the hole, on purpose. The board must
  show the hull so the organiser sees why, and the per-Match assignment must be reachable from
  there.
- **Hard:** two Pools alternating on one Lice have overlapping hulls. That is fine for the Lice, and
  a conflict only if the same person is in both, which is the checker's job.
- **Hard:** until ADR-018 is built, every length is today's five minutes. The shape is right before
  the number is.
- **Hard:** because the sheet is read live, changing a length on it resizes every placed bout of
  that kind at once while their starts stay put. A laid-out day shows overlaps until Generate is
  pressed for it. The operator chose this for simplicity, knowing it.
- **Committed to:** no reader mints a length; no plan moves without a click; the checker never reads
  a clock.

## Alternatives considered

- **Keep the median gap and document it.** Rejected: a middle Match leaving moves the end, and the
  grid never used it anyway.
- **Reality replaces the plan once a Match starts.** Rejected: Impossible verdicts would change with
  nobody at the board; clock actions are online-only, so the record has holes; and the running-late
  controls already move the plan by a click.
- **Plan until the Match ends, then its actual times replace the window.** Rejected: it re-judges
  assignments on Matches that are over, and shows two ends side by side.
- **A Pool owns a planned window and its Matches sit inside it.** Rejected: Matches are what gets
  dragged, and a Pool time would disagree with them within an hour of a real event.
- **A Pool's window is the set of its Matches' windows, not the hull.** Rejected: a referee on a Pool
  is on the Lice between its Matches; pieces would let the checker book them into that gap.
- **The hull split per Lice and per day.** Deferred to W5: it changes what an assignment is scoped
  to, not what a window is.
- **A Lice occupied by hulls.** Rejected: a postponed Match could not land later on its own Lice,
  and a Pool could not be split once anything else was scheduled.
- **The bar owns the length, looked up at read time.** Rejected: a Match dragged into the lunch gap
  would shrink to five minutes.
- **The phase owns the length.** Rejected: no per-Match difference, and a hand-placed Match of an
  unconfigured phase falls to a default with no owner.
- **Derive the length from the fight clock.** Rejected: 90 seconds of fighting is six to eight
  minutes on the Lice, and a ruleset without a time limit gives no number.
- **Include the gap in the window.** Rejected: back-to-back Pools on two Lices would be Impossible
  over fifteen seconds, with no override.
- **Freeze the window on the assignment for display.** Rejected: two answers by design, and the
  public page shows a time that is no longer true.
- **Put the function in `@myclash/types` or `@myclash/rulesets`.** Rejected: `types` must stay
  shapes and ships to the scoring pad; `rulesets` cannot reach the public app.
- **A copy of the length stored on each Match when it is placed.** The first version of this record
  chose it. Rejected by the operator on 2026-09-14 for simplicity: with the sheet as the only place
  a number is typed, a copy would exist only to disagree with it. The price, a laid-out day that
  shows overlaps after a sheet change until Generate runs, was accepted.
