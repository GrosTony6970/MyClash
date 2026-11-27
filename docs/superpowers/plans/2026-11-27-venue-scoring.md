# Venue Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `venues` scoring mode in the match format: each clean hit wins its venue and 1 point, and a round ends when N venues have a winner (or as soon as it is decided, if the organiser chose that).

**Architecture:** Three new match-format fields. One shared per-exchange pricer (`exchangeDeltas`) in `@myclash/rules` replaces the three copies (scorer, server delta, pad queue). The round-end decision stays in its one owner, `roundOutcome`, which gains a venue branch the server and the pad both already reach. The pad derives its buttons at read (`buttonsInForce`).

**Tech Stack:** TypeScript, Zod, Vitest, NestJS (`apps/api`), Next.js (`apps/web-admin`, `apps/web-staff`), Playwright (offline E2E), pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-11-27-venue-scoring-design.md`. Read it first; this plan argues from it.

## Global Constraints

- `scoringUnit` defaults to `'points'`. A config without the new keys behaves byte-for-byte as today. The TF_v1 golden test (`packages/rulesets/test/tf_v1.fal2026.test.ts`) must stay green unchanged (hard rule 2).
- Venue = a non-voided `clean` exchange with a `firstStrikerColor`. Afterblow, double and no_exchange win no venue and score 0 in venues mode, whatever the button values or the afterblow mode.
- `venuesPerRound` default `{ pool: 5, bracket: 5, finals: 5 }`, `swiss` optional → falls back to `pool`. Positive integers, max 50.
- `stopWhenDecided` default `true`.
- New end reason literal: `'venue_limit'`.
- Every user-facing string in `en` AND `fr` (hard rule 6). FR word: « venue ».
- Offline specs stay green: `tests/e2e/06-offline-sync.spec.ts`, `08-offline-custom-ruleset.spec.ts`, `40-offline-bout.spec.ts`, `tests/a11y/pad-offline-drill.spec.ts` (hard rule 3).
- Commits: one task = one commit. Write the message to a file and `git commit -F <file>`. Stage explicit paths, never `git add -A`. Check `git log --oneline -1` before staging. No heredocs.
- After editing `packages/rules`, `packages/rulesets` or `packages/types`, rebuild their `dist` (`pnpm --filter <pkg> build`) before running a consumer's tests: the consumers read `dist`.

## Review Focus

1. **A card around the limit.** Red leads 3-0 in venues out of 5 with early stop on, then a card gives Blue 2 points: 3-2 with 2 venues left, so the round stays open. Expected: the rule reads the carded score. → test in Task 1.
2. **A tablet with old target buttons.** It sends a clean hit worth 2 in a venues bout. Expected: the server stores and scores 1, and the tablet's provisional score also moves by 1. → tests in Task 2 and Task 3.
3. **A config that holds only the new key.** A ruleset stores `{ scoringUnit: 'venues' }` alone (operator ruling 59: a ruleset stores only the changed keys). Expected: it survives `normalizeMatchFormatConfig`, which today drops a key missing from `hasSharedShape`. → test in Task 1.
4. **A correction under the limit.** A completed `venue_limit` bout has one won venue voided, so only 4 of 5 venues are now won. Expected: the bout is decided again like a `first_to_points` bout. It is in `DECIDED_ON_THE_BOARD`. → test in Task 2.
5. **An even N, level, in a bracket.** 2-2 out of 4. Expected: the round stays open and the next won venue ends it. In a Pool, the same board is a draw. → test in Task 1.

---

### Task 1: Engine and config (`@myclash/rules`, `@myclash/rulesets`)

**Files:**

- Modify: `packages/rules/src/domain.ts` (`MatchScore`)
- Modify: `packages/rules/src/match-format.ts` (`MatchFormatConfig`, `computeMatchFormatScore`, `RoundEvaluation`, `roundOutcome`, new helpers)
- Modify: `packages/rules/src/afterblow.ts` (new `exchangeDeltas`, beside `computeAfterblowDeltas`)
- Modify: `packages/rules/src/index.ts` and `packages/rules/src/pad.ts` (export `exchangeDeltas`, `getEffectiveVenuesPerRound`, type `ScoringUnit`)
- Modify: `docs/ARCHITECTURE.md` §7.3 table (row for each new `/pad` export, with its reason)
- Modify: `packages/rulesets/src/match-format.ts` (`MatchFormatConfigSchema`, `DEFAULT_MATCH_FORMAT_CONFIG` if it lists fields, `normalizeMatchFormatConfig`)
- Modify: `packages/rulesets/src/types.ts:55` (`MatchEndDecision.reason` gains `'venue_limit'`)
- Modify: `packages/rulesets/src/generic_points_cap/index.ts` (its `MatchScore` gains the venue counts, counted the same way)
- Test: `packages/rules/src/venues.test.ts` (new), fix literals in `packages/rules/src/round-outcome.test.ts` and other `MatchScore` literals that `pnpm typecheck` names
- Test: `packages/rulesets/src/match-format.test.ts` (or the existing normalize test file — find it with `grep -l normalizeMatchFormatConfig packages/rulesets/src/*.test.ts`)

**Interfaces:**

- Produces (`@myclash/rules`):
  - `type ScoringUnit = 'points' | 'venues'`
  - `MatchFormatConfig` gains `scoringUnit: ScoringUnit; venuesPerRound: ByPhase<number>; stopWhenDecided: boolean`
  - `MatchScore` gains **required** `redVenuesWon: number; blueVenuesWon: number`. They are counted in every mode (in points mode they are just the clean hits).
  - `getEffectiveVenuesPerRound(match: Pick<Match, 'phaseType' | 'matchNumberLabel'>, config: MatchFormatConfig): number` goes through the private `forPhase`.
  - `exchangeDeltas(ex: Pick<Exchange, 'type' | 'firstStrikerColor' | 'firstStrikeValue' | 'afterblowValue'>, afterblowMode: AfterblowMode, unit: ScoringUnit): { red: number; blue: number; venue: 'red' | 'blue' | null }`. This is the ONE per-exchange pricer. Points mode: today's arithmetic (clean = button value to the striker; afterblow through `computeAfterblowDeltas`; double and no_exchange = 0). Venues mode: clean = 1 to the striker; everything else 0. `venue` = the striker of a clean hit, in both modes.
  - `RoundEvaluation.endReason` gains `'venue_limit'`.
  - `roundOutcome`'s `score` param becomes `CapScore & Pick<MatchScore, 'doubles' | 'redVenuesWon' | 'blueVenuesWon'>`.
- Produces (`@myclash/rulesets`): the schema fields and `MatchEndDecision.reason` with `'venue_limit'`.

- [ ] **Step 1: Write the failing tests** in `packages/rules/src/venues.test.ts`. Reuse the `config()` helper shape from `round-outcome.test.ts`, with `scoringUnit: 'venues', venuesPerRound: { pool: 5, bracket: 5, finals: 5 }, stopWhenDecided: true`.
  - `computeMatchFormatScore scores 1 per clean hit whatever the button`: exchanges clean red value 2, clean blue value 1, afterblow red 2-1, double, no_exchange → `redScore 1, blueScore 1, redVenuesWon 1, blueVenuesWon 1, doubles 1`.
  - `afterblow wins no venue in full mode either`: one afterblow red 1-1, `afterblowMode 'full'` → `redScore 0, blueScore 0, redVenuesWon 0`.
  - `points mode counts venues without changing the score`: the first case with `scoringUnit 'points'` → the same scores as today (red 2 + afterblow netting, blue 1), `redVenuesWon 1, blueVenuesWon 1`.
  - `exchangeDeltas` table: one `it.each` row per type × unit, asserting `{ red, blue, venue }`.
  - `roundOutcome stops a decided round`: POOL, `{ redScore: 3, blueScore: 0, doubles: 0, redVenuesWon: 3, blueVenuesWon: 0 }` → `{ autoOver: true, winnerColor: 'red', endReason: 'venue_limit' }`.
  - `roundOutcome plays on when early stop is off`: same board, `stopWhenDecided: false` → `OPEN`; at `4-1` with venues `4/1` → over, red.
  - `a card keeps a round open` (Review Focus 1): `{ redScore: 3, blueScore: 2, redVenuesWon: 3, blueVenuesWon: 0 }` → `OPEN` (lead 1, remaining 2).
  - `a card can decide a round early`: `{ redScore: 4, blueScore: 0, redVenuesWon: 2, blueVenuesWon: 0 }` → over, red (lead 4 > remaining 3).
  - `an even N level in a bracket stays open, in a pool is a draw` (Review Focus 5): N 4, `2-2`, venues `2/2` → BRACKET `OPEN`; POOL `{ autoOver: true, winnerColor: null, endReason: 'venue_limit' }`. Then BRACKET `3-2`, venues `3/2` → over, red.
  - `the point cap is not read in venues mode`: `pointCap: 2`, board `2-0`, venues `2/0` → `OPEN`.
  - `the doubles ceiling still ends a pool round`: venues `1/0`, `doubles: 3`, `maxDoubleHits: 3` → `endReason: 'max_doubles'`.
  - `getEffectiveVenuesPerRound` reads per phase; a Swiss bout with no `swiss` value reads `pool`.

- [ ] **Step 2: Write the failing schema tests** in the rulesets normalize test file.
  - `a format holding only scoringUnit keeps it` (Review Focus 3): `normalizeMatchFormatConfig({ scoringUnit: 'venues' }).scoringUnit === 'venues'`. Repeat for `{ venuesPerRound: { pool: 7, bracket: 5, finals: 5 } }` and `{ stopWhenDecided: false }`.
  - `venues always counts up`: `normalizeMatchFormatConfig({ scoringUnit: 'venues', scoringDirection: 'reverse_zero_loses' }).scoringDirection === 'normal'`; with `scoringUnit: 'points'` the direction stays `reverse_zero_loses`.
  - `an old config resolves to points`: `normalizeMatchFormatConfig({ pointCap: 10 })` has `scoringUnit 'points'`, `venuesPerRound { pool: 5, bracket: 5, finals: 5 }` and `stopWhenDecided true`.

- [ ] **Step 3: Run the tests and see them fail**
      Run: `pnpm --filter @myclash/rules test -- venues` and `pnpm --filter @myclash/rulesets test -- match-format`
      Expected: FAIL. The new fields and functions do not exist.

- [ ] **Step 4: Implement.**
  - Add the fields to the interface and to `MatchFormatConfigSchema` with the defaults above, mirroring `BestOfConfigSchema` for `venuesPerRound` (`swiss` `.optional()`, the others `.default(5)`, `int().positive().max(50)`). The `Exact` check at `packages/rulesets/src/match-format.ts:226-227` forces the two to agree.
  - Add `'scoringUnit' in raw || 'venuesPerRound' in raw || 'stopWhenDecided' in raw` to `hasSharedShape`, with a one-line comment that names the trap.
  - Resolve the direction at the end of both `normalizeMatchFormatConfig` branches: venues → `scoringDirection: 'normal'`.
  - `computeMatchFormatScore` loops through `exchangeDeltas(ex, afterblowMode, config.scoringUnit)` for the scores and the venue counts. Keep `targetPoints` and `timesHit` exactly as they are computed today (they are stats). In venues mode `targetPoints` must equal the venue's 1, not the button value: add the venue delta, not `firstStrikeValue`. The doubles count and the max-doubles wipe stay as they are.
  - Add the venue branch to `roundOutcome`. It sits in the place of the cap check when `config.scoringUnit === 'venues'`. Pseudocode, because the order matters:

```ts
const n = getEffectiveVenuesPerRound(match, config);
const remaining = n - (score.redVenuesWon + score.blueVenuesWon);
const lead = Math.abs(score.redScore - score.blueScore);
if (remaining <= 0 || (config.stopWhenDecided && lead > remaining)) {
  const leader = leadingColor(score);
  if (leader) return { autoOver: true, winnerColor: leader, endReason: 'venue_limit' };
  if (chainAllowsLevelEnd(config, match.phaseType, match.matchNumberLabel)) {
    return { autoOver: true, winnerColor: null, endReason: 'venue_limit' };
  }
}
return atTheCeiling ? ceiling : OPEN;
```

- Export `exchangeDeltas`, `getEffectiveVenuesPerRound` and `ScoringUnit` from `index.ts` and from the `/pad` door (`pad.ts`). Add one row per export to the ARCHITECTURE.md §7.3 table ("the pad prices a queued hit with the server's pricer"; "the pad reads N for the round it closes").
- Fix every `MatchScore` literal that `pnpm --filter @myclash/rules typecheck` and `pnpm --filter @myclash/rulesets typecheck` name. Generic_PointsCap counts the venues with `exchangeDeltas(...).venue`.

- [ ] **Step 5: Run the tests and see them pass**
      Run: `pnpm --filter @myclash/rules test` then `pnpm --filter @myclash/rules build`, then `pnpm --filter @myclash/rulesets test` (the golden test included).
      Expected: all PASS. `tf_v1.fal2026.test.ts` passes untouched.

- [ ] **Step 6: Falsify.** Delete the `'scoringUnit' in raw` line and watch Review Focus 3 go red. Then delete the `stopWhenDecided &&` guard and watch "plays on when early stop is off" go red. Restore with `git restore` on each file (not a reverse edit).

- [ ] **Step 7: Commit** `packages/rules/src/**`, `packages/rulesets/src/**` (explicit paths) and `docs/ARCHITECTURE.md`. Message: `feat(rules): a round can end on a number of won venues`.

---

### Task 2: Server (`apps/api`)

**Files:**

- Modify: `apps/api/src/modules/events/dto/events.dto.ts:281` (`matchFormatSchema` gains the three keys; `.strict()` 400s without them)
- Modify: `apps/api/src/modules/admin/custom-rulesets/match-format-defaults.ts:15-21` (`venuesPerRound` joins the phased key lists)
- Modify: `apps/api/src/modules/matches/matches.service.ts:1190-1219` (`computeDeltas` becomes a call to `exchangeDeltas` with the bout's resolved `scoringUnit`)
- Modify: `apps/api/src/modules/matches/scoring.service.ts:644-660` (`endWinnerRegistrationId`: `'venue_limit'` names the leader, like `max_doubles_result_stands`)
- Modify: `apps/api/src/modules/matches/correction-outcome.ts:70` (`'venue_limit'` in `DECIDED_ON_THE_BOARD`)
- Modify: `apps/api/src/modules/matches/closed-round-correction.ts:30` (union gains `'venue_limit'`)
- Test: `apps/api/src/modules/matches/venue-scoring.test.ts` (new); extend the DTO test that covers `bestOf` on `matchFormatSchema` (`grep -l "bestOf" apps/api/src/modules/events/**/*.test.ts`)

**Interfaces:**

- Consumes: `exchangeDeltas`, `ScoringUnit`, `'venue_limit'` from Task 1.
- Produces: `red/blue_score_delta` stored at 1 per venue in venues mode. A completed venues bout stores `end_reason = 'venue_limit'` and its winner.

- [ ] **Step 1: Write the failing tests** in `venue-scoring.test.ts`. Build the bout with the same fixtures `round-advance.fixtures.ts` and the single-fight scoring tests use.
  - `a single venues bout completes at its limit`: pool bout, N 3, early stop off, three clean hits (red, blue, red) → completed, `end_reason 'venue_limit'`, winner red, score 2-1.
  - `a best-of venues round closes and the series completes`: bracket Bo3, N 3, early stop on; red wins two clean hits in round 1 → round 1 closes to red (`awaiting_round_advance`); the same in round 2 → completed, winner red.
  - `the server prices a stale button as 1` (Review Focus 2): a clean hit posted with `firstStrikeValue: 2` in a venues bout → the stored `red_score_delta` is 1 (assert the insert payload) and the score is 1.
  - `an afterblow posted in venues mode stores 0/0`, in `full` mode.
  - `a voided venue re-decides the bout` (Review Focus 4): a completed `venue_limit` bout at 3/3; void one clean hit → `correctionOutcome` does not return `unchanged` (the bout is decided again).
  - DTO: `PATCH` match format with `{ scoringUnit: 'venues', venuesPerRound: { pool: 5, bracket: 5, finals: 5 }, stopWhenDecided: false }` parses. `{ scoringUnit: 'goals' }` is refused.

- [ ] **Step 2: Run and see them fail**
      Run: `pnpm --filter @myclash/api test -- venue-scoring` (run it directly; turbo caches `api#test`).
      Expected: FAIL.

