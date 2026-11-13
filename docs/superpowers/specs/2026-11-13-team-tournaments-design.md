# Team Tournaments — design

Status: agreed with the operator on 2026-11-13, in a brainstorm. Nothing is built. The decisions
in "What the operator decided" are rulings. The items in "My calls" are proposals the operator has
read and not overturned. The plan of slice 1a is
`docs/superpowers/plans/2026-11-13-team-tournaments-slice1a.md`. Reviewed with
`myclash-plan-review`; the record is at the end.

## Context

MyClash runs individual Tournaments only. Every side of a Match, every Pool member, every bracket
slot, every penalty and every standings row is one Registration, which is one person
(`docs/HIERARCHY.md:80`). An Exchange records a colour, red or blue, and never who struck
(`packages/db/migrations/0001_init.sql:461`). No document plans teams and none rules them out.

The operator wants team Tournaments: Fighters grouped in teams, a team as one side of a Match, the
scorekeeper choosing who starts and changing the Fighter between Exchanges, and an organiser rule
that says when the swap happens. The operator did not name a specific event; the feature is wanted
as a general option, used rarely.

## Goals

1. An organiser can run a Tournament whose entrants are teams, through Pools and a single
   elimination bracket, with team standings and a final ranking.
2. For a team that has named members, the scorekeeper records which Fighter is on the piste, online
   and offline. A team with no names is scored as one unit and nobody is asked who is on.
3. The organiser can set a swap rule; the scorekeeper screen signals when a swap is due.
4. Two team fight formats: **relay** (one running score) and **series of duels**.

## Non-goals (for now)

- Team Tournaments in Swiss and double elimination. Later slice.
- Fighters or captains creating teams themselves. The organiser builds teams.
- Personal statistics, profile history and follow alerts from team Matches. For teams with named
  members the data to add them later is recorded (who was on, per Exchange). For a team with no
  names there is nothing to record, by design.
- An organisation-level list of teams reused from Event to Event. A "copy teams from a past
  Tournament" button can come later.
- A "team is out of the Tournament" status and the automatic rules that feed it (decision 7).
- Team Matches in the HEMA Ratings export. That file accepts one person against one person only.
- The detailed design of series of duels and of composition rules. Each gets its own short design
  before its slice.
- Powers for a captain. The captain is a mark for now.

## Anti-goals

- An individual Tournament must not change behaviour. The code it runs through changes in one way
  only, the side-key rename below, and the existing suites hold that.
- No second copy of standings, Pool generation or bracket advance. One owner per behaviour.
- The swap rule must never stop the scorekeeper from recording what happened on the piste.
- No stored counter becomes the truth, and the end of a Match never depends on a line-up row. Who
  is on, points taken and "team is out" are derived from Exchanges (hard rule 1).
- The clock code is not touched. Line-ups live outside the Match timeline.

## What the operator decided

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Both formats: relay and series of duels.                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | A team has numbered slots. A name on a slot is optional.                                                                                                                                                                                                                                                                                                                                                           |
| 2b  | The scorekeeper screen asks who is on the piste **only for a team with at least one named member**. In such a team an unnamed slot shows as "Fighter 2". A team with no names gets no picker; if the Tournament has a swap rule, that side gets one plain "Swap done" button.                                                                                                                                      |
| 3   | The organiser chooses who swaps: **together** (both leave), **alternating** (one side each time), or **each side on its own** (survivor).                                                                                                                                                                                                                                                                          |
| 4   | Alternating example, 3 minutes, teams of 3, rule "30 s": red swaps at 0:30, blue at 1:00, red at 1:30, blue at 2:00, red at 2:30.                                                                                                                                                                                                                                                                                  |
| 5   | Survivor: when every Fighter of a team has taken the set number of points, that team has lost and the Match ends at once.                                                                                                                                                                                                                                                                                          |
| 6   | Teams are decoupled from Registration. A side of a Match is either a Registration or a Team. Confirmed a second time after the review showed the cost (see Approaches).                                                                                                                                                                                                                                            |
| 7   | A team that leaves mid-Tournament: the organiser records a forfeit on each remaining Match by hand. No "team is out" status in the first slices. The automatic rules (black card, disqualify after N) do not act on teams.                                                                                                                                                                                         |
| 8   | A team Tournament ends with a public final ranking of teams. It cannot be linked to a League, and the screen says why: League points belong to persons.                                                                                                                                                                                                                                                            |
| 9   | A team has a colour, and an optional logo, so it is easy to identify.                                                                                                                                                                                                                                                                                                                                              |
| 10  | Teams are managed from a "Teams" entry in the **Event** menu, beside Persons and Clubs, shown only when the Event has a team Tournament. A team belongs to one Tournament. No organisation-level menu. The team Tournament itself is created where every Tournament is: Event → Tournaments, same wizard.                                                                                                          |
| 12  | Seven more features, chosen from a list of twelve: **reserves**, **captain**, **composition rules**, **leg score and swap countdown on TV**, **blind line-up**, **who scored for the team**, **public team page**. Details under "Chosen extras".                                                                                                                                                                  |
| 11  | **Rule 8 protects named Fighters only.** A Fighter in a slot with no name is unknown to MyClash, so it cannot stop them being booked as referee while they fight. The operator accepts this limit. The Teams screen marks every slot the rule cannot protect, and the referee board shows a notice on any Match of a team with unnamed Fighters. The limit is written into ADR-016 and into rule 8 of `CLAUDE.md`. |

