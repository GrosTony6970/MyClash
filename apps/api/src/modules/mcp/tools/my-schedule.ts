import { Logger } from '@nestjs/common';
import type { McpCaller, McpRefusal, McpToolDeps } from '../mcp-server';
import type { PersonSchedule } from '../../persons/public-schedule.service';
import { readableEventBySlug, type McpEvent } from './readable-event';

const logger = new Logger('McpMySchedule');

export interface MyScheduleAnswer {
  event: { name: string; slug: string };
  fights: {
    tournamentName: string | null;
    roundCode: string;
    opponentName: string | null;
    liceName: string | null;
    start: string | null;
    status: string;
    score: { mine: number; opponent: number };
  }[];
  refereeing: {
    tournamentName: string | null;
    poolName: string | null;
    role: string;
    liceName: string | null;
    start: string | null;
    end: string | null;
  }[];
  workshops: {
    name: string;
    start: string | null;
    end: string | null;
    location: string | null;
    cancelled: boolean;
  }[];
}

/**
 * The person's own Matches, referee duties and Workshops at one Event: what `/e/<slug>/my-schedule`
 * shows. The person is found by the connector's login, never by a name the model gives. Every id
 * is dropped; a bout is named by its code. The schedule has no Tournament slug, so none is shown.
 */
export async function mySchedule(
  eventSlug: string,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<MyScheduleAnswer | McpRefusal> {
  const event = await readableEventBySlug(eventSlug, caller, deps);
  if (!event) return { refusal: `No Event "${eventSlug}" that you can see.` };

  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('id')
    .eq('claimed_by_user_id', caller.userId)
    .eq('event_id', event.id)
    .maybeSingle();
  // A failed read is not "not on the roster": that answer would tell a person who is on it that
  // they are not.
  if (error) {
    logger.error(`mcp my_schedule: roster read failed: ${error.message}`);
    return { refusal: 'Could not read your schedule. Try again.' };
  }
  const personId = (data as { id: string } | null)?.id;
  if (!personId) return { refusal: `You are not on the roster of ${event.name}.` };

  // The person reads their own schedule: the requester is the person, so nothing is hidden.
  return toAnswer(event, await deps.schedule.getSchedule(event.id, personId, personId));
}

function toAnswer(event: McpEvent, schedule: PersonSchedule): MyScheduleAnswer {
  return {
    event: { name: event.name, slug: event.slug },
    fights: schedule.matches.map((m) => ({
      tournamentName: m.tournamentName,
      roundCode: m.roundCode,
      opponentName: m.opponentName,
      liceName: m.liceName,
      start: m.scheduledAt,
      status: m.status,
      score: m.isRed
        ? { mine: m.redScore, opponent: m.blueScore }
        : { mine: m.blueScore, opponent: m.redScore },
    })),
    refereeing: schedule.refereeSlots.map((s) => ({
      tournamentName: s.tournamentName,
      poolName: s.poolName,
      role: s.role,
      liceName: s.liceName,
      start: s.startsAt ?? s.scheduledAt,
      end: s.endsAt,
    })),
    workshops: (schedule.workshops ?? []).map((w) => ({
      name: w.workshopName,
      start: w.sessionStart,
      end: w.sessionEnd,
      location: w.location,
      cancelled: w.sessionCancelled,
    })),
  };
}