- [ ] **Step 3: Implement.** `computeDeltas(dto, afterblowMode, scoringUnit)` returns `exchangeDeltas(...)` mapped to `{ redDelta, blueDelta }`. Read `scoringUnit` from the bout's resolved match format, the same one the scorer reads (`scoredMatchFormat`), and do not add a second read of the tournament. Add the `'venue_limit'` branch, the list entry and the union member above.

- [ ] **Step 4: Run and see them pass.** Run `pnpm --filter @myclash/api test` (full), then `pnpm --filter @myclash/api typecheck`.

- [ ] **Step 5: Falsify** Review Focus 2: pass `'points'` instead of the resolved unit, and watch the stale-button test go red. Then `git restore`.

- [ ] **Step 6: Regenerate the OpenAPI client** if the DTO change alters `packages/api-client/src/generated/schema.ts` (the `myclash-gates` skill names the command). **Commit.** Message: `feat(api): a venues bout is priced and ended by its won venues`.

---

### Task 3: Scoring pad, offline (`apps/web-staff`)

**Files:**

- Modify: `packages/types/src/scoring-config.ts` (new `buttonsInForce`)
- Modify: `apps/web-staff/src/lib/bout-rules.ts` (`rulesOnPad` returns `buttonsInForce(...)` in BOTH branches)
- Modify: `apps/web-staff/src/offline/pending-events.ts:35-57` (`localDeltas` calls `exchangeDeltas`; `pendingRowsForMatch` args gain `scoringUnit: ScoringUnit`)
- Modify: `apps/web-staff/src/hooks/useMatchScoringData.ts:166` (pass `scoringUnit` from the bout's `matchFormat`, threaded from the caller that holds `rulesOnPad`'s result)
- Modify: `apps/web-staff/src/offline/pad-series.ts` (`roundCount` and `singleRound` add `redVenuesWon` and `blueVenuesWon`: server rows of the round plus queued rows, filtered `type === 'clean' && scoringSide`, as `doubles` is counted)
- Modify: `apps/web-staff/src/components/end-guard.ts` (`EndBoard` gains the venue counts; `LimitReason` excludes `'venue_limit'`; `endIsEarly` and `endRefusedOnPad` return "not early / not refused" when `roundOutcome(...).endReason === 'venue_limit'`)
- Modify: `apps/web-staff/src/offline/db.ts:130` (`LimitReason` excludes `'venue_limit'` too: it is not a wipe)
- Test: `packages/types/src/scoring-config.test.ts`, `apps/web-staff/src/offline/pad-series.venues.test.ts` (new), `apps/web-staff/src/offline/pending-events.test.ts`, `apps/web-staff/src/components/end-guard.test.ts`
- Test: `tests/e2e/40-offline-bout.spec.ts` gains one venues case (or a new `tests/e2e/41-offline-venues.spec.ts`, seeded the way 40 seeds)

