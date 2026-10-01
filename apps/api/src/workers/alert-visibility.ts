/**
 * alert-visibility.ts — may a "starting soon" still fire?
 *
 * An alert is queued when its bout, duty or Workshop gets a time, and an organiser times a draft
 * before publishing it (the planner, ruling 166b). Publishing queues nothing again, so the check
 * runs when the alert FIRES: one about a draft is dropped then, for everyone, a club member
 * included: a follower's alerts (rulings 129, 130, 163) and the fighter's and the referee's own
 * (rulings 183, 184); a duty holds ruling 126's bar. A TEST Event rings like any other: it is a
 * rehearsal of the day (ruling 185). A draft published before the minute comes still rings; one
 * sent back to draft goes silent. A deleted one is silent too. The referee's lock message is sent
 * at once, so a draft going to published or running sends it again (rulings 186, 190, 191).
 */
import { PUBLIC_TOURNAMENT_STATUSES } from '../common/auth/competition-visibility';
import { isPublicEvent } from '../common/auth/event-read-gate';
import { PUBLIC_WORKSHOP_STATUSES } from '../modules/workshops/workshop-visibility';
import type { SupabaseService } from '../modules/supabase/supabase.service';
import type { NotificationKind, ScheduledNotificationJob } from './notification-scheduler.worker';

type Row = Record<string, unknown> | null;
/** Is the thing this alert is about public right now? */
type Check = (supabase: SupabaseService, id: string) => Promise<boolean>;

const TOURNAMENT = 'tournaments(status, events(status))';

/** A to-one embed, as PostgREST hands it: an object or a one-element array. */
const one = (value: unknown): Row =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as Row;

/** The Tournament embed of a bout or a Pool: `phases(tournaments(…))`. */
const tournamentOf = (holder: Row): Row => one(one(holder?.['phases'])?.['tournaments']);

/**
 * An Event that is not a draft, whatever its kind (ruling 185): `isPublicEvent` asked of the
 * status alone. A row read without its status is silent.
 */
const eventRings = (event: Row): boolean =>
  Boolean(event?.['status']) && isPublicEvent({ status: event?.['status'] });

/** A published, running or completed Tournament of an Event that rings. */
const tournamentRings = (tournament: Row): boolean =>
  PUBLIC_TOURNAMENT_STATUSES.has(String(tournament?.['status'])) &&
  eventRings(one(tournament?.['events']));

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

const boutIsPublic: Check = async (supabase, id) => {
  const read = ['matches', `phases(${TOURNAMENT})`, 'alert bout'] as const;
  return tournamentRings(tournamentOf(await readRow(supabase, read, id)));
};

const dutyIsPublic: Check = async (supabase, id) => {
  const select = `events(status), pools(phases(${TOURNAMENT})), matches(phases(${TOURNAMENT}))`;
  const duty = await readRow(supabase, ['referee_assignments', select, 'alert referee duty'], id);
  // A Pool's or a bout's duty is public only in a public Tournament; a piste's has none.
  const tournament = tournamentOf(one(duty?.['pools'])) ?? tournamentOf(one(duty?.['matches']));
  return tournament ? tournamentRings(tournament) : eventRings(one(duty?.['events']));
};

const workshopIsPublic: Check = async (supabase, id) => {
  const select = 'workshops(status, events(status))';
  const read = ['workshop_sessions', select, 'alert Workshop session'] as const;
  const workshop = one((await readRow(supabase, read, id))?.['workshops']);
  return (
    PUBLIC_WORKSHOP_STATUSES.includes(String(workshop?.['status'])) &&
    eventRings(one(workshop?.['events']))
  );
};

/**
 * What each kind is about, so what must be public when it fires; null = not checked here. Every
 * kind is named: a new one fails the typecheck until it is placed here, so none rings by default.
 */
const CHECKS: Record<NotificationKind, Check | null> = {
  match_starting: boutIsPublic,
  follow_match_starting: boutIsPublic,
  referee_starting: dutyIsPublic,
  follow_referee_starting: dutyIsPublic,
  follow_workshop_starting: workshopIsPublic,
  // The lock message (ruling 186): held for a draft, sent again as it goes to published or running
  // (`lockedDutiesPublished`).
  assignment_changed: dutyIsPublic,
  // Addressed to the booking's roster id, not an account: it reaches no one (enrollment.service).
  // Once it reaches an account, it takes `workshopIsPublic`.
  workshop_starting: null,
  workshop_cancelled: null,
  waitlist_promoted: null,
  exchange_edit_rejected: null,
  organizer_broadcast: null,
  organizer_published_event: null,
  // Checked when queued: a public Tournament of a public Event (`resultsPublished`, rulings 196,
  // 197). Held here, a refused notice would keep its job id and swallow the later send for a day.
  results_published: null,
  // Checked when queued, on the same bar (swiss-round-context.ts, ruling 198).
  swiss_round_published: null,
};

export async function isPublicAlert(
  supabase: SupabaseService,
  job: Pick<ScheduledNotificationJob, 'kind' | 'entityId'>,
): Promise<boolean> {
  const check = CHECKS[job.kind];
  return check ? check(supabase, job.entityId) : true;
}
