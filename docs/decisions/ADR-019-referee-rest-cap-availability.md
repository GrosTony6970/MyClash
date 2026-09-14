# ADR-019 — Referee rest counts the day's slots, a cap counts bouts, availability has a window

**Date:** 2026-09-14
**Status:** Accepted

## Context

ADR-016 put every referee rule behind one checker with two levels, Impossible and Discouraged, and
left four rules to choose a level and a unit. The code they replace:

- **Rest** is measured in positions of a list. The engine takes the index of a Pool in the array it
  was handed and flags a candidate whose previous duty sits within `refereeRestMinSlots` positions
  of it (`packages/rulesets/src/scheduling/referee-assigner.ts:707-728`). That array is real Pools
  by sort order, then every Swiss unit, then every bracket Match
  (`apps/api/src/modules/referees/assignment-board.service.ts:1005`), never by time: adjacent
  positions can be days apart or simultaneous. It is a score penalty of 20, not a filter, so the
  best-scoring candidate is still assigned back-to-back. The setting `referee_rest_min_slots`
  (default 1) is validated as 0 to 5 on one route and 0 to 10 on another
  (`settings.controller.ts:34`, `phases.dto.ts:29`) and has no screen: it can only be set through the
  raw API.
- **`enforceDedicatedRefereeRest`** is stored, sent to the engine and read by nothing
  (`referee-assigner.ts:157` is the only occurrence in the engine). The database default is true, the
  service default is false. The two documents that describe it contradict each other: the design
  spec says rest between a person's own fight and their duty; `docs/ARCHITECTURE.md:1374` says the
  same rest applied to people who do not fight.
- **Workload** has no ceiling anywhere. The engine adds five points per duty already given in the
  same run. The board's candidate `workload` is a hard-coded zero rendered nowhere
  (`assignment-board.service.ts:1544`). The roster page shows a real count of bouts per referee from
  `countAssignmentsByReferee` (`qualifications.service.ts:936`). Three unrelated "workload" numbers
  exist.
- **Availability** is per Tournament and per whole day (`0077_referee_granular_availability.sql`),
  entered by the organiser, and a hard filter in the engine. Nothing finer than a day exists. The
  board attaches a referee's allow-lists only when rows exist, without the "all tournaments" and
  "all days" coalescing the roster applies, so a referee marked available for everything is
  filtered out of a Tournament added later.
- **The board's lock** is not a column. "Locked" means some assignment has status `confirmed`
  (`assignment-board.service.ts:1037`). Only the bulk paths check it; a single manual write deletes
  a confirmed row and inserts the new one (`:2195-2225`, `matches.service.ts:637-643`, the `0194`
  function).

## Decision

### Rest: Discouraged, counted in the day's slots

- **A slot is a distinct start time of the day's Pools and rounds**, on the Event's clock, in time
  order. Saturday's units start at 10:00, 14:00 and 16:00: three slots. Two Pools that start at the
  same minute are one slot.
- A duty is **Discouraged** when the person has another duty whose slot is within
  `referee_rest_min_slots` slots of it. With the default of 1, the 10:00 referee is Discouraged at
  14:00 and Fine at 16:00, and two hours of lunch in between change nothing. That is the operator's
  reading of rest: skip the next slot, not "N minutes".
- Rest is between two duties only. A person's own fight and a duty are not subject to rest; their
  overlap is already Impossible.
- Slots are counted within one event day, never across a night. A duty belongs to the day its first
  bout starts on. A duty with no times yet sits in no slot and counts toward no cap until it gets
  times, as ADR-016 says of overlap.
- The switch is the existing `enforceRefereeNoBackToBack`; the number is the existing
  `referee_rest_min_slots`, validated as 0 to 5 everywhere, 0 meaning off. The number gets a field on
  the referee settings screen. The engine skips Discouraged candidates, as ADR-016 says, and the
  20-point penalty goes.

### The dead switch goes

