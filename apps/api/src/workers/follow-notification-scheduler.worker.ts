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
  notify_match_start: boolean | null;
}

interface NotificationPreferenceRow {
  user_id: string;
  enabled: boolean | null;
  match_starting_minutes_before: string | number | null;
}

export function buildFollowNotificationJobId(matchId: string, followerUserId: string): string {
  return `follow:match_starting:${matchId}:${followerUserId}`;
}

function fighterName(registration: RegistrationRow | undefined): string {
  const given = registration?.persons?.given_name?.trim() ?? '';
  const family = registration?.persons?.family_name?.trim() ?? '';
  return `${given} ${family}`.trim() || 'A followed fighter';
}

function readLeadMinutes(row: NotificationPreferenceRow | undefined): number {
  const raw = row?.match_starting_minutes_before;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
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
  }

  private async replaceJob(
    job: ScheduledNotificationJob,
    startsAt: string,
    leadMinutes: number,
    now: Date,
  ): Promise<void> {
    const jobId = buildFollowNotificationJobId(job.entityId, job.userId);
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
      .select('user_id, enabled, match_starting_minutes_before')
      .in('user_id', userIds);
    return new Map(((data ?? []) as NotificationPreferenceRow[]).map((row) => [row.user_id, row]));
  }
}
