import { ConflictException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * Take a bout's forfeit record off the books, from outside MatchesService.
 *
 * A reset used to leave the active `match_forfeits` row standing. Everything
 * that reads a forfeit keys on `voided_at IS NULL` and nothing else — pool
 * standings, Swiss standings, and the HEMA Ratings export, which DROPS the bout
 * from the submission as a walkover — so the F kept counting for a bout that had
 * been put back on the schedule. And because
 * `match_forfeits_one_active_per_match` is `UNIQUE(match_id) WHERE voided_at IS
 * NULL`, the replayed bout could not be forfeited again either: `existingRecord`
 * returns the stale row and the write is a silent no-op.
 *
 * A FREE FUNCTION, not a service, for the same reason `revert-match.ts` is one.
 * The caller is `MatchCompletionService` in PhasesModule; MatchesModule imports
 * PhasesModule, and an edge back would close a cycle `module-graph.test.ts`
 * fails on. A free module in `matches/` adds no edge at all — `revert-match.ts`
 * already imports `unplayed-match-columns` across the same seam.
 *
 * NARROW ON PURPOSE. This voids records whose whole effect was their own bout,
 * and REFUSES anything wider. It never writes `registrations` and never writes
 * `bracket_slots`.
 *
 * The refusal is not caution, it is the only correct answer. `clock.service.ts`
 * reaches the same owner on `reopen`, so a referee tapping Reopen to fix a
 * penalty entry on a `black_card_2` bout would otherwise silently un-disqualify
 * the fighter — a DQ reversed by a clock button, with nothing to re-apply it
 * when the bout ends again. Whether a disqualification stands is not a decision
 * the pad gets to make by accident.
 *
 * The wide cases already have a correct, reachable remedy in
 * `PATCH /match-forfeits/:id/void`, which restores `registrations.status` from
 * `previous_registration_state`, cascade-voids the children and puts their bouts
 * back. Routing to it beats re-implementing ~150 lines of its guards here.
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;

export interface ForfeitVoidActor {
  userId?: string;
  staffAccountId?: string;
}

/** One live forfeit record, with just enough to decide whether it may be voided here. */
export interface ActiveForfeitRecord {
  id: string;
  matchId: string;
  forfeitingRegistrationId: string;
  /** A reserve was swapped into the bracket for a round-1 no-show. */
  replacementRegistrationId: string | null;
  /** `previous_registration_state.status` — null when none was captured. */
  previousRegistrationStatus: string | null;
}

/**
 * Every live record on these matches, in one read.
 *
 * Batched over the root AND every dependent the cascade is about to revert: a
 * bracket semi won by forfeit is a dependent, and its record is just as capable
 * of having withdrawn somebody as the root's.
 */
export async function readActiveForfeits(
  supabase: Client,
  matchIds: readonly string[],
): Promise<ActiveForfeitRecord[]> {
  if (matchIds.length === 0) return [];
  const { data } = await supabase
    .from('match_forfeits')
    .select(
      'id, match_id, forfeiting_registration_id, replacement_registration_id, previous_registration_state',
    )
    .in('match_id', [...matchIds])
    .is('voided_at', null);

  return ((data ?? []) as Row[]).map((row) => {
    const previous = (row['previous_registration_state'] as Row | null) ?? {};
    return {
      id: row['id'] as string,
      matchId: row['match_id'] as string,
      forfeitingRegistrationId: row['forfeiting_registration_id'] as string,
      replacementRegistrationId: (row['replacement_registration_id'] as string | null) ?? null,
      previousRegistrationStatus: (previous['status'] as string | null) ?? null,
    };
  });
}

/**
 * Refuse any record that reached beyond its own bout. A pure read — call it in
 * the assert phase, before anything has been written.
 *
 * TWO PREDICATES, and the obvious third one is wrong.
 *
 * 1. A live child. The record withdrew a fighter and auto-forfeited their
 *    remaining pool bouts; undoing it here would leave those bouts forfeited
 *    while the fighter is back in play.
 * 2. The fighter's `registrations.status` is no longer what the record captured.
 *    That is the only evidence that `applyTournamentState` actually moved them —
 *    it writes nothing at all for a plain match-only forfeit, while
 *    `previous_registration_state` is captured either way. Comparing against the
 *    CURRENT row is what separates the two.
 *
 * NOT `can_continue === false`, which is the predicate that looks right and
 * refuses the exact case this must allow: `createAutoForfeit` hardcodes
 * `can_continue: false` on every child it writes, so keying on it would refuse
 * every reset of an auto-forfeited pool bout — the commonest thing an organiser
 * wants to undo.
 *
 * Note what predicate 2 implies: on the path that PASSES, previous === current,
 * so restoring the registration would write the value that is already there.
 * That is why this module never touches `registrations` — there is nothing to
 * put back.
 */
export async function assertForfeitsVoidableHere(
  supabase: Client,
  records: readonly ActiveForfeitRecord[],
): Promise<void> {
  if (records.length === 0) return;

  // Only records that captured a status can be compared. A child captures `{}`
  // by construction, so it is not evidence of anything and must not be treated
  // as a mismatch against a null.
  const moved = await movedRegistrationIds(
    supabase,
    records.filter((record) => record.previousRegistrationStatus !== null),
  );
  const withChildren = await recordsWithLiveChildren(supabase, records);

  const offender = records.find(
    (record) => moved.has(record.forfeitingRegistrationId) || withChildren.has(record.id),
  );
  if (!offender) return;

  throw new ConflictException({
    message:
      'This bout was closed by a forfeit that also took the fighter out of the tournament. ' +
      'An organiser has to undo that record before the bout can be reopened.',
    code: 'forfeit_withdrew_fighter',
    forfeitId: offender.id,
    matchId: offender.matchId,
  });
}

/** Which of these fighters no longer hold the status their record captured. */
async function movedRegistrationIds(
  supabase: Client,
  records: readonly ActiveForfeitRecord[],
): Promise<Set<string>> {
  if (records.length === 0) return new Set();
  const { data } = await supabase
    .from('registrations')
    .select('id, status')
    .in(
      'id',
      records.map((record) => record.forfeitingRegistrationId),
    );

  const current = new Map<string, string | null>();
  for (const row of (data ?? []) as Row[]) {
    current.set(row['id'] as string, (row['status'] as string | null) ?? null);
  }
  return new Set(
    records
      .filter(
        (record) =>
          current.get(record.forfeitingRegistrationId) !== record.previousRegistrationStatus,
      )
      .map((record) => record.forfeitingRegistrationId),
  );
}

/** Which of these records still carry un-voided children. */
async function recordsWithLiveChildren(
  supabase: Client,
  records: readonly ActiveForfeitRecord[],
): Promise<Set<string>> {
  const { data } = await supabase
    .from('match_forfeits')
    .select('parent_forfeit_id')
    .in(
      'parent_forfeit_id',
      records.map((record) => record.id),
    )
    .is('voided_at', null);

  return new Set(
    ((data ?? []) as Row[]).map((row) => row['parent_forfeit_id'] as string).filter(Boolean),
  );
}

/**
 * Stamp the void columns. Shared with `MatchForfeitsService` so a record voided
 * by a reset, by the organiser, or by a parent's cascade all record the same
 * audit trail — who voided it and when.
 */
export async function stampForfeitVoided(
  supabase: Client,
  forfeitId: string,
  actor: ForfeitVoidActor,
): Promise<Row | null> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('match_forfeits')
    .update({
      voided_at: now,
      voided_by_user_id: actor.userId ?? null,
      voided_by_staff_account_id: actor.staffAccountId ?? null,
      updated_at: now,
    })
    .eq('id', forfeitId)
    .select('*')
    .single();
  return (data as Row | null) ?? null;
}

/**
 * The only write this module performs: `voided_at` on each record.
 *
 * `bracket_slots` is deliberately untouched even when the record swapped a
 * reserve in for a round-1 no-show. Entering a substitute changed the FIELD, not
 * this result — and by the time an un-completion can reach such a record the
 * reserve has actually fought, possibly elsewhere. Undoing a result must not
 * un-enter a fighter. The pre-flight reports the substitution instead.
 */
export async function voidForfeitRecords(
  supabase: Client,
  records: readonly ActiveForfeitRecord[],
  actor: ForfeitVoidActor,
): Promise<number> {
  for (const record of records) await stampForfeitVoided(supabase, record.id, actor);
  return records.length;
}