```text
Decision 4, drawn:
       0:00   0:30   1:00   1:30   2:00   2:30   3:00
Red    Anna  |Ben           |Chloé        |Anna  |
Blue   Xavier       |Yann          |Zoé          |
```

## My calls (not yet confirmed by the operator)

Each is a proposal with its reason. Correct any of them.

1. **A Tournament is individual or team, chosen at creation.** It locks once the first entrant
   exists. Mixing the two would need every screen to handle both in one list.
2. **Order of work: relay first, duels last.** The request describes relay in detail; duels reuse it.
3. **After the last slot, the order returns to the first slot** (Anna at 2:30 in decision 4).
4. **Alternating starts with red.** Matches decision 4. Cheap to turn into a setting later.
5. **The rule proposes, the scorekeeper confirms.** When a swap is due the screen signals it and
   proposes the next slot in order. The scorekeeper confirms, picks another slot, or dismisses.
6. **A swap happens only while the clock is halted.** A time rule that fires during an action waits
   for the next halt. The manual "Change fighter" button always works at a halt, rule or no rule.
7. **Which counts go with which mode.** Together: exchanges, points or seconds. Alternating:
   exchanges or seconds. Each side on its own: points taken only. The other pairings give the same
   result as "together", so they are not offered.
8. **"Together" on points uses the running score.** Rule "5": the first leg ends when either team
   reaches 5, the second at 10, the third at 15.
9. **A named slot holds a Person of the Event.** No free-text names (public repo, personal data
   rules). A person sits in at most one team per Tournament, with the same reach as
   `UNIQUE(tournament_id, person_id)` on Registrations today. A team member holds no Registration
   in that Tournament.
10. **Team size is set per team**, pre-filled from a default on the Tournament. A team's size and
    slots cannot change from the Teams screen while one of its Matches is running. The one change
    allowed during a Match is a reserve coming on at a halt, from the scorekeeper screen.
11. **Rule 8 (referees): every named member of both teams is fighting for the whole team Match.**
    The reach is the same as for an individual Fighter today: the checker knows a person by their
    Global Person (`apps/api/src/modules/referees/event-commitments.ts:83`), so a member whose
    Person is not linked to one is as invisible as an unnamed slot. Both cases get the mark and the
    notice of decision 11.
12. **A card in a team Match goes to the team**, and records which slot was on the piste. Its effect
    stops at that Match (decision 7), so the Tournament-level penalty review gets no team form.
13. **A team forfeits as a whole**, one Match at a time (decision 7). The "replacement" link on a
    forfeit stays individual-only.
14. **The organiser cannot add a Registration to a team Tournament, nor a Team to an individual
    one.** No self sign-up exists today; the organiser's two routes are the only writers
    (`apps/api/src/modules/registrations/registrations.service.ts:167`, `:255`).
15. **If the scorekeeper dismisses a survivor swap, the Fighter stays on** and keeps taking points.
    The team is out only when every slot has taken its number. Follows from anti-goal 3.
16. **A named member is "fighting" in more places, from slice 1:** their personal schedule shows the
    team's Matches, and the schedule board's double-booking check sees them (a member who also
    fights an individual Match at the same time). Bout alerts stay a non-goal.
17. **A member can be replaced during the Tournament** (injury, substitute). Past Exchanges keep
    pointing at the member who really fought. So an Exchange stamps the slot _row_, not the slot
    number; replacing a member retires the old row and opens a new one at the same number.
18. **A line-up row is "side X, turn N, slot S".** Changing the Fighter writes turn N+1. Fixing a
    wrong tap rewrites the slot of the same turn. Two tablets sending the same turn give one row,
    and the tap made later wins, not the one that arrives later. "Later" is the time as the server
    places it, corrected for a tablet whose clock is off, the same way a late clock press is placed
    today (`apps/api/src/modules/matches/late-press.ts:99`).
    Nothing is undone, as for a clock press today (`apps/web-staff/src/offline/db.ts:38`).
19. **Survivor details, to confirm again in slice 3's plan.** Points taken are what the other
    side's score gained from Exchanges; a double or an afterblow counts for each side what the
    other gained. Card points do not count: a card is not a hit. A team with names is out when
    every slot has taken N. **A team with no names is out when it has taken size × N points in
    total**; "Swap done" only clears the cue. Survivor cannot be combined with best-of-N rounds;
    the server refuses the pair. Teams of different sizes may meet; the larger team has more lives,
    and that is the organiser's choice.
20. **Team colour: one of the 15 colour names the Tournament colour already uses**
    (`TOURNAMENT_COLORS`, `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/_lib/tournament-colors.ts:14`;
    rendered through `packages/ui/src/utils/color-token.ts`). Optional, like the Tournament's. No
    colour means no chip. It shows beside the team name in lists, standings, the bracket, the
    schedule, TV and public pages.
21. **On the scorekeeper screen the two sides stay red and blue.** Those colours mean "which side
    scored", and two teams may pick the same colour. The team colour is a chip next to the name.
22. **Team logo: optional, same upload path as the Tournament logo** (`tournaments.logo_url`
    pattern, PNG/JPEG/WebP). No logo means no image, not a placeholder.
