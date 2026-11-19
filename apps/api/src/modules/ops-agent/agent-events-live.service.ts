import { Injectable } from '@nestjs/common';
import { canonicalZone, DEFAULT_EVENT_TIMEZONE, zonedDay } from '@myclash/time';
import { asEventKind, holdsBackRepairs } from '@myclash/types';
import { isOver } from '../../common/live-status';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { IN_PLAY } from '../matches/start-count';
import { SupabaseService } from '../supabase/supabase.service';
import type { AgentEventsLiveDto, AgentLiveSign } from './dto/agent-events-live.dto';

/** The door's answer when a read fails: the run treats it as "live" (the skill, §7). */
export const EVENTS_UNREADABLE_CODE = 'EVENTS_UNREADABLE';

const EVENT_COLUMNS = 'id, name, status, start_date, end_date, timezone, event_kind';
const NOT_OVER = ['draft', 'published', 'running'];
const SIGN_ORDER: readonly AgentLiveSign[] = ['status', 'bout', 'dates'];

interface EventRow {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  timezone: string | null;
  event_kind: string | null;
}

type Query = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Whether an Event is live now, for the ops agent's repairs (rulings 864, 882, 883). Any sign
 * counts: its status is `running`, a bout of it is in play, or today — in the Event's own zone —
 * falls between its dates. An Event that is over never counts, nor does a test Event. The answer
 * names each live Event and its signs; no roster, no person. A read that fails is a 503 with a
 * code, never "not live": the run then holds its repairs back.
 */
@Injectable()
export class AgentEventsLiveService {
  constructor(private readonly supabase: SupabaseService) {}

  async read(now: Date = new Date()): Promise<AgentEventsLiveDto> {
    const db = this.supabase.service;
    const live = new Map<string, { row: EventRow; signs: Set<AgentLiveSign> }>();
    const mark = (row: EventRow, sign: AgentLiveSign) => {
      if (isOver(row.status) || !holdsBackRepairs(asEventKind(row.event_kind))) return;
      const entry = live.get(row.id) ?? { row, signs: new Set<AgentLiveSign>() };
      entry.signs.add(sign);
      live.set(row.id, entry);
    };

    const events = await rows<EventRow>(
      db.from('events').select(EVENT_COLUMNS).in('status', NOT_OVER),
    );
    for (const row of events) {
      if (row.status === 'running') mark(row, 'status');
      const today = zonedDay(
        now.toISOString(),
        canonicalZone(row.timezone) ?? DEFAULT_EVENT_TIMEZONE,
      );
      if (today && row.start_date <= today && today <= row.end_date) mark(row, 'dates');
    }
    for (const row of await this.eventsWithBoutsInPlay()) mark(row, 'bout');

    return {
      generatedAt: now.toISOString(),
      live: live.size > 0,
      events: [...live.values()].map(({ row, signs }) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        signs: SIGN_ORDER.filter((sign) => signs.has(sign)),
      })),
    };
  }

  /** The Events of the bouts in play: bouts → phases → tournaments → Events. */
  private async eventsWithBoutsInPlay(): Promise<EventRow[]> {
    const db = this.supabase.service;
    const bouts = await rows<{ phase_id: string }>(
      db.from('matches').select('phase_id').in('status', IN_PLAY),
    );
    if (bouts.length === 0) return [];
    const phases = await rows<{ id: string; tournament_id: string }>(
      db
        .from('phases')
        .select('id, tournament_id')
        .in('id', unique(bouts.map((b) => b.phase_id))),
    );
    const tournaments = await rows<{ id: string; event_id: string }>(
      db
        .from('tournaments')
        .select('id, event_id')
        .in('id', unique(phases.map((p) => p.tournament_id))),
    );
    if (tournaments.length === 0) return [];
    return rows<EventRow>(
      db
        .from('events')
        .select(EVENT_COLUMNS)
        .in('id', unique(tournaments.map((t) => t.event_id))),
    );
  }
}

async function rows<T>(query: Query): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    throw new OperationalUnavailableException({
      code: EVENTS_UNREADABLE_CODE,
      message: 'The Events could not be read. Treat an Event as live.',
    });
  }
  return (data ?? []) as T[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
