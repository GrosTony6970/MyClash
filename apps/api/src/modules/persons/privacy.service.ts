/**
 * privacy.service.ts — T-608 + T-609
 *
 * Manages person_privacy rows and applies privacy filters
 * to schedule queries per ARCHITECTURE.md §11quinquies.
 */

import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface PersonPrivacy {
  personId: string;
  hideWorkshopsPublicly: boolean;
  allowBeingFollowed: boolean;
  showRealEmailToFollowers: boolean;
}

const DEFAULTS: Omit<PersonPrivacy, 'personId'> = {
  hideWorkshopsPublicly: false,
  allowBeingFollowed: true,
  showRealEmailToFollowers: false,
};

/**
 * Fold two copies of one user's answer to the stricter of the two.
 *
 * "Stricter" is per-field, not per-row: hiding is the restrictive choice for
 * `hideWorkshopsPublicly`, and NOT allowing is the restrictive choice for the
 * other two. Keeps `personId` from the accumulator, which the caller seeds with
 * the primary row.
 */
function mostRestrictive(a: PersonPrivacy, b: PersonPrivacy): PersonPrivacy {
  return {
    personId: a.personId,
    hideWorkshopsPublicly: a.hideWorkshopsPublicly || b.hideWorkshopsPublicly,
    allowBeingFollowed: a.allowBeingFollowed && b.allowBeingFollowed,
    showRealEmailToFollowers: a.showRealEmailToFollowers && b.showRealEmailToFollowers,
  };
}