23. **The engine's side fields are renamed, not reused.** `redRegistrationId`, `blueRegistrationId`
    and `winnerRegistrationId` in `packages/rules` and `packages/rulesets` become `redSideId`,
    `blueSideId` and `winnerSideId`. A field named "registration" that holds a team id would be a
    lie the next reader trusts. Checked with `principal-engineer` on 2026-11-13, who confirmed it
    with two corrections, both taken:
    - The rename follows the engine's **answers** up to the line that writes them to the database
      (`apps/api/src/modules/matches/scoring.service.ts:232`, `:254`, `:840`), not only its inputs.
      After the rename each of those lines fails to compile until it is visited.
    - The fields that key an **entrant** (`StandingsRow.registrationId`, a Pool seat, a bracket
      seed) are not renamed in 1a. No team reaches them before 1b; each is renamed in the slice
      that first sends a team through it. Swiss is left alone.
      One person's history (`packages/rules/src/results/fighter-career.ts`) keeps its own names.

## Chosen extras (decision 12)

Added after the review passes. Each lands in a later slice with its own plan and its own review.
The behaviour below is my proposal for each; the operator chose the feature, not these details.

| Extra                       | What it does                                                                                                                                                                   | My calls                                                                                                                                                                                                                                                                                                                                                                                                                              | Slice          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Captain**                 | One slot of a team is marked captain. Shown on the Teams screen, the team page and the TV.                                                                                     | No powers yet. At most one per team. Only a named slot can be captain.                                                                                                                                                                                                                                                                                                                                                                | 1b             |
| **Reserves**                | A team of 3 can bring a 4th Fighter.                                                                                                                                           | A reserve is always a named Person, attached to the team with no slot number. The team size stays 3. At a halt, "Change fighter" also lists the reserves; a reserve who comes on **takes the number of the Fighter who leaves**, for the rest of that Match. Survivor counts per slot number, so a reserve inherits the points already taken on that number and adds no life.                                                         | data 1b, use 2 |
| **Public team page**        | A page for a team inside its Tournament: colour, logo, captain, named members, its Matches and results. Linked from standings, bracket and schedule.                           | Lives at `/e/<event>/t/<tournament>/team/<team-slug>`, so a team gets a slug (no raw id in a URL or on screen). Hidden while the Tournament is a draft, by the same rule as the roster. A member with a public profile links to it.                                                                                                                                                                                                   | 4              |
| **Who scored for the team** | Inside a team: points scored and points taken per member, and the top scorer. On the team page and at the end of each Match.                                                   | Teams with names only. Worked out on read from the slot stamps on Exchanges; nothing stored. It stays inside the team: a person's own profile and career statistics are still a non-goal.                                                                                                                                                                                                                                             | 4              |
| **Leg score and countdown** | The TV shows the running total and, under it, the current leg: "Anna 3 – Xavier 1". With a swap rule it also shows "swap in 0:12" and "next: Ben".                             | A leg runs from the last line-up change of either side to now. Leg score: teams with names only. Countdown: every team, for time rules; for exchange and point rules it reads "swap in 2 exchanges" or "swap at 10". "Next" follows the slot order, or the declared order under blind line-up.                                                                                                                                        | 4              |
| **Blind line-up**           | Each team fixes its order before the Match and the two orders are revealed together.                                                                                           | A switch on the Tournament. Teams with names only. With no captain accounts yet, the scorekeeper enters red's order, the screen hides it, then blue's, then shows both. **Nothing leaves the tablet until both are entered**, so no screen or feed can leak one order early. It replaces "Who starts?". During the Match the picker proposes the declared order; the scorekeeper can still pick someone else (injury), as everywhere. | 5              |
| **Composition rules**       | The organiser sets what a legal team is, and MyClash refuses a team that breaks it. Examples given: one weapon per slot, at least one woman, a cap on the team's total rating. | Gets its **own design first**. Each rule needs a ruling. "One weapon per slot" may mean different buttons and scoring per leg, which reaches the ruleset. "At least one woman" reads a person's gender, which is personal data. Whitelisted rule kinds with numbers, never a formula typed by the organiser (hard rule 5).                                                                                                            | 7              |

**Considered and not chosen:** team from a Club, team timeouts (would touch the clock), starting
score (points with no Exchange behind them, against hard rule 1 without a ruling), a medal on each
member's profile, follow a team.

## Approaches considered

**A. A team holds a Registration.** Registration becomes "one person or one team". Least to build;
calculating code (scoring, scheduling, standings, brackets) is untouched because the id is never
empty. Rejected twice by the operator: a Registration with no person is a state the app has never
seen, about 69 API files read a name through a Registration, some Event-wide, and the tests there
are weak (the doubles do not check what is read).

**B. Teams decoupled — chosen.** Registration keeps its meaning. A side is a Registration or a
Team. Its true cost, as the review found:

- Nine links gain a team twin and each writer gains a branch.
- **A missed place is not safe.** Code that calculates compares side ids. With both ids empty, a
  team card scores for both teams (`apps/api/src/modules/matches/scoring.service.ts:628`,
  `apps/web-staff/src/offline/pending-events.ts:309`), and the schedule run treats all team Matches
  as one Fighter (`apps/api/src/modules/schedule/match-scheduler.ts:267`).
- So every Match gets **one side key that is never empty**, and every comparison uses it. That
  changes the id compared in code individual Tournaments also run through. That code has direct
  suites (the TF_v1 reference, `compute-rows.test.ts`, `bracket-advance.service.test.ts`, the
  scorekeeper suites); this is why B's risk is acceptable.
- The guard is the ledger test (slice 1a), not the empty state.

**C. A team fight as a folder of ordinary Matches.** Rejected: cannot do relay, and cannot do
unnamed slots, because an ordinary Match needs two known persons.

## Design

### Words (`docs/HIERARCHY.md`)

