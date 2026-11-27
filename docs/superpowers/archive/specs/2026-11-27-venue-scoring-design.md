# Venue scoring — rounds limited by a number of won exchanges

Status: built (2026-11-27). `docs/ARCHITECTURE.md` §7.4 says what the code does now.

## Intent and why

The operator wants to run a competition whose rulebook does not use target values or a
clock-limited round. Under that rulebook:

- each exchange ("venue") that has a winner gives that winner **1 point**;
- a round ends when **N venues have a winner** (e.g. 5);
- the clock stays only as a **backstop against stalling**, not as the normal end;
- rounds combine with the existing best-of-N: a Bo3 of 5-venue rounds is at most 15 won venues.

Why: reproduce an existing competition rulebook ("règlement d'une compétition").

## Rulings from the operator (this conversation)

1. **A venue is won only by a clean hit.** Clean hit → the striker wins the venue (1 point).
   Afterblow → nobody wins it. Double → nobody wins it. No exchange ("rien") → nobody wins it.
2. **Only won venues count toward N.** Doubles, afterblows and "rien" consume no venue: a round
   of 5 lasts until 5 venues have a winner.
3. **Early stop is a setting.** Either the round stops as soon as it is decided (3-0 out of 5),
   or all N venues are fought anyway.
4. **Approach B**: a "venue" scoring mode in the match format, correct by construction, rather
   than one extra setting that relies on the organiser also setting targets to 1 / afterblow
   deductive / point cap.
5. **One "Touch" button per side** on the pad in a venues bout — no target choice. Every clean
   hit is +1 everywhere: board, exchange log, standings, fighter stats.

## Goals

- An organiser picks "venues" scoring for a Tournament (or a ruleset that seeds it), sets N per
  phase and the early-stop switch, and the bout runs to that rulebook with no other knob to get
  right.
- Works with best-of-N rounds unchanged (round wins, `rounds_json`, advance, reopen).
- Works fully offline on the scoring pad (hard rule 3): the pad closes a round on the same rule,
  from the same `@myclash/rules` owner.
- The server derives the score from exchanges (hard rule 1); nothing new is stored as truth.
- A "Venues 3/5" counter (won venues of the current round / N) shows on the pad and on the TV
  scoreboard in a venues bout, beside the existing "Round 2/3" counter (operator, 2026-11-27).
  Both count from exchange rows they already hold, by one shared predicate; nothing is added to
  the display payload.

## Non-goals

- No new built-in ruleset (it would copy the engine; one owner per behaviour).
- No change to `points` mode behaviour. TF_v1 golden test stays byte-identical (hard rule 2).
- No change to max-doubles: it stays its own setting (pool/Swiss only), as today.

## Anti-goals

- A venue score that depends on button values or on the afterblow mode. (That is approach A's
  failure mode, rejected.)
- The pad and the server disagreeing on when a round ends.

## Approaches considered

- **A. One new setting "won venues per round"**, organiser sets targets to 1, afterblow
  deductive, point cap ⌈N/2⌉ (early stop) or ≥ N (play all). Very little code; silently wrong if
  one of the three other knobs is off. Rejected by the operator.
- **B. A `venues` scoring mode in the match format** (chosen). The engine scores 1 per clean hit
  whatever the target, 0 for afterblow/double/no_exchange, and ends the round on won venues.
- **C. A new built-in ruleset.** Rejected: duplicates the scorer and the end logic.

## Design

### Config (match format)

New fields on `MatchFormatConfig`, mirroring the existing per-phase shape of `bestOf`:

- `scoringUnit: 'points' | 'venues'` — default `'points'` (every existing config unchanged).
- `venuesPerRound: { pool, swiss?, bracket, finals }` — positive ints, default 5; `swiss` optional
  falling back to `pool` exactly like `bestOf.swiss`. Read only in `venues` mode.
- `stopWhenDecided: boolean` — default `true`. Read only in `venues` mode.

