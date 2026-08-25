/**
 * apps/api/src/modules/matches/clock.service.ts
 *
 * Match clock service — persists clock state as match_events rows.
 * Clock state is always recomputed from the match_events timeline,
 * never stored as a separate field. This makes it lossless and replayable.
 *
 * Clock actions: start | halt | resume | end | reopen | reset_clock
 *
 * Active time = sum of (resume_at - start_at) intervals.
 * Current active time = sum of closed intervals + (now - last_start) if running.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value import, not `import type`: Nest needs the runtime class for DI metadata.
import { MatchCompletionService } from '../phases/match-completion.service';
import { popLastClosedRoundColumns } from './reopen-match-columns';
import { timeLimitResult } from './time-limit-result';

export type ClockAction =
  'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock' | 'adjust_time' | 'reset_match';

export interface ClockState {
  matchId: string;
  status: 'idle' | 'running' | 'halted' | 'ended';
  /** Total active time in milliseconds (excluding current running interval) */
  activeMs: number;
  /** If running: timestamp when the current interval started */
  runningFrom: string | null;
  /** Computed total active time including current interval (if running) */
  totalActiveMs: number;
  /** Wall-clock origin: ISO timestamp of the first 'start' event; null until match starts; resets on reset_match */
  startedAt: string | null;
  events: Array<{
    id: string;
    type: ClockAction;
    occurredAt: string;
    reason: string | null;
    adjustmentMs: number | null;
  }>;
}

// Valid transitions
const VALID_TRANSITIONS: Record<string, ClockAction[]> = {
  idle: ['start'],
  running: ['halt', 'end'],
  halted: ['resume', 'end', 'reset_clock'],
  ended: ['reopen'],
};

@Injectable()
export class ClockService {
  private readonly logger = new Logger(ClockService.name);

  constructor(
    private readonly supabase: SupabaseService,
    /** Optional so tests and non-Phases consumers still construct. */
    @Optional() private readonly matchCompletion?: MatchCompletionService,
  ) {}

  // ── Get clock state ───────────────────────────────────────────────────────

  async getClockState(matchId: string): Promise<ClockState> {
    const { data: events, error } = await this.supabase.service
      .from('match_events')
      .select('id, type, reason, occurred_at, adjustment_ms')
      .eq('match_id', matchId)
      .in('type', [
        'start',
        'halt',
        'resume',
        'end',
        'reopen',
        'reset_clock',
        'adjust_time',
        'reset_match',
      ])
      .order('occurred_at', { ascending: true })
      .order('sequence', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return this.computeClockState(matchId, events ?? []);
  }

  // ── Clock action ──────────────────────────────────────────────────────────

  async clockAction(
    matchId: string,
    action: ClockAction,
    reason?: string,
    actor?: {
      userId?: string;
      staffAccountId?: string;
      canOverrideLocked?: boolean;
      canDiscardDependentResults?: boolean;
    },
    discardDependents = false,
  ): Promise<ClockState> {
    // Verify match exists
    const { data: match } = await this.supabase.service
      .from('matches')
      .select(
        // The scores and the phase's match format are here so `end` can NAME
        // the winner of a bout that ran out of time — see `timeLimitResult`.
        'id, status, locked_at, started_at, rounds_json, current_round, ' +
          'red_registration_id, blue_registration_id, red_score, blue_score, match_number_label, ' +
          'phases(type, tournaments(ruleset_config))',
      )
      .eq('id', matchId)
      .maybeSingle();

    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    if ((match as { locked_at?: string | null }).locked_at && !actor?.canOverrideLocked) {
      throw new BadRequestException('Match is locked');
    }

    // Get current state
    const current = await this.getClockState(matchId);

    // Validate transition
    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(action)) {
      throw new BadRequestException(
        `Cannot ${action} clock when status is '${current.status}'. ` +
          `Allowed: ${allowed.length ? allowed.join(', ') : 'none'}`,
      );
    }

    // Four of the six actions write a non-completed status, and the transition
    // table above cannot see that: it is keyed on the clock status replayed from
    // `match_events`, and never reads `matches.status`. A bout completed without
    // an `end` event — every `PATCH /status` completion, every forfeit or point
    // cap on a clock that was never started — has clock status 'idle', so
    // 'start' is legal on it, and 'halt' and 'resume' after that. Only 'reopen'
    // looks like an un-completion; all four are one.
    //
    // Owned once, here, before the event row is written, so a refusal leaves the
    // timeline as well as the row untouched.
    if (
      (match as { status?: string }).status === 'completed' &&
      action !== 'end' &&
      action !== 'reset_clock'
    ) {
      await this.matchCompletion?.onMatchUncompleted(matchId, {
        actor,
        discardDependents,
        reason: reason ?? `clock ${action}`,
      });
    }

    // Get next sequence number
    const { data: lastEvent } = await this.supabase.service
      .from('match_events')
      .select('sequence')
      .eq('match_id', matchId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sequence = ((lastEvent as { sequence: number } | null)?.sequence ?? 0) + 1;
    const now = new Date().toISOString();

    // Insert match_event. The error MUST be checked: an unchecked failed
    // insert would return a recomputed-but-unchanged clock with HTTP 200 —
    // a silent no-op the operator can't diagnose.
    const { error: insertErr } = await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence,
      type: action,
      reason: reason ?? null,
      by_user_id: actor?.userId ?? null,
      staff_account_id: actor?.staffAccountId ?? null,
      occurred_at: now,
    });
    if (insertErr) throw new BadRequestException(insertErr.message);

