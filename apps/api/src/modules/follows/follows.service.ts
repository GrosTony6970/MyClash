/**
 * follows.service.ts — T-610
 *
 * Manages follow rows. Supports both guest sessions and claimed users.
 * Idempotent POST. Respects allow_being_followed privacy setting.
 * Guest→claimed migration moves follows one row at a time.
 */

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { onlyPublicTournaments, type PublicReader } from '../../common/auth/competition-visibility';
import { isPublicEvent } from '../../common/auth/event-read-gate';
import { applyReachable } from '../fighters/directory-predicate';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrivacyService } from '../persons/privacy.service';
import { readEventPerson } from './event-person-gate';

export interface FollowRow {
  id: string;
  personId: string;
  personName: string;
  personClub: string | null;
  followedAt: string;
  notifyMatchStart: boolean;
  notifyWorkshopStart: boolean;
  /** Inline: next scheduled match for the followed person */
  nextEvent: NextEvent | null;
}

export interface NextEvent {
  type: 'match' | 'workshop';
  label: string;
  scheduledAt: string | null;
}

export interface FollowIdentity {
  /** Set for guest sessions */
  guestSessionId?: string;
  /** The one Event a guest session belongs to. */
  guestEventId?: string;
  /** Set for claimed users */
  userId?: string;
}

/** The `code` of the 403 a follow of someone who opted out gets. */
export const PREFERS_NOT_FOLLOWED = 'prefers_not_followed';

const hasFollower = (identity: FollowIdentity): boolean =>
  Boolean(identity.userId || identity.guestSessionId);

/** A guest session belongs to one Event: anywhere else it follows nobody (ruling 130). */
const guestOfAnotherEvent = (identity: FollowIdentity, eventId: string): boolean =>
  Boolean(identity.guestSessionId) && identity.guestEventId !== eventId;

/**
 * The column and value every follows query scopes to: the caller's own rows.
 * With neither id there is no follower to scope to, and a query without this
 * filter acts on EVERY follower of the person, so it refuses (ruling 102).
 */
function followerFilter(identity: FollowIdentity): [string, string] {
  if (identity.userId) return ['follower_user_id', identity.userId];
  if (identity.guestSessionId) return ['follower_guest_session_id', identity.guestSessionId];
  throw new UnauthorizedException('Sign in, or join the Event as a guest, to follow someone');
}

/** A follow plus the event it belongs to — for the cross-event "people I
 *  follow" list (the per-event endpoints stay event-scoped). */
export interface FollowRowCrossEvent extends FollowRow {
  eventId: string;
  eventName: string | null;
  eventSlug: string | null;
}

/** Outcome of following a global person across all their current/upcoming events. */
export interface FollowAllSummary {
  globalPersonId: string;
  upcomingEventCount: number;
  followedCount: number;
  alreadyFollowingCount: number;
  skippedPrivacyCount: number;
  /** Whether the persistent directory follow now exists (claimed users only). */
  following: boolean;
}

/** A persistent, event-independent follow (the "Following" tab source of truth). */
export interface DirectoryFollow {
  globalPersonId: string;
  followedAt: string;
}

/** The event-scoped follow that backs a global person's notification toggles. */
export interface EventFollowState {
  eventId: string;
  personId: string;
  notifyMatchStart: boolean;
  notifyWorkshopStart: boolean;
  notifyRefereeStart: boolean;
  /** The backing Event is upcoming and public: not over, not a draft, not a test Event. */
  active: boolean;
}

/** Normalize a PostgREST embed that may arrive as an object or a 1-element array. */
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/**
 * A query's data, or a 5xx naming what failed (ruling 117a): a failed read is
 * never "no rows", and a failed write is never "done".
 */
function dataOrThrow<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data;
}

/** Per-global-person follow state for the "People" hub cards. */
export interface FollowState {
  upcomingEventCount: number;
  followingEventCount: number;
}

const TERMINAL_EVENT_STATUSES = ['completed', 'archived'];

/**
 * Is this a current or upcoming Event the public sees? Not a draft or test Event (ruling 130: the
 * follow-everywhere fan-out, the People hub counts and the notification toggles leave those out),
 * and not over. A follow made before its Event went back to draft is not removed by this.
 */
