import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';
import {
  computeNotificationDelayMs,
  NOTIFICATION_QUEUE,
  NOTIFICATION_SEND_JOB,
  type ScheduledNotificationJob,
} from './notification-scheduler.worker';

interface MatchRow {
  id: string;
  match_number_label: string | null;
  scheduled_at: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  lices?: { name?: string | null; label?: string | null } | null;
  pools?: { name?: string | null } | null;
}

interface RegistrationRow {
  id: string;
  person_id: string | null;
  persons?: { given_name?: string | null; family_name?: string | null } | null;
}

interface FollowRow {
  followed_person_id: string | null;
  follower_user_id: string | null;
  notify_match_start?: boolean | null;
  notify_referee_start?: boolean | null;
  notify_workshop_start?: boolean | null;
}

interface WorkshopSessionRow {
  id: string;
  starts_at: string | null;
  status: string | null;
  workshops?: { id?: string | null; title?: string | null; event_id?: string | null } | null;
}

interface RefereeAssignmentRow {
  id: string;
  person_id: string | null;
  event_id: string | null;
  starts_at: string | null;
  role: string | null;
  matches?: {
    match_number_label?: string | null;
    scheduled_at?: string | null;
    lices?: { name?: string | null } | null;
  } | null;
}

interface NotificationPreferenceRow {
  user_id: string;
  enabled: boolean | null;
  match_starting_minutes_before: string | number | null;
  referee_starting_minutes_before?: string | number | null;
  workshop_starting_minutes_before?: string | number | null;
}

export function buildFollowNotificationJobId(matchId: string, followerUserId: string): string {
  return `follow:match_starting:${matchId}:${followerUserId}`;
}

export function buildFollowRefereeJobId(assignmentId: string, followerUserId: string): string {
  return `follow:referee_starting:${assignmentId}:${followerUserId}`;
}

export function buildFollowWorkshopJobId(sessionId: string, followerUserId: string): string {
  return `follow:workshop_starting:${sessionId}:${followerUserId}`;
}

function fighterName(registration: RegistrationRow | undefined): string {
  const given = registration?.persons?.given_name?.trim() ?? '';
  const family = registration?.persons?.family_name?.trim() ?? '';
  return `${given} ${family}`.trim() || 'A followed fighter';
}