**Interfaces:**

- Consumes: `exchangeDeltas`, `ScoringUnit`, `roundOutcome` with venue counts (Task 1, via the `/pad` door re-exported by `@myclash/types`).
- Produces: `buttonsInForce(buttons: ScoringButtonConfig, unit: ScoringUnit): ScoringButtonConfig`. Venues mode returns `clean: [{ label: '+1', value: 1, visible: true }]`, and `afterblow: [{ label: '1-1', attackerPts: 1, defenderPts: 1, visible: true }]` when `buttons.afterblow` is non-empty, else `[]`. Points mode returns `buttons` unchanged (the same reference).

- [ ] **Step 1: Write the failing unit tests.**
  - `buttonsInForce`: points → the same object (`toBe`); venues → the one-button shape above; venues on a grammar without afterblow → `afterblow: []`.
  - `rulesOnPad` in venues mode → `scoringConfig.buttons.clean` has length 1, value 1.
  - `pendingRowsForMatch` (Review Focus 2): a queued clean hit with `firstStrikeValue: 2`, `scoringUnit: 'venues'` → row `scoreDelta 1`; a queued afterblow 2-1 → `scoreDelta 0, defenderDelta 0`.
  - `padSeries` venues: Bo3, N 3, early stop on; server rows give red 1 venue in round 1, the queue holds one more red clean hit → round 1 closes for red on the tablet (`tabletRound`), with no network.
  - `padSeries` single round: N 3, three clean hits queued → `redVenuesWon + blueVenuesWon === 3` on the current round.
  - `endIsEarly` returns false and `endRefusedOnPad` returns null at a level pool board at the venue limit with time left. `pressedOn` at the venue limit keeps the board (no wipe) and names the leader.

