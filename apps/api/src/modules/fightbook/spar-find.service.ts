import { Injectable } from '@nestjs/common';
import type { CompetitionEvent, PublicReader } from '../../common/auth/competition-visibility';
import { isPublicEvent } from '../../common/auth/event-read-gate';
import { hiddenEntrantIds } from '../../common/auth/hidden-entrants';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { askableFighters } from './spar-askable';

/**
 * Who the caller may ask for a spar, for the pages that show an Ask button (FightBook slice 2).
 * Every answer leaves out a fighter the caller blocked and never reads who blocked the caller
 * (ruling 672, `spar-askable.ts`).
 */
@Injectable()
export class SparFindService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /** May `me` ask this fighter (the profile page)? */
  async askableFighter(me: string, globalPersonId: string): Promise<{ askable: boolean }> {
    const askable = await askableFighters(this.supabase.service, me, [globalPersonId]);
    return { askable: askable.has(globalPersonId) };
  }

  /**
   * Of these roster rows of the Event, those `me` may ask, as roster id → profile id (the people
   * page). Nothing for an Event the public cannot see, for rows of another Event's roster, and
   * for someone entered only in a Tournament hidden from `reader`: the people lookup does not
   * list them either. The caller need not be on the Event. A row with no profile is skipped.
   */
  async askableAtEvent(
    me: string,
    eventId: string,
    personIds: string[],
    reader: PublicReader,
  ): Promise<Record<string, string>> {
    const event = await this.publicEvent(eventId);
    if (!event) return {};
    const rows = await this.rosterRows(eventId, personIds);
    if (rows.length === 0) return {};
    const [hidden, askable] = await Promise.all([
      hiddenEntrantIds({ supabase: this.supabase, orgs: this.orgs }, event, reader),
      askableFighters(
        this.supabase.service,
        me,
        rows.map((row) => row.global_person_id),
      ),
    ]);
    return Object.fromEntries(
      rows
        .filter((row) => !hidden.has(row.id) && askable.has(row.global_person_id))
        .map((row) => [row.id, row.global_person_id]),
    );
  }

  /** The Event, when the public may see it; null for a draft, a test or an unknown one. */
  private async publicEvent(eventId: string): Promise<CompetitionEvent | null> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, status, organization_id, event_kind')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`FightBook Event read failed: ${error.message}`);
    const event = data as CompetitionEvent | null;
    return event && isPublicEvent(event) ? event : null;
  }

  /** These roster rows, of this Event only, that name a fighter profile. */
  private async rosterRows(
    eventId: string,
    personIds: string[],
  ): Promise<Array<{ id: string; global_person_id: string }>> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id')
      .eq('event_id', eventId)
      .in('id', [...new Set(personIds)]);
    if (error) throw new Error(`FightBook roster read failed: ${error.message}`);
    return ((data ?? []) as Array<{ id: string; global_person_id: string | null }>).filter(
      (row): row is { id: string; global_person_id: string } => row.global_person_id !== null,
    );
  }
}
