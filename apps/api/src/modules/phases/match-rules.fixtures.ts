/**
 * The database's stamp of a bout's rules (`stamp_match_rules`, migration 0229), for a test's
 * seeded Tournaments: one copy per Tournament, and the function's answer, so a door that stamps
 * its bouts reads the copy of the Tournament it names. Imported by tests and nothing else.
 *
 * The copy holds the Tournament row's engine pair and hash, with the column defaults the schema
 * gives a row that names none (`0001_init.sql`: TF_v1, "1"). The stamp's own work, the bouts it
 * points at the copy, is the database's: the probe holds it (`scripts/lib/match-rules-probe.mjs`).
 */
import type { RpcAnswer, TableSeed } from '../../common/testing/supabase-chain';
import { normalizeRulesetVersion } from '../events/ruleset-defaults';

/** The id of the copy the stamp answers for a Tournament. */
export const rulesOf = (tournamentId: string): string => `rules-${tournamentId}`;

type Row = Record<string, unknown>;

const rowsOf = (seed: TableSeed | undefined): Row[] =>
  (seed && !Array.isArray(seed) && 'rows' in seed && Array.isArray(seed.rows)
    ? seed.rows
    : []) as Row[];

const one = (embed: unknown): Row | null =>
  ((Array.isArray(embed) ? embed[0] : embed) as Row | null | undefined) ?? null;

/**
 * The seed's Tournaments, as the stamp reads them: the `tournaments` rows, and a Tournament a
 * phase row (or a bout row's phase) embeds, under the phase's `tournament_id`. A seed written
 * for the embed read the stamp replaced keeps its Tournament's rules there.
 */
function tournamentsOf(seed: Readonly<Record<string, TableSeed>>): Row[] {
  const found = new Map<string, Row>();
  for (const row of rowsOf(seed['tournaments'])) found.set(String(row['id']), row);
  const phases = [
    ...rowsOf(seed['phases']),
    ...rowsOf(seed['matches']).map((match) => one(match['phases'])),
  ];
  for (const phase of phases) {
    const id = phase?.['tournament_id'];
    const embedded = one(phase?.['tournaments']);
    if (typeof id === 'string' && !found.has(id)) found.set(id, { ...embedded, id });
  }
  return [...found.values()];
}

/**
 * `seed` with the copies of its Tournaments added, and the stamp's answer: spread both into
 * `mockSupabase(...withStampedRules(seed))`. A Tournament the seed does not hold answers as the
 * function does, "not found" (P0002).
 */
export function withStampedRules(
  seed: Readonly<Record<string, TableSeed>>,
): [Record<string, TableSeed>, Record<string, RpcAnswer>] {
  const tournaments = tournamentsOf(seed);
  const copies = tournaments.map((t) => ({
    id: rulesOf(String(t['id'])),
    tournament_id: t['id'],
    ruleset_code: t['ruleset_code'] ?? 'TF_v1',
    // As the row builder writes it (0229): "1", "1.0" and none are 1.0.0.
    ruleset_version: normalizeRulesetVersion(String(t['ruleset_version'] || '1')),
    ruleset_content_hash: t['ruleset_content_hash'] ?? null,
  }));
  const stamp: RpcAnswer = ({ p_tournament_id: id }) =>
    tournaments.some((t) => t['id'] === id)
      ? { data: rulesOf(String(id)), error: null }
      : { data: null, error: { code: 'P0002', message: `Tournament ${String(id)} was not found` } };
  return [{ match_rules: { rows: copies }, ...seed }, { stamp_match_rules: stamp }];
}
