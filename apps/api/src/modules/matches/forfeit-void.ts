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
 * `PATCH /match-forfeits/:id/void`, which settles the Fighter's status from what
 * stays live, and their Pool bouts follow it. Routing to it beats
 * re-implementing ~150 lines of its guards here.
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
  /** What the record did to its Fighter at its time (`fighter_outcome`, 0240): null = nothing. */
  fighterOutcome: string | null;
  /** Written by the status reconcile because its Fighter was out, not by a person. */
  autoCreated: boolean;
}

/** A read that failed decides nothing: a plain Error (a 5xx), never "no row". */
function rowsOf(what: string, result: { data: unknown; error: { message: string } | null }): Row[] {
  if (result.error) throw new Error(`${what} could not be read: ${result.error.message}`);
  return (result.data ?? []) as Row[];
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
  const result = await supabase
    .from('match_forfeits')
    .select(
      'id, match_id, forfeiting_registration_id, replacement_registration_id, fighter_outcome, auto_created',
    )
    .in('match_id', [...matchIds])
    .is('voided_at', null);

  return rowsOf('The forfeits of these bouts', result).map((row) => ({
    id: row['id'] as string,
    matchId: row['match_id'] as string,
    forfeitingRegistrationId: row['forfeiting_registration_id'] as string,
    replacementRegistrationId: (row['replacement_registration_id'] as string | null) ?? null,
    fighterOutcome: (row['fighter_outcome'] as string | null) ?? null,
    autoCreated: row['auto_created'] === true,
  }));
}

/**
 * Refuse any record that reached beyond its own bout. A pure read — call it in
 * the assert phase, before anything has been written.
 *
 * THREE PREDICATES, and the obvious fourth one is wrong.
 *
 * 1. A live child. The record withdrew a fighter, and bouts were forfeited or
 *    recorded under it since; undoing it here would leave them standing.
 * 2. The record withdrew or disqualified its Fighter itself (`fighter_outcome`,
 *    0240). The status settle reads it as a cause, and this module settles
 *    nobody: voided here, the Fighter would stay out with no cause on record.
 * 3. A record a person wrote, whose Fighter is out: it may be what holds them
 *    out with no outcome of its own ("disqualify after N" counts it; a black
 *    card forfeit's card is the cause). The plan's Reopen rule (slice B, §2.5).
 *
 * NOT `can_continue === false`, which is the predicate that looks right and
 * refuses the exact case this must allow: every bout the reconcile forfeits
 * while a Fighter is out has `can_continue: false`, so keying on it would refuse
 * every reset of such a bout — the commonest thing an organiser wants to undo.
 * That reset is the organiser's put-back: the reconcile leaves the bout alone
 * for the rest of the Fighter's spell out (`voided_by_return` stays false).
 *
 * On the path that PASSES, the record put nobody out and moved nobody, so the
 * void changes no Fighter's status: this module never touches `registrations`
 * and asks no settle.
 */
export async function assertForfeitsVoidableHere(
  supabase: Client,
  records: readonly ActiveForfeitRecord[],
): Promise<void> {
  if (records.length === 0) return;

  // Records a person wrote: a bout forfeited because its Fighter is out may be reset, as the
  // organiser's put-back (predicate 3 only, below). This filter is the exemption's one owner: a
  // Reset touches one bout, so no Fighter has both kinds of record in one set.
  const out = await outRegistrationIds(
    supabase,
    records.filter((record) => !record.autoCreated),
  );
  const withChildren = await recordsWithLiveChildren(supabase, records);

  const offender = records.find(
    (record) =>
      record.fighterOutcome !== null ||
      out.has(record.forfeitingRegistrationId) ||
      withChildren.has(record.id),
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

/** Which of these records' Fighters are out of their Tournament now. */
async function outRegistrationIds(
  supabase: Client,
  records: readonly ActiveForfeitRecord[],
): Promise<Set<string>> {
  if (records.length === 0) return new Set();
  const result = await supabase
    .from('registrations')
    .select('id, status')
    .in(
      'id',
      records.map((record) => record.forfeitingRegistrationId),
    );
  return new Set(
    rowsOf('The Fighters of these forfeits', result)
      .filter((row) => row['status'] === 'withdrawn' || row['status'] === 'disqualified')
      .map((row) => row['id'] as string),
  );
}

/** Which of these records still carry un-voided children. */
async function recordsWithLiveChildren(
  supabase: Client,
  records: readonly ActiveForfeitRecord[],
): Promise<Set<string>> {
  const result = await supabase
    .from('match_forfeits')
    .select('parent_forfeit_id')
    .in(
      'parent_forfeit_id',
      records.map((record) => record.id),
    )
    .is('voided_at', null);

  return new Set(
    rowsOf('The forfeits under these records', result)
      .map((row) => row['parent_forfeit_id'] as string)
      .filter(Boolean),
  );
}

/**
 * Stamp the void columns. Shared with `MatchForfeitsService` and the status
 * reconcile, so a record voided by a reset, by the organiser, or because its
 * Fighter came back in all record the same audit trail — who voided it and
 * when. `byReturn` marks the last (`voided_by_return`, 0241): the reconcile's
 * own void, which it may forfeit again on the Fighter's next spell out.
 */
export async function stampForfeitVoided(
  supabase: Client,
  forfeitId: string,
  actor: ForfeitVoidActor,
  byReturn = false,
): Promise<Row | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('match_forfeits')
    .update({
      voided_at: now,
      voided_by_user_id: actor.userId ?? null,
      voided_by_staff_account_id: actor.staffAccountId ?? null,
      updated_at: now,
      ...(byReturn ? { voided_by_return: true } : {}),
    })
    .eq('id', forfeitId)
    .select('*')
    .single();
  if (error) throw new Error(`Forfeit ${forfeitId} was not voided: ${error.message}`);
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