function parseLeadMinutes(raw: string | number | null | undefined, fallback = 10): number {
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readLeadMinutes(row: NotificationPreferenceRow | undefined): number {
  return parseLeadMinutes(row?.match_starting_minutes_before);
}

function readRefereeLeadMinutes(row: NotificationPreferenceRow | undefined): number {
  return parseLeadMinutes(row?.referee_starting_minutes_before);
}

function readWorkshopLeadMinutes(row: NotificationPreferenceRow | undefined): number {
  return parseLeadMinutes(row?.workshop_starting_minutes_before, 15);
}

@Injectable()
export class FollowNotificationSchedulerService {
  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
  ) {}

  async scheduleMatchStarting(matchId: string, now = new Date()): Promise<void> {
    const match = await this.getMatch(matchId);
    if (!match?.scheduled_at) return;

    const registrations = await this.getRegistrations([
      match.red_registration_id,
      match.blue_registration_id,
    ]);
    const byRegistrationId = new Map(registrations.map((row) => [row.id, row]));
    const red = byRegistrationId.get(match.red_registration_id ?? '');
    const blue = byRegistrationId.get(match.blue_registration_id ?? '');
    const personIds = [red?.person_id, blue?.person_id].filter((id): id is string => Boolean(id));
    if (personIds.length === 0) return;

    const follows = await this.getClaimedMatchFollows(personIds);
    const preferences = await this.getPreferences(
      follows.map((follow) => follow.follower_user_id).filter((id): id is string => Boolean(id)),
    );

    await Promise.all(
      follows.map((follow) => {
        if (!follow.follower_user_id || !follow.followed_person_id) return undefined;
        const preference = preferences.get(follow.follower_user_id);
        if (preference?.enabled === false) return undefined;

        const leadMinutes = readLeadMinutes(preference);
        const followedRegistration = red?.person_id === follow.followed_person_id ? red : blue;
        const opponentRegistration = followedRegistration === red ? blue : red;
        const job: ScheduledNotificationJob = {
          kind: 'follow_match_starting',
          entityId: match.id,
          userId: follow.follower_user_id,
          title: 'Followed fighter starting soon',
          body: `${fighterName(followedRegistration)} fights in ${leadMinutes} min - ${
            match.pools?.name ?? match.match_number_label ?? 'Match'
          } vs ${fighterName(opponentRegistration)} on ${
            match.lices?.name ?? match.lices?.label ?? 'their lice'
          }.`,
          url: '/notifications',
        };
        return this.replaceJob(job, match.scheduled_at!, leadMinutes, now);
      }),
    );
  }

  async cancelMatchStarting(matchId: string, followerUserId: string): Promise<void> {
    const existing = await this.queue.getJob(buildFollowNotificationJobId(matchId, followerUserId));
    await existing?.remove();
  }

  async cancelForFollowedPerson(followedPersonId: string, followerUserId: string): Promise<void> {
    const { data: registrations } = await this.supabase.service
      .from('registrations')
      .select('id')
      .eq('person_id', followedPersonId);
    const registrationIds = ((registrations ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (registrationIds.length === 0) return;

    const { data: matches } = await this.supabase.service
      .from('matches')
      .select('id')
      .or(
        `red_registration_id.in.(${registrationIds.join(
          ',',
        )}),blue_registration_id.in.(${registrationIds.join(',')})`,
      );
    await Promise.all(
      ((matches ?? []) as Array<{ id: string }>).map((match) =>
        this.cancelMatchStarting(match.id, followerUserId),
      ),
    );

    // Also cancel any pending referee-start jobs for this followed person: bridge
    // the event-scoped persons.id → global identity → their referee assignments.
    const { data: person } = await this.supabase.service
      .from('persons')
      .select('global_person_id, event_id')
      .eq('id', followedPersonId)
      .maybeSingle();
    const p = person as { global_person_id: string | null; event_id: string | null } | null;
    if (!p?.global_person_id || !p.event_id) return;
    const { data: assignments } = await this.supabase.service
      .from('referee_assignments')
      .select('id')
      .eq('person_id', p.global_person_id)
      .eq('event_id', p.event_id);
    await Promise.all(
      ((assignments ?? []) as Array<{ id: string }>).map((assignment) =>
        this.cancelRefereeStarting(assignment.id, followerUserId),
      ),
    );

    // Cancel pending workshop-start jobs: instructor global identity → their
    // workshops in this event → their sessions.
    const { data: instructorRows } = await this.supabase.service
      .from('workshop_instructors')
      .select('workshop_id')
      .eq('global_person_id', p.global_person_id);
    const candidateWorkshopIds = [
      ...new Set(
        ((instructorRows ?? []) as Array<{ workshop_id: string }>).map((row) => row.workshop_id),
      ),
    ];
    if (candidateWorkshopIds.length === 0) return;
    const { data: eventWorkshops } = await this.supabase.service
      .from('workshops')
      .select('id')
      .in('id', candidateWorkshopIds)
      .eq('event_id', p.event_id);
    const workshopIds = ((eventWorkshops ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (workshopIds.length === 0) return;
    const { data: sessions } = await this.supabase.service
      .from('workshop_sessions')
      .select('id')
      .in('workshop_id', workshopIds);
    await Promise.all(
      ((sessions ?? []) as Array<{ id: string }>).map((session) =>
        this.cancelWorkshopStarting(session.id, followerUserId),
      ),
    );
  }

  private async replaceJob(
    job: ScheduledNotificationJob,
    startsAt: string,
    leadMinutes: number,
    now: Date,
  ): Promise<void> {
    const jobId =
      job.kind === 'follow_referee_starting'
        ? buildFollowRefereeJobId(job.entityId, job.userId)
        : job.kind === 'follow_workshop_starting'
          ? buildFollowWorkshopJobId(job.entityId, job.userId)
          : buildFollowNotificationJobId(job.entityId, job.userId);
    const existing = await this.queue.getJob(jobId);
    await existing?.remove();
    await this.queue.add(NOTIFICATION_SEND_JOB, job, {
      jobId,
      delay: computeNotificationDelayMs(startsAt, leadMinutes, now),
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  private async getMatch(matchId: string): Promise<MatchRow | null> {
    const { data } = await this.supabase.service
      .from('matches')
      .select(
        'id, match_number_label, scheduled_at, red_registration_id, blue_registration_id, lices ( name, label ), pools ( name )',
      )
      .eq('id', matchId)
      .maybeSingle();
    return (data as MatchRow | null) ?? null;
  }

  private async getRegistrations(
    registrationIds: Array<string | null>,
  ): Promise<RegistrationRow[]> {
    const ids = registrationIds.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];
    const { data } = await this.supabase.service
      .from('registrations')
      .select('id, person_id, persons ( given_name, family_name )')
      .in('id', ids);
    return (data ?? []) as RegistrationRow[];
  }

  private async getClaimedMatchFollows(personIds: string[]): Promise<FollowRow[]> {
    const { data } = await this.supabase.service
      .from('follows')
      .select('followed_person_id, follower_user_id, notify_match_start')
      .in('followed_person_id', personIds)
      .eq('notify_match_start', true);
    return ((data ?? []) as FollowRow[]).filter(
      (follow) => Boolean(follow.follower_user_id) && follow.notify_match_start !== false,
    );
  }

  private async getPreferences(userIds: string[]): Promise<Map<string, NotificationPreferenceRow>> {
    if (userIds.length === 0) return new Map();
    const { data } = await this.supabase.service
      .from('notification_preferences')
      .select(
        'user_id, enabled, match_starting_minutes_before, referee_starting_minutes_before, workshop_starting_minutes_before',
      )
      .in('user_id', userIds);
    return new Map(((data ?? []) as NotificationPreferenceRow[]).map((row) => [row.user_id, row]));
  }

  // ── Referee-starting (followers of a person who is about to referee) ───────────

  /**
   * Schedule "someone you follow is about to referee" reminders. Referee
   * assignments key on the GLOBAL person, whereas follows key on the event-scoped
   * persons.id — so we bridge global + event → persons.id, then read the follows
   * with notify_referee_start on. Mirrors scheduleMatchStarting; delivery reuses
   * the same NOTIFICATION_QUEUE → push/email pipeline.
   */
  async scheduleRefereeStarting(assignmentId: string, now = new Date()): Promise<void> {
    const assignment = await this.getRefereeAssignment(assignmentId);
    if (!assignment?.person_id || !assignment.event_id) return;
    const startsAt = assignment.starts_at ?? assignment.matches?.scheduled_at ?? null;
    if (!startsAt) return;

    const personIds = await this.getEventPersonIds(assignment.person_id, assignment.event_id);
    if (personIds.length === 0) return;

    const follows = await this.getClaimedRefereeFollows(personIds);
    if (follows.length === 0) return;

    const preferences = await this.getPreferences(
      follows.map((follow) => follow.follower_user_id).filter((id): id is string => Boolean(id)),
    );
    const refereeName = await this.getGlobalPersonName(assignment.person_id);

    await Promise.all(
      follows.map((follow) => {
        if (!follow.follower_user_id) return undefined;
        const preference = preferences.get(follow.follower_user_id);
        if (preference?.enabled === false) return undefined;

        const leadMinutes = readRefereeLeadMinutes(preference);
        const matchLabel = assignment.matches?.match_number_label;
        const liceName = assignment.matches?.lices?.name;
        const job: ScheduledNotificationJob = {
          kind: 'follow_referee_starting',
          entityId: assignment.id,
          userId: follow.follower_user_id,
          title: 'Followed referee starting soon',
          body: `${refereeName} referees in ${leadMinutes} min${
            matchLabel ? ` - ${matchLabel}` : ''
          }${liceName ? ` on ${liceName}` : ''}.`,
          url: '/notifications',
        };
        return this.replaceJob(job, startsAt, leadMinutes, now);
      }),
    );
  }

  async cancelRefereeStarting(assignmentId: string, followerUserId: string): Promise<void> {
    const existing = await this.queue.getJob(buildFollowRefereeJobId(assignmentId, followerUserId));
    await existing?.remove();
  }

  private async getRefereeAssignment(assignmentId: string): Promise<RefereeAssignmentRow | null> {
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .select(
        'id, person_id, event_id, starts_at, role, matches ( match_number_label, scheduled_at, lices ( name ) )',
      )
      .eq('id', assignmentId)
      .maybeSingle();
    return (data as RefereeAssignmentRow | null) ?? null;
  }

  /** Bridge a referee's global identity to their event-scoped persons row(s). */
  private async getEventPersonIds(globalPersonId: string, eventId: string): Promise<string[]> {
    const { data } = await this.supabase.service
      .from('persons')
      .select('id')
      .eq('global_person_id', globalPersonId)
      .eq('event_id', eventId);
    return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  private async getClaimedRefereeFollows(personIds: string[]): Promise<FollowRow[]> {
    const { data } = await this.supabase.service
      .from('follows')
      .select('followed_person_id, follower_user_id, notify_referee_start')
      .in('followed_person_id', personIds)
      .eq('notify_referee_start', true);
    return ((data ?? []) as FollowRow[]).filter(
      (follow) => Boolean(follow.follower_user_id) && follow.notify_referee_start !== false,
    );
  }

  private async getGlobalPersonName(globalPersonId: string): Promise<string> {
    const { data } = await this.supabase.service
      .from('global_persons')
      .select('display_name')
      .eq('id', globalPersonId)
      .maybeSingle();
    const name = (data as { display_name?: string | null } | null)?.display_name?.trim() ?? '';
    return name || 'A followed referee';
  }

  // ── Workshop-starting (followers of a workshop instructor) ─────────────────────

  /**
   * Schedule "an instructor you follow has a workshop starting" reminders.
   * Workshop instructors key on the GLOBAL person, whereas follows key on the
   * event-scoped persons.id — so we bridge global + event → persons.id, then read
   * the follows with notify_workshop_start on. Delivery reuses the same
   * NOTIFICATION_QUEUE → push/email pipeline.
   */
  async scheduleWorkshopStarting(sessionId: string, now = new Date()): Promise<void> {
    const session = await this.getWorkshopSession(sessionId);
    const workshop = session?.workshops;
    if (
      !session?.starts_at ||
      session.status === 'cancelled' ||
      !workshop?.id ||
      !workshop.event_id
    ) {
      return;
    }

    const instructorGlobalIds = await this.getWorkshopInstructorGlobalIds(workshop.id);
    if (instructorGlobalIds.length === 0) return;

    const personRows = await this.getEventPersonsForGlobals(instructorGlobalIds, workshop.event_id);
    if (personRows.length === 0) return;
    const personToGlobal = new Map(personRows.map((r) => [r.id, r.global_person_id]));

    const follows = await this.getClaimedWorkshopFollows([...personToGlobal.keys()]);
    if (follows.length === 0) return;

    const preferences = await this.getPreferences(
      follows.map((follow) => follow.follower_user_id).filter((id): id is string => Boolean(id)),
    );
    const nameByGlobal = await this.getGlobalPersonNames([
      ...new Set(personRows.map((r) => r.global_person_id)),
    ]);
    const title = workshop.title ?? 'A workshop';

    await Promise.all(
      follows.map((follow) => {
        if (!follow.follower_user_id || !follow.followed_person_id) return undefined;
        const preference = preferences.get(follow.follower_user_id);
        if (preference?.enabled === false) return undefined;

        const leadMinutes = readWorkshopLeadMinutes(preference);
        const globalId = personToGlobal.get(follow.followed_person_id);
        const instructor = (globalId && nameByGlobal.get(globalId)) || 'A followed instructor';
        const job: ScheduledNotificationJob = {
          kind: 'follow_workshop_starting',
          entityId: session.id,
          userId: follow.follower_user_id,
          title: 'Followed instructor workshop soon',
          body: `${title} with ${instructor} starts in ${leadMinutes} min.`,
          url: '/notifications',
        };
        return this.replaceJob(job, session.starts_at!, leadMinutes, now);
      }),
    );
  }

  async cancelWorkshopStarting(sessionId: string, followerUserId: string): Promise<void> {
    const existing = await this.queue.getJob(buildFollowWorkshopJobId(sessionId, followerUserId));
    await existing?.remove();
  }

  private async getWorkshopSession(sessionId: string): Promise<WorkshopSessionRow | null> {
    const { data } = await this.supabase.service
      .from('workshop_sessions')
      .select('id, starts_at, status, workshops ( id, title, event_id )')
      .eq('id', sessionId)
      .maybeSingle();
    return (data as WorkshopSessionRow | null) ?? null;
  }

  private async getWorkshopInstructorGlobalIds(workshopId: string): Promise<string[]> {
    const { data } = await this.supabase.service
      .from('workshop_instructors')
      .select('global_person_id')
      .eq('workshop_id', workshopId)
      .not('global_person_id', 'is', null);
    return ((data ?? []) as Array<{ global_person_id: string | null }>)
      .map((row) => row.global_person_id)
      .filter((id): id is string => Boolean(id));
  }

  /** Bridge instructor global identities to their event-scoped persons rows. */
  private async getEventPersonsForGlobals(
    globalPersonIds: string[],
    eventId: string,
  ): Promise<Array<{ id: string; global_person_id: string }>> {
    if (globalPersonIds.length === 0) return [];
    const { data } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id')
      .in('global_person_id', globalPersonIds)
      .eq('event_id', eventId);
    return ((data ?? []) as Array<{ id: string; global_person_id: string | null }>).filter(
      (row): row is { id: string; global_person_id: string } => Boolean(row.global_person_id),
    );
  }

  private async getClaimedWorkshopFollows(personIds: string[]): Promise<FollowRow[]> {
    if (personIds.length === 0) return [];
    const { data } = await this.supabase.service
      .from('follows')
      .select('followed_person_id, follower_user_id, notify_workshop_start')
      .in('followed_person_id', personIds)
      .eq('notify_workshop_start', true);
    return ((data ?? []) as FollowRow[]).filter(
      (follow) => Boolean(follow.follower_user_id) && follow.notify_workshop_start !== false,
    );
  }

  private async getGlobalPersonNames(globalPersonIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (globalPersonIds.length === 0) return map;
    const { data } = await this.supabase.service
      .from('global_persons')
      .select('id, display_name')
      .in('id', globalPersonIds);
    for (const row of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
      const name = row.display_name?.trim() ?? '';
      if (name) map.set(row.id, name);
    }
    return map;
  }
}
