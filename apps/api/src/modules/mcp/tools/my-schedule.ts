import type { McpCaller, McpToolDeps } from '../mcp-server';
import type { McpRefusal } from './mcp-answer';
import type { PersonSchedule } from '../../persons/public-schedule.service';
import { noEventRefusal, readableEventBySlug, type McpEvent } from './readable-event';

export interface MyScheduleAnswer {
  /** `timezone` is the Event's own IANA zone; every time below is UTC ISO. */
  event: { name: string; slug: string; timezone: string };
  fights: {
    tournamentName: string | null;
    roundCode: string;
    opponentName: string | null;
    liceName: string | null;
    start: string | null;
    status: string;
    /** The person's result (win, loss, draw), null until the bout is completed. */
    result: 'win' | 'loss' | 'draw' | null;
    /** Null while the bout is still scheduled: a 0-0 there is no score. */
    score: { mine: number; opponent: number } | null;
  }[];
  refereeing: {
    tournamentName: string | null;
    poolName: string | null;
    /** The duty's role by name (the skill's name), the raw role when it has none. */
    role: string;
    roundCode: string | null;
    liceName: string | null;
    start: string | null;
    end: string | null;
  }[];
  /** The sessions the person teaches and the ones they booked, by start (untimed last). A session
   *  both taught and booked is listed once, as taught. */
  workshops: {
    name: string;
    /** Whether the person teaches the session or attends it. */
    role: 'teaching' | 'attending';
    start: string | null;
    end: string | null;
    location: string | null;
    cancelled: boolean;
    /** A place on the waiting list, not a seat. Never for a session taught. */
    waitlisted: boolean;
    /** Who teaches a session the person attends (less instructors who hide their Workshops);
     *  empty for one they teach. */
    instructors: string[];
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
  if (!event) return noEventRefusal(eventSlug);

  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('id')
    .eq('claimed_by_user_id', caller.userId)
    .eq('event_id', event.id)
    .maybeSingle();
  // A failed read is not "not on the roster": that answer would tell a person who is on it that
  // they are not. It throws; `answer()` logs it and sends the generic failure.
  if (error) throw new Error(`roster read failed: ${error.message}`);
  const personId = (data as { id: string } | null)?.id;
  if (!personId) return { refusal: `You are not on the roster of ${event.name}.` };

  // The person reads their own schedule: the requester is the person, so nothing is hidden.
  return toAnswer(event, await deps.schedule.getSchedule(event.id, personId, personId));
}

function toAnswer(event: McpEvent, schedule: PersonSchedule): MyScheduleAnswer {
  return {
    event: { name: event.name, slug: event.slug, timezone: event.timezone },
    fights: schedule.matches.map((m) => ({
      tournamentName: m.tournamentName,
      roundCode: m.roundCode,
      opponentName: m.opponentName,
      liceName: m.liceName,
      start: m.scheduledAt,
      status: m.status,
      // The app shows Win/Loss/Draw from `outcome`, never from the scores: a forfeit wins on the
      // lower one.
      result: m.outcome,
      score:
        m.status === 'scheduled'
          ? null
          : m.isRed
            ? { mine: m.redScore, opponent: m.blueScore }
            : { mine: m.blueScore, opponent: m.redScore },
    })),
    refereeing: schedule.refereeSlots.map((s) => ({
      tournamentName: s.tournamentName,
      poolName: s.poolName,
      // The skill's name, as the app shows it; the raw role is a skill id (`custom-<hex>-<nonce>`).
      role: s.skillName ?? s.role,
      roundCode: s.roundCode || null,
      liceName: s.liceName,
      start: s.startsAt ?? s.scheduledAt,
      end: s.endsAt,
    })),
    workshops: workshopsOf(schedule),
  };
}

/** The classes taught, then the seats and waitlist places not on one of them, by start. */
function workshopsOf(schedule: PersonSchedule): MyScheduleAnswer['workshops'] {
  const teaching = schedule.teaching ?? [];
  const taught = new Set(teaching.map((s) => s.sessionId));
  const rows: MyScheduleAnswer['workshops'] = [
    ...teaching.map((s) => ({
      name: s.workshopName,
      role: 'teaching' as const,
      start: s.sessionStart,
      end: s.sessionEnd,
      location: s.location,
      cancelled: s.sessionCancelled,
      waitlisted: false,
      instructors: [],
    })),
    ...(schedule.workshops ?? [])
      .filter((w) => !taught.has(w.workshopId))
      .map((w) => ({
        name: w.workshopName,
        role: 'attending' as const,
        start: w.sessionStart,
        end: w.sessionEnd,
        location: w.location,
        cancelled: w.sessionCancelled,
        waitlisted: w.status === 'waitlisted',
        instructors: w.instructorNames,
      })),
  ];
  // Untimed last; ISO UTC strings sort as times.
  return rows.sort((a, b) => (a.start ?? '￿').localeCompare(b.start ?? '￿'));
}
