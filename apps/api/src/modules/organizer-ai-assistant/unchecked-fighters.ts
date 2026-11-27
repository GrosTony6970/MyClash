import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inListChunks } from '../../common/postgrest-in-list';
import { storedKind } from '../events/tournament-kind';

/**
 * The rule-8 notice of the assistant's referee drafts (CLAUDE.md rule 8; ADR-016, 2026-11-13;
 * design decision 11). A team's slots have no names in slice 1b-1, so the one checker cannot see
 * a team's Fighters. A draft that assigns a referee to a team Pool, or to a bout of a team
 * Tournament, says so on screen. The notice blocks nothing.
 */

/**
 * The shape of a row id. The model writes the ids of a draft. An id of another shape names no row,
 * and PostgREST refuses a whole `.in()` read that carries one, which would break the drafts list.
 */
const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The draft columns this module reads. */
export interface DraftTargets {
  id: string;
  proposed_actions_json: Array<Record<string, unknown>>;
}

/** A Pool or bout row, with the kind of its Tournament through its Phase. */
interface KindRow {
  id: string;
  phases: { tournaments: { entrant_kind?: unknown } | null } | null;
}

/** The Pool and bout ids the `assign_referee` actions of `actions` name. */
function targetsOf(actions: ReadonlyArray<Record<string, unknown>>, key: 'poolId' | 'matchId') {
  return actions
    .filter((action) => action['kind'] === 'assign_referee')
    .map((action) => action[key])
    .filter((id): id is string => typeof id === 'string' && ROW_ID.test(id));
}

/**
 * The ids among `ids` whose row belongs to a team Tournament of `eventId`. The model writes the
 * ids and the client is the service role, so the read is scoped to the Event: an id of another
 * Event's Pool or bout finds no row and gives no flag.
 */
async function teamRows(
  db: SupabaseClient,
  table: 'pools' | 'matches',
  eventId: string,
  ids: string[],
): Promise<Set<string>> {
  const team = new Set<string>();
  for (const chunk of inListChunks([...new Set(ids)])) {
    const { data, error } = await db
      .from(table)
      .select('id, phases!inner(tournaments!inner(event_id, entrant_kind))')
      .eq('phases.tournaments.event_id', eventId)
      .in('id', chunk);
    if (error) throw new BadRequestException(error.message);
    for (const row of (data ?? []) as unknown as KindRow[]) {
      if (storedKind(row.phases?.tournaments?.entrant_kind) === 'team') team.add(row.id);
    }
  }
  return team;
}

/**
 * The ids of the drafts in `drafts` that assign a referee to a team Pool or a team bout of
 * `eventId`, the Event the drafts are read under.
 */
export async function draftsOfTeamFighters(
  db: SupabaseClient,
  eventId: string,
  drafts: ReadonlyArray<DraftTargets>,
): Promise<Set<string>> {
  const actionsOf = (draft: DraftTargets) => draft.proposed_actions_json ?? [];
  const [pools, matches] = await Promise.all([
    teamRows(
      db,
      'pools',
      eventId,
      drafts.flatMap((draft) => targetsOf(actionsOf(draft), 'poolId')),
    ),
    teamRows(
      db,
      'matches',
      eventId,
      drafts.flatMap((draft) => targetsOf(actionsOf(draft), 'matchId')),
    ),
  ]);
  return new Set(
    drafts
      .filter(
        (draft) =>
          targetsOf(actionsOf(draft), 'poolId').some((id) => pools.has(id)) ||
          targetsOf(actionsOf(draft), 'matchId').some((id) => matches.has(id)),
      )
      .map((draft) => draft.id),
  );
}