Registration keeps its meaning: one person entered in one Tournament. Two existing definitions must
widen, and the operator's approval of this design covers that change (CLAUDE.md: ask before
deviating from HIERARCHY):

- **Match** — today "a single fight between two registrations" (`:97`, and the diagram at `:80`).
  Becomes "a single fight between two sides".
- **Fighter** — today "holds a Registration" (`:117`). Becomes "holds a Registration, or a slot in
  a Team".

Seven words are new:

| Word        | Meaning                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------- |
| **Team**    | A named group entered in one team Tournament. Has a size and numbered slots.                 |
| **Slot**    | One numbered place in a Team. Holds a Person of the Event, or nobody.                        |
| **Side**    | One of the two parties of a Match: a Registration or a Team.                                 |
| **Line-up** | Which slot of each team is on the piste at a given moment.                                   |
| **Captain** | The one named slot of a Team marked as its captain. A mark, not a role with powers.          |
| **Reserve** | A named Person attached to a Team with no slot number, who can take a number during a Match. |
| **Leg**     | A stretch of a relay Match between two line-up changes.                                      |

An ADR (`docs/decisions/ADR-022-team-is-a-second-kind-of-side.md`) records decision 6, the side
key, and why.

### Data

- `tournaments.entrant_kind`: `individual` (default) or `team`. `tournaments.team_default_size`.
- New tables `teams` (tournament, name, slug, size, seed, colour name, optional logo) and
  `team_slots` (team, position, optional person, captain mark, retired-at). A row with a person and
  no position is a reserve. One person per Tournament at most, and one captain per team at most,
  both in the database.
- New table `match_lineups` (match, side, turn, optional slot row, client id, time, staff account),
  unique on (match, side, turn). **Not** rows in `match_events`: the repair of a lost Start reads
  the last timeline row of any type (`apps/api/src/modules/matches/late-press.ts:235`,
  `clock.service.ts:444`), and a line-up row after every Start would defeat it.
- All three new tables: RLS policy in the same migration (hard rule 4), read exactly as a
  Registration of the same Tournament is, so hidden while the Tournament is a draft
  (`0203_draft_tournament_row_hidden.sql:39`), and written by the API only. Each is added to the
  archive registry and to the personal-data export coverage, which the existing guards force
  (`apps/api/src/modules/privacy/subject-export.coverage.test.ts:61`). `match_lineups` joins the
  realtime publication so the TV follows a swap (precedent: `0167_realtime_match_penalties.sql`).
- **A team twin beside each Registration link**, with a check "a Registration or a Team, never
  both". Nine links: `pool_members`; `bracket_slots` (a, b); `matches` (red, blue, winner);
  `match_penalties`; `match_forfeits` (forfeiting, winner). `pool_members.registration_id`, the
  penalty link and the two forfeit links are `NOT NULL` today and become nullable under that check.
  No twin for `tournament_penalty_reviews` (call 12) nor for the forfeit "replacement" (call 13).
  The forfeit's stored snapshot also carries a winner id
  (`apps/api/src/modules/matches/match-forfeits.service.ts:642`) and gains the side form.
- New foreign keys follow the deferred-delete rule of `0237_cascade_deletes_check_at_commit.sql`.
- **One database trigger holds the kind.** It refuses a Registration in a team Tournament, a Team
  in an individual one, and a change of kind once an entrant exists. Three writers race here (add
  Registration, add Team, change kind); the trigger is the one judge, the API messages come second.
- Who is on: `exchanges.red_slot_id` and `exchanges.blue_slot_id` (slot rows), stamped by the
  scorekeeper screen when the Exchange is tapped (call 17). Set only for a side whose team has
  named members (decision 2b); empty otherwise.
- The swap rule lives in the match format config, like `bestOf` and `maxDoubleHits`:
  `teamSwap?: { count: 'exchanges' | 'points' | 'seconds', every: number, who: 'together' | 'alternating' | 'own' }`.
  **Absent when unused, never `null`:** the ruleset fingerprint hashes the normalised config
  (`packages/rulesets/src/content-hash.ts:86`), and a present key would change the fingerprint of
  every ruleset. A whitelisted enum plus a number, no formula (hard rule 5). Each Match keeps its
  frozen copy: `match_rules` copies the whole `ruleset_config` (`0229_match_rules.sql:159`).

### One owner for each new behaviour

- **The side key.** `sideKey(registrationId, teamId)` in `packages/types` gives the one id of a
  side: the Registration id or the Team id, never empty for a Match that has its sides. It lives
  in `packages/types` because the API and the scorekeeper screen both need it and the engine never
  calls it: the engine receives ids already resolved. Every comparison of sides uses it: the
  scorer's card matching, the scorekeeper screen's pending score, the scheduler's "who is busy",
  standings, bracket advance, forfeits. In the engine packages the fields are renamed (call 23);
  the database columns keep their names, because those really do hold Registrations.
- **The side resolver.** One function in the API turns a side into what a screen prints: kind,
  name, colour, logo. It calls `sideKey`. It lands in slice 1b with its first callers, not in 1a:
  about fourteen copies of "name of a side" exist today
  (`apps/api/src/modules/staff/lice-matches.ts:88` and its twins), and a new owner that nobody
  calls yet would be a fifteenth.