In `venues` mode `pointCap` is not read (hidden in the editor). A venues bout always counts
up: `normalizeMatchFormatConfig` resolves `scoringDirection` to `'normal'` when `scoringUnit`
is `'venues'`, so every reader of a resolved format (the engine, the pad's `scoreOnPad`,
`bout-flow.ts`) sees one answer, and the editors hide the direction select in venues mode. The
resolve happens at read only (`formatInForce`); a write stores the organiser's direction as set
(`parseMatchFormatConfig`), so a countdown Tournament that tries venues and goes back to points
counts down again, and a ruleset forced to points (`scoredMatchFormat`) plays its stored
direction. A write-time refusal was rejected: the API's `matchFormatSchema` is a partial PATCH shape and
`MatchFormatConfigSchema.shape` is read elsewhere, so neither can carry a cross-field refine.

The field lives in the THREE places that must agree (see memory `reference_best_of_rounds`):
`@myclash/rules` `MatchFormatConfig` interface, `@myclash/rulesets` `MatchFormatConfigSchema`
(compile-time `Exact` check at `packages/rulesets/src/match-format.ts:226-227`), and the API
`matchFormatSchema` in `events.dto.ts` (`.strict()`). **Trap:** `normalizeMatchFormatConfig`
(`packages/rulesets/src/match-format.ts:242-260`) silently drops keys missing from its
`hasSharedShape` list — the new keys must be added there.

### Score in venues mode

`computeMatchFormatScore` (`packages/rules/src/match-format.ts:707`) gains a `venues` branch:

- `clean` with a striker: +1 to the striker, +1 to a new `redVenuesWon` / `blueVenuesWon` count.
- `afterblow`, `double`, `no_exchange`: 0 points, no venue. Stats (`timesHit`, `targetPoints`,
  `doubles`) are computed as today, so fighter stats and pool indicators keep their meaning.
- Card points keep being added to the score exactly as today. A card is **not** a venue.
  _(my call — see "Calls I made")_

The venue count is new on `MatchScore`, counted from the exchange **type**, never from score
deltas (`timesHit` cannot stand in: an afterblow raises it). Formula rulesets reach this via
`computeMatchFormatScore` (`formula/ruleset.ts:152`), and so does TF_v1: its `computeMatchScore`
already calls it (`packages/rulesets/src/tf_v1/score.ts:60-72`), so one branch covers TF_v1, its
copies and formula rulesets with no extra routing. The `points` path is untouched (golden test).
Generic_PointsCap does not offer venues mode.

**Per-exchange pricing outside the scorer.** Two more places price an exchange from its button
value and must follow venues mode, or the log shows "+2" while the board moves by 1:

- server delta on exchange save, `red/blue_score_delta`
  (`apps/api/src/modules/matches/matches.service.ts:1190-1219`), read by the exchange log and
  the public fighter exchange stats views (migrations 0128, 0136, 0189);
- pad `localDeltas` / `provisionalDeltas` (`apps/web-staff/src/offline/pending-events.ts:35-57`,
  `:341-367`).

### When a round ends — one owner

`roundOutcome` (`packages/rules/src/match-format.ts:920`) is the single decision point; the
server single-bout path (`endOnPointCapOrMaxDoubles` → `isMatchOver`), the server best-of path
(`evaluateRound` / `recomputeBestOfRounds`) and the pad (`padSeries` → `roundOutcome`,
`apps/web-staff/.../offline/pad-series.ts:354`) all already ask it.

In venues mode, with `remaining = N − (redVenuesWon + blueVenuesWon)`:

- **stopWhenDecided = true**: the round ends when `|redScore − blueScore| > remaining`.
- **stopWhenDecided = false**: the round ends when `remaining = 0`.
- Ended round: the leader on score wins. A level board when the round ends (only possible with
  an even N, or with card points) follows the rule a level board at the point cap follows
  (`pointCapEndsBout`): a phase whose chain allows a level end (`chainAllowsLevelEnd`, a pool's
  `draw`) ends it as a draw; any other phase keeps the round open, and the next won venue puts
  someone ahead and ends it.
- New end reason `'venue_limit'` added to `RoundEvaluation.endReason`, `MatchEndDecision.reason`
  and the winner branch in `endWinnerRegistrationId` (`scoring.service.ts:644-660`), AND every
  other list that names `'first_to_points'`: `matches/correction-outcome.ts:70`,
  `matches/closed-round-correction.ts:30`, `web-staff/src/offline/db.ts:130`,
  `web-staff/src/components/end-guard.ts:57`, `web-public/.../match/[matchId]/match-row.ts:29`.
  No DB constraint on `end_reason` (`0096_matches_end_reason.sql:22`).
