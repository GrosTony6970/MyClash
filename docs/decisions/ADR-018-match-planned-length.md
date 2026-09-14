# ADR-018 — The Event's planner sheet is the one place a bout length is typed

**Date:** 2026-09-14
**Status:** Accepted
**Amended:** 2026-09-14, same day — the first version copied the length onto each Match when it was
placed and let bars carry their own. The operator asked for one place only. This version records
that: the sheet is read live, the bars carry no numbers, and a length typed on a Pool is the one
override.

## Context

ADR-017 decided that a Match's planned length is its own, never a guess from its neighbours, and
left open where the number lives and where a Match placed by hand finds it.

- The planner's four lengths (pool 5, swiss 5, elimination 8, finals 10) are a constant in the
  browser (`apps/web-admin/app/org/[slug]/events/[eventId]/schedule/programme.tsx`). They are sent
  with each Suggest and survive only as each bar's `event_programme_blocks.match_duration_minutes`,
  next to a per-bar gap and a per-bar rest. Nothing on `events`, `tournaments` or `phases` stores a
  bout length, and the planner forgets every setting when the page reloads.
- Thirteen paths write `matches.scheduled_at`. Hand placement is `PATCH /matches/:id/schedule`
  with a Lice and a time (`apps/api/src/modules/matches/matches.service.ts`). The AI assistant, the
  Pool reschedule and `createMatch` write the time on their own. `POST …/pools/:id/auto-distribute`
  takes a length in its body, has no Zod schema and no caller in the app.
- No screen edits a Match. The run popover has label, start, Lices and colour. Resizing a run
  respaces starts and writes no length. The grid already sends a `durationMinutes` per card, a
  constant five.
- The planner already classifies "finals" bouts in one place: a bracket Match whose round is the
  highest round present, which is the gold final and the bronze, or the double-elimination grand
  final and its reset (`apps/api/src/modules/programme/programme.service.ts`, `loadBracketMatches`).
  Suggest and Generate both use it.

## Decision

### The sheet is the one owner

- One row per Event in `event_programme_configs` (`event_id`, `config_json`, `updated_at`), next to
  the bars in `event_programme_blocks` and under the same row-level security. The Suggest schema
  validates it. The planner loads it when it opens and saves it on every field change. The
  defaults, 5/5/8/10 and the rest, live in that schema, which is the one owner of those numbers.
  The browser constant goes.
- Through the API, anyone signed in who can see the Event may read the sheet; only the organiser's
  team may write it. The sheet holds planning numbers and no personal data. What its own table buys
  is that it never rides along in a public event payload.
- **The sheet is read live.** A Match has no copy of its length. Change a number on the sheet and
  every Match of that kind in the Event has the new length at once. Their starts do not move, so a
  laid-out day shows overlaps until Generate is pressed for it. The operator chose this for
  simplicity, knowing it.

### The bars carry no numbers

- `event_programme_blocks` loses `match_duration_minutes`, `match_gap_seconds` and
  `min_rest_minutes`, and the planner loses its per-bar fields for them. A bar is a time span, its
  Lices, a name and a colour.
- Suggest sizes a bar and Generate spaces its Matches from the sheet, by the bar's kind (pool,
  swiss, bracket, finals). The per-phase numbers the planner already computes from the sheet stop
  being flattened into a per-bar copy.

### How a Match gets its length

- Every Match reads the sheet's number for its kind: the pool length for a pool Match; the swiss
  length, else the pool length, for a Swiss Match; the finals length for a bout the planner's
  classifier calls finals; the elimination length for every other bracket Match. That holds whether
  Generate placed the Match or a hand did.
- **The one override.** The run popover gains a "bout length" field. It writes
  `matches.planned_duration_override_minutes` on every Match of the run and respaces their starts
  from the run's start. A run of one Match is the per-Match case. A Match with an override reads it
  instead of the sheet, and keeps it when it is moved. Generate clears the override on every Match it
  re-places: the sheet wins when a day is generated again. Resizing a run keeps its meaning: it
  respaces starts and touches no length.
- Placing a Match writes no length. There is nothing for a forgetful writer to forget, so no
  constraint ties a length to a time. The override column is nullable and above zero when set.

### One function, every reader

- One pure function in `@myclash/schedule-core` computes a Match's window and the hull of a set of
  Matches from a start and a length. On the API, one helper resolves the lengths for a set of
  Matches — the sheet, each Match's kind, and any override — and hands them to that function. The
  referee checker of ADR-016 receives commitments already windowed and computes nothing about time.
