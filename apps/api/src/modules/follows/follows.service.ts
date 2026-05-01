/**
 * follows.service.ts — T-610
 *
 * Manages follow rows. Supports both guest sessions and claimed users.
 * Idempotent POST. Respects allow_being_followed privacy setting.
 * Guest→claimed migration transfers follows atomically.
 */

import { ForbiddenException, Injectable } from '@nestjs/common';
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

@Injectable()
export class FollowsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly privacy: PrivacyService,
  ) {}

  // ── List ─────────────────────────────────────────────────────────────────────

  async listFollows(eventId: string, identity: FollowIdentity): Promise<FollowRow[]> {
    let q = this.supabase.service
      .from('follows')
      .select(
        `
        id, person_id, followed_at, notify_match_start, notify_workshop_start,
        persons ( given_name, family_name, clubs ( name ) )
      `,
      )
      .eq('event_id', eventId);

    if (identity.userId) {
      q = q.eq('user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('guest_session_id', identity.guestSessionId) as typeof q;
    } else {
      return [];
    }

    const { data } = await q.order('followed_at', { ascending: false });
    if (!data) return [];

    const rows = data as Array<Record<string, unknown>>;
    return Promise.all(rows.map((r) => this.mapRow(r, eventId)));
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
      person_id: personId,
      notify_match_start: true,
      notify_workshop_start: false,
    };
    if (identity.userId) insert['user_id'] = identity.userId;
    if (identity.guestSessionId) insert['guest_session_id'] = identity.guestSessionId;

    const { data } = await this.supabase.service
      .from('follows')
      .insert(insert)
      .select(
        `id, person_id, followed_at, notify_match_start, notify_workshop_start,
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
      .eq('person_id', personId);

    if (identity.userId) {
      q = q.eq('user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('guest_session_id', identity.guestSessionId) as typeof q;
    }

    await q;
  }

  // ── Update notification prefs ─────────────────────────────────────────────────

  async updateNotifications(
    eventId: string,
    personId: string,
    identity: FollowIdentity,
    patch: { notifyMatchStart?: boolean; notifyWorkshopStart?: boolean },
  ): Promise<FollowRow> {
    const updates: Record<string, unknown> = {};
    if (patch.notifyMatchStart !== undefined)
      updates['notify_match_start'] = patch.notifyMatchStart;
    if (patch.notifyWorkshopStart !== undefined)
      updates['notify_workshop_start'] = patch.notifyWorkshopStart;

    let q = this.supabase.service
      .from('follows')
      .update(updates)
      .eq('event_id', eventId)
      .eq('person_id', personId);

    if (identity.userId) {
      q = q.eq('user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('guest_session_id', identity.guestSessionId) as typeof q;
    }

    const { data } = await (
      q as never as {
        select: (s: string) => { single: () => Promise<{ data: unknown }> };
      }
    )
      .select(
        `id, person_id, followed_at, notify_match_start, notify_workshop_start,
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
      .select('id, person_id')
      .eq('guest_session_id', guestSessionId)
      .eq('event_id', eventId);

    if (!guestFollows || guestFollows.length === 0) return 0;

    // Fetch existing user follows to detect duplicates
    const { data: userFollows } = await this.supabase.service
      .from('follows')
      .select('person_id')
      .eq('user_id', userId)
      .eq('event_id', eventId);

    const userPersonIds = new Set(
      (userFollows ?? []).map((f) => (f as { person_id: string }).person_id),
    );

    let migrated = 0;

    for (const gf of guestFollows as Array<{ id: string; person_id: string }>) {
      if (userPersonIds.has(gf.person_id)) {
        // Duplicate — delete guest follow
        await this.supabase.service.from('follows').delete().eq('id', gf.id);
      } else {
        // Transfer to user
        await this.supabase.service
          .from('follows')
          .update({ user_id: userId, guest_session_id: null })
          .eq('id', gf.id);
        migrated++;
      }
    }

    return migrated;
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
        `id, person_id, followed_at, notify_match_start, notify_workshop_start,
         persons ( given_name, family_name, clubs ( name ) )`,
      )
      .eq('event_id', eventId)
      .eq('person_id', personId);

    if (identity.userId) {
      q = q.eq('user_id', identity.userId) as typeof q;
    } else if (identity.guestSessionId) {
      q = q.eq('guest_session_id', identity.guestSessionId) as typeof q;
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

    const personId = r['person_id'] as string;
    const nextEvent = await this.fetchNextEvent(personId, eventId);

    return {
      id: r['id'] as string,
      personId,
      personName: person ? `${person.given_name} ${person.family_name}` : 'Unknown',
      personClub: person?.clubs?.name ?? null,
      followedAt: r['followed_at'] as string,
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
