import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// A value import: Nest needs the runtime class for DI metadata.
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';

/** The statuses a Tournament completes from. A draft stays a draft: completing it would show it. */
const OPEN_STATUSES = ['published', 'running'] as const;
const ELIMINATION_PHASES = ['single_elim', 'double_elim'] as const;
/** An Event in these is over: nothing reopens one of its Tournaments. */
const OVER_EVENT_STATUSES = ['completed', 'archived'];

type Db = SupabaseService['service'];

/**
 * A Tournament completes by itself (ruling 892). Nothing did before: the status help said it
 * "moves to completed when the final has been fought", fighters never got "results published",
 * and its Event never auto-archived (the archive waits for every Tournament to be completed).
 *
 * A Tournament does not record whether a bracket follows its pools, so the end of its pools
 * proves nothing. Two rules, then:
 *   1. a Tournament with a bracket completes once its bracket has a champion: no bout of it left
 *      to fight, every bracket bout fought with a winner (a final lost by both fighters waits for
 *      the Event's end), and no grand-final reset owed that is not made yet;
 *   2. every Tournament still open completes with its Event. Silently when the Event went
 *      straight from draft to completed: that is old news (ruling 190).
 * A pools-only or Swiss-only Tournament completes by rule 2, or by hand before.
 *
 * And back: while its Event is not over, a completed Tournament runs again when one of its bouts
 * is reopened, when a correction makes a bout to fight (a grand-final reset), or when its Event
 * goes back from completed. It completes again, and announces again, when its bracket ends.
 *
 * The races: the last two bouts can end together, each asking rule 1; an organiser can save the
 * Tournament meanwhile. Every status write is a compare-and-set on the status read, so one writer
 * wins and the others write nothing; the results notice also holds a duplicate for a day. A
 * notice that fails puts the status back, so the next ask completes and announces again rather
 * than leaving a Tournament completed that told nobody.
 */
