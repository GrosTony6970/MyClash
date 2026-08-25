import { computeAggregates, isDoubleLossBout } from '@myclash/rulesets';
import type {
  Exchange,
  FighterAggregates,
  RankingRule,
  Ruleset,
  StandingsColumn,
} from '@myclash/rulesets';
import { applyRanking, type StandingsRow } from '@myclash/rules/results';
import type { PoolWithMembers } from './pool-rows';
import { poolScoresByRegistration } from './ruleset-scores';

/**
 * Turn a set of fighters and their completed bouts into ranked standings rows.
 *
 * Extracted verbatim from PoolStandingsService.computeRows so Swiss can reuse
 * the ruleset-driven half of a standings table — W/D/L, points for and against,
 * hits given and received, doubles, forfeits, and the ruleset's own `score` —
 * without reimplementing it and drifting.
 *
 * Takes a MEMBER LIST rather than a pool, because that is the only thing about
 * it that was pool-shaped. Everything else here is about fighters and results.
 *
 * The pool path must stay behaviour-identical through this move; that is what
 * pool-standings.service.test.ts guards.
 */

export type StandingsMember = PoolWithMembers['pool_members'][number];

export interface ComputeRowsInput {
  members: StandingsMember[];
  completedMatches: Array<{
    id: string;
    red_registration_id: string;
    blue_registration_id: string;
    red_score: number | null;
    blue_score: number | null;
    winner_registration_id: string | null;
    /** `matches.end_reason` — 'max_doubles' means BOTH fighters LOST. */
    end_reason: string | null;
  }>;
  columns: StandingsColumn[];
  rankingChain: RankingRule[];
  status: 'in_progress' | 'completed';
  exchangesByMatch: Map<string, Exchange[]>;
  forfeitCountByReg: Map<string, number>;
  /** Matches to score as a draw regardless of points (empty unless the policy is on). */
  drawnForfeitMatchIds: Set<string>;
  ruleset: Ruleset;
  runtimeConfig: unknown;
  /**
   * The TOURNAMENT's afterblow mode. Required: it changes every derived number,
   * and a default of 'full' against a product default of 'deductive' is how a
   * caller silently scores a bout the wrong way.
   */
  afterblowMode: 'full' | 'deductive';
  /**
   * Compute the ruleset's `score` even when the columns do not declare one.
   *
   * The POOL path leaves this false, which is what keeps its behaviour
   * byte-identical: it calls the ruleset only when a `score` column exists.
   * Swiss opts in independently, because ranking by the ruleset score is
   * offered on every ruleset — and when the ruleset declares no score column,
   * Swiss adds one to the display rather than ranking on a value the reader
   * cannot see.
   */
  forceScore?: boolean;
}