- **"Is a swap due?"** One pure function in `@myclash/rules`, exported through the `/pad` door so
  it runs offline. The thresholds are multiples of the rule's number on a counter that only grows
  (clock, Exchange count, score), so the answer needs no line-up row. Line-up rows only tell the
  screen which swaps were already made. A new `/pad` export needs its row in `docs/ARCHITECTURE.md`
  §7.3 first (`scripts/check-package-purity.mjs`).
- **"Is a team out?"** `roundOutcome` (`packages/rules/src/match-format.ts:924`) stays the one
  place that decides an ending, with a new end reason `team_out`. Today it reads a finished score
  only. It gains one input, the points taken per slot and in total, worked out by one pure function
  from the Exchanges. It has five call sites, and each passes it
  (`apps/web-staff/src/offline/pad-series.ts:296` and `:354`, `components/end-guard.ts:56`,
  `packages/rulesets/src/match-format.ts:341`, `packages/rules/src/match-format.ts:908`). Survivor
  is refused with best-of-N, so "the round is over" and "the Match is over" are the same thing
  wherever `team_out` can fire. No `default:` branch is added to absorb the new reason; the compile
  errors are the checklist.
- **Standings, Pool generation, bracket advance** keep one copy each, fed side keys.

### People and privacy

Four paths reach people through Registrations only, and would miss a team member. Each gains a team
branch in slice 1c:

- **Hidden people of a draft Tournament.** The rule that keeps them out of public lookups reads
  Registrations (`apps/api/src/common/auth/hidden-entrants.ts:43`). Named slots feed it too.
- **Deleting a Person.** The check for Matches that block the delete is Registration-keyed
  (`apps/api/src/modules/registrations/assignments.service.ts:296`, `:529`). A named slot in a team
  that has fought blocks it the same way.
- **The Tournament archive** collects persons through Registrations
  (`apps/api/src/modules/exports/archive.tables.ts:153`). This one lands in slice 1a with the
  tables: the archive's own guard goes red otherwise.
- **The personal data export** reaches fought Matches through Registrations
  (`apps/api/src/modules/privacy/subject-export.service.ts:103`).

The merge of two Global Persons needs nothing: a slot holds an Event Person.

### Routes and access

- Team routes are nested under the Tournament (`tournaments/:id/teams/…`), so the archived-Event
  lock resolves them (`apps/api/src/common/event-readonly/resolve-event-id.ts:51`).
- Each new route names its refuser, and the API-wide route test must stay closed with no new
  exemption (`apps/api/src/common/testing/route-authz-ledger.ts`). Teams and slots: the organiser
  or the Tournament admin. Line-up writes: a scorekeeper account of that Event, through the same
  door as a late clock press (`apps/api/src/modules/matches/matches.controller.ts:578`).
- The League link is refused at both of its doors (`apps/api/src/modules/leagues/leagues.service.ts:895`, `:1385`).

### What each person sees

#### Organiser (web-admin): the Tournament creator

The creator is the four-step wizard in `tournaments/new/_wizard/`. It stays four steps.

| Step           | Today                                                                                               | Change for a team Tournament                                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Basics       | name, slug, weapon, ruleset, penalty list and forfeit rules, colour, max participants, max waitlist | New first choice: **Individual** or **Team**. On Team: a "default team size" field appears; "max participants" reads "max teams" and is enforced when a team is created; "max waitlist" is hidden (teams have no waitlist); the automatic forfeit rules are hidden and one line says they do not act on teams yet (decision 7). |
| 2 Match format | point cap, clock, time limits, best-of, max doubles                                                 | Slice 1: nothing. Slice 3: the swap rule (three fields). Slice 4: relay or series of duels.                                                                                                                                                                                                                                     |
| 3 Display      | logo, side colours, buttons                                                                         | Nothing.                                                                                                                                                                                                                                                                                                                        |
| 4 Advanced     | locks, publish                                                                                      | Nothing.                                                                                                                                                                                                                                                                                                                        |

- The create request is validated by a strict schema (`createTournamentSchema`,
  `apps/api/src/modules/events/dto/events.dto.ts:327`). The two new fields (kind, default team
  size) must be added there, or the create is refused with a 400. Same for the update schema, so a
  draft resumed in the wizard keeps its kind.
- The kind can change while the Tournament has no entrant. After that the trigger refuses it and
  the settings page shows the kind as fixed, with the reason.
- A hidden field is not sent. It is never shown greyed-out with a value still going to the server.
- The Tournaments list shows a "Team" badge on a team Tournament.

#### Organiser (web-admin): the rest

- A "Teams" entry in the Event menu (`apps/web-admin/src/components/event-nav-groups.ts`), beside
  Persons and Clubs, shown only when the Event has a team Tournament (decision 10). The screen lists
  the teams of each team Tournament: create a team (name, size, colour, optional logo), fill slots
  from the Event's Persons or leave them empty. Empty teams are allowed, so Pools can be built early.
- Pools and bracket generation take teams. Standings and the final ranking list teams.
- Match format tab: the swap rule (three fields), shown on team Tournaments only.

#### Scorekeeper (web-staff)

```text
┌──── ● Lyon Blades (has names) ─────┬──── ● Paris Steel (no names) ──────┐
│ on piste: Anna Martin              │                                    │
│ [ Change fighter ]                 │ [ Swap done ]  (only with a rule)  │
│            ...scoring buttons as today, clock in the middle...          │
└────────────────────────────────────┴────────────────────────────────────┘
  ● = team colour chip. The columns themselves stay red and blue.
```

- **A team with names.** Pressing Start first asks "Who starts?" for that side, slot 1 pre-chosen.
  "Change fighter" is live while the clock is halted and proposes the next slot.
