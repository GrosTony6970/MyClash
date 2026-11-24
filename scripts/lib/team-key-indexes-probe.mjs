/**
 * Part of check 25 of the RLS probe (`team-tables-probe.mjs` runs it): the index on each key that
 * names a team (migration 0283), by its table, its name and its whole definition, the partial
 * condition included, as 0283's DO block reads it. A delete of a team reads every one of these
 * tables, to take, clear or refuse the rows that name it.
 */

/** A btree index on one team key, only over the rows that name a team. */
const partial = (column) => `(${column}) WHERE (${column} IS NOT NULL)`;

const TEAM_KEY_INDEXES = [
  ['pool_members', 'pool_members_team_id_idx', partial('team_id')],
  ['bracket_slots', 'bracket_slots_team_a_id_idx', partial('team_a_id')],
  ['bracket_slots', 'bracket_slots_team_b_id_idx', partial('team_b_id')],
  ['matches', 'matches_red_team_id_idx', partial('red_team_id')],
  ['matches', 'matches_blue_team_id_idx', partial('blue_team_id')],
  ['matches', 'matches_winner_team_id_idx', partial('winner_team_id')],
  ['match_penalties', 'match_penalties_team_id_idx', partial('team_id')],
  ['match_forfeits', 'match_forfeits_forfeiting_team_id_idx', partial('forfeiting_team_id')],
  ['match_forfeits', 'match_forfeits_winner_team_id_idx', partial('winner_team_id')],
  ['match_protests', 'match_protests_team_id_idx', partial('team_id')],
  ['team_slots', 'team_slots_team_id_tournament_id_idx', '(team_id, tournament_id)'],
];

/** Each index of `TEAM_KEY_INDEXES` missing, or not as written, as a sentence. */
export async function teamKeyIndexFailures(tx) {
  const failures = [];
  for (const [table, name, definition] of TEAM_KEY_INDEXES) {
    const want = `CREATE INDEX ${name} ON public.${table} USING btree ${definition}`;
    const rows = await tx`SELECT pg_get_indexdef(i.indexrelid) AS def
                            FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
                           WHERE i.indrelid = ${`public.${table}`}::regclass
                             AND ic.relname = ${name}`;
    if (rows.length !== 1 || rows[0].def !== want) {
      failures.push(`check 25: ${table}.${name} is ${rows[0]?.def ?? 'missing'}, not ${want}`);
    }
  }
  return failures;
}
