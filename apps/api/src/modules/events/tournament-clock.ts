import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether a Tournament's rules are locked to ordinary edits: the ONE owner of "has a bout of this
 * Tournament started", asked by the five doors that change its engine, its card rules or its
 * forfeit rules — the ruleset switch, the card pin and the forfeit changes of the settings save
 * (ruling 73), the Tournament's own card pin and the Event's default one (the audited settings
 * change, revision 7 of its plan). Each reads the clock, then writes: a bout that starts between
 * the two is not seen, a race each door accepts.
 *
 * A bout has started once it has left `scheduled`, a voided one included: voiding a bout does not
 * void its cards (`MatchesService.voidMatch`), and a card it holds still counts toward a fighter's
 * later sanctions under the card rules it was given by.
 *
 * A failed read throws: read as "nothing started", the change went through mid-event. A plain
 * function on the client, not a service method, so the penalties doors ask it too.
 */
export async function tournamentClockOf(
  db: SupabaseClient,
  tournamentId: string,
): Promise<{ locked: boolean }> {
  const { data, error } = await db
    .from('matches')
    .select('id, phases!inner(tournament_id)')
    .eq('phases.tournament_id', tournamentId)
    .neq('status', 'scheduled')
    .limit(1);
  if (error)
    throw new Error(
      `The bouts of Tournament ${tournamentId} were not read for its lock: ${error.message}`,
    );
  return { locked: (data ?? []).length > 0 };
}