- **A team with no names.** No question at Start and no picker. With a swap rule, one "Swap done"
  button, live while the clock is halted; it clears the cue. With no rule, nothing extra.
- A Match can mix the two: one side with names, the other without.
- When the rule says a swap is due: a cue like the existing time-up cue. At the next halt the
  picker opens with the next slot pre-chosen, or "Swap done" is highlighted.
- Everything above works with no network. The tablet's kept copy of a bout holds only bout, clock,
  Exchanges and penalties today (`apps/web-staff/src/offline/kept-bout.ts:27`); it gains the two
  teams, their slots and the line-up list, so a screen reloaded offline still knows who is on.
- A card on a team changes the row the tablet queues (`apps/web-staff/src/offline/db.ts:157`).
  That lands in slice 1b, with team penalties, not in slice 2.

#### Public and TV (web-public, `TVScoreboard`)

- Team name, colour chip and logo where the Fighter name is today. For a team with names, the
  Fighter on the piste under it; a swap shows live through the realtime feed on `match_lineups`.

#### Referee board

- A named team member cannot be booked to referee during their team's Match (call 11).
- Any Match of a team that has an unnamed slot, or a member the check cannot see, carries a notice:
  MyClash cannot check these Fighters (decision 11). The notice blocks nothing. It is a note on
  the Match, not a fourth level beside Impossible, Discouraged and Fine (ADR-016).

### Races named

- **Line-up change against an Exchange tapped offline.** The Exchange carries its own slot stamp,
  and survivor for a team with no names counts points only. So the score and the end of a Match
  never depend on the order in which queued rows reach the server. Line-up rows serve display.
- **Two tablets on one Match, or one tablet back online late.** A line-up row is unique on (match,
  side, turn): the same turn sent twice is one row. Its slot is set by the tap with the later time.
  Every queued row carries the time of the tap and the time it was sent
  (`apps/web-staff/src/offline/sync.ts:306`), and the server places it as it places a late clock
  press, so an old tap replayed after a correction does not overwrite it, even from a tablet whose
  clock is off.
- **Add a Registration, add a Team, change the kind.** One database trigger judges all three.

## Slices

Each slice is usable alone and lands as several single-concern commits.

1. **Teams enter a Tournament**, in three parts.
   - **1a, foundations, no screen changes.** Words in HIERARCHY and ADR-022. The limit of rule 8
     written into ADR-016 and `CLAUDE.md` (decision 11). The side-key rename in
     the engine packages, as one commit that changes names and no value. The schema (tables, nine
     twins, trigger, policies). `sideKey`, used where the API feeds the engine and where it writes
     the engine's winner back. The **ledger gate**. Planned in full in
     `docs/superpowers/plans/2026-11-13-team-tournaments-slice1a.md`.
   - **1b, an organiser can run Pools.** The side resolver. The Tournament creator, the Teams screen with colour and
     logo, Pool generation, standings, team cards and forfeits Match by Match, team names on the
     schedule, the scorekeeper screen, TV and public pages. A team Match is scored as one unit.
   - **1c, the rest of a Tournament.** Single elimination, final ranking, League link refused, the
     referee rule with its mark and notice, personal schedule and double-booking check for named members, the four people
     and privacy paths, HEMA Ratings export skips team Tournaments and says so.
2. **Who is on, for teams with names.** "Who starts?", "Change fighter", slot stamps on Exchanges,
   `match_lineups`, the new offline queue kind, the kept line-up, Fighter on piste on TV and public
   pages. A team with no names is untouched by this slice.
3. **Swap rules.** The "is a swap due" function, the cue, "Swap done", survivor end, and the
   `teamSwap` setting in **all** its homes:
   - the rules interface (`packages/rules/src/match-format.ts:127`) and the Zod schema
     (`packages/rulesets/src/match-format.ts:178`);
   - the shape check that would otherwise drop a config holding only this key
     (`packages/rulesets/src/match-format.ts:242`);
   - the strict API schema, with the refusal of survivor plus best-of
     (`apps/api/src/modules/events/dto/events.dto.ts:281`);
   - the rules-lock list and its `en`/`fr` labels (`packages/types/src/rules-change.ts:42`);
   - the Tournament form and the club ruleset form
     (`apps/web-admin/src/components/rulesets/RulesetMatchFormatBox.tsx`).
4. **The team on show.** The public team page, who scored for the team, the leg score, the swap
   countdown and "next" on TV. Needs slices 1 to 3.
5. **Blind line-up.** The Tournament switch, the hidden entry of the two orders on the scorekeeper
   screen, the picker following the declared order. Needs slice 2. Works with no network.
6. **Series of duels.** Own short design first. Expected to reuse best-of-N rounds: one duel is one
   round with a fixed slot per side.
7. **Composition rules.** Own design first; each rule needs a ruling.
8. Later, each on request: a real "team is out" status with the automatic rules, Swiss and double
   elimination, personal statistics, bout alerts for members, captain sign-up and captain powers.

The captain mark and the reserves' data land in slice 1b with the Teams screen; a reserve coming on
lands in slice 2.

### Size estimate, in commits

An estimate, not a promise. Basis: one commit per single concern (hard rule 9), and what this repo
spent on comparable work, counted from `git log` on 2026-11-13: FightBook's four slices took 123
commits, Swiss took 148, best-of-N rounds took 62. Each figure below includes the plan, the review
fixes and the follow-up fixes, which were about a third of those totals.