@Injectable()
export class PrivacyService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── Get or create ────────────────────────────────────────────────────────────

  async getOrCreate(personId: string): Promise<PersonPrivacy> {
    const { data } = await this.supabase.service
      .from('person_privacy')
      .select('*')
      .eq('person_id', personId)
      .maybeSingle();

    if (data) return this.map(data as Record<string, unknown>);

    // Auto-create with defaults
    const { data: created } = await this.supabase.service
      .from('person_privacy')
      .insert({
        person_id: personId,
        hide_workshops_publicly: DEFAULTS.hideWorkshopsPublicly,
        allow_being_followed: DEFAULTS.allowBeingFollowed,
        show_real_email_to_followers: DEFAULTS.showRealEmailToFollowers,
      })
      .select('*')
      .single();

    if (created) return this.map(created as Record<string, unknown>);
    return { personId, ...DEFAULTS };
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async update(
    personId: string,
    patch: Partial<Omit<PersonPrivacy, 'personId'>>,
  ): Promise<PersonPrivacy> {
    const updates: Record<string, unknown> = {};
    if (patch.hideWorkshopsPublicly !== undefined)
      updates['hide_workshops_publicly'] = patch.hideWorkshopsPublicly;
    if (patch.allowBeingFollowed !== undefined)
      updates['allow_being_followed'] = patch.allowBeingFollowed;
    if (patch.showRealEmailToFollowers !== undefined)
      updates['show_real_email_to_followers'] = patch.showRealEmailToFollowers;

    // Upsert — creates row if missing
    const { data } = await this.supabase.service
      .from('person_privacy')
      .upsert({ person_id: personId, ...updates })
      .select('*')
      .single();

    if (data) return this.map(data as Record<string, unknown>);
    return this.getOrCreate(personId);
  }

  // ── Per-user (across every event) ────────────────────────────────────────────

  /**
   * One privacy answer for a user who may hold several event-scoped `persons`
   * rows.
   *
   * `person_privacy.person_id` references `persons(id)`, which is event-scoped,
   * so a competitor in five events has five places to store a single preference.
   * The controller used to resolve one arbitrary row; the reader
   * (`hiddenWorkshopGlobalPersonIds`) then looked up the row for whichever event
   * it was rendering, so "hide my workshops" applied to at most one event and
   * silently did nothing on the rest.
   *
   * Read folds MOST-RESTRICTIVE across the rows. When copies disagree — and
   * before this commit they routinely did — honouring the strictest is the only
   * safe reading: it can never publish something the user asked to hide.
   */
  async getOrCreateForPersons(personIds: string[]): Promise<PersonPrivacy> {
    const primary = personIds[0] as string;
    if (personIds.length === 1) return this.getOrCreate(primary);

    const { data } = await this.supabase.service
      .from('person_privacy')
      .select('*')
      .in('person_id', personIds);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return this.getOrCreate(primary);

    return rows
      .map((row) => this.map(row))
      .reduce(mostRestrictive, {
        personId: primary,
        ...DEFAULTS,
      });
  }

  /**
   * Write the answer to EVERY row the user owns, so it holds in every event.
   *
   * Anything less leaves the copies disagreeing, which is the state that made
   * the setting look applied while doing nothing.
   */
  async updateForPersons(
    personIds: string[],
    patch: Partial<Omit<PersonPrivacy, 'personId'>>,
  ): Promise<PersonPrivacy> {
    const updates: Record<string, unknown> = {};
    if (patch.hideWorkshopsPublicly !== undefined)
      updates['hide_workshops_publicly'] = patch.hideWorkshopsPublicly;
    if (patch.allowBeingFollowed !== undefined)
      updates['allow_being_followed'] = patch.allowBeingFollowed;
    if (patch.showRealEmailToFollowers !== undefined)
      updates['show_real_email_to_followers'] = patch.showRealEmailToFollowers;

    await this.supabase.service
      .from('person_privacy')
      .upsert(personIds.map((person_id) => ({ person_id, ...updates })));

    return this.getOrCreateForPersons(personIds);
  }

  // ── Privacy check ────────────────────────────────────────────────────────────

  /**
   * Returns true if the requester can see workshops for this person.
   * Workshops are hidden only when:
   *   - person has hide_workshops_publicly = true
   *   - AND requester is NOT the same person
   */
  async canSeeWorkshops(personId: string, requesterPersonId: string | null): Promise<boolean> {
    if (requesterPersonId === personId) return true; // always see own workshops
    const priv = await this.getOrCreate(personId);
    return !priv.hideWorkshopsPublicly;
  }

  /**
   * Batched public-read helper: given global-person ids tagged in an event,
   * return the subset whose event-scoped person set `hide_workshops_publicly`.
   * Read-only (never auto-creates rows); a missing privacy row ⇒ not hidden.
   * Used to drop opted-out instructors from public workshop listings.
   */
  async hiddenWorkshopGlobalPersonIds(
    eventId: string,
    globalPersonIds: string[],
  ): Promise<Set<string>> {
    const hidden = new Set<string>();
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    if (ids.length === 0) return hidden;

    const { data: persons } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id')
      .eq('event_id', eventId)
      .in('global_person_id', ids);

    const personIdToGlobal = new Map<string, string>();
    for (const raw of persons ?? []) {
      const p = raw as { id: string; global_person_id: string | null };
      if (p.global_person_id) personIdToGlobal.set(p.id, p.global_person_id);
    }
    if (personIdToGlobal.size === 0) return hidden;

    const { data: privacy } = await this.supabase.service
      .from('person_privacy')
      .select('person_id, hide_workshops_publicly')
      .in('person_id', [...personIdToGlobal.keys()]);

    for (const raw of privacy ?? []) {
      const row = raw as { person_id: string; hide_workshops_publicly: boolean | null };
      if (row.hide_workshops_publicly) {
        const global = personIdToGlobal.get(row.person_id);
        if (global) hidden.add(global);
      }
    }
    return hidden;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private map(row: Record<string, unknown>): PersonPrivacy {
    return {
      personId: row['person_id'] as string,
      hideWorkshopsPublicly: Boolean(row['hide_workshops_publicly']),
      allowBeingFollowed: Boolean(row['allow_being_followed'] ?? true),
      showRealEmailToFollowers: Boolean(row['show_real_email_to_followers']),
    };
  }
}