    // Update match status if needed
    if (action === 'start' || action === 'resume') {
      await this.supabase.service
        .from('matches')
        .update({ status: 'running', started_at: action === 'start' ? now : undefined })
        .eq('id', matchId);
    } else if (action === 'halt') {
      await this.supabase.service.from('matches').update({ status: 'paused' }).eq('id', matchId);
    } else if (action === 'end') {
      let finalActiveMs = current.activeMs;
      if (current.status === 'running' && current.runningFrom) {
        finalActiveMs += new Date(now).getTime() - new Date(current.runningFrom).getTime();
      }
      const matchStartedAt = (match as { started_at?: string | null }).started_at;
      const durationTotalMs = matchStartedAt
        ? new Date(now).getTime() - new Date(matchStartedAt).getTime()
        : null;
      await this.supabase.service
        .from('matches')
        .update({
          status: 'completed',
          ended_at: now,
          duration_active_ms: finalActiveMs,
          ...(durationTotalMs !== null ? { duration_total_ms: durationTotalMs } : {}),
          ...timeLimitResult(match as unknown as Record<string, unknown>),
        })
        .eq('id', matchId);
      // Ending the clock completes the match, so the bracket must advance here
      // too — this and the point-cap path in ScoringService are the only ways a
      // pad-scored match ever finishes. It can advance now: the update above
      // NAMES the leader, where it used to leave the winner null and strand
      // every time-limit bout in the bracket.
      await this.matchCompletion?.onMatchCompleted(matchId);
    } else if (action === 'reopen') {
      // Reverses a prior 'end': clock goes back to halted with the
      // accumulated active time preserved (computeClockState reads the
      // same event-sourced timeline). Clears ended_at + locked_at so
      // scoring can resume.
      const reopenUpdates: Record<string, unknown> = {
        status: 'paused',
        ended_at: null,
        locked_at: null,
        duration_total_ms: null,
      };
      // Best-of: pop the last closed round so the deciding round reopens for
      // correction, and clear the series winner/end_reason set on completion.
      // Single-round matches (no rounds_json) keep their winner so a bare
      // reopen → end round-trip preserves the result.
      const poppedRound = popLastClosedRoundColumns(
        (match as { rounds_json?: unknown }).rounds_json,
        (match as { current_round?: number }).current_round ?? 1,
      );
      if (poppedRound) Object.assign(reopenUpdates, poppedRound);
      await this.supabase.service.from('matches').update(reopenUpdates).eq('id', matchId);
    }

