/**
 * The bout shapes the competition core reasons about.
 *
 * These are the MINIMAL forms — enough to derive a result, and no more. The full
 * row shapes, with their database columns and their optional display fields,
 * stay in `@myclash/types`. Keeping the minimal ones here is what lets a test
 * call any rule with a plain object literal instead of a fixture.
 *
 * They lived in `@myclash/rulesets/src/types.ts`, which meant the arithmetic
 * that reads them had to live beside zod. It does not need zod.
 */

export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';
export type StrikerColor = 'red' | 'blue' | null;

/** `phases.type` — the four values the DB CHECK constraint allows. */
export type PhaseType = 'pool' | 'single_elim' | 'double_elim' | 'swiss';

export interface Exchange {
  id: string;
  clientUuid: string;
  matchId: string;
  sequence: number;
  type: ExchangeType;
  occurredAt: string;
  firstStrikerColor: StrikerColor;
  /**
   * The target's value, as the referee pressed it. `1 | 2` was a lie: the DTO
   * accepts 1..10 (`MAX_AUTHORED_TARGET_VALUE`), the column is a plain INTEGER
   * with no CHECK, and the pad has typed these as `number` all along. The
   * arithmetic that reads them never cared — it sums whatever it is given.
   *
   * The same wrong assumption is ALSO in SQL, and there it is a live defect
   * rather than a type lie: `fighter_exchange_stats` buckets values 1, 2 and 3
   * by hand (migration 0136), so a 4-point target is invisible in every stats
   * column today. Fixing that needs a migration and is not this change.
   */
  firstStrikeValue: number | null;
  afterblowValue: number | null;
  noExchangeReason: string | null;
  voided: boolean;
}

export interface Match {
  id: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  rulesetCode: string;
  rulesetVersion: string;
  status: 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';
  phaseType?: PhaseType;
  matchNumberLabel?: string | null;
}

/**
 * A finished bout, as the standings maths reads it: who fought, who won, and
 * what happened in it.
 *
 * Every ruleset used to reach these two extra fields through a cast --
 * `(match as Match & { exchanges?: Exchange[]; winnerRegistrationId?: string })`
 * -- because `Match` carries neither, and the API then built a `Match` it did
 * not have by casting a PostgREST row through `as unknown as`. Naming the shape
 * that was actually being passed removes both.
 *
 * There is no `status`: a caller passes COMPLETED bouts. Every implementation
 * used to filter for that itself, and the API's only caller had already
 * filtered, so the field existed to be re-checked and never to be false.
 *
 * ── A disagreement this type used to carry ─────────────────────────────────
 * TF_v1 and Generic_PointsCap read `winnerRegistrationId` to count a win, while
 * the formula ruleset called the bout by a score it RE-DERIVED from `exchanges`
 * — so the two disagreed about every bout awarded against the points. This
 * paragraph used to say that was real and unfixed. It is fixed: every scorer
 * reads the bout's own result through `boutOutcomes`, and the stored scores are
 * on the type so none of them has to reconstruct one.
 *
 * The two score pairs here are NOT interchangeable, which is why both exist.
 * `redScore`/`blueScore` are what the board finished on — penalties applied, the
 * doubles ceiling's zeroing applied, a forfeit's policy applied. Anything summed
 * from `exchanges` sees none of that and answers a different question: how many
 * hits were landed.
 */
export interface ScoredMatch {
  id: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  winnerRegistrationId: string | null;
  /**
   * `matches.end_reason` — 'max_doubles' means BOTH fighters LOST.
   *
   * Needed here because neither of the two fields above can express it: a
   * double loss has no winner AND no points, so a scorer reading either one
   * calls it a draw. The other max-doubles reasons carry their own outcome
   * (`max_doubles_draw` is a real draw, `max_doubles_result_stands` names a
   * winner) and need no special case.
   */
  endReason: string | null;
  /**
   * The bout's STORED scores — what the board finished on, penalties and the
   * ceiling's zeroing included. Distinct from anything re-derived from
   * `exchanges` below, which sees none of that.
   */
  redScore: number | null;
  blueScore: number | null;
  exchanges: Exchange[];
}

export interface MatchScore {
  redScore: number;
  blueScore: number;
  /** Derived aggregates for display */
  redWins: number;
  blueWins: number;
  redTargetPoints: number;
  blueTargetPoints: number;
  redTimesHit: number;
  blueTimesHit: number;
  doubles: number;
}
