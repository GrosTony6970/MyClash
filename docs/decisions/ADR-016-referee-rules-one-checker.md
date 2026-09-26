# ADR-016 — Referee assignment rules have one checker and two levels: Impossible and Discouraged

**Date:** 2026-09-13
**Status:** Accepted

## Context

Whether a person may referee a Pool or Match is decided in several places, and they disagree.

- The auto-assign engine (`packages/rulesets/src/scheduling/referee-assigner.ts`) filters
  candidates and records one reason per empty slot, in its own words.
- The referee board (`apps/api/src/modules/referees/assignment-board.service.ts`) decides again
  for the picker, again for manual assign, again for the conflict banner, and a fourth time for
  its empty-slot warnings.
- The schedule board checks in the browser
  (`apps/web-admin/app/org/[slug]/events/[eventId]/schedule/referee-conflict-rows.ts`) with a
  second detector, `packages/rulesets/src/scheduling/conflict-check.ts`, and reads no settings.
- The reason codes exist in four independent lists, and `CandidatePicker.tsx` renders a fifth code
  that no server emits.

The detectors are already shared (`packages/types/src/referee-conflicts.ts`). What each site
decides again is the **policy**: which setting gates a rule, and whether the answer blocks, warns or
greys out.

The copies have already drifted. A referee booked in another hall at an overlapping time is greyed
out in the picker but accepted by manual assign.

Three more findings made this more than a tidy-up:

- **Hard rule 8 could be switched off.** `enforce_fighter_referee_no_overlap` is pinned to true by a
  CHECK in `packages/db/migrations/0001_init.sql`, but no evaluation site reads it. The behaviour it
  names is gated by the switches that `packages/db/migrations/0097_referee_rule_toggles.sql` added,
  and the settings endpoint accepts them
  (`apps/api/src/modules/referees/settings.controller.ts`). An organiser could untick "cannot
  referee while fighting at the same time".
- **Most doors check nothing.**
  - Manual assign and auto-assign run the rules.
  - The per-Match crew (`apps/api/src/modules/matches/matches.service.ts`), the per-Pool crew
    (`apps/api/src/modules/phases/phases.service.ts`) and the AI assistant
    (`apps/api/src/modules/organizer-ai-assistant/organizer-ai-assistant.service.ts`) run few rules
    or none.
  - The RLS write policy in `packages/db/migrations/0002_rls.sql` lets an organiser admin write
    rows directly through PostgREST.
  - The legacy `matches.referee_id` (`packages/db/migrations/0039_matches_referee_id.sql`) is still
    accepted by the API, and no check sees it.
- **Teaching a Workshop is a commitment that nothing sees.** An instructor is the same global person
  a referee is, and Workshop sessions have real times. But the engine's Workshop input is always
  empty.

ADR-015 says the six rules "are enforced identically across the four kinds". That holds for the kind
of unit. It does not hold across sites. Capacity is also not a rule about one person at all (see
below).

## Decision

**One checker answers "may this person referee this Pool or Match?", and every door asks it.**

It lives in `packages/rulesets/src/scheduling/`, next to the engine. It is pure. It receives:

- the person;
- the target;
- every commitment in the Event;
- the Event's switches, already resolved.

It does no I/O, so the API and the admin schedule board call the same code. `packages/types` keeps
only the shared shapes, so the scoring pad does not carry the logic.

Ranking candidates by rating and workload stays inside the engine. That is a different job, and it
has one caller. Rest is not ranking: it is a Discouraged rule of the checker (ADR-019).

The checker returns one of three levels, with every reason that applies.

**Impossible** — no switch and no override:

- refereeing one's own Match;
- refereeing while fighting at an overlapping time;
- refereeing another Pool or Match at an overlapping time, in any hall;
- refereeing while teaching a Workshop at an overlapping time;
- refereeing outside one's declared availability.

A Pool, Match or Workshop session with no time cannot overlap anything until it gets a time.

**Discouraged** — each rule has one on/off switch per Event. When a rule is on, the organiser can go
ahead after confirming:

- refereeing one's own Pool at a different time;
- holding two roles in one Pool;
- refereeing while attending a Workshop at an overlapping time.

- refereeing anywhere while a Pool one fights in is running, outside one's own bouts — the
  whole-Pool span (operator, 2026-09-18, ruling 5; its own switch, ruling 21). A fighter is busy
  for their Pool's hull everywhere, refereeing included. Their own bouts overlapping stay
  Impossible.
- refereeing without rest: another duty of that day within `referee_rest_min_slots` day slots
  (ADR-019; its switch is `enforce_referee_no_back_to_back`);
- refereeing past the day's bout cap, `max_bouts_per_day` (ADR-019; 0 = no cap).

**Fine** — no rule applies.

The level is the worst reason's, and every reason that applies is returned. **Reason codes have
one list**, in the checker (`REFEREE_REASON_CODES`), and every screen's words come from it by
code. A Swiss round is a group like a Pool for the two Pool rules. A bout of one's own group —
Pool or round — on another piste at the same time is still two places at once (Impossible).

"Not enough referees at this time" is not a verdict on a person. It stays a warning about the whole
slate, with its own switch, and it never blocks.

### The contract at the doors

