import { Injectable } from '@nestjs/common';
import type { CompetitionEvent, PublicReader } from '../../common/auth/competition-visibility';
import { isPublicEvent } from '../../common/auth/event-read-gate';
import { hiddenEntrantIds } from '../../common/auth/hidden-entrants';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { inListChunks } from '../../common/postgrest-in-list';
import { addDays, zonedDay } from '@myclash/time';
import type { FightBookEvent } from '@myclash/types';
import { askableFighters } from './spar-askable';
import { openEventDays } from './spar-ask-rules';

/** The columns `myEvents` selects, no more. */
type MyEventRow = {
  id: string;
  name: string;
  status: string;
  event_kind: string | null;
  start_date: string;
  end_date: string;
  timezone: unknown;
};

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

  /**
   * The published Events `me` is on whose days have not all ended, soonest first day first, then
   * by name. Each carries its open days and today on its own clock (`openEventDays`).
   */
  async myEvents(me: string, now = new Date()): Promise<FightBookEvent[]> {
    const eventIds = await this.myEventIds(me);
    // A day stays open until 06:00 the next morning on the Event's clock, and that clock's date
    // is at most one day behind UTC's: an Event ending two days before the UTC date is over
    // everywhere. This only narrows the read; `openEventDays` decides.
    const since = addDays(zonedDay(now.toISOString(), 'UTC'), -2);
    const rows: MyEventRow[] = [];
    for (const piece of inListChunks(eventIds)) {
      const { data, error } = await this.supabase.service
        .from('events')
        .select('id, name, status, event_kind, start_date, end_date, timezone')
        .in('id', piece)
        .gte('end_date', since);
      if (error) throw new Error(`FightBook Events read failed: ${error.message}`);
      rows.push(...((data ?? []) as MyEventRow[]));
    }
    return rows
      .filter(isPublicEvent)
      .map((row) => ({ row, ...openEventDays(row, now) }))
      .filter((open) => open.days.length > 0)
      .sort((a, b) => a.days[0]!.localeCompare(b.days[0]!) || a.row.name.localeCompare(b.row.name))
      .map(({ row, days, today }) => ({ id: row.id, name: row.name, days, today }));
  }

  /** The Events where `me` has a roster row. */
  private async myEventIds(me: string): Promise<string[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('event_id')
      .eq('global_person_id', me);
    if (error) throw new Error(`FightBook roster read failed: ${error.message}`);
    return [...new Set(((data ?? []) as Array<{ event_id: string }>).map((row) => row.event_id))];
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
