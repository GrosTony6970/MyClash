/**
 * archive-match-rules.ts — the copies of their rules the bouts of an OLDER archive take on restore.
 *
 * Since migration 0229 a bout points at a copy of its Tournament's rules (`match_rules`), and an
 * archive carries the copies its bouts hold. An archive made before 0229 carries bouts and no
 * copies. Ruling "Old archives" (operator, 2026-10-17): its bouts get copies on restore.
 *
 * - A bout not started takes its restored Tournament's copy of now, as a bout generated there
 *   would (`stamp_match_rules`), with that copy's engine pair and hash on its own columns.
 * - Any other bout takes a copy of its restored Tournament's settings with the bout's OWN engine
 *   pair and hash (`build_match_rules`, the row builder of 0229's backfill), one copy per distinct
 *   pair. A bout keeps the engine it was fought under. Its settings were the Tournament's before
 *   0229, and stay so: the backfill gave the bouts in the database the same.
 *
 * Both functions are the database's: the ids land on the bouts before the bouts are written, so a
 * bout of its own Tournament points at a copy of its own Tournament (0229's trigger).
 */
import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchRulesetForTournament, type MatchRulesetStamp } from '../phases/match-ruleset';
import type { ArchiveRow, ArchiveTables } from './archive.types';

/**
 * An archive made before 0229: it has no `matchRules` table and carries bouts. A structure
 * archive carries no bouts, so it needs no copy. Read on the archive's OWN data, never on the
 * normalised tables: those give every table the file lacks an empty list.
 */
export function carriesBoutsWithoutCopies(data: object): boolean {
  const matches = (data as { matches?: unknown }).matches;
  return !Object.hasOwn(data, 'matchRules') && Array.isArray(matches) && matches.length > 0;
}

/**
 * The bouts of `data`, each with the copy it takes (above). Called once the Tournaments are
 * written and before the bouts are: both functions read the restored Tournament.
 *
 * `restoredTournamentOf` answers the restored id of a Tournament the archive names, as the
 * restore maps a phase's `tournament_id`.
 */
export async function boutsWithTheirCopies(
  supabase: SupabaseClient,
  data: Pick<ArchiveTables, 'phases' | 'matches'>,
  restoredTournamentOf: (sourceId: string) => string | undefined,
): Promise<ArchiveRow[]> {
  const tournamentOfPhase = new Map(
    data.phases.map((phase) => [phase['id'], phase['tournament_id']]),
  );
  const copiesOfNow = new Map<string, MatchRulesetStamp>();
  const copiesBuilt = new Map<string, string>();
  const bouts: ArchiveRow[] = [];
  for (const bout of data.matches) {
    const source = tournamentOfPhase.get(bout['phase_id']);
    const tournamentId = typeof source === 'string' ? restoredTournamentOf(source) : undefined;
    if (!tournamentId) {
      throw new BadRequestException(`Bout ${String(bout['id'])} of the archive has no Tournament`);
    }
    if ((bout['status'] ?? 'scheduled') === 'scheduled') {
      const copy =
        copiesOfNow.get(tournamentId) ?? (await matchRulesetForTournament(supabase, tournamentId));
      copiesOfNow.set(tournamentId, copy);
      bouts.push({ ...bout, ...copy });
      continue;
    }
    const pair = {
      p_tournament_id: tournamentId,
      p_code: bout['ruleset_code'] ?? null,
      p_version: bout['ruleset_version'] ?? null,
      p_hash: bout['ruleset_content_hash'] ?? null,
    };
    const key = JSON.stringify(pair);
    const id = copiesBuilt.get(key) ?? (await buildCopy(supabase, pair));
    copiesBuilt.set(key, id);
    bouts.push({ ...bout, match_rules_id: id });
  }
  return bouts;
}

async function buildCopy(supabase: SupabaseClient, pair: Record<string, unknown>): Promise<string> {
  const { data: id, error } = await supabase.rpc('build_match_rules', pair);
  if (error || typeof id !== 'string') {
    throw new Error(
      `The rules of the restored bouts were not copied: ${error?.message ?? 'no copy'}`,
    );
  }
  return id;
}
