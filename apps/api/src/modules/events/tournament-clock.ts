import { ForbiddenException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatPhaseOf, type FormatPhase, type PhaseType } from '@myclash/rules';
import type { RulesClock } from '@myclash/rulesets';
import { RULES_CHANGE_CODES } from '@myclash/types';

/** The card doors' one refusal text, by what the card pin belongs to. */
export const CARD_RULES_LOCKED = {
  tournament:
    'This tournament has started, or its Event is running with bouts made: its card rules are locked.',
  event:
    'A tournament of this Event has started, or the Event is running with its bouts made: the card rules it inherits are locked.',
} as const;

/**
 * The refusal of a card pin change on a locked clock (`card_change_locked`), for every card door:
 * the Tournament's own pin (the settings save, the penalties door) and the Event's default pin. No
 * audited card change exists (ruling 35).
 */
export function cardChangeLocked(of: keyof typeof CARD_RULES_LOCKED): ForbiddenException {
  return new ForbiddenException({
    code: RULES_CHANGE_CODES.cardLocked,
    message: CARD_RULES_LOCKED[of],
  });
}

/**
 * What has started in a Tournament, for its rules lock: the ONE owner of "does it run" and "which
 * format phases has a bout started in", asked by every door that changes its engine, its card
 * rules or its forfeit rules (the settings save, the Tournament's own card pin, the Event's default
 * card pin). `clockLocks` (`@myclash/rulesets`) turns it into "locked"; `lockedChanges` reads it
 * per key. Each door reads the clock, then writes: a bout that starts between the two is not seen,
 * a race each door accepts.
 *
 * It RUNS when its own status is `running` (the manual pick), or when its Event runs (the ticker
 * opens it on its first day) and it has bouts made (operator ruling "Offline clock": nothing sets a
 * Tournament running by itself).
 *
 * A bout has started once it has left `scheduled`, a voided one included: voiding a bout does not
 * void its cards (`MatchesService.voidMatch`), and a card it holds still counts toward a fighter's
 * later sanctions under the card rules it was given by. A Pool or Swiss phase is asked for one
 * started bout; a bracket phase reads its started bouts' labels, because a finals bout is told
 * apart by its label alone (`formatPhaseOf`), so one row of a bracket could hide the gold bout.
 *
 * A failed read throws: read as "nothing started", the change went through mid-event. A plain
 * function on the client, not a service method, so the penalties doors ask it too.
 */
export async function tournamentClockOf(
  db: SupabaseClient,
  tournamentId: string,
): Promise<RulesClock> {
  const tournament = await readOne(
    db,
    'tournaments',
    'status, event_id',
    tournamentId,
    tournamentId,
  );
  const event = await readOne(db, 'events', 'status', String(tournament['event_id']), tournamentId);
  const phases = await phasesOf(db, tournamentId);
  const perPhase = await Promise.all(phases.map((phase) => startedIn(db, tournamentId, phase)));
  const started = new Set<FormatPhase>(perPhase.flat());
  const running =
    tournament['status'] === 'running' ||
    (event['status'] === 'running' &&
      (started.size > 0 || (await hasBouts(db, tournamentId, phases))));
  return { running, startedFormatPhases: started };
}

type Row = Record<string, unknown>;
interface Phase {
  id: string;
  type: PhaseType;
}

const failed = (what: string, tournamentId: string, message: string) =>
  new Error(`The ${what} of Tournament ${tournamentId} were not read for its lock: ${message}`);

async function readOne(
  db: SupabaseClient,
  table: string,
  columns: string,
  id: string,
  tournamentId: string,
) {
  const { data, error } = await db.from(table).select(columns).eq('id', id).maybeSingle();
  if (error) throw failed(table, tournamentId, error.message);
  if (!data) throw failed(table, tournamentId, 'no row');
  return data as unknown as Row;
}

async function phasesOf(db: SupabaseClient, tournamentId: string): Promise<Phase[]> {
  const { data, error } = await db
    .from('phases')
    .select('id, type')
    .eq('tournament_id', tournamentId);
  if (error) throw failed('phases', tournamentId, error.message);
  return (data ?? []) as Phase[];
}

/** The format phases a started bout of this phase counts against. */
async function startedIn(
  db: SupabaseClient,
  tournamentId: string,
  phase: Phase,
): Promise<FormatPhase[]> {
  const bracket = phase.type !== 'pool' && phase.type !== 'swiss';
  const query = db
    .from('matches')
    .select(bracket ? 'match_number_label' : 'id')
    .eq('phase_id', phase.id)
    .neq('status', 'scheduled');
  const { data, error } = bracket ? await query : await query.limit(1);
  if (error) throw failed('bouts', tournamentId, error.message);
  const rows = (data ?? []) as unknown as Array<{ match_number_label?: string | null }>;
  return rows.map((row) => formatPhaseOf(phase.type, row.match_number_label));
}

/** Whether any bout of these phases exists, whatever its status. */
async function hasBouts(
  db: SupabaseClient,
  tournamentId: string,
  phases: readonly Phase[],
): Promise<boolean> {
  if (phases.length === 0) return false;
  const { data, error } = await db
    .from('matches')
    .select('id')
    .in(
      'phase_id',
      phases.map((phase) => phase.id),
    )
    .limit(1);
  if (error) throw failed('bouts', tournamentId, error.message);
  return (data ?? []).length > 0;
}