export function computeStandingsRows(input: ComputeRowsInput): StandingsRow[] {
  const {
    members,
    completedMatches,
    columns,
    rankingChain,
    status,
    exchangesByMatch,
    forfeitCountByReg,
    drawnForfeitMatchIds,
    ruleset,
    runtimeConfig,
    afterblowMode,
    forceScore = false,
  } = input;

  const statsByReg = new Map<string, Record<string, number>>();
  const declaresScore = columns.some((col) => col.key === 'score');
  // Per-fighter exchange aggregates (targetPoints/timesHit/doubles/wins),
  // accumulated across the bouts, and the source of the generic stat columns.
  const aggByReg = new Map<string, FighterAggregates>();
  for (const member of members) {
    const empty: Record<string, number> = {};
    for (const col of columns) {
      empty[col.key] = 0;
    }
    statsByReg.set(member.registration_id, empty);
    aggByReg.set(member.registration_id, { wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 });
  }

  for (const m of completedMatches) {
    const red = statsByReg.get(m.red_registration_id);
    const blue = statsByReg.get(m.blue_registration_id);
    if (!red || !blue) continue;
    const rs = m.red_score ?? 0;
    const bs = m.blue_score ?? 0;

    red['ptsScored'] = (red['ptsScored'] ?? 0) + rs;
    red['ptsConceded'] = (red['ptsConceded'] ?? 0) + bs;
    blue['ptsScored'] = (blue['ptsScored'] ?? 0) + bs;
    blue['ptsConceded'] = (blue['ptsConceded'] ?? 0) + rs;

    if (drawnForfeitMatchIds.has(m.id)) {
      // tournamentPolicy.forfeitDrawsCount: the bout was forfeited, so record
      // a draw for both instead of the win/loss the scores imply. FIRST,
      // because a forfeit is an explicit operator act and outranks the rest.
      red['D'] = (red['D'] ?? 0) + 1;
      blue['D'] = (blue['D'] ?? 0) + 1;
    } else if (isDoubleLossBout(m.end_reason)) {
      // The doubles ceiling under `double_loss_zero_scores`: a LOSS FOR BOTH.
      // It cannot be read off the scores, because the bout is 0-0 and would
      // otherwise fall to the final `else` and score as a draw — which is how
      // the same outcome was a double loss in Swiss points and a draw in the
      // W/L/D columns of the very same Swiss table.
      //
      // The other two ceiling reasons need no branch: 'max_doubles_draw' IS a
      // 0-0 draw, and 'max_doubles_result_stands' leaves a real score below.
      red['L'] = (red['L'] ?? 0) + 1;
      blue['L'] = (blue['L'] ?? 0) + 1;
    } else if (rs > bs) {
      red['W'] = (red['W'] ?? 0) + 1;
      blue['L'] = (blue['L'] ?? 0) + 1;
    } else if (bs > rs) {
      blue['W'] = (blue['W'] ?? 0) + 1;
      red['L'] = (red['L'] ?? 0) + 1;
    } else {
      red['D'] = (red['D'] ?? 0) + 1;
      blue['D'] = (blue['D'] ?? 0) + 1;
    }

    // Accumulate the canonical per-fighter aggregates from this match's
    // exchanges (hits given/received, doubles) + the win count the score
    // formula needs. `computeAggregates` asks for the one field it reads, so
    // this is a plain object rather than a row cast into a domain type.
    const matchExchanges = exchangesByMatch.get(m.id) ?? [];
    const rulesetMatch = { redRegistrationId: m.red_registration_id };
    for (const regId of [m.red_registration_id, m.blue_registration_id]) {
      const acc = aggByReg.get(regId);
      if (!acc) continue;
      const a = computeAggregates(
        regId,
        rulesetMatch,
        matchExchanges,
        m.winner_registration_id === regId,
        afterblowMode,
      );
      acc.wins += a.wins;
      acc.targetPoints += a.targetPoints;
      acc.timesHit += a.timesHit;
      acc.doubles += a.doubles;
    }
  }

  for (const stats of statsByReg.values()) {
    if ('diff' in stats) {
      stats['diff'] = (stats['ptsScored'] ?? 0) - (stats['ptsConceded'] ?? 0);
    }
  }

  // `score` is the one ruleset-SPECIFIC column, so the ruleset computes it.
  // This used to call TF_v1's computeScore directly, which meant an
  // org-authored pool was scored and ranked by the federal formula instead of
  // the author's own scoreFormula.
  const scoreByReg =
    declaresScore || forceScore
      ? poolScoresByRegistration(
          ruleset,
          members,
          completedMatches,
          exchangesByMatch,
          afterblowMode,
          runtimeConfig,
        )
      : new Map<string, number>();

  // Extended columns derived from exchanges + forfeits. Only assign keys the
  // active ruleset actually declares (Generic_PointsCap declares none of these
  // and stays untouched). Score is rounded to 2 decimals for display; ranking
  // uses the same rounded value with the ruleset's own tiebreaks after it.
  for (const [regId, stats] of statsByReg) {
    const agg = aggByReg.get(regId) ?? { wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 };
    if ('hitsGiven' in stats) stats['hitsGiven'] = agg.targetPoints;
    if ('hitsReceived' in stats) stats['hitsReceived'] = agg.timesHit;
    if ('doubles' in stats) stats['doubles'] = agg.doubles;
    if ('score' in stats) stats['score'] = Math.round((scoreByReg.get(regId) ?? 0) * 100) / 100;
    if ('F' in stats) stats['F'] = forfeitCountByReg.get(regId) ?? 0;
    // forceScore with no declared column: carry the value so a caller that adds
    // its own `score` column can render it. Harmless for the pool path, which
    // never sets forceScore.
    if (forceScore && !('score' in stats)) {
      stats['score'] = Math.round((scoreByReg.get(regId) ?? 0) * 100) / 100;
    }
  }

  const rows: StandingsRow[] = members.map((member) => {
    const person = member.registrations.persons;
    const displayName = `${person.given_name} ${person.family_name}`.trim();
    return {
      rank: 0,
      registrationId: member.registration_id,
      displayName,
      club: person.clubs,
      status,
      stats: statsByReg.get(member.registration_id) ?? {},
    };
  });

  return applyRanking(rows, rankingChain);
}
