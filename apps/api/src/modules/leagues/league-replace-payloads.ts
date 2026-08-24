import type { LeagueRankingRow, LeagueTournamentContribution } from '@myclash/rules/results';

/**
 * The JSONB rows the two `replace_league_*` functions expand (migration 0190).
 *
 * Exported, and separate from the service, for one reason: the migration and
 * these mappings are two halves of one contract that nothing else checks. The
 * Supabase double ignores an rpc payload, and `db-schema-conformance.test.ts`
 * only reads `.from(...).select(...)` — it knows nothing about `.rpc()`. So a
 * key renamed on either side would fail at runtime and nowhere else.
 * `league-replace-payloads.test.ts` reads the migration's
 * `jsonb_to_recordset(...) as r(...)` field list and compares it against the
 * keys these produce.
 *
 * The scoping columns are NOT here. `league_id` and `tournament_id` come from
 * the function's own parameters, because the delete is scoped by those and an
 * insert taking them from the payload could write rows the delete never covered.
 */

/** One row of a league's standings table. */
export function toRankingPayload(row: LeagueRankingRow): Record<string, unknown> {
  return {
    ranking_group_key: row.rankingGroupKey,
    global_person_id: row.fighterId,
    rank: row.rank,
    total_points: row.totalPoints,
    participation_count: row.participationCount,
    medal_count: row.medalCount,
    double_hits_total: row.doubleHitsTotal,
    // TEXT in the schema since 0015, so the ratio keeps its exact printed form
    // instead of a float's.
    double_hit_average: String(row.doubleHitAverage),
    per_tournament: row.perTournament,
  };
}

/** One fighter's contribution from one tournament. */
export function toTournamentResultPayload(
  row: LeagueTournamentContribution,
): Record<string, unknown> {
  return {
    event_id: row.eventId,
    global_person_id: row.fighterId,
    ranking_group_key: row.rankingGroupKey,
    final_rank: row.finalRank,
    league_points: row.leaguePoints,
    medal: row.medal,
    double_hits: row.doubleHits,
  };
}
