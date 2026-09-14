# ADR-018 — A Match's planned length lives on the Match, and the Event keeps the planner's sheet

**Date:** 2026-09-14
**Status:** Accepted

## Context

ADR-017 decided that a Match owns its planned length, set when the Match is placed, and left two
things open: the column, and where a Match placed by hand finds its number.

- The planner's four lengths (pool 5, swiss 5, elimination 8, finals 10) are a constant in the
  browser (`apps/web-admin/app/org/[slug]/events/[eventId]/schedule/programme.tsx`). They are sent
  with each Suggest and survive only as each bar's `event_programme_blocks.match_duration_minutes`.
  Nothing on `events`, `tournaments` or `phases` stores a bout length, and the planner forgets every
  setting when the page reloads. So "the phase's default" of ADR-017 had no home.
- Thirteen paths write `matches.scheduled_at`. Hand placement is `PATCH /matches/:id/schedule`
  with a Lice and a time (`apps/api/src/modules/matches/matches.service.ts`). The AI assistant, the
  Pool reschedule and `createMatch` write the time on their own. `POST …/pools/:id/auto-distribute`
  takes a length in its body, has no Zod schema and no caller in the app. Adding or removing a Pool
  member deletes and re-inserts the Pool's Matches.
- No screen edits a Match. The run popover has label, start, Lices and colour. Resizing a run
  respaces starts and writes no length. The grid already sends a `durationMinutes` per card, a
  constant five.
- The planner already classifies "finals" bouts in one place: a bracket Match whose round is the
  highest round present, which is the gold final and the bronze, or the double-elimination grand
  final and its reset (`apps/api/src/modules/programme/programme.service.ts`, `loadBracketMatches`).
  Suggest and Generate both use it.

## Decision

### The column

- `matches.planned_duration_minutes INTEGER`, nullable, with two named constraints: the value is
  above zero, and a Match that has a `scheduled_at` must have one. A Match in the tray may keep its
  number, so dragging it off the board and back keeps its 8 minutes. A writer that places a Match
  without a length fails at the database, loudly. No reader and no default mints a five.
- Minutes, because every control in the planner speaks minutes.

### The Event keeps the planner's sheet

- One row per Event in `event_programme_configs` (`event_id`, `config_json`, `updated_at`), next to
  the bars in `event_programme_blocks` and under the same row-level security. The Suggest schema
  validates it. The planner loads it when it opens and saves it on every field change. The
  defaults, 5/5/8/10 and the rest, live in that schema, which is the one owner of those numbers.
  The browser constant goes.
- Bars keep their per-bar length. It is seeded from the sheet at Suggest and editable per bar, as
  today.

### How a Match gets its number

- **Generate** writes the bar's length on every Match it places. A length typed by hand is
  overwritten when the day is generated again. The bar wins, as it already does for starts and
  Lices.
- **Every other door that gives an unplaced Match a time** goes through one placement function:
  hand placement, the AI assistant, the Pool reschedule, `createMatch` with a time, and the re-fan.
  The function keeps the Match's own length when it has one. Otherwise it reads the Event's sheet:
  the pool length for a pool Match; the swiss length, else the pool length, for a Swiss Match; the
  finals length for a bout the planner's classifier calls finals; the elimination length for every
  other bracket Match. The bar under the drop is not consulted.
- Moves of a Match that already has a time (drag, block move, day delay, per-Lice shift) carry the
  length and write no new one.
- A Pool whose members change is re-generated without times. Its Matches get a length again when
  they are placed.

### Editing

- The run popover gains one field, "bout length". It applies to every Match in the run and
  respaces their starts from the run's start. A run of one Match is the per-Match case. Resizing a
  run keeps its meaning: it respaces starts and leaves lengths alone.

### What goes

- The auto-distribute door (`POST …/pools/:id/auto-distribute` and
  `apps/api/src/modules/phases/pool-auto-distribute.ts`). It has no caller.
- The re-fan's `matchDurationMinutes ?? 5` and its DTO field. The re-fan reads each Match's length.
- The planner's `DEFAULT_CONFIG` constant in the browser.
- With this build, everything ADR-017 listed under "what goes": `runEndIso`, the private fives, the
  proximity test, the Tournament end with no length, and `referee_assignments.starts_at` and
  `ends_at`. The one window function in `@myclash/schedule-core` reads `planned_duration_minutes`.

## Consequences

- **Easy:** a forgotten writer is a database error, not a silent five. The list of doors is the list
  of callers of one function.
- **Easy:** the planner remembers its settings.
- **Hard:** `@myclash/api` gains a dependency on `@myclash/schedule-core`. The API image copies
  workspace packages by hand in three stages (`apps/api/Dockerfile`); the package must be added to
  all three, or the container builds and does not boot.
- **Hard:** saving the sheet on every change is one more writer on the schedule page. It is
  debounced and tracked like the other board writes, and it never writes on mount.
- **Hard:** a new table means a row-level security policy (mirroring the bars'), an entry in the
  archive-coverage registry, and the database review gates. That is the price of keeping the sheet
  out of the public event payloads.
- **Committed to:** no door places a Match without its length, and no code holds a bout length
  except the schema defaults of the sheet.

## Alternatives considered

- **`NOT NULL DEFAULT 5`.** Rejected: the schema would mint the five ADR-017 forbids.
- **Seconds.** Rejected: everything else is minutes.
- **Four columns on `events`.** Rejected: the planner would still forget its other settings.
- **One JSON column on `events`.** Rejected after a check: the public events list selects every
  column of the event row (`apps/api/src/modules/events/events.service.ts`, `listEvents`), so the
  sheet would ride out in a public payload. Its own table under the bars' policy keeps it private.
- **A length on `phases`, written by Generate.** Rejected: a phase that was never generated has
  none, so a second home is still needed.
- **The bar under the drop, else five.** Rejected: that is today, with a five nobody chose.
- **Generate preserves a hand-typed length.** Rejected: Generate would have to remember which numbers
  were typed, and the bar would disagree with its Matches.
- **Save the sheet on Suggest only.** Rejected by the operator: a field changed without pressing
  Suggest would be lost. The sheet saves as it changes.
- **Resizing a run sets lengths.** Rejected: one gesture, two effects.
- **A per-Match popover now.** Rejected: a run of one Match covers it.
- **Every hand-placed bracket Match gets the elimination length.** Rejected by the operator: the
  planner already knows which bouts are finals, so they get the finals length without typing.
- **Keep and wire the auto-distribute door.** Rejected: no caller.