function isUpcomingPublicEvent(event: { status?: unknown; event_kind?: unknown } | null): boolean {
  return (
    !!event && isPublicEvent(event) && !TERMINAL_EVENT_STATUSES.includes(String(event.status ?? ''))
  );
}

@Injectable()
export class FollowsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly privacy: PrivacyService,
    private readonly followNotifications: FollowNotificationSchedulerService,
    private readonly orgs: OrganizationsService,
  ) {}

  // ── List ─────────────────────────────────────────────────────────────────────

  async listFollows(eventId: string, identity: FollowIdentity): Promise<FollowRow[]> {
    if (!hasFollower(identity)) return [];
    const q = this.supabase.service
      .from('follows')
      .select(
        `
        id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
        persons ( given_name, family_name, clubs ( name ) )
      `,
      )
      .eq('event_id', eventId)
      .eq(...followerFilter(identity));

    const data = dataOrThrow(await q.order('created_at', { ascending: false }), 'follows read');
    if (!data) return [];

    const rows = data as Array<Record<string, unknown>>;
    return Promise.all(rows.map((r) => this.mapRow(r, eventId)));
  }

  /**
   * All of the session's follows across every event, with the event attached so
   * the personal-space "people I follow" page can group them. Same row query as
   * listFollows minus the event_id filter (+ an events embed). Note: mapRow
   * resolves each person's next match individually (N+1) — fine for the small
   * follow counts seen in practice; batch if it grows.
   */
  async listAllFollows(identity: FollowIdentity): Promise<FollowRowCrossEvent[]> {
    if (!hasFollower(identity)) return [];
    const q = this.supabase.service
      .from('follows')
      .select(
        `
        id, followed_person_id, event_id, created_at, notify_match_start, notify_workshop_start,
        persons ( given_name, family_name, clubs ( name ) ),
        events ( name, slug )
      `,
      )
      .eq(...followerFilter(identity));

    const data = dataOrThrow(await q.order('created_at', { ascending: false }), 'follows read');
    if (!data) return [];

    const rows = data as Array<Record<string, unknown>>;
    return Promise.all(
      rows.map(async (r) => {
        const eventId = r['event_id'] as string;
        const base = await this.mapRow(r, eventId);
        const event = r['events'] as { name: string; slug: string } | null;
        return {
          ...base,
          eventId,
          eventName: event?.name ?? null,
          eventSlug: event?.slug ?? null,
        } satisfies FollowRowCrossEvent;
      }),
    );
  }

  // ── Follow (idempotent) ───────────────────────────────────────────────────────

  /**
   * `POST /events/:eventId/follows` (ruling 130): the public person page's bar first, so a hidden
   * Event or a person of another Event answers exactly as an unknown person, and nothing about
   * them comes back. A guest session is nobody outside its own Event.
   */
  async followInEvent(
    eventId: string,
    personId: string,
    identity: FollowIdentity,
    reader: PublicReader,
  ): Promise<FollowRow> {
    const deps = { supabase: this.supabase, orgs: this.orgs };
    await readEventPerson(deps, eventId, personId, reader, 'id');
    return this.follow(eventId, personId, guestOfAnotherEvent(identity, eventId) ? {} : identity);
  }

  async follow(eventId: string, personId: string, identity: FollowIdentity): Promise<FollowRow> {
    const [followerColumn, follower] = followerFilter(identity);
    // Check privacy
    const priv = await this.privacy.getOrCreate(personId);
    if (!priv.allowBeingFollowed) {
      // Its own code: an archived Event refuses every follow write with a 403 too
      // (EventReadOnlyGuard), and the page must not blame the person for that.
      throw new ForbiddenException({
        code: PREFERS_NOT_FOLLOWED,
        message: 'This person prefers not to be followed',
      });
    }

    // Idempotency check
    const existing = await this.findExisting(eventId, personId, identity);
    if (existing) return this.mapRow(existing, eventId);

    // Insert
    const insert: Record<string, unknown> = {
      event_id: eventId,
      followed_person_id: personId,
      notify_match_start: true,
      notify_workshop_start: false,
      [followerColumn]: follower,
    };

    const data = dataOrThrow(
      await this.supabase.service
        .from('follows')
        .insert(insert)
        .select(
          `id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
         persons ( given_name, family_name, clubs ( name ) )`,
        )
        .single(),
      'follow write',
    );

    return this.mapRow(data as Record<string, unknown>, eventId);
  }

  /** Does this caller follow this person in this Event? A caller with no follower id does not. */
  async isFollowing(eventId: string, personId: string, identity: FollowIdentity): Promise<boolean> {
    if (!hasFollower(identity)) return false;
    return (await this.findExisting(eventId, personId, identity)) !== null;
  }

  // ── Unfollow ──────────────────────────────────────────────────────────────────

  async unfollow(eventId: string, personId: string, identity: FollowIdentity): Promise<void> {
    const follower = followerFilter(identity);
    dataOrThrow(
      await this.supabase.service
        .from('follows')
        .delete()
        .eq('event_id', eventId)
        .eq('followed_person_id', personId)
        .eq(...follower),
      'follow delete',
    );
    if (identity.userId) {
      await this.followNotifications.cancelForFollowedPerson(personId, identity.userId);
    }
  }

  // ── Update notification prefs ─────────────────────────────────────────────────

  async updateNotifications(
    eventId: string,
    personId: string,
    identity: FollowIdentity,
    patch: {
      notifyMatchStart?: boolean;
      notifyWorkshopStart?: boolean;
      notifyRefereeStart?: boolean;
    },
  ): Promise<FollowRow> {
    const follower = followerFilter(identity);
    const updates: Record<string, unknown> = {};
    if (patch.notifyMatchStart !== undefined)
      updates['notify_match_start'] = patch.notifyMatchStart;
    if (patch.notifyWorkshopStart !== undefined)
      updates['notify_workshop_start'] = patch.notifyWorkshopStart;
    if (patch.notifyRefereeStart !== undefined)
      updates['notify_referee_start'] = patch.notifyRefereeStart;

    const q = this.supabase.service
      .from('follows')
      .update(updates)
      .eq('event_id', eventId)
      .eq('followed_person_id', personId)
      .eq(...follower);

    const data = dataOrThrow(
      await (
        q as never as {
          select: (s: string) => {
            single: () => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        }
      )
        .select(
          `id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
         persons ( given_name, family_name, clubs ( name ) )`,
        )
        .single(),
      'follow notifications write',
    );

    return this.mapRow(data as Record<string, unknown>, eventId);
  }

  // ── Guest→claimed migration ───────────────────────────────────────────────────

  /**
   * Transfer all follow rows from a guest session to a claimed user, one row at
   * a time (not atomic). Nothing calls it today.
   * Duplicate follows (same person already followed by user) are deleted.
   */
  async migrateGuestFollows(
    guestSessionId: string,
    userId: string,
    eventId: string,
  ): Promise<number> {
    // Fetch guest follows
    const guestFollows = dataOrThrow(
      await this.supabase.service
        .from('follows')
        .select('id, followed_person_id')
        .eq('follower_guest_session_id', guestSessionId)
        .eq('event_id', eventId),
      'guest follows read',
    );

    if (!guestFollows || guestFollows.length === 0) return 0;

    // Fetch existing user follows to detect duplicates
    const userFollows = dataOrThrow(
      await this.supabase.service
        .from('follows')
        .select('followed_person_id')
        .eq('follower_user_id', userId)
        .eq('event_id', eventId),
      'follows read',
    );

    const userPersonIds = new Set(
      (userFollows ?? []).map((f) => (f as { followed_person_id: string }).followed_person_id),
    );

    let migrated = 0;

    for (const gf of guestFollows as Array<{ id: string; followed_person_id: string }>) {
      const duplicate = userPersonIds.has(gf.followed_person_id);
      await this.moveGuestFollow(gf.id, userId, duplicate);
      if (!duplicate) migrated++;
    }

    return migrated;
  }

  /** A guest follow the account already has is deleted; any other moves to the account. */
  private async moveGuestFollow(followId: string, userId: string, duplicate: boolean) {
    if (duplicate) {
      dataOrThrow(
        await this.supabase.service.from('follows').delete().eq('id', followId),
        'follow delete',
      );
      return;
    }
    dataOrThrow(
      await this.supabase.service
        .from('follows')
        .update({ follower_user_id: userId, follower_guest_session_id: null })
        .eq('id', followId),
      'follow write',
    );
  }

  // ── Follow-from-hub (global person → all current/upcoming events) ─────────────

  /**
   * Follow a GLOBAL person across every current/upcoming event they're entered
   * in (per the product decision: one tap follows them everywhere upcoming).
   * Reuses the per-event follow() so privacy + idempotency are enforced per
   * event. Anonymous identities are a no-op (a follow row needs a follower).
   */
  async followAllEvents(
    globalPersonId: string,
    identity: FollowIdentity,
  ): Promise<FollowAllSummary> {
    await this.assertLiveProfile(globalPersonId);
    // A guest session follows only inside its own Event (ruling 130): the others are not counted
    // as upcoming for it either, so the summary never promises a follow it cannot make.
    const targets = (await this.resolveEventPersons(globalPersonId, { upcomingOnly: true })).filter(
      (t) => !guestOfAnotherEvent(identity, t.eventId),
    );
    const summary: FollowAllSummary = {
      globalPersonId,
      upcomingEventCount: targets.length,
      followedCount: 0,
      alreadyFollowingCount: 0,
      skippedPrivacyCount: 0,
      following: false,
    };
    if (!hasFollower(identity)) return summary; // anonymous: nothing to write

    // Persist the follow at the GLOBAL-person level (claimed users only) so the
    // person shows in the "Following" tab even with zero upcoming events. The
    // per-event fan-out below only wires notifications for events they're in.
    if (identity.userId) {
      await this.writeDirectoryFollow(identity.userId, globalPersonId);
      summary.following = true;
    }

    for (const t of targets) {
      const existing = await this.findExisting(t.eventId, t.personId, identity);
      if (existing) {
        summary.alreadyFollowingCount += 1;
        continue;
      }
      const priv = await this.privacy.getOrCreate(t.personId);
      if (!priv.allowBeingFollowed) {
        summary.skippedPrivacyCount += 1;
        continue;
      }
      await this.follow(t.eventId, t.personId, identity);
      summary.followedCount += 1;
    }
    return summary;
  }

  /** The persistent, event-independent follow (idempotent). */
  private async writeDirectoryFollow(userId: string, globalPersonId: string): Promise<void> {
    dataOrThrow(
      await this.supabase.service
        .from('directory_follows')
        .upsert(
          { follower_user_id: userId, followed_global_person_id: globalPersonId },
          { onConflict: 'follower_user_id,followed_global_person_id', ignoreDuplicates: true },
        ),
      'directory follow write',
    );
  }

  /** Unfollow a global person across ALL their events (toggles the hub button
   *  fully off, including any follow left over from a now-finished event) and
   *  removes the persistent directory follow. */
  async unfollowAllEvents(globalPersonId: string, identity: FollowIdentity): Promise<void> {
    if (!hasFollower(identity)) return;

    if (identity.userId) {
      dataOrThrow(
        await this.supabase.service
          .from('directory_follows')
          .delete()
          .eq('follower_user_id', identity.userId)
          .eq('followed_global_person_id', globalPersonId),
        'directory follow delete',
      );
    }

    const targets = await this.resolveEventPersons(globalPersonId, { upcomingOnly: false });
    for (const t of targets) {
      await this.unfollow(t.eventId, t.personId, identity);
    }
  }

  // ── Directory follows (persistent, event-independent) ─────────────────────────

  /** The user's persistent directory follows (global-person level), newest first. */
  async listDirectoryFollows(userId: string): Promise<DirectoryFollow[]> {
    const data = dataOrThrow(
      await this.supabase.service
        .from('directory_follows')
        .select('followed_global_person_id, created_at')
        .eq('follower_user_id', userId)
        .order('created_at', { ascending: false }),
      'directory follows read',
    );
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      globalPersonId: r['followed_global_person_id'] as string,
      followedAt: r['created_at'] as string,
    }));
  }

  /** Which of the given global persons the user follows at the directory level. */
  async filterFollowedGlobalPersons(
    userId: string,
    globalPersonIds: string[],
  ): Promise<Set<string>> {
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    if (ids.length === 0) return new Set();
    const data = dataOrThrow(
      await this.supabase.service
        .from('directory_follows')
        .select('followed_global_person_id')
        .eq('follower_user_id', userId)
        .in('followed_global_person_id', ids),
      'directory follows read',
    );
    return new Set(
      ((data ?? []) as Array<Record<string, unknown>>).map(
        (r) => r['followed_global_person_id'] as string,
      ),
    );
  }

  /**
   * For each global person, the event-scoped follow row that backs their
   * notification toggles (prefers an active/upcoming event over a finished
   * one). Lets the "Following" tab render match/workshop toggles that PATCH the
   * right `/events/:eventId/follows/:personId`. One query total.
   */
  async getEventFollowStateForGlobalPersons(
    userId: string,
    globalPersonIds: string[],
  ): Promise<Map<string, EventFollowState>> {
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    const map = new Map<string, EventFollowState>();
    if (ids.length === 0) return map;

    const data = dataOrThrow(
      await this.supabase.service
        .from('follows')
        .select(
          `event_id, followed_person_id, notify_match_start, notify_workshop_start, notify_referee_start,
         persons ( global_person_id, events ( status, event_kind ) )`,
        )
        .eq('follower_user_id', userId),
      'follows read',
    );

    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const person = one(r['persons']);
      const gp = person?.['global_person_id'] as string | undefined;
      if (!person || !gp || !ids.includes(gp)) continue;
      const ev = one(person['events']);
      const active = isUpcomingPublicEvent(ev);
      const state: EventFollowState = {
        eventId: r['event_id'] as string,
        personId: r['followed_person_id'] as string,
        notifyMatchStart: Boolean(r['notify_match_start']),
        notifyWorkshopStart: Boolean(r['notify_workshop_start']),
        notifyRefereeStart: Boolean(r['notify_referee_start']),
        active,
      };
      const existing = map.get(gp);
      // Prefer an active event-follow; otherwise keep the first seen.
      if (!existing || (active && !existing.active)) map.set(gp, state);
    }
    return map;
  }

  /**
   * Batched follow-state for the "My Groups" member cards: for each global
   * person, how many current/upcoming events they're in, and how many of those
   * the session already follows. One persons query + one follows query total.
   */
  async countFollowStateForGlobalPersons(
    globalPersonIds: string[],
    identity: FollowIdentity,
  ): Promise<Map<string, FollowState>> {
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    const result = new Map<string, FollowState>();
    if (ids.length === 0) return result;

    const personRows = await this.eventPeopleOf(ids);

    // global_person_id → { upcoming distinct events, all person ids }
    const upcomingEvents = new Map<string, Set<string>>();
    const personIdToGlobal = new Map<string, string>();
    for (const raw of (personRows ?? []) as Array<Record<string, unknown>>) {
      const gp = raw['global_person_id'] as string | null;
      if (!gp) continue;
      const personId = raw['id'] as string;
      const eventId = raw['event_id'] as string;
      const ev = raw['events'] as { status: string; event_kind: string | null } | null;
      personIdToGlobal.set(personId, gp);
      if (isUpcomingPublicEvent(ev)) {
        const set = upcomingEvents.get(gp) ?? new Set<string>();
        set.add(eventId);
        upcomingEvents.set(gp, set);
      }
    }

    // Count the session's follows over those person ids.
    const followingByGlobal = new Map<string, number>();
    const personIds = [...personIdToGlobal.keys()];
    if (personIds.length > 0 && hasFollower(identity)) {
      const followRows = await this.followedAmong(personIds, identity);
      for (const raw of followRows) {
        const gp = personIdToGlobal.get(raw.followed_person_id);
        if (gp) followingByGlobal.set(gp, (followingByGlobal.get(gp) ?? 0) + 1);
      }
    }

    for (const gp of ids) {
      result.set(gp, {
        upcomingEventCount: upcomingEvents.get(gp)?.size ?? 0,
        followingEventCount: followingByGlobal.get(gp) ?? 0,
      });
    }
    return result;
  }

  /** The event-scoped people behind these global persons, with their Event's status and kind. */
  private async eventPeopleOf(globalPersonIds: string[]) {
    return dataOrThrow(
      await this.supabase.service
        .from('persons')
        .select('id, global_person_id, event_id, events!inner(status, event_kind)')
        .in('global_person_id', globalPersonIds),
      'event people read',
    );
  }

  /** The caller's follows among these event-scoped people. */
  private async followedAmong(
    personIds: string[],
    identity: FollowIdentity,
  ): Promise<Array<{ followed_person_id: string }>> {
    const rows = dataOrThrow(
      await this.supabase.service
        .from('follows')
        .select('followed_person_id')
        .in('followed_person_id', personIds)
        .eq(...followerFilter(identity)),
      'follows read',
    );
    return (rows ?? []) as Array<{ followed_person_id: string }>;
  }

  /** Resolve a global person to their event-scoped persons rows. `upcomingOnly`
   *  keeps only upcoming public Events (`isUpcomingPublicEvent`). */
  private async resolveEventPersons(
    globalPersonId: string,
    opts: { upcomingOnly: boolean },
  ): Promise<Array<{ eventId: string; personId: string }>> {
    // A 5xx: read as "no events", a follow would report nothing to follow.
    const data = dataOrThrow(
      await this.supabase.service
        .from('persons')
        .select('id, event_id, events!inner(status, event_kind)')
        .eq('global_person_id', globalPersonId),
      'event people read',
    );

    return ((data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => {
        const ev = r['events'] as { status: string; event_kind: string | null } | null;
        if (!ev) return false;
        if (!opts.upcomingOnly) return true;
        return isUpcomingPublicEvent(ev);
      })
      .map((r) => ({ eventId: r['event_id'] as string, personId: r['id'] as string }));
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /** An erased, merged or deleted profile answers exactly like an unknown one (ruling 112). */
  private async assertLiveProfile(globalPersonId: string): Promise<void> {
    const data = dataOrThrow(
      await applyReachable(
        this.supabase.service.from('global_persons').select('id').eq('id', globalPersonId),
      ).maybeSingle(),
      'fighter read',
    );
    if (!data) throw new NotFoundException(`Fighter ${globalPersonId} not found`);
  }

  private async findExisting(
    eventId: string,
    personId: string,
    identity: FollowIdentity,
  ): Promise<Record<string, unknown> | null> {
    const data = dataOrThrow(
      await this.supabase.service
        .from('follows')
        .select(
          `id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
         persons ( given_name, family_name, clubs ( name ) )`,
        )
        .eq('event_id', eventId)
        .eq('followed_person_id', personId)
        .eq(...followerFilter(identity))
        .maybeSingle(),
      'follows read',
    );
    return (data as Record<string, unknown> | null) ?? null;
  }

  private async mapRow(r: Record<string, unknown>, eventId: string): Promise<FollowRow> {
    const person = r['persons'] as {
      given_name: string;
      family_name: string;
      clubs: { name: string } | null;
    } | null;

    const personId = r['followed_person_id'] as string;
    const nextEvent = await this.fetchNextEvent(personId, eventId);

    return {
      id: r['id'] as string,
      personId,
      personName: person ? `${person.given_name} ${person.family_name}` : 'Unknown',
      personClub: person?.clubs?.name ?? null,
      followedAt: (r['created_at'] ?? r['followed_at']) as string,
      notifyMatchStart: Boolean(r['notify_match_start']),
      notifyWorkshopStart: Boolean(r['notify_workshop_start']),
      nextEvent,
    };
  }

  private async fetchNextEvent(personId: string, _eventId: string): Promise<NextEvent | null> {
    // Find next scheduled match for this person in this event
    const regs = dataOrThrow(
      await this.supabase.service.from('registrations').select('id').eq('person_id', personId),
      'registrations read',
    );

    if (!regs || regs.length === 0) return null;

    const regIds = (regs as Array<{ id: string }>).map((r) => r.id);

    // A draft Tournament's bout is no next bout (ruling 130): this line goes back to whoever follows,
    // and a follow is open to anyone who may see the Event. `persons` is event-scoped, so the
    // Event is the follow's own, already gated.
    const upcoming = this.supabase.service
      .from('matches')
      .select(
        'id, match_number_label, scheduled_at, status, phases!inner(tournaments!inner(status))',
      )
      .or(
        `red_registration_id.in.(${regIds.join(',')}),blue_registration_id.in.(${regIds.join(',')})`,
      )
      .in('status', ['scheduled', 'running']);
    const next = await onlyPublicTournaments(upcoming)
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const match = dataOrThrow(next, 'matches read');

    if (!match) return null;

    const m = match as {
      id: string;
      match_number_label: string;
      scheduled_at: string | null;
      status: string;
    };

    return {
      type: 'match',
      label: m.status === 'running' ? `Live — ${m.match_number_label}` : m.match_number_label,
      scheduledAt: m.scheduled_at,
    };
  }
}