- The max-doubles ceiling keeps its place in the order (pool/Swiss only, as today).

The rule "lead greater than remaining venues" also covers cards: a card point can make a lead
uncatchable earlier, or keep a 3-venues-to-0 round open if card points narrowed it.

### Clock

Unchanged. The clock is the anti-stalling backstop: when time runs out before the round ends,
`timeLimitResult` / `endRoundOnTime` apply as today (leader wins, level → level-at-time chain).
The organiser sets the time limit as today.

### Pad buttons (ruling 5)

In venues mode the pad shows one "Touch" button per side instead of the target buttons; the
afterblow, double and no-exchange actions stay (an afterblow is still recorded, it just wins no
venue). Buttons are seeded once into `tournaments.scoring_config_json.buttons` at Tournament
creation (`buildScoringButtons`, `packages/types/src/scoring-config.ts:328`). Venues mode does
not re-seed them: the pad derives its buttons AT READ through one function, `buttonsInForce`,
called in `rulesOnPad` (`apps/web-staff/src/lib/bout-rules.ts`), the one place the pad gets its
buttons and its match format. Switching the mode back and forth therefore needs no write. The
button is labelled `+1` like every other clean button (no new word to translate). A clean hit is
stored with value 1. The server
still prices a venues-mode clean hit as 1 whatever value arrives (a pad holding stale buttons
cannot inflate a score), so `targetPoints`, `timesHit`, the stored deltas, the standings
(`formula/derive-stats.ts:66-68`, TF_v1 ranking) and the public stats views all read 1 per venue
with no view migration.

### Offline pad

- The pad does NOT use the shared scorer: `roundCount` (`pad-series.ts:245-265`) takes the
  server's score row and adds queued hits through `provisionalDeltas`. Venues mode changes the
  queued-hit pricing (above) and adds a venue count by exchange-type filter, the way doubles are
  counted today (`pad-series.ts:253-264`).
- Single-round bouts: the pad never auto-ends one today; `end-guard.ts` (`limitEnd`, `endIsEarly`)
  must treat "venue limit reached" as a legitimate end, not an early one.
- Offline E2E specs (`06`, `08`, `40`, `pad-offline-drill`) must stay green; add one offline
  case for a venues bout.

### UI (web-admin) and i18n

- Ruleset editor `RulesetMatchFormatBox.tsx` (+ `ruleset-own-values.ts`), Tournament wizard
  `Step2MatchFormat.tsx`, settings `MatchFormatTab.tsx`, shared `match-format-form.ts`: a
  "Points / Venues" choice; in venues mode show "won venues per round" per phase and "stop when
  decided"; hide the point cap.
- All strings in `en` and `fr` (hard rule 6). FR term: « venue ».

## Calls I made (operator to check)

1. **Cards are not venues, but their points count.** A penalty that gives a point to the
   opponent adds to the score as today; it never fills one of the N venues. Early stop uses
   "lead > remaining venues", so a card can decide a round early.
2. **N per phase**, mirroring `bestOf` (e.g. pool 5 single round, finals Bo3 of 5).
3. **Default N = 5, early stop on.**
4. **Any positive N is allowed**, even values; an even N can end level: a draw in a pool, and
   the next won venue decides it elsewhere.
5. **A venues bout always counts up**; the countdown direction is resolved away, not refused.
6. **Afterblow mode is ignored** in venues mode (an afterblow is never a won venue).
7. **Venues mode is available wherever the match format is editable** (TF_v1 copies, club
   formula rulesets, a Tournament's match format). Built-in TF_v1's defaults stay `points`, so
   the golden test is untouched.

## Left to the builder

- Exact type names and where the venue count sits on `MatchScore`.
- Test layout; each rule above gets a test that can go red (CLAUDE.md "Verification").

## Verification

- Unit: `@myclash/rules` — venues scoring (each exchange type), `roundOutcome` for both early-stop
  values, level at N, cards, max-doubles interplay; schema round-trip incl. `normalizeMatchFormatConfig`.
- API: single-round and Bo3 venues bout auto-close; `venue_limit` winner; reopen.
- TF_v1 golden test unchanged.
- Offline: the four offline specs + a new venues offline case.
- Full `myclash-gates` chain before push.
