/**
 * privacy.service.ts — T-608 + T-609
 *
 * A person's two privacy choices — hide their workshops publicly, and whether others may follow
 * them — and the filters that apply them (ARCHITECTURE.md §11quinquies).
 *
 * They live on the GLOBAL person (migration 0211, ruling 132): one answer for every Event, past and
 * future. They used to live per Event row (`person_privacy`, keyed by the event-scoped
 * `persons.id`), so a competitor in five Events held five answers, and a choice made before an
 * Event existed never reached it.
 *
 * A failed read or write is a 5xx, never the defaults (rulings 117a, 124): the defaults allow being
 * followed, so a guess could follow someone who opted out.
 */

import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface PersonPrivacy {
  hideWorkshopsPublicly: boolean;
  allowBeingFollowed: boolean;
}

/** 0211's column defaults: what a person who never chose has. */
const DEFAULTS: PersonPrivacy = {
  hideWorkshopsPublicly: false,
  allowBeingFollowed: true,
};

@Injectable()
export class PrivacyService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * The choices of the global person behind an Event's person row. A row linked to no global
   * person has made no choice anywhere: the defaults.
   */
  async forPerson(personId: string): Promise<PersonPrivacy> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('id', personId)
      .maybeSingle();
    if (error) throw new Error(`privacy read failed: ${error.message}`);
    return this.forGlobalPerson(
      (data as { global_person_id: string | null } | null)?.global_person_id ?? null,
    );
  }

  /** The choices of a global person; none (an unlinked Event row) or an unknown one has made none. */
  async forGlobalPerson(globalPersonId: string | null): Promise<PersonPrivacy> {
    if (!globalPersonId) return DEFAULTS;
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('hide_workshops_publicly, allow_being_followed')
      .eq('id', globalPersonId)
      .maybeSingle();
    if (error) throw new Error(`privacy read failed: ${error.message}`);
    return data ? this.map(data as Record<string, unknown>) : DEFAULTS;
  }

  /**
   * The signed-in user's own choices, or null when no live global person is theirs. A merge moves
   * the account to the survivor (ruling 159) unless another account owns it; the account then
   * stays on the merged-away profile, whose choices nothing reads, so it has none to edit.
   */
  async forUser(userId: string): Promise<PersonPrivacy | null> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('hide_workshops_publicly, allow_being_followed')
      .eq('claimed_by_user_id', userId)
      .is('merged_into_id', null)
      .maybeSingle();
    if (error) throw new Error(`privacy read failed: ${error.message}`);
    return data ? this.map(data as Record<string, unknown>) : null;
  }

  /** Save the user's choices on their global person, then read them back (null: none is theirs). */
  async updateForUser(
    userId: string,
    patch: Partial<PersonPrivacy>,
  ): Promise<PersonPrivacy | null> {
    const updates: Record<string, boolean> = {};
    if (patch.hideWorkshopsPublicly !== undefined)
      updates['hide_workshops_publicly'] = patch.hideWorkshopsPublicly;
    if (patch.allowBeingFollowed !== undefined)
      updates['allow_being_followed'] = patch.allowBeingFollowed;

    // An empty patch would be an UPDATE with no column, which PostgREST refuses.
    if (Object.keys(updates).length > 0) {
      const { error } = await this.supabase.service
        .from('global_persons')
        .update(updates)
        .eq('claimed_by_user_id', userId)
        .is('merged_into_id', null);
      // A failed save is a 5xx (ruling 124): the read-back below would answer the old values as
      // if they were saved.
      if (error) throw new Error(`privacy write failed: ${error.message}`);
    }
    return this.forUser(userId);
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
    return !(await this.forPerson(personId)).hideWorkshopsPublicly;
  }

  /**
   * Batched public-read helper: the subset of these global persons who hide their workshops.
   * Used to drop opted-out instructors from public workshop listings. A failed read is a 5xx,
   * never an empty set (ruling 120): that would list them.
   */
  async hiddenWorkshopGlobalPersonIds(globalPersonIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    if (ids.length === 0) return new Set();

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .in('id', ids)
      .eq('hide_workshops_publicly', true);
    if (error) throw new Error(`hidden-workshop privacy read failed: ${error.message}`);
    return new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private map(row: Record<string, unknown>): PersonPrivacy {
    return {
      hideWorkshopsPublicly: Boolean(row['hide_workshops_publicly']),
      allowBeingFollowed: Boolean(row['allow_being_followed']),
    };
  }
}
