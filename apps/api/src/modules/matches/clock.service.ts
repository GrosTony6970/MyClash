/**
 * apps/api/src/modules/matches/clock.service.ts
 *
 * Match clock service — persists clock state as match_events rows.
 * Clock state is always recomputed from the match_events timeline,
 * never stored as a separate field. This makes it lossless and replayable.
 *
 * Clock actions: start | halt | resume | end | reset_clock
 *
 * Active time = sum of (resume_at - start_at) intervals.
 * Current active time = sum of closed intervals + (now - last_start) if running.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type ClockAction = 'start' | 'halt' | 'resume' | 'end' | 'reset_clock';

export interface ClockState {
  matchId: string;
  status: 'idle' | 'running' | 'halted' | 'ended';
  /** Total active time in milliseconds (excluding current running interval) */
  activeMs: number;
  /** If running: timestamp when the current interval started */
  runningFrom: string | null;
  /** Computed total active time including current interval (if running) */
  totalActiveMs: number;
  events: Array<{
    id: string;
    type: ClockAction;
    occurredAt: string;
    reason: string | null;
  }>;
}

// Valid transitions
const VALID_TRANSITIONS: Record<string, ClockAction[]> = {
  idle: ['start'],
  running: ['halt', 'end'],
  halted: ['resume', 'end', 'reset_clock'],
  ended: [],
};

@Injectable()
export class ClockService {
  private readonly logger = new Logger(ClockService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ── Get clock state ───────────────────────────────────────────────────────

  async getClockState(matchId: string): Promise<ClockState> {
    const { data: events, error } = await this.supabase.service
      .from('match_events')
      .select('id, type, reason, occurred_at')
      .eq('match_id', matchId)
      .in('type', ['start', 'halt', 'resume', 'end', 'reset_clock'])
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
    byUserId?: string,
  ): Promise<ClockState> {
    // Verify match exists
    const { data: match } = await this.supabase.service
      .from('matches')
      .select('id, status')
      .eq('id', matchId)
      .maybeSingle();

    if (!match) throw new NotFoundException(`Match ${matchId} not found`);

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

    // Insert match_event
    await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence,
      type: action,
      reason: reason ?? null,
      by_user_id: byUserId ?? null,
      occurred_at: now,
    });

    // Update match status if needed
    if (action === 'start' || action === 'resume') {
      await this.supabase.service
        .from('matches')
        .update({ status: 'running', started_at: action === 'start' ? now : undefined })
        .eq('id', matchId);
    } else if (action === 'halt') {
      await this.supabase.service.from('matches').update({ status: 'paused' }).eq('id', matchId);
    } else if (action === 'end') {
      await this.supabase.service
        .from('matches')
        .update({ status: 'completed', ended_at: now })
        .eq('id', matchId);
    }

    this.logger.log(`Match ${matchId}: clock ${action}`);
    return this.getClockState(matchId);
  }

  // ── Compute clock state from events ──────────────────────────────────────

  computeClockState(
    matchId: string,
    rawEvents: Array<{ id: string; type: string; reason: string | null; occurred_at: string }>,
  ): ClockState {
    const events = rawEvents.map((e) => ({
      id: e.id,
      type: e.type as ClockAction,
      occurredAt: e.occurred_at,
      reason: e.reason,
    }));

    let status: ClockState['status'] = 'idle';
    let activeMs = 0;
    let runningFrom: string | null = null;

    for (const ev of events) {
      switch (ev.type) {
        case 'start':
          status = 'running';
          runningFrom = ev.occurredAt;
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

        case 'reset_clock':
          // Reset: clear all accumulated time, go back to halted
          activeMs = 0;
          runningFrom = null;
          status = 'halted';
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
      events,
    };
  }
}