- [ ] **Step 2: Run and see them fail.** Run `pnpm --filter @myclash/types test` and `pnpm --filter @myclash/web-staff test -- pad-series pending-events end-guard`.

- [ ] **Step 3: Implement** the changes listed under Files. Rebuild `@myclash/types` (`pnpm --filter @myclash/types build`) before the web-staff tests.

- [ ] **Step 4: Run and see them pass.** Then run `pnpm --filter @myclash/web-staff typecheck`.

- [ ] **Step 5: Offline E2E.** Add the venues case: an offline single-round pool bout with N 3 and early stop off. Score three clean hits with the network cut, press End, reconnect. Expected: the bout lands `completed`, `end_reason 'venue_limit'`, score 2-1. Run the four offline specs plus the new case on the local stack (memory `reference_local_offline_e2e_run`).

- [ ] **Step 6: Falsify** the pricer: make `localDeltas` ignore `scoringUnit` and watch the stale-button test go red. Then `git restore`.

- [ ] **Step 7: Commit.** Message: `feat(pad): a venues bout runs offline, one +1 button per side`.

---

### Task 4: "Venues 3/5" counter on the pad and the TV scoreboard (`packages/ui`, `apps/web-staff`)

Added by the operator on 2026-11-27, after the plan was approved.

**Files:**

