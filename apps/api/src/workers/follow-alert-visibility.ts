/**
 * follow-alert-visibility.ts — may a follower's "starting soon" still fire?
 *
 * A follow alert is queued when its bout, duty or Workshop gets a time, and an organiser times a
 * draft before publishing it (the planner, ruling 166b). Publishing queues nothing again, so the
 * check runs when the alert FIRES: one about something the public may not see is dropped then.
 * Public things only, for every follower, a club member included (rulings 129, 130, 163), as the
 * follow's own next-bout line; a referee's duty holds ruling 126's bar. A draft published before
 * the minute comes still rings; one sent back to draft goes silent. A deleted one is silent too.
 *
 * The fighter's own alerts are not this gate's: a kind not named `follow_…` passes. A new follow
 * kind must join the switch below, or the typecheck fails: nothing falls through to "send".
 */
import { isPublicTournamentEmbed } from '../common/auth/competition-visibility';
import { isPublicEvent } from '../common/auth/event-read-gate';
import { PUBLIC_WORKSHOP_STATUSES } from '../modules/workshops/workshop-visibility';
import type { SupabaseService } from '../modules/supabase/supabase.service';
import type {
  FollowNotificationKind,
  NotificationKind,
  ScheduledNotificationJob,
} from './notification-scheduler.worker';

type Row = Record<string, unknown> | null;

const isFollowKind = (kind: NotificationKind): kind is FollowNotificationKind =>
  kind.startsWith('follow_');

const TOURNAMENT = 'tournaments(status, events(status, event_kind))';

/** A to-one embed, as PostgREST hands it: an object or a one-element array. */
const one = (value: unknown): Row =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as Row;

/** The Tournament embed of a bout or a Pool: `phases(tournaments(…))`. */
const tournamentOf = (holder: Row): Row => one(one(holder?.['phases'])?.['tournaments']);

/** The row the alert is about, or null when it is gone. A failed read fails the job: no send. */
async function readRow(
  supabase: SupabaseService,
  [table, select, what]: readonly [string, string, string],
  id: string,
): Promise<Row> {
  const { data, error } = await supabase.service
    .from(table)
    .select(select)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return data as Row;
}

export async function isPublicFollowAlert(
  supabase: SupabaseService,
  job: Pick<ScheduledNotificationJob, 'kind' | 'entityId'>,
): Promise<boolean> {
  if (!isFollowKind(job.kind)) return true;
  switch (job.kind) {
    case 'follow_match_starting': {
      const read = ['matches', `phases(${TOURNAMENT})`, 'follow alert bout'] as const;
      return isPublicTournamentEmbed(tournamentOf(await readRow(supabase, read, job.entityId)));
    }
    case 'follow_referee_starting': {
      const select = `events(status, event_kind), pools(phases(${TOURNAMENT})), matches(phases(${TOURNAMENT}))`;
      const read = ['referee_assignments', select, 'follow alert referee duty'] as const;
      const duty = await readRow(supabase, read, job.entityId);
      // A Pool's or a bout's duty is public only in a public Tournament; a piste's has none.
      const tournament = tournamentOf(one(duty?.['pools'])) ?? tournamentOf(one(duty?.['matches']));
      return tournament
        ? isPublicTournamentEmbed(tournament)
        : isPublicEvent(one(duty?.['events']));
    }
    case 'follow_workshop_starting': {
      const select = 'workshops(status, events(status, event_kind))';
      const read = ['workshop_sessions', select, 'follow alert Workshop session'] as const;
      const workshop = one((await readRow(supabase, read, job.entityId))?.['workshops']);
      return (
        PUBLIC_WORKSHOP_STATUSES.includes(String(workshop?.['status'])) &&
        isPublicEvent(one(workshop?.['events']))
      );
    }
  }
}
