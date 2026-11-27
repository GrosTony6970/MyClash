# ADR-022 — A Team is a second kind of side, not a Registration

**Date:** 2026-11-13
**Status:** Accepted

## Context

MyClash is adding team Tournaments. A Match in one has two Teams on it, not two Registrations. A
Team has a size and numbered slots. A slot holds a Person of the Event, or nobody. A relay Match
swaps Fighters during the bout.

Until now a Match has had two sides, and a side has always been a Registration. Scoring, scheduling,
standings, bracket advance and forfeits all compare those two ids. The question is where a Team
goes in that model.

Two approaches were weighed (the design lists them as A and B, with C rejected early):

- **A. A Team holds a Registration.** Registration becomes "one person or one team". Almost nothing
  that calculates changes, because the side id is never empty.
- **B. Teams decoupled.** Registration keeps its meaning. A side is a Registration or a Team.

Approach A is the cheaper build. The operator declined it twice, for the same reasons both times:

- A Registration with no Person is a state the app has never seen. About 69 API files read a name
  through a Registration, some of them Event-wide.
- The tests around those reads are weak: the doubles do not check what is read. A Registration with
  no Person would reach screens and exports with no test that notices.

## Decision

**A side of a Match is a Registration or a Team (decision 6 of the design).** Registration keeps its
meaning: one Person entered in one Tournament. A Team is its own table, `teams`, with its numbered
slots in `team_slots`. A Tournament is `individual` or `team` (`tournaments.entrant_kind`), and a
database trigger holds the kind: no Registration in a team Tournament, no Team in an individual one,
no change of kind once an entrant exists, nor once a phase exists (ruling 989, migration 0288).
The phase trigger, under the same lock, refuses a double elimination or Swiss phase on a team
Tournament, and only those, so a race with a switch to team cannot leave one there
(`phase_fits_entrant_kind`, rulings 996 and 1007, migration 0289).

**Each Registration link gains a team twin**, with a check "a Registration or a Team, never both":
the Pool seat, both bracket slots, both sides and the winner of a Match, a card, the forfeiting
side and the winning side of a forfeit, and a protest. That is ten links. Links that were `NOT NULL` become nullable under that check. The new foreign keys follow the
deferred-delete rule of migration 0237.

**Every Match gets one side key, and every comparison of sides uses it.** The side key is the
Registration id or the Team id. It is never `''`: it is null while a side is not known, and a bout
with a side not known is refused Start, hits, cards and colour swap (`docs/ARCHITECTURE.md`, "A
bout waiting for a Fighter"). It lives in `packages/types`, because the API and
the scorekeeper screen both need it. The engine never calls it: the engine receives ids already
resolved.

**The engine's side fields are renamed, not reused (call 23 of the design).** `redRegistrationId`,
`blueRegistrationId` and `winnerRegistrationId` in `packages/rules` and `packages/rulesets` become
`redSideId`, `blueSideId` and `winnerSideId`. A field named "registration" that holds a Team id
would be a lie the next reader trusts. The rename boundary is:

- It follows the engine's **answers** up to the line that writes them to the database, not only its
  inputs. After the rename each of those lines fails to compile until someone visits it.
- The database columns keep their names, because they really do hold Registrations.
- The fields that key an **entrant** (a standings row, a Pool seat, a bracket seed) are not renamed
  in slice 1a. Each is renamed in the slice that first sends a Team through it. Swiss is left alone.
  The shared standings field name (`entrantId`) follows into Swiss by name only, because a Swiss
  row extends the standings row. Swiss still has no team path.
- One person's history (`packages/rules/src/results/fighter-career.ts`) keeps its own names.

**A missed reader is not safe. The gate is the guard.** Under approach B, a place that compares
Registration ids and was never taught about Teams does not fail. With both ids empty, a team card
scores for both teams, and the schedule run treats every team Match as one Fighter. So the guard is
not the empty state. It is a ledger test: a gate (`quality:side-readers`) that lists every reader of
a side id and refuses a new one that no one has decided on.

## Consequences

- **Easy:** Registration, and the 69 files that read a name through it, keep their meaning. An
  individual Tournament never meets a Team.
- **Hard:** ten links gain a team twin, and every writer of each gains a branch. This is the cost
  approach A would have saved, and it was accepted with the operator's eyes open, twice. The design
  counted nine; the protest twin was added by the operator on 2026-11-24, after the design was
  written.
- **Hard:** the side key changes the id compared in code that individual Tournaments also run
  through. That code has direct suites: the TF_v1 FAL 2026 reference, the standings computation, the
  bracket advance and the scorekeeper suites. This is why the risk is acceptable. Hard rule 2 still
  holds: a red golden test means the engine is wrong.
- **Hard:** a reader nobody listed is a silent wrong answer, not an error. The ledger gate is the
  only thing that catches it, so it must stay green and complete. A reader added later is added to
  the ledger in the same commit.
- **Hard:** the rename touches the engine's answers, so many lines stop compiling at once. That is
  intended: the compile errors are the checklist.
- **Committed to:** a Registration never stands for a Team, and a Team never stands for a Person.
- **Committed to:** rule 8 (referees) keeps its reach for Teams as written in ADR-016, section
  2026-11-13.

## Alternatives considered

- **A. A Team holds a Registration.** Rejected twice by the operator, for the reasons in Context.
  Cheaper to build, but it widens Registration to a state with no Person that about 69 files and
  their weak tests were never written for.
- **C. A team fight as a folder of ordinary Matches.** Rejected: it cannot do a relay, and it cannot
  do unnamed slots, because an ordinary Match needs two known Persons.
- **Reuse the Registration field names for a Team id.** Rejected (call 23): the name would lie.
- **Rely on the empty state to catch a missed reader.** Rejected: with both ids empty a missed
  reader compares equal and answers wrongly, with no error.