- `enforce_dedicated_referee_rest`: the column, the setting, the DTO fields and the engine field are
  deleted. Neither of its two documented meanings is a rule the operator kept.

### A cap in bouts per day: Discouraged

- The Event sets a **maximum number of bouts per person per event day**; 0 means no cap. A duty that
  would take the person past it is Discouraged, with the count in the reason. Auto-assign never
  exceeds it. Ranking keeps preferring the less loaded candidate.
- The count has one owner: the bouts under the person's duties that day, computed by the function
  the roster page already uses. The board's load column shows that number. The hard-coded zero goes.

### Availability: a from–to window per day, Impossible outside it

- A referee's availability for a day may carry a **from–to time** on the Event's clock; the default
  is the whole day, so nobody who never touches it sees a change.
- A duty is **Impossible** unless its whole window (the hull of ADR-017) lies inside one of the
  person's windows for that day. "Available until 16:00" refuses a Pool that runs 15:30 to 16:30.
- The organiser enters it next to the day chips on the roster. There is no referee self-service, as
  today.
- The board's coalescing gap is closed: a referee marked available for all Tournaments or all days
  is available for a Tournament or a day added later.

### The lock holds at every door

- A `confirmed` assignment is never replaced or deleted without unlocking the board first. Every
  door that writes an assignment answers "locked" with a 409, the same way every door asks the
  checker.
- **Confirm is the only sender of notifications.** After the board is confirmed, a Pool's time or
  piste may still move (ADR-016 allows later changes and shows them red or amber). Nothing is sent
  for that by itself; the change accumulates and the board shows the duty as changed since the last
  confirmation. Pressing Confirm again sends one message per duty whose start, piste, person or
  role changed since the previous confirmation, and nothing to the others. The operator chose this
  over re-notifying on every material change: the organiser decides when the board is final again.

## Consequences

- **Easy:** three rules land in the one checker with a level each, and the rest rule stops depending
  on the order a query returned rows.
- **Easy:** one workload number, shown where assignments are made.
- **Hard:** rest in slots means a referee who works Lice 2 all morning, Pool after Pool, is
  Discouraged for every second Pool when the number is 1. An Event that runs referees that way sets
  the number to 0.
- **Hard:** a wrong availability window refuses a referee with no override. That was chosen for
  availability in ADR-016 and stands.
- **Hard:** the lock now stops the per-Match crew editor and the Pools page on a confirmed board.
  Unlock first.
- **Committed to:** no rule reads array positions; no cap in hours; no fight-to-duty rest.

## Alternatives considered

- **Rest in minutes between hulls.** Rejected by the operator: the day is thought of in slots, and a
  two-hour lunch does not make the next slot restful.
- **Rest as a programme bar, or as the next duty on the same piste.** Rejected: bars overlap across
  Tournaments and a Pool can be dragged out of its bar; the same-piste rule would call a change of
  hall restful.
- **Rest as an engine score only.** Rejected: the picker and Assign would say nothing.
- **Rest as Impossible.** Rejected: a one-slot shortfall would block a free referee with no way
  through.
- **Rest that exempts staying on the same piste.** Rejected: rest is about the person, not the walk;
  the number decides.
- **Rest between a fight and a duty.** Rejected by the operator: duties only.
- **Keep the dead switch as the rest switch.** Rejected: that switch already exists.
- **A cap in hours per day.** Rejected: nobody plans referees in hours, and a bout count is what the
  roster already shows.
- **No cap.** Rejected: nothing stops one referee taking twelve Pools.
- **Half-day availability.** Rejected: "from 11:00" would become "afternoon only".
- **Keep whole-day availability.** Rejected: "I must leave at 16:00" could not be said.
- **The lock stops auto-assign only.** Rejected: a confirmed referee was replaced silently by a
  single click.
- **Re-notify a referee on every material change to a confirmed duty.** Rejected by the operator:
  a board under repair would send a message per drag. Confirm, pressed again, sends the changes.
- **Never re-notify.** Rejected: a referee would learn of a moved duty only from their schedule page.
