# ADR-020 — A crew belongs to a Pool or a Match; a hand-placed bout is pinned; repair is Generate

**Date:** 2026-09-14
**Status:** Accepted

## Context

- `referee_assignments` allows three scopes: a Pool, a Match, or a Lice
  (`packages/db/migrations/0091_sql_audit_tier2.sql:96-100`). **Nothing writes a Lice-scoped row**,
  but the compensation code pays on one as every completed bout on that piste, all day, with no
  time bound (`apps/api/src/modules/compensation/compensation.service.ts:333-362, :399-403`), while
  the referee statistics exclude the same rows. The first Lice row anyone wrote would change a
  referee's pay silently.
- The Pools page's "assign this Pool a referee" button writes **one Match-scoped row per Match**
  (`apps/api/src/modules/phases/phases.service.ts:2768-2797`, the `0194` function). Adding or
  removing a Pool member deletes and re-inserts the Pool's Matches, and every such row cascades away
  (`0179_referee_assignments_scope_cascade.sql`). Pool-scoped rows survive.
- A Swiss round on one Lice is stored as one Match-scoped row per bout; a bracket bout is its own
  unit. Nothing makes `(match_id, role)` or `(pool_id, role)` unique, so two saves at once can leave
  two referees on one role (`0194:26-28`).
- Staffing is configured per Tournament (or Event default), per kind — pool, swiss, bracket,
  **finals** — with up to six slots (`0060_staffing_slot_config.sql:19-28`, `0164`). A final that
  needs six officials when brackets use four is already expressible. One particular semi-final is
  not.
- A Match carries no mark of having been placed by hand. Generate re-lays every bout in a bar,
  hand-placed or already fought (`programme.service.ts:1903-1928` applies no status filter). Block
  moves and the day delay move every bout that has not started and nothing that has
  (`block-move-plan.ts:47-49`). The referee side already has the notion: a manual assignment is a
  prior that auto-assign never touches (`apps/api/src/modules/referees/prior-assignments.ts:24-46`).
- Nothing named repair exists. Generate is one greedy pass; a Pool can be re-fanned; a day can be
  delayed; the programme can be reset.

## Decision

### A crew belongs to a Pool or to a single Match

- The Lice scope goes: from the CHECK, from the row (`lice_id`), from the resolution chain, and from
  the compensation code. "This crew works Lice 3 all morning" is done by assigning the crew to each
  Pool on Lice 3; auto-assign may prefer staying on one piste, and that is ranking, not a rule.
- **A Pool's crew is one Pool-scoped row per role, everywhere.** The Pools page button writes a Pool
  row, not one row per Match, so a roster change keeps the crew.
- Match-scoped rows remain for one Match's exception to its Pool's crew, and for Swiss and bracket
  bouts, whose units have no row of their own. Per-Match rows on a Pool's Matches are exceptions by
  definition; a roster change that deletes those Matches deletes them, and the board says so.
- One person per role per target: unique indexes on `(pool_id, role)` and `(match_id, role)`. The
  concurrent-save gap of `0194` closes with them.
- **The piste is derived, never stored.** A referee must know where to go, and no crew row carries
  a Lice any more. A duty's piste is the piste of its Matches, read live: for a Match-scoped duty
  the Match's `lice_id`; for a Pool-scoped duty the distinct Lices of the Pool's timed Matches, in
  order of first start. A Pool that runs on two pistes, or whose straggler was moved, names both,
  each with its times. Every surface that tells a referee where to be reads it the same way: the
  referee board's unit card, the picker, the roster's assignment summary, the referee's own
  schedule, and the assignment notification. The board's current pick, the first Match that happens
  to have a piste in an unordered read (`assignment-board.service.ts:1393`), goes.
- Staffing stays per Tournament per kind. There is no per-Match slot list. The design spec's
  "out of scope" ruling on per-Match staffing stands.

### A hand-placed bout is pinned

- A Match gains a **pinned** mark. Every hand gesture that places it sets the mark: a card drop, a
  group drop, the Pool's small window, the AI assistant applying the organiser's draft. Dragging the
  Match to the unplaced tray clears it; resetting the programme clears all of them. Generate never
  sets it.
- Generate and any repair treat pinned bouts, and bouts that have started or finished, as fixed
  occupants: they lay the other bouts around them and never move them.
- Block moves and the day delay still move pinned bouts that have not started. There the organiser
  is moving the whole day on purpose, and a pinned bout that stayed behind would be the surprise.
- On the referee board the same word means what it already means: a manual assignment is a prior
  and auto-assign works around it.

### Repair is Generate

- There is no separate repair command. Repair after hand edits is Generate for that day, with pinned
  and started bouts fixed, plus the per-Pool re-fan that exists. A bout that has been fought keeps
  the time it was fought at; Generate stops rewriting history.

## Consequences

- **Easy:** the loaded gun is gone: no scope exists that pays for a piste-day. The pay code has one
  fewer branch, and that branch could never fire.
- **Easy:** a Pool's crew survives a roster change, because it is one row on the Pool.
- **Easy:** the piste a referee is told follows the Matches. Move a Pool to another piste and every
  surface says the new one, with nothing to update.
- **Easy:** "pinned" has one meaning on both boards: made by hand, so automation leaves it alone.
- **Hard:** a Pool whose bouts were all placed by hand is a Pool Generate can never tidy. Unpin by
  dragging to the tray, or reset the day.
- **Hard:** the unique indexes refuse a second referee on a role; the doors that used to insert
  blindly must replace instead.
- **Committed to:** no third grain; no per-Match slot count; no second scheduling algorithm.

## Alternatives considered

- **A real piste session as a third grain, with a stored time window.** Rejected: a stored window is
  the frozen copy ADR-017 removed, and the window would only exist to be wrong.
- **Leave the schema and stop paying on Lice rows.** Rejected: dead columns kept, and a writer could
  still appear.
- **Per-Match staffing overrides.** Rejected: the case the ticket was written for, six officials for
  a final, already works through the finals kind; the remaining case is rare and has a manual way.
- **No pin; Generate moves everything.** Rejected: every hand placement would be redone after every
  Generate.
- **A pin that block moves respect too.** Rejected: a whole-day delay that left one bout behind
  would be the surprise, not the fix.
- **A separate "tidy up" command with local moves.** Rejected: a second algorithm to write and
  explain when the pin makes Generate the repair.