    this.logger.log(`Match ${matchId}: clock ${action}`);
    return this.getClockState(matchId);
  }

  async adjustTime(
    matchId: string,
    adjustmentMs: number,
    reason?: string,
    actor?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ): Promise<ClockState> {
    const { data: match } = await this.supabase.service
      .from('matches')
      .select('id, locked_at')
      .eq('id', matchId)
      .maybeSingle();
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    if ((match as { locked_at?: string | null }).locked_at && !actor?.canOverrideLocked) {
      throw new BadRequestException('Match is locked');
    }
    const sequence = await this.nextSequence(matchId);
    // Same silent-no-op guard as clockAction: a failed insert must surface
    // as an error, not as an unchanged clock with HTTP 200.
    const { error: insertErr } = await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence,
      type: 'adjust_time',
      reason: reason ?? null,
      adjustment_ms: adjustmentMs,
      by_user_id: actor?.userId ?? null,
      staff_account_id: actor?.staffAccountId ?? null,
      occurred_at: new Date().toISOString(),
    });
    if (insertErr) throw new BadRequestException(insertErr.message);
    return this.getClockState(matchId);
  }

  // ── Compute clock state from events ──────────────────────────────────────

  computeClockState(
    matchId: string,
    rawEvents: Array<{
      id: string;
      type: string;
      reason: string | null;
      occurred_at: string;
      adjustment_ms?: number | null;
    }>,
  ): ClockState {
    const events = rawEvents.map((e) => ({
      id: e.id,
      type: e.type as ClockAction,
      occurredAt: e.occurred_at,
      reason: e.reason,
      adjustmentMs: e.adjustment_ms ?? null,
    }));

    let status: ClockState['status'] = 'idle';
    let activeMs = 0;
    let runningFrom: string | null = null;
    let startedAt: string | null = null;

    for (const ev of events) {
      switch (ev.type) {
        case 'start':
          status = 'running';
          runningFrom = ev.occurredAt;
          if (startedAt === null) startedAt = ev.occurredAt;
          break;

        case 'halt':
          if (runningFrom) {
            activeMs += new Date(ev.occurredAt).getTime() - new Date(runningFrom).getTime();
            runningFrom = null;
          }
          status = 'halted';
          break;

        case 'resume':
          status = 'running';
          runningFrom = ev.occurredAt;
          break;

        case 'end':
          if (runningFrom) {
            activeMs += new Date(ev.occurredAt).getTime() - new Date(runningFrom).getTime();
            runningFrom = null;
          }
          status = 'ended';
          break;

        case 'reopen':
          // Inverse of 'end' — keep the accumulated activeMs, return
          // the clock to halted so the referee can resume or end again.
          runningFrom = null;
          status = 'halted';
          break;

        case 'reset_clock':
          // Reset: clear all accumulated time, go back to halted
          activeMs = 0;
          runningFrom = null;
          status = 'halted';
          break;

        case 'adjust_time':
          activeMs = Math.max(0, activeMs + (ev.adjustmentMs ?? 0));
          break;

        case 'reset_match':
          activeMs = 0;
          runningFrom = null;
          status = 'idle';
          startedAt = null;
          break;
      }
    }

    // Compute total including current running interval
    const totalActiveMs =
      status === 'running' && runningFrom
        ? activeMs + (Date.now() - new Date(runningFrom).getTime())
        : activeMs;

    return {
      matchId,
      status,
      activeMs,
      runningFrom,
      totalActiveMs,
      startedAt,
      events,
    };
  }

  private async nextSequence(matchId: string): Promise<number> {
    const { data: lastEvent } = await this.supabase.service
      .from('match_events')
      .select('sequence')
      .eq('match_id', matchId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();

    return ((lastEvent as { sequence: number } | null)?.sequence ?? 0) + 1;
  }
}