| Slice                   | Commits                    | First thing it gives                                         |
| ----------------------- | -------------------------- | ------------------------------------------------------------ |
| 1a foundations          | about 20                   | Nothing visible. The base everything stands on.              |
| 1b Pools                | about 38                   | An organiser can create a team Tournament and run its Pools. |
| 1c rest of a Tournament | about 28                   | Bracket, final ranking, referee rule, privacy paths.         |
| 2 who is on             | about 32                   | "Who starts?", "Change fighter", reserves.                   |
| 3 swap rules            | about 32                   | The three swap modes and survivor.                           |
| 4 the team on show      | about 22                   | Team page, who scored, leg score, countdown.                 |
| 5 blind line-up         | about 18                   | The two orders revealed together.                            |
| **1a to 5**             | **about 190** (160 to 230) |                                                              |
| 6 series of duels       | 25 to 35                   | Not designed yet.                                            |
| 7 composition rules     | 20 to 40                   | Not designed yet; depends on which rules.                    |
| **Everything**          | **about 250** (210 to 300) |                                                              |

The first point where the feature can be tried at a live test event is the end of 1b, after about
60 commits.

### The ledger test (slice 1a)

It answers "has every place that reads a Match side been visited?".

- It scans apps, packages **and migrations** for every spelling of a side link: the column names,
  their camelCase forms, and the foreign-key embed names used in read strings
  (for example `apps/api/src/modules/staff/lice-matches.ts:32`, SQL such as
  `packages/db/migrations/0189_blow_value_stats_any_value.sql:82`, shared code such as
  `packages/ui/src/components/TVScoreboard.tsx:453`).
- About 410 files mention a side link today, tests included; about 200 are not tests. Each of
  those is listed with a verdict and its count of hits: "uses the side key", "individual only, on
  purpose" with the reason, or "not yet" with the slice that will visit it.
- A file that is not listed fails. A listed file whose count changed fails until someone re-reads
  it. "Not yet" is a ratchet, as in the route ledger
  (`apps/api/src/common/testing/route-authz-ledger.ts:25`): its size is pinned and may only shrink,
  to zero by the end of slice 1c.
- A second rule covers the failure the principal engineer named: in the apps, a value put into a
  `redSideId`, `blueSideId` or `winnerSideId` must come from `sideKey(…)` or from another side id.
  A raw `red_registration_id` there compiles, and gives a team a score of zero with no error.
- It is falsified by **adding** a new reader and seeing red, and the count of scanned files is
  pinned, so a scan that silently reads nothing cannot pass.
- It spans apps, packages and migrations, so it is a root gate with its four registrations
  (script, `ci.yml` step, `CI_GATES`, `CONTRIBUTING.md`).

## Critical files

- Vocabulary and decision: `docs/HIERARCHY.md`, `docs/ARCHITECTURE.md` (data model, §7.3),
  `docs/decisions/`.
- Schema: `packages/db/migrations/` (next number = max + 1).
- Engine: `packages/rules/src/domain.ts`, `packages/rules/src/match-format.ts`,
  `packages/rules/src/pad.ts`, `packages/rulesets/src/match-format.ts`,
  `packages/rulesets/src/content-hash.ts`, `packages/types/src/rules-change.ts`.
- API writers: `apps/api/src/modules/phases/phases.service.ts` (`generatePools`,
  `generateBracket`), `phases/bracket-advance.service.ts`, `pool-standings/compute-rows.ts`,
  `penalties/penalties.service.ts`, `matches/match-forfeits.service.ts`,
  `matches/scoring.service.ts`, `schedule/match-scheduler.ts`, `matches/dto/matches.dto.ts`
  (strict), `events/dto/events.dto.ts` (strict).
- Referee rule, two copies today: `apps/api/src/modules/referees/event-commitments.ts`
  (`fightersOf`) and `apps/web-admin/app/org/[slug]/events/[eventId]/schedule/referee-conflict-rows.ts`.
- Names on screens: `apps/api/src/modules/staff/staff.service.ts`, `staff/lice-matches.ts`, match
  summaries, `packages/ui/src/components/TVScoreboard.tsx`.
- Members as fighters: `apps/api/src/modules/persons/public-schedule.service.ts`,
  `apps/web-admin/app/org/[slug]/events/[eventId]/schedule/conflict-detection.ts`.
- People and privacy: `apps/api/src/common/auth/hidden-entrants.ts`,
  `registrations/assignments.service.ts`, `exports/archive.tables.ts`,
  `privacy/subject-export.service.ts`.
- Final ranking and League: `apps/api/src/modules/tournament-placement/tournament-placement.service.ts`,
  `apps/api/src/modules/leagues/leagues.service.ts`.
- Must NOT gain a team path (decision 7): `apps/api/src/modules/matches/fighter-status.service.ts`,
  migration `0240_fighter_status_settle.sql`. Must NOT change in its logic: the clock
  (`matches/clock.service.ts`, `matches/late-press.ts`, `packages/rules/src/clock.ts`). Its list
  of columns read from a bout (`BOUT_COLUMNS`, `clock.service.ts:156`) gains the team columns in
  slice 1b; that is a read list, not clock logic.
- Scorekeeper screen: `apps/web-staff/src/components/MatchView.tsx`, `ScoringCenterControls.tsx`,
  `ScoringColumn.tsx`, `MatchHeader.tsx`, `src/offline/db.ts`, `src/offline/sync.ts`,
  `src/offline/kept-bout.ts`, `src/offline/pending-events.ts`, `src/lib/time-up.ts`.