- Every reader that computes an end, an overlap, an occupancy or a drift goes through that helper:
  the referee board's Pools and picker, the checker's commitments, the auto-assign engine's start and
  end, the grid's cards and Pool bars, Lice occupancy, the staff live board's per-Lice length, the
  public "my schedule" and its conflicts, the public event page's Tournament end, the drift badge,
  the notification worker, and Generate.
- Presentation may differ from the window; nothing else may. A card keeps a minimum height on the
  grid. The Detailed view's per-Lice bands label adjacent cards and claim no end.
- The frozen copy goes: `referee_assignments.starts_at` and `ends_at` are dropped, and the public
  schedule computes the window like everyone else.

### What goes

- The three number columns on `event_programme_blocks` and the planner's per-bar fields for them.
- The auto-distribute door (`POST …/pools/:id/auto-distribute` and
  `apps/api/src/modules/phases/pool-auto-distribute.ts`). It has no caller.
- The re-fan's `matchDurationMinutes ?? 5` and its DTO field. The re-fan reads the sheet.
- The planner's `DEFAULT_CONFIG` constant in the browser.
- With this build, everything ADR-017 listed under "what goes": `runEndIso`, the private fives, the
  proximity test, the Tournament end with no length, and `referee_assignments.starts_at` and
  `ends_at`.

## Consequences

- **Easy:** one place to type a number, one field to override it. The list of readers is the list
  of callers of one helper.
- **Easy:** the planner remembers its settings.
- **Hard:** a sheet change resizes placed bouts at once while starts stay put; Generate is the
  repair. The board shows the overlaps until then.
- **Hard:** every reader needs the sheet and the Match's kind, and finals need the bracket's final
  round. The API helper loads them once per request; no reader loads them on its own.
- **Hard:** `@myclash/api` gains a dependency on `@myclash/schedule-core`. The API image copies
  workspace packages by hand in several stages (`apps/api/Dockerfile`); the package must be added to
  every one, or the container builds and does not boot.
- **Hard:** saving the sheet on every change is one more writer on the schedule page. It is
  debounced, and it never writes on mount.
- **Hard:** a new table means a row-level security policy (mirroring the bars'), an entry in the
  archive-coverage registry, and the database review gates.
- **Committed to:** no number about a bout lives anywhere but the sheet and the override; no reader
  mints a length.

## Alternatives considered

- **A copy of the length on each Match, set when it is placed** (this record's first version).
  Rejected by the operator for simplicity: the copy would exist only to disagree with the sheet.
- **Bars keep their own length, gap and rest.** Rejected by the operator: a second place to type
  the same numbers.
- **No override at all.** Rejected by the operator: a length typed on one Pool stays the one
  exception.
- **`NOT NULL DEFAULT 5` on a per-Match column.** Rejected: the schema would mint the five
  ADR-017 forbids.
- **Seconds.** Rejected: everything else is minutes.
- **Four columns on `events`.** Rejected: the planner would still forget its other settings.
- **One JSON column on `events`.** Rejected after a check: the public events list selects every
  column of the event row (`apps/api/src/modules/events/events.service.ts`, `listEvents`), so the
  sheet would ride out in a public payload. Its own table keeps it out of those payloads.
- **The sheet readable only by the organiser's team.** Rejected by the operator: the bars are already
  public on the schedule, and the numbers are not secret. Anyone signed in who can see the Event may
  read it; writing stays with the team.
- **A length on `phases`, written by Generate.** Rejected: a phase that was never generated has
  none, so a second home is still needed.
- **Generate preserves a typed override.** Rejected: the sheet wins when a day is generated again.
- **Save the sheet on Suggest only.** Rejected by the operator: a field changed without pressing
  Suggest would be lost. The sheet saves as it changes.
- **Resizing a run sets lengths.** Rejected: one gesture, two effects.
- **A per-Match popover now.** Rejected: a run of one Match covers it.
- **Every hand-placed bracket Match gets the elimination length.** Rejected by the operator: the
  planner already knows which bouts are finals, so they get the finals length without typing.
- **Keep and wire the auto-distribute door.** Rejected: no caller.
- **A restore transform for event files saved before this change.** Not needed: nothing is in
  production, and with no constraint on a per-Match length there is nothing to repair.
