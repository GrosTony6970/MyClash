/**
 * follows.service.ts — T-610
 *
 * Manages follow rows. Supports both guest sessions and claimed users.
 * Idempotent POST. Respects allow_being_followed privacy setting.
 * Guest→claimed migration transfers follows atomically.
 */

import { ForbiddenException, Injectable } from '@nestjs/common';
import { asEventKind, isPubliclyVisible } from '@myclash/types';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { PrivacyService } from '../persons/privacy.service';

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
  /** Set for claimed users */
  userId?: string;
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
  /** The backing event is non-terminal and not a test event. */
  active: boolean;
}

/** Normalize a PostgREST embed that may arrive as an object or a 1-element array. */
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/** Per-global-person follow state for the "People" hub cards. */
export interface FollowState {
  upcomingEventCount: number;
  followingEventCount: number;
}

const TERMINAL_EVENT_STATUSES = ['completed', 'archived'];

@Injectable()
export class FollowsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly privacy: PrivacyService,
    private readonly followNotifications: FollowNotificationSchedulerService,
  ) {}

  // ── List ─────────────────────────────────────────────────────────────────────

  async listFollows(eventId: string, identity: FollowIdentity): Promise<FollowRow[]> {
    let q = this.supabase.service
      .from('follows')
      .select(
        `
        id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
        persons ( given_name, family_name, clubs ( name ) )
      `,
      )
      .eq('event_id', eventId);

    if (identity.userId) {
      q = q.eq('follower_user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('follower_guest_session_id', identity.guestSessionId) as typeof q;
    } else {
      return [];
    }

    const { data } = await q.order('created_at', { ascending: false });
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
    let q = this.supabase.service.from('follows').select(
      `
        id, followed_person_id, event_id, created_at, notify_match_start, notify_workshop_start,
        persons ( given_name, family_name, clubs ( name ) ),
        events ( name, slug )
      `,
    );

    if (identity.userId) {
      q = q.eq('follower_user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('follower_guest_session_id', identity.guestSessionId) as typeof q;
    } else {
      return [];
    }

    const { data } = await q.order('created_at', { ascending: false });
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

  async follow(eventId: string, personId: string, identity: FollowIdentity): Promise<FollowRow> {
    // Check privacy
    const priv = await this.privacy.getOrCreate(personId);
    if (!priv.allowBeingFollowed) {
      throw new ForbiddenException('This person prefers not to be followed');
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
    };
    if (identity.userId) insert['follower_user_id'] = identity.userId;
    if (identity.guestSessionId) insert['follower_guest_session_id'] = identity.guestSessionId;

    const { data } = await this.supabase.service
      .from('follows')
      .insert(insert)
      .select(
        `id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
         persons ( given_name, family_name, clubs ( name ) )`,
      )
      .single();

    return this.mapRow(data as Record<string, unknown>, eventId);
  }

  // ── Unfollow ──────────────────────────────────────────────────────────────────

  async unfollow(eventId: string, personId: string, identity: FollowIdentity): Promise<void> {
    let q = this.supabase.service
      .from('follows')
      .delete()
      .eq('event_id', eventId)
      .eq('followed_person_id', personId);

    if (identity.userId) {
      q = q.eq('follower_user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('follower_guest_session_id', identity.guestSessionId) as typeof q;
    }

    await q;
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
    const updates: Record<string, unknown> = {};
    if (patch.notifyMatchStart !== undefined)
      updates['notify_match_start'] = patch.notifyMatchStart;
    if (patch.notifyWorkshopStart !== undefined)
      updates['notify_workshop_start'] = patch.notifyWorkshopStart;
    if (patch.notifyRefereeStart !== undefined)
      updates['notify_referee_start'] = patch.notifyRefereeStart;

    let q = this.supabase.service
      .from('follows')
      .update(updates)
      .eq('event_id', eventId)
      .eq('followed_person_id', personId);

    if (identity.userId) {
      q = q.eq('follower_user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('follower_guest_session_id', identity.guestSessionId) as typeof q;
    }

    const { data } = await (
      q as never as {
        select: (s: string) => { single: () => Promise<{ data: unknown }> };
      }
    )
      .select(
        `id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
         persons ( given_name, family_name, clubs ( name ) )`,
      )
      .single();

    return this.mapRow(data as Record<string, unknown>, eventId);
  }

  // ── Guest→claimed migration ───────────────────────────────────────────────────

  /**
   * Transfer all follow rows from a guest session to a claimed user.
   * Called atomically from the claim handler (T-009).
   * Duplicate follows (same person already followed by user) are deleted.
   */
  async migrateGuestFollows(
    guestSessionId: string,
    userId: string,
    eventId: string,
  ): Promise<number> {
    // Fetch guest follows
    const { data: guestFollows } = await this.supabase.service
      .from('follows')
      .select('id, followed_person_id')
      .eq('follower_guest_session_id', guestSessionId)
      .eq('event_id', eventId);

    if (!guestFollows || guestFollows.length === 0) return 0;

    // Fetch existing user follows to detect duplicates
    const { data: userFollows } = await this.supabase.service
      .from('follows')
      .select('followed_person_id')
      .eq('follower_user_id', userId)
      .eq('event_id', eventId);

    const userPersonIds = new Set(
      (userFollows ?? []).map((f) => (f as { followed_person_id: string }).followed_person_id),
    );

    let migrated = 0;

    for (const gf of guestFollows as Array<{ id: string; followed_person_id: string }>) {
      if (userPersonIds.has(gf.followed_person_id)) {
        // Duplicate — delete guest follow
        await this.supabase.service.from('follows').delete().eq('id', gf.id);
      } else {
        // Transfer to user
        await this.supabase.service
          .from('follows')
          .update({ follower_user_id: userId, follower_guest_session_id: null })
          .eq('id', gf.id);
        migrated++;
      }
    }

    return migrated;
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
    const targets = await this.resolveEventPersons(globalPersonId, { upcomingOnly: true });
    const summary: FollowAllSummary = {
      globalPersonId,
      upcomingEventCount: targets.length,
      followedCount: 0,
      alreadyFollowingCount: 0,
      skippedPrivacyCount: 0,
      following: false,
    };
    if (!identity.userId && !identity.guestSessionId) return summary; // anonymous: nothing to write

    // Persist the follow at the GLOBAL-person level (claimed users only) so the
    // person shows in the "Following" tab even with zero upcoming events. The
    // per-event fan-out below only wires notifications for events they're in.
    if (identity.userId) {
      await this.supabase.service
        .from('directory_follows')
        .upsert(
          { follower_user_id: identity.userId, followed_global_person_id: globalPersonId },
          { onConflict: 'follower_user_id,followed_global_person_id', ignoreDuplicates: true },
        );
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

  /** Unfollow a global person across ALL their events (toggles the hub button
   *  fully off, including any follow left over from a now-finished event) and
   *  removes the persistent directory follow. */
  async unfollowAllEvents(globalPersonId: string, identity: FollowIdentity): Promise<void> {
    if (!identity.userId && !identity.guestSessionId) return;

    if (identity.userId) {
      await this.supabase.service
        .from('directory_follows')
        .delete()
        .eq('follower_user_id', identity.userId)
        .eq('followed_global_person_id', globalPersonId);
    }

    const targets = await this.resolveEventPersons(globalPersonId, { upcomingOnly: false });
    for (const t of targets) {
      await this.unfollow(t.eventId, t.personId, identity);
    }
  }

  // ── Directory follows (persistent, event-independent) ─────────────────────────

  /** The user's persistent directory follows (global-person level), newest first. */
  async listDirectoryFollows(userId: string): Promise<DirectoryFollow[]> {
    const { data } = await this.supabase.service
      .from('directory_follows')
      .select('followed_global_person_id, created_at')
      .eq('follower_user_id', userId)
      .order('created_at', { ascending: false });
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
    const { data } = await this.supabase.service
      .from('directory_follows')
      .select('followed_global_person_id')
      .eq('follower_user_id', userId)
      .in('followed_global_person_id', ids);
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

    const { data } = await this.supabase.service
      .from('follows')
      .select(
        `event_id, followed_person_id, notify_match_start, notify_workshop_start, notify_referee_start,
         persons ( global_person_id, events ( status, event_kind ) )`,
      )
      .eq('follower_user_id', userId);

    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const person = one(r['persons']);
      const gp = person?.['global_person_id'] as string | undefined;
      if (!person || !gp || !ids.includes(gp)) continue;
      const ev = one(person['events']);
      const active =
        !!ev &&
        isPubliclyVisible(asEventKind(ev['event_kind'])) &&
        !TERMINAL_EVENT_STATUSES.includes(String(ev['status'] ?? ''));
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

    const { data: personRows } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id, event_id, events!inner(status, event_kind)')
      .in('global_person_id', ids);

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
      if (
        ev &&
        isPubliclyVisible(asEventKind(ev.event_kind)) &&
        !TERMINAL_EVENT_STATUSES.includes(ev.status)
      ) {
        const set = upcomingEvents.get(gp) ?? new Set<string>();
        set.add(eventId);
        upcomingEvents.set(gp, set);
      }
    }

    // Count the session's follows over those person ids.
    const followingByGlobal = new Map<string, number>();
    const personIds = [...personIdToGlobal.keys()];
    if (personIds.length > 0 && (identity.userId || identity.guestSessionId)) {
      let q = this.supabase.service
        .from('follows')
        .select('followed_person_id')
        .in('followed_person_id', personIds);
      if (identity.userId) {
        q = q.eq('follower_user_id', identity.userId) as typeof q;
      } else if (identity.guestSessionId) {
        q = q.eq('follower_guest_session_id', identity.guestSessionId) as typeof q;
      }
      const { data: followRows } = await q;
      for (const raw of (followRows ?? []) as Array<{ followed_person_id: string }>) {
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

  /** Resolve a global person to their event-scoped persons rows. `upcomingOnly`
   *  keeps only non-terminal, non-test events. */
  private async resolveEventPersons(
    globalPersonId: string,
    opts: { upcomingOnly: boolean },
  ): Promise<Array<{ eventId: string; personId: string }>> {
    const { data } = await this.supabase.service
      .from('persons')
      .select('id, event_id, events!inner(status, event_kind)')
      .eq('global_person_id', globalPersonId);

    return ((data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => {
        const ev = r['events'] as { status: string; event_kind: string | null } | null;
        if (!ev) return false;
        if (!opts.upcomingOnly) return true;
        return (
          isPubliclyVisible(asEventKind(ev.event_kind)) &&
          !TERMINAL_EVENT_STATUSES.includes(ev.status)
        );
      })
      .map((r) => ({ eventId: r['event_id'] as string, personId: r['id'] as string }));
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async findExisting(
    eventId: string,
    personId: string,
    identity: FollowIdentity,
  ): Promise<Record<string, unknown> | null> {
    let q = this.supabase.service
      .from('follows')
      .select(
        `id, followed_person_id, created_at, notify_match_start, notify_workshop_start,
         persons ( given_name, family_name, clubs ( name ) )`,
      )
      .eq('event_id', eventId)
      .eq('followed_person_id', personId);

    if (identity.userId) {
      q = q.eq('follower_user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('follower_guest_session_id', identity.guestSessionId) as typeof q;
    }

    const { data } = await q.maybeSingle();
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
    const { data: regs } = await this.supabase.service
      .from('registrations')
      .select('id')
      .eq('person_id', personId);

    if (!regs || regs.length === 0) return null;

    const regIds = (regs as Array<{ id: string }>).map((r) => r.id);

    const { data: match } = await this.supabase.service
      .from('matches')
      .select('id, match_number_label, scheduled_at, status')
      .or(
        `red_registration_id.in.(${regIds.join(',')}),blue_registration_id.in.(${regIds.join(',')})`,
      )
      .in('status', ['scheduled', 'running'])
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();

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