- Teams screen: `apps/web-admin/src/components/event-nav-groups.ts`, a new
  `events/[eventId]/teams/page.tsx`, `tournaments/_lib/tournament-colors.ts`, the Tournament logo
  upload as the model.
- Creator: `tournaments/new/_wizard/Step1Basics.tsx`, `Step2MatchFormat.tsx`,
  `tournaments/[tournamentId]/settings/_components/MatchFormatTab.tsx`,
  `tournaments/_shared/match-format-form.ts`.
- i18n: every new string in `en` and `fr` (hard rule 6).

## Left to the builder

- Exact column names, migration split, and RLS policy text.
- Where the side resolver lives and its exact shape.
- Whether "Who starts?" is a dialog or an inline step, within `DESIGN.md` and `docs/design/`.

## Open questions for the slice plans

- Does a corrected Exchange keep its slot stamp, or can the correction change it? (slice 2)
- Does `pnpm db:cascade-probe` pick up new foreign keys by itself? UNVERIFIED; run it after the
  slice 1a migration and read its count.

## Verification

- **Hard rule 2.** The TF_v1 golden test stays green, byte for byte. Its fixture does not carry the
  renamed fields (checked: no "registration" in `packages/rulesets/test/fixtures/fal2026.json` nor
  in `tf_v1.fal2026.test.ts`), so the fixture is not edited.
- **The side-key rename (1a)** is one commit whose diff changes names and no value. The suites of
  `packages/rules`, `packages/rulesets`, `apps/api` and `apps/web-staff` pass before and after it.
- **Individual Tournaments unchanged.** After the rename, slices 1 to 3 edit no expectation in the
  existing suites for standings, Pool generation, bracket advance and scoring
  (`pool-standings/compute-rows.test.ts`, `phases/phases.service.test.ts`,
  `phases/bracket-advance.service.test.ts`, the scorekeeper suites). The check is a command:
  `git diff <rename-commit>..HEAD` on those files shows no changed assertion.
- **Each team branch has a falsifier.** Delete the branch, see its test go red, and compare the
  collected-test count with the baseline so a file that stopped loading is not read as a red.
  Named cases: a team card scores for one side only; two team Matches of different teams are
  scheduled side by side on two pistes; a named team member is refused as referee during their
  team's Match; a hidden draft team's member is not found by a public lookup; the referee board
  shows the notice for a team with an unnamed slot and does not show it for a team whose members
  are all named and known to the check.
- **A test over a database read asserts the read string**, so dropping a team column from it turns
  the test red.
- **Ruleset fingerprint.** A test proves the fingerprint of an individual ruleset is the same with
  the `teamSwap` field in the schema as without it.
- **Creator.** The wizard creates a team Tournament and a resumed draft keeps its kind. The trigger
  refuses a change of kind once an entrant exists, a Registration in a team Tournament, and a Team
  in an individual one. A team beyond "max teams" is refused.
- **Schema.** `pnpm db:migrations:replay`, then a read of the migrated schema that lists the nine
  checks and the trigger by name. A replay alone does not prove a CHECK landed.
- **Offline (hard rule 3).** The offline E2E suite stays green. New offline specs: slice 2, a
  line-up change made with no network reaches the server once, and a screen reloaded offline still
  shows who is on; slice 3, a swap cue fires with no network.
- **Slice 2.** A Match between a team with names and a team with no names asks "Who starts?" for
  the first side only and stamps a slot on that side only. A lost Start is still repaired when a
  line-up was written after it.
- **Slice 3.** Table-driven tests for "is a swap due": decision 4's timeline exactly, legs on
  points (5, 10, 15), survivor out by slots, survivor out at size × N for a team with no names.
- **Reserves (slice 2).** A reserve who comes on takes the leaving Fighter's number; in survivor
  the team's lives do not grow; the Exchanges before and after the change point at two persons.
- **Slice 4.** The team page of a draft Tournament answers "not found" to the public. "Who
  scored" for a known list of Exchanges gives the expected per-member table, and deleting the slot
  stamp from the read turns the test red.
- **Slice 5.** With blind line-up on, no request leaves the tablet between the entry of the first
  order and the entry of the second; the test asserts the sent requests, not the screen.
- **Gates.** The full chain through the `myclash-gates` skill before each push, with the i18n and
  API tests run directly and not through turbo. Large edited files re-point the complexity baseline.
- **Concurrent sessions.** `git log --oneline -1` before staging, `git fetch` before pushing,
  explicit paths only.

## Next

1. The plan of slice 1a is `docs/superpowers/plans/2026-11-13-team-tournaments-slice1a.md`.
2. Each later slice gets its own plan and its own review before it is built.
3. No code before the operator says so.

## Review record

`myclash-plan-review`, 2026-11-13.

- Pass 1: 1 BLOCKER, 8 MAJOR, 5 MINOR, all folded into this text. The BLOCKER was the claim that a
  missed reader degrades safely; decision 6 was put to the operator again with the corrected facts
  and confirmed.
- Pass 2: 1 BLOCKER, `accepted-as-is` by the operator with a mitigation (rule 8 and unnamed
  Fighters, decision 11); 4 MINOR and 1 NIT, folded in.
- Pass 3: 0 BLOCKER, 0 MAJOR; 2 MINOR and 1 NIT, folded in. CONVERGED with open questions, listed
  above.
- **Not reviewed:** the seven extras of decision 12 were added after pass 3. Each is reviewed with
  the plan of its own slice.