@Injectable()
export class TournamentCompletionService {
  private readonly logger = new Logger(TournamentCompletionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  /**
   * Asked when a bout ends, or ends again with another result. Completes an open Tournament whose
   * bracket has a champion (rule 1); runs again a completed one that has a bout to fight (a reset
   * a correction made) while its Event is not over.
   */
  async settleAfterBout(tournamentId: string): Promise<void> {
    const status = await this.statusOf(tournamentId);
    if (status === 'completed') {
      if ((await this.unfinishedBouts(tournamentId)) > 0) await this.reopen(tournamentId);
      return;
    }
    if (!isOpen(status) || !(await this.bracketHasChampion(tournamentId))) return;
    await this.complete(tournamentId, status, true);
  }

  /** A bout of this Tournament is about to be reopened: a completed one runs again. */
  async reopenForBoutUndone(tournamentId: string): Promise<void> {
    if ((await this.statusOf(tournamentId)) === 'completed') await this.reopen(tournamentId);
  }

  /** Rule 2, asked when an Event completes. The ids of the Tournaments this call completed. */
  async completeOpenTournaments(
    eventId: string,
    options: { announce: boolean } = { announce: true },
  ): Promise<string[]> {
    const rows = await this.tournamentsOf(eventId, [...OPEN_STATUSES]);
    const completed: string[] = [];
    for (const row of rows) {
      if (await this.complete(row.id, row.status, options.announce)) completed.push(row.id);
    }
    return completed;
  }

  /** An Event went back from completed: each completed Tournament with a bout left runs again. */
  async reopenUnfinishedOfEvent(eventId: string): Promise<void> {
    for (const row of await this.tournamentsOf(eventId, ['completed'])) {
      if ((await this.unfinishedBouts(row.id)) > 0) await this.reopen(row.id);
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private async statusOf(tournamentId: string): Promise<string | undefined> {
    const { data, error } = await this.db()
      .from('tournaments')
      .select('id, status')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new Error(`tournament read failed: ${error.message}`);
    return (data as { status?: string } | null)?.status;
  }

  private async tournamentsOf(
    eventId: string,
    statuses: string[],
  ): Promise<Array<{ id: string; status: string }>> {
    const { data, error } = await this.db()
      .from('tournaments')
      .select('id, status')
      .eq('event_id', eventId)
      .in('status', statuses);
    if (error) throw new Error(`tournament read failed: ${error.message}`);
    return (data ?? []) as Array<{ id: string; status: string }>;
  }

  /** Bouts of the Tournament, pools included, that are neither completed nor voided. */
  private async unfinishedBouts(tournamentId: string): Promise<number> {
    const { count, error } = await this.db()
      .from('matches')
      .select('id, phases!inner(tournament_id)', { count: 'exact', head: true })
      .eq('phases.tournament_id', tournamentId)
      .not('status', 'in', '("completed","voided")');
    if (error) throw new Error(`bout count failed: ${error.message}`);
    // No count is no answer: read as a bout left, so nothing completes on it.
    return count ?? 1;
  }

  /** Rule 1. A bye has no bout row, so it neither blocks nor counts. */
  private async bracketHasChampion(tournamentId: string): Promise<boolean> {
    const { data: phases, error } = await this.db()
      .from('phases')
      .select('id, type, config_json')
      .eq('tournament_id', tournamentId)
      .in('type', [...ELIMINATION_PHASES]);
    if (error) throw new Error(`phase read failed: ${error.message}`);
    const brackets = (phases ?? []) as BracketPhase[];
    if (brackets.length === 0) return false;
    if ((await this.unfinishedBouts(tournamentId)) > 0) return false;

    // A bracket bout fought with no winner (both fighters out on doubles): no champion yet.
    const { count, error: winnerError } = await this.db()
      .from('matches')
      .select('id, phases!inner(tournament_id, type)', { count: 'exact', head: true })
      .eq('phases.tournament_id', tournamentId)
      .in('phases.type', [...ELIMINATION_PHASES])
      .eq('status', 'completed')
      .is('winner_registration_id', null);
    if (winnerError) throw new Error(`winner count failed: ${winnerError.message}`);
    if ((count ?? 1) > 0) return false;

    for (const phase of brackets) {
      if (await resetOwed(this.db(), phase)) return false;
    }
    return true;
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  private async complete(tournamentId: string, before: string, announce: boolean) {
    if (!(await this.moveStatus(tournamentId, before, 'completed'))) return false;
    if (!announce) return true;
    try {
      await this.notificationEvents.resultsPublished(tournamentId);
    } catch (err) {
      // Put the status back, so the next ask completes and announces again.
      await this.moveStatus(tournamentId, 'completed', before);
      throw err;
    }
    return true;
  }

  private async reopen(tournamentId: string): Promise<void> {
    if (await this.eventIsOver(tournamentId)) return;
    await this.moveStatus(tournamentId, 'completed', 'running');
  }

  private async eventIsOver(tournamentId: string): Promise<boolean> {
    const { data, error } = await this.db()
      .from('tournaments')
      .select('id, events!inner(status)')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new Error(`event read failed: ${error.message}`);
    const embed = (data as { events?: unknown } | null)?.events;
    const event = (Array.isArray(embed) ? embed[0] : embed) as { status?: string } | null;
    // An Event that cannot be read is treated as over: nothing reopens on no answer.
    return !event?.status || OVER_EVENT_STATUSES.includes(event.status);
  }

  /** The compare-and-set every status write goes through. True when this call moved it. */
  private async moveStatus(tournamentId: string, from: string, to: string): Promise<boolean> {
    const { data, error } = await this.db()
      .from('tournaments')
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('status', from)
      .select('id');
    if (error) throw new Error(`tournament status write failed: ${error.message}`);
    const moved = (data ?? []).length > 0;
    this.logger.log(
      moved
        ? `Tournament ${tournamentId}: ${from} → ${to}`
        : `Tournament ${tournamentId} moved from ${from} meanwhile: not set to ${to}`,
    );
    return moved;
  }

  private db(): Db {
    return this.supabase.service;
  }
}

interface BracketPhase {
  id: string;
  type: string;
  config_json: { grandFinalReset?: boolean; wbRounds?: number; lbRounds?: number } | null;
}

/**
 * A double elimination's grand final won by the losers' side owes a reset, and the reset bout is
 * made only after the grand final's result is written (`BracketAdvanceService`). In that gap, or
 * when the advance failed, the bracket has no bout left yet no champion either.
 */
async function resetOwed(db: Db, phase: BracketPhase): Promise<boolean> {
  const config = phase.config_json ?? {};
  if (phase.type !== 'double_elim' || config.grandFinalReset !== true) return false;
  const grandFinalRound = (config.wbRounds ?? 0) + (config.lbRounds ?? 0) + 1;
  const { data: slots, error } = await db
    .from('bracket_slots')
    .select('id, round, registration_a_id')
    .eq('phase_id', phase.id)
    .in('round', [grandFinalRound, grandFinalRound + 1]);
  if (error) throw new Error(`bracket slot read failed: ${error.message}`);
  const rows = (slots ?? []) as Array<{
    id: string;
    round: number;
    registration_a_id: string | null;
  }>;
  const grandFinal = rows.find((slot) => slot.round === grandFinalRound);
  if (!grandFinal) return false;

  const { data: bouts, error: boutError } = await db
    .from('matches')
    .select('bracket_slot_id, winner_registration_id')
    .in(
      'bracket_slot_id',
      rows.map((slot) => slot.id),
    );
  if (boutError) throw new Error(`grand final read failed: ${boutError.message}`);
  const byslot = new Map(
    (
      (bouts ?? []) as Array<{ bracket_slot_id: string; winner_registration_id: string | null }>
    ).map((bout) => [bout.bracket_slot_id, bout]),
  );
  const winner = byslot.get(grandFinal.id)?.winner_registration_id ?? null;
  // The winners' side won it (slot side A, `grandFinalEndsBracket`): the bracket is over.
  if (!winner || winner === grandFinal.registration_a_id) return false;
  const reset = rows.find((slot) => slot.round === grandFinalRound + 1);
  return !reset || !byslot.has(reset.id);
}

function isOpen(status: string | undefined): status is (typeof OPEN_STATUSES)[number] {
  return (OPEN_STATUSES as readonly string[]).includes(status ?? '');
}
