import type { BoutDeps } from './fighter-bouts';
import { isOut, rowsOf, type Fighter } from './fighter-cause';

/**
 * A Fighter's Swiss pairings follow their status (slice B-Swiss, 0244; rulings 77, 81, 123-126).
 *
 * Out: withdrawn from the pairings of every Swiss phase they are in, from the next round — BEFORE
 * their bouts are read and forfeited, so a round committed first is seen and its bout forfeited,
 * and before the completion owner pairs the round the forfeit closes. In: put back, unless the
 * organiser withdrew them by hand, the phase is over, or a round was paired without them (the
 * functions decide, under the phase's row lock). By `.rpc` on the service client: no Swiss provider
 * is injected, so `MatchesModule` gains no edge to the Swiss leaf (`swiss-core.module.ts`).
 */

type Client = BoutDeps['db'];

const phasesOf = (rows: Array<Record<string, unknown>>) =>
  rows.map((row) => row['phase_id'] as string);

async function call(db: Client, fn: string, args: Record<string, unknown>, what: string) {
  const { data, error } = await db.rpc(fn, args);
  // A server error, never a 400: the status is settled, and the retry repairs the rest.
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as unknown;
}

/**
 * Out of every Swiss phase they are in. EVERY entry, not only those that read "paired": a hand
 * put-back not yet committed reads "withdrawn" here, and the function, waiting on its lock,
 * withdraws after it (a no-op for a row withdrawn already).
 */
export async function swissOut(db: Client, fighter: Fighter): Promise<void> {
  const entries = rowsOf(
    'The Swiss entries of the Fighter',
    await db.from('swiss_entrants').select('phase_id').eq('registration_id', fighter.id),
  );
  for (const phase of phasesOf(entries)) {
    await call(
      db,
      'swiss_withdraw',
      { p_phase: phase, p_registration: fighter.id, p_by: 'status' },
      `Registration ${fighter.id} was not withdrawn from Swiss phase ${phase}`,
    );
  }
}

/** Back in the pairings their status took them out of. */
export async function swissBackIn(db: Client, fighter: Fighter): Promise<void> {
  const entries = rowsOf(
    'The Swiss entries the status withdrew',
    await db
      .from('swiss_entrants')
      .select('phase_id')
      .eq('registration_id', fighter.id)
      .eq('withdrawn_by', 'status'),
  );
  for (const phase of phasesOf(entries)) {
    await call(
      db,
      'swiss_put_back',
      { p_phase: phase, p_registration: fighter.id, p_by: 'status' },
      `Registration ${fighter.id} was not put back in Swiss phase ${phase}`,
    );
  }
}

/**
 * The entrants of a Swiss phase whose status the phase did not follow while it was over: those out
 * of their Tournament (127), and those back in but still withdrawn by their status (129).
 */
export async function entrantsToFollowOf(db: Client, phaseId: string): Promise<string[]> {
  const entrants = rowsOf(
    'The entrants of the Swiss phase',
    await db.from('swiss_entrants').select('registration_id, withdrawn_by').eq('phase_id', phaseId),
  );
  if (entrants.length === 0) return [];
  const byStatus = new Set(
    entrants
      .filter((row) => row['withdrawn_by'] === 'status')
      .map((row) => row['registration_id'] as string),
  );
  const rows = rowsOf(
    'The statuses of the entrants',
    await db
      .from('registrations')
      .select('id, status')
      .in(
        'id',
        entrants.map((row) => row['registration_id'] as string),
      ),
  );
  return rows
    .filter((row) => isOut(row['status'] as string) || byStatus.has(row['id'] as string))
    .map((row) => row['id'] as string);
}

/** The Swiss phases a status change no longer touches (125, 126): `swiss_phase_over` decides. */
export async function swissPhasesOver(db: Client, phases: string[]): Promise<Set<string>> {
  const over = new Set<string>();
  for (const phase of new Set(phases)) {
    const answer = await call(
      db,
      'swiss_phase_over',
      { p_phase: phase },
      `Swiss phase ${phase} could not be read`,
    );
    if (answer === true) over.add(phase);
  }
  return over;
}
