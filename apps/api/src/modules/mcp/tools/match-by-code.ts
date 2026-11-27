/**
 * match-by-code.ts — a Tournament's bout by the round code the app shows (`LSW-P2-M04`, call O),
 * and the fold names are compared through. `preview_referee_assignment` asks for one bout;
 * `draft_match_schedule` reads the Tournament's bouts once and asks for each of its codes.
 */
import { READ_PAGE } from '../../../common/postgrest-in-list';
import { readEveryRowById } from '../../../common/read-every-row-by-id';
import type { McpToolDeps } from '../mcp-server';
import type { McpRefusal } from './mcp-answer';
import { MATCH_SELECT, toWriteMatch, type WriteMatch } from './referee-write-gate';

/** Case and accents folded away, so `declarant` finds `Déclarant`. */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase();

/**
 * Every bout of the phases, page after page by id: PostgREST cuts a read at 1000 rows and says
 * nothing (ruling 831), and a cut read would answer "No Match" for a bout that exists.
 */
async function everyMatch(deps: McpToolDeps, phaseIds: string[]) {
  const { rows } = await readEveryRowById<Record<string, unknown>>((after) => {
    const query = deps.supabase.service
      .from('matches')
      .select(MATCH_SELECT)
      .in('phase_id', phaseIds)
      .order('id');
    return (after === undefined ? query : query.gt('id', after)).limit(READ_PAGE);
  });
  return rows;
}

/** A Tournament's name and every one of its bouts. */
export interface TournamentBouts {
  tournament: string;
  matches: WriteMatch[];
}

/** The Tournament's name and bouts, read once. A failed read throws. */
export async function tournamentBouts(
  deps: McpToolDeps,
  tournamentId: string,
): Promise<TournamentBouts> {
  const { data: t, error: tError } = await deps.supabase.service
    .from('tournaments')
    .select('name, phases(id)')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tError || !t) throw new Error(`tournament read failed: ${tError?.message ?? 'no row'}`);
  const { name, phases } = t as unknown as { name: string; phases: { id: string }[] | null };
  const phaseIds = (phases ?? []).map((p) => p.id);
  const rows = phaseIds.length > 0 ? await everyMatch(deps, phaseIds) : [];
  return { tournament: name, matches: rows.map(toWriteMatch) };
}

/** The bout with this round code among the Tournament's, compared case-blind. */
export function matchByCode(bouts: TournamentBouts, code: string): WriteMatch | McpRefusal {
  const name = bouts.tournament;
  const wanted = code.trim().toLocaleLowerCase();
  const found = bouts.matches.filter((m) => m.code.toLocaleLowerCase() === wanted);
  if (found.length === 0) return { refusal: `No Match "${code}" in ${name}.` };
  if (found.length > 1) {
    return { refusal: `Several Matches of ${name} are "${code}": MyClash cannot tell them apart.` };
  }
  return found[0]!;
}
