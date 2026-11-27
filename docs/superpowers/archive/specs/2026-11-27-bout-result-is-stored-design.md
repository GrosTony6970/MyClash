# A finished bout's result is what it stored

Status: shipped 2026-11-27 (R1 `8beee0abd`, R2 `90fc5e29e`, R3 the commit that archived this).
Follows rulings 1005-1008 (a copy of TF_v1 is a formula).

## The problem

A finished bout's result is read in two ways:

- **Winner only.** TF_v1's pool score, the SQL fighter stats, Swiss, the HEMA Ratings export,
  bracket advancement.
- **Winner, else the leader.** `boutOutcomes` / `winnerColorFrom`
  (`packages/rules/src/match-format.ts`): the standings W/D/L columns, a club formula's victories,
  the fighter career and history, the public schedule. `winnerLoser`
  (`packages/types/src/final-ranking-core.ts:109-139`) does the same for the final ranking and leagues.

They disagree on a finished bout with **no winner and unequal scores**. That bout exists today:

1. **A card after a doubles-limit draw.** The board is wiped to 0-0, then the card applies: 0 to -1,
   no winner, `end_reason: 'max_doubles_draw'`. TF_v1 counts a draw; the W column a win.
2. **`PATCH /matches/:id/status` with `completed` and no winner.** Writes no winner and no reason, whatever
   the score. No screen and no MCP tool calls it; only `tests/e2e/07-populate-event.spec.ts`, always
   with a winner.
3. **Clock End on an undecided best-of bout** (`time-limit-result.ts:129`, `clock.service.ts:646-691`):
   completes the series with no winner, on the open round's score. The pad never sends it.
4. **A refused correction.** A 3-3 draw corrected to 4-3 keeps its draw (a later bout was fought);
   the W column then reads a win.

## The rule

A finished bout's result is its stored `winner_registration_id` and `end_reason`. The score never
decides it. No winner means a draw, unless the reason is a double loss (`max_doubles`).

Then TF_v1 ("the stored winner wins") and every `boutOutcomes` reader agree with no change to TF_v1.
The operator wipes and redeploys, so no older row needs the fallback.

## Slices

**R1 — live readers ask who leads, not who won.** No behaviour change. These read a RUNNING bout and use
the fallback as "who leads"; they move to `leadingColor`:

- `apps/api/src/modules/matches/time-limit-result.ts:46-56` (`isLevelBout`) and `:137-151`, which also
  serve `level-step.ts:153` and `scoring.service.ts:1486` (`sheetEnds`);
- `apps/web-staff/src/components/MatchResultOverlay.tsx:133`: the tablet passes the series winner it
  computed (`MatchView.tsx:595-617`), not a fake `completed` status.
- The fighter's match history (`fighters.service.ts` `listMatchesPaginated`, which lists running and
  voided bouts too): a bout not finished has no outcome, and the modal shows no W/D/L for it.
- "Is it level" (`isLevelBout`) reads a recorded winner and the board each on its own: the level
  steps still refuse a 0-0 forfeit under a zeroing policy. The clock's End reads the board only, so
  its select stops fetching `winner_registration_id`.

Left as it is: `packages/ui/src/components/TVScoreboard.tsx:596-621` asks for the winner once the
clock ends. After R3 it shows the stored winner, which arrives with the completed row a moment later;
guessing the leader in that moment could crown the wrong fighter (a forfeit wins on the lower score).

**R2 — every path that finishes a bout stores its result.**

- Clock End on a best-of bout that is not decided: refused. The server's own End after a clinch
  (`scoring.service.ts:297-298`) stays, since the bout is already completed.
- A level time-out stores `end_reason: 'time_limit'` (`time-limit-result.ts:165`). No CHECK limits the
  column, and `correction-outcome.ts:101-108` already writes it. Its guess at `:80-84` goes.
- `PATCH /matches/:id/status` (ruling 1010, 2026-11-27): a completion needs a winner who is one of the
  two fighters, else 400. A draw comes from the clock. The E2E populate test already names one. It
  clears the end reason: a result by hand is its winner alone, so an old `max_doubles` or
  `time_limit` cannot override it.
- A card after a doubles-limit draw (ruling 1009, 2026-11-27): **still a draw.** The limit decided the
  bout; the card moves the board, not the result. No write changes: the stored reason is
  `max_doubles_draw` with no winner, and R3 makes every reader call that a draw, as TF_v1 does today.

**R3 — the fallback goes.** `winnerColorFrom` (and through it `boutOutcomes`) and `winnerLoser` read the
winner only. Six tests that pin the fallback change (`bout-outcomes.test.ts`,
`match-winner.test.ts`, `recent-matches.test.ts`, `fighter-career.test.ts`,
`correction-outcome.test.ts`, `tournament-data.test.ts`), with the comments and ARCHITECTURE lines
(§ near 864 and 972) that say the fallback must stay.

Each slice ends with the `myclash-gates` chain; R1 and R2 run the offline specs (hard rule 3).

## Acceptance (tests)

- A bout ended by a card after a doubles-limit draw reads the same in TF_v1's score, the W column and
  a club formula.
- A level time-out stores `time_limit` with no winner; every reader calls it a draw.
- Clock End on an undecided best-of bout is refused; after a clinch it still ends.
- `PATCH status completed` with no winner, or a winner who is not in the bout, is a 400.
- `boutOutcomes` of a completed bout with no winner at 3-1 is a draw.
- The clock End on a running 3-1 bout still names the leader (R1 guards R3).