- **The picker and the Assign button give the same answer**, because they make the same call.
- **Every door that creates an assignment asks the checker.** That covers manual assign,
  auto-assign, the per-Match crew, the per-Pool crew and AI assistant apply.
  - An Impossible assignment is refused.
  - A Discouraged assignment returns 409 with the reasons, unless the request confirms. This follows
    `apps/api/src/modules/swiss/swiss-override.service.ts`.
  - The overridden reasons are stored on the assignment, in `conflicts_jsonb`. No audit row is
    written. They are stored as a code and the data name it was against (a Pool name, a round
    code, a Workshop title), never an id and never a sentence. A reason stored there shows
    grey, "confirmed", and is no longer a warning; a new reason shows amber again (ruling 135).
    The column is not public (migration 0205): "attends a Workshop" names a private enrolment.
  - An Impossible refusal and a Discouraged one both answer 409, with `level` and the reasons
    in the body (ruling 22). A missing skill is not a scheduling rule and stays a 400.
- **Locked** = any confirmed Pool or bout assignment in the Event; every door that writes an assignment
  answers 409 while it is locked (ADR-019). The lock itself refuses while a duty is
  Impossible, unless the organiser sends anyway over exactly the duties it listed (ruling 138). Deleting a bout or a Pool is not a referee
  door: its crew goes with it, locked or not (ruling 137).
- **Auto-assign never picks a Discouraged candidate.** An empty slot lists every reason, in the
  picker's words. It asks the checker for every candidate, with its own proposals counted as
  duties, over the commitments the run keeps (never the auto rows it replaces); Apply re-judges
  every proposal before it deletes anything, and a refused one is an engine bug and a 5xx (W1.3).
  It never proposes someone for a Pool or Swiss round they fight in, even with the own-Pool rule
  switched off: the switch lets the organiser do that by hand (operator, 2026-09-26, ruling 140).
- **The schedule board's instant check calls the same checker.** The second detector retires, and
  `apps/api/src/modules/phases/conflict-check.controller.ts` answers from the checker.
- **Changes that are not assignments are allowed.** Moving a Match or Pool, programme generate,
  editing availability and editing a Workshop all go through.
  - A rule they break shows on the board as Impossible (red) or Discouraged (amber).
  - Confirming the referee board while anything is Impossible asks "send anyway?".

### What goes

- the switches for the Impossible rules, and the `enforce_fighter_referee_no_overlap` column;
- per-Tournament referee switches. Referee switches are per Event, and pool-generation settings are
  not touched.
- direct PostgREST writes to `referee_assignments`;
- `matches.referee_id`;
- the silent drop of a fighter from their own crew inside `persistAssignments`. The checker's
  refusal replaces it.

Scorekeeper logins are not linked to a person, so the checker cannot see a scorekeeper who also
referees. That is a known gap with its own ticket, and it is not part of this decision.

## Consequences

- **Easy:** a new rule is written once. Minute-based rest, workload caps and availability time
  windows each choose a level and land in one place instead of five.
- **Easy:** the organiser sees the same answer on every screen, and the board says why.
- **Hard:** Impossible has no escape hatch. On a short evening with no free referee, the organiser
  must change the availability or the schedule. They cannot click through. This was chosen on
  purpose for availability.
- **Hard:** a schedule move can leave the board in an impossible state. It stays visible, and
  Confirm asks before sending, but nothing prevents it.
- **Hard:** overlap is measured on the Pool windows the board derives today, which are estimates.
  An estimate that runs long can mark a workable assignment Impossible. Who owns a bout's time window
  is a separate decision, recorded in [ADR-017](ADR-017-match-owns-its-time-window.md).
- **Committed to:** no door writes a referee assignment without the checker, and no Impossible rule
  has a switch. Hard rule 8 in `CLAUDE.md` says so.
- **Committed to:** until the build lands, the code still has the old switches and doors. This ADR
  records the target, not the current state.

## Alternatives considered

- **Share the detectors only, and leave the policy at each site.** Rejected: the detectors were
  already shared, and the policy is what drifted.
- **Two levels, everything overridable.** Rejected: hard rule 8 would then be enforced nowhere.
- **Two levels, blocked or warning, with no override.** Rejected for the soft rules: a small club
  referees its poolmates every weekend.
- **Keep an overlap in another hall as a softer case.** Rejected: two halls at the same time is still
  two places at once.
- **The picker as advice, the Assign button as enforcement.** Rejected: that is today's cross-venue
  bug in general form.
- **The checker resolves Event and Tournament settings itself.** Rejected: it would become
  server-only, and the schedule board would keep its own copy.
- **One owner for eligibility and ranking.** Rejected: ranking has one caller, so exporting it would
  build an abstraction for a single caller.
- **Auto-assign picks a Discouraged candidate as a last resort.** Rejected: it would overrule a
  switch the organiser turned on.
- **Refuse schedule moves that break a rule.** Rejected: moving a whole day would bounce on one
  referee, and every scheduling path would have to call the referee checker.
- **Keep the checker in `packages/types`.** Rejected: that package ships whole to every app,
  including the scoring pad, and it would grow with every new rule.
- **Call the levels "Blocked" and "Warning".** Rejected: the picker's "blocked" list already means
  greyed out, and "warning" already names the slate notice and the engine's scoring notes. "Locked"
  is also taken: it is the board's freeze button.