- Create: `packages/ui/src/utils/venues-won.ts` (one shared counter)
- Modify: `packages/ui/src/components/TVScoreboard.tsx` (~line 403, beside the round counter)
- Modify: `apps/web-staff/src/components/MatchHeader.tsx` (~line 186, beside the round counter)
- Modify: `apps/web-staff/src/offline/pad-series.ts` (its venue filter from Task 3 calls `isWonVenue`, so the pad's count and the counter agree)
- Modify: `packages/i18n/src/messages/en/scoring.ts` and `fr/scoring.ts` (beside `rounds.counter`)
- Test: `packages/ui/src/utils/venues-won.test.ts`, the existing TVScoreboard test (`grep -l TVScoreboard packages/ui/src --include=*.test.*`), `apps/web-staff/src/components/MatchHeader.test.tsx` (create if none)

**Interfaces:**

- Consumes: `getEffectiveVenuesPerRound` and `MatchFormatConfig.scoringUnit` (Task 1, through `@myclash/types`), the pad's per-round venue counts (Task 3).
- Produces: `isWonVenue(row: Pick<ExchangeRow, 'type' | 'voided' | 'scoringSide'>): boolean` (non-voided `clean` with a `scoringSide`) and `venuesWonInRound(rows: readonly ExchangeRow[], round: number): number` (rows with `(round_number ?? 1) === round` that pass `isWonVenue`).

- [ ] **Step 1: Write the failing tests.**
  - `venuesWonInRound`: rows of round 1 = clean red, clean blue, afterblow, double, no_exchange, voided clean red; one row of round 2 = clean red → round 1 gives 2, round 2 gives 1. A row with no `round_number` counts in round 1.
  - TVScoreboard: in a venues bout (`matchFormat.scoringUnit 'venues'`, `venuesPerRound.pool 5`, pool phase) with 3 won venues in the current round, the text `Venues 3/5` renders. In a points bout no venues counter renders.
  - MatchHeader: the same two cases, from the pad's current-round count.

- [ ] **Step 2: Run and see them fail.** Run `pnpm --filter @myclash/ui test -- venues-won TVScoreboard` and `pnpm --filter @myclash/web-staff test -- MatchHeader`.

- [ ] **Step 3: Implement.**
  - The i18n key is `scoring.rounds.venuesCounter`: EN "Venues {won}/{total}" / FR « Venues {won}/{total} ».
  - The TV shows the counter when `match.matchFormat?.scoringUnit === 'venues'`, with `total = getEffectiveVenuesPerRound(match, match.matchFormat)` and `won = venuesWonInRound(exchanges, match.currentRound ?? 1)`. It uses the same pill markup and token classes as the round counter beside it.
  - The pad passes MatchHeader its current round's `redVenuesWon + blueVenuesWon` from `padSeries`, so queued offline hits count, and shows the counter in venues mode only.

- [ ] **Step 4: Run and see them pass.** Then run `pnpm --filter @myclash/ui build`, and `pnpm --filter @myclash/i18n test` directly.

- [ ] **Step 5: Commit.** Message: `feat(scoring): a venues bout shows how many venues are won`.

---

### Task 5: Organiser screens and words (`apps/web-admin`, `packages/i18n`, `apps/web-public`)

**Files:**

- Modify: `apps/web-admin/src/components/rulesets/RulesetMatchFormatBox.tsx`, `ruleset-own-values.ts` (`venuesPerRound` is phased like `bestOf`)
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/_shared/match-format-form.ts`, `.../new/_wizard/Step2MatchFormat.tsx`, `.../[tournamentId]/settings/_components/MatchFormatTab.tsx`
- Modify: `packages/i18n/src/messages/en/organizer.ts` and `fr/organizer.ts` (beside `bestOfPool`), and `en/admin.ts` / `fr/admin.ts` (beside `pointCapLabel`)
- Modify: `apps/web-public/app/e/[eventSlug]/match/[matchId]/match-row.ts:29` (union gains `'venue_limit'`)
- Test: `apps/web-admin/src/components/rulesets/ruleset-own-values.test.ts`, the existing `match-format-form` test (`grep -l match-format-form apps/web-admin -r --include=*.test.ts`)

**Interfaces:**

- Consumes: the three config fields (Task 1), the DTO keys (Task 2).

- [ ] **Step 1: Write the failing tests.**
  - `ruleset-own-values`: `venuesPerRound.pool` is an own value when set and is read from the schema default when not (mirror the `bestOfPool` cases).
  - `match-format-form`: a form in venues mode sends `scoringUnit`, `venuesPerRound` and `stopWhenDecided`, and does not send `pointCap` or `scoringDirection` changes. Switching back to points sends `scoringUnit: 'points'`.

- [ ] **Step 2: Run and see them fail.** Run `pnpm --filter @myclash/web-admin test -- ruleset-own-values match-format-form`.

- [ ] **Step 3: Implement.** Add a "Points / Venues" select (`scoringUnit`). In venues mode, show "Won venues per round" per phase (pool, bracket, finals; number 1-50) and "Stop as soon as the round is decided" (checkbox), and hide the point cap and the scoring direction. Keys (EN / FR):
  - `scoringUnitLabel`: "Score by" / « Score par »
  - `scoringUnitPoints`: "Points (target values)" / « Points (valeur des cibles) »
  - `scoringUnitVenues`: "Venues (1 per won exchange)" / « Venues (1 par venue gagnée) »
  - `venuesPerRoundPool`, `venuesPerRoundBracket`, `venuesPerRoundFinals`: "Pool won venues per round" / « Venues gagnées par manche (poule) » (bracket « (tableau) », finals « (finales) »)
  - `stopWhenDecidedLabel`: "Stop the round as soon as it is decided" / « Arrêter la manche dès qu'elle est jouée »
  - `stopWhenDecidedHelp`: "Off: all won venues are fought, even when the result can no longer change." / « Désactivé : toutes les venues gagnées sont jouées, même quand le résultat ne peut plus changer. »
    Use only token classes, and copy the markup of the neighbouring `bestOf` fields (read `docs/design/known-deviations.md` first).

- [ ] **Step 4: Run and see them pass.** Then run the i18n sweep directly: `pnpm --filter @myclash/i18n test` (turbo caches it).

- [ ] **Step 5: Commit.** Message: `feat(web-admin): an organiser can score a Tournament by venues`.

---

### Task 6: Close the slice

**Files:**

- Modify: `docs/ARCHITECTURE.md` (the match-format section: the three fields, the venue rule in `roundOutcome`, `exchangeDeltas` as the one pricer, `buttonsInForce`)
- Move: `docs/superpowers/specs/2026-11-27-venue-scoring-design.md` → `docs/superpowers/archive/specs/`
- Delete: `docs/superpowers/plans/2026-11-27-venue-scoring.md`

- [ ] **Step 1:** Update ARCHITECTURE.md to say what the code does now.
- [ ] **Step 2:** Run the full `myclash-gates` chain. Expected: green. A red gate gets fixed or reported, not pushed.
- [ ] **Step 3:** Ask for a `code-architecture-reviewer` pass on the slice (CLAUDE.md routing). Fix what it confirms.
- [ ] **Step 4: Commit** the doc update, the spec move and the plan deletion. Message: `docs: venues scoring is built`. Run `git fetch` and rebase if needed, then push to `main`.
