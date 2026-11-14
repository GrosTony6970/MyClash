import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { CompetitionEvent, PublicReader } from '../../common/auth/competition-visibility';
import { isPublicEvent } from '../../common/auth/event-read-gate';
import { hiddenEntrantIds } from '../../common/auth/hidden-entrants';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { DIRECTORY_WEAPONS_SHOWN, readFighterWeaponNames } from '../fighters/fighter-weapon-names';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { IN_LIST_MAX, inListChunks, READ_PAGE } from '../../common/postgrest-in-list';
import { addDays, zonedDay } from '@myclash/time';
import type {
  EventFindCard,
  FightBookAskable,
  FightBookEvent,
  FindCard,
  FindPage,
  SparFighter,
  SparRefusalCode,
} from '@myclash/types';
import {
  applyFightBookOn,
  applyWeapon,
  askableFighters,
  blockedBy,
  favouritesOf,
  isOnEventRoster,
  weaponColumns,
} from './spar-askable';
import { freeAt, ownFreeUntil } from './free-now.service';
import { logReason } from './log-reason';
import { openEventDays } from './spar-ask-rules';
import { readSparFighters } from './spar-fighters';

/** Cards per page of all of FightBook (ruling 675). */
const FIND_PAGE_SIZE = 20;

/** The most fighters Find's Event block lists. */
export const AT_EVENT_MAX = 200;

/** By name, ignoring case and accents; the id breaks a tie, so the order never wobbles. */
export const byName = (a: SparFighter, b: SparFighter): number =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
  a.globalPersonId.localeCompare(b.globalPersonId);

/**
 * The browse's name filter: the `or` of three `ilike` (given, family, display name), or null to
 * list everyone. What was typed loses PostgREST's meta-characters (`sanitizePostgrestFilterValue`)
 * and the `ilike` wildcards `%` and `_`; under 2 characters left, there is no name filter.
 */
function browseNameFilter(q: string | undefined): string | null {
  const term = sanitizePostgrestFilterValue(q ?? '')
    .replace(/[%_]/g, '')
    .trim();
  if (term.length < 2) return null;
  return `given_name.ilike.%${term}%,family_name.ilike.%${term}%,display_name.ilike.%${term}%`;
}

type RosterRow = { id: string; global_person_id: string | null };
type ProfileRosterRow = { id: string; global_person_id: string };

/** The roster rows that name a fighter profile. */
const withProfile = (rows: RosterRow[]): ProfileRosterRow[] =>
  rows.filter((row): row is ProfileRosterRow => row.global_person_id !== null);

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
 * Who the caller may ask for a spar, for the pages that show an Ask button and the Find tab
 * (FightBook slice 2).
 * Every answer leaves out a fighter the caller blocked and never reads who blocked the caller
 * (ruling 672, `spar-askable.ts`).
 */
@Injectable()
export class SparFindService {
  private readonly logger = new Logger(SparFindService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /** May `me` ask this fighter (the profile page)? */
  async askableFighter(me: string, globalPersonId: string): Promise<FightBookAskable> {
    const db = this.supabase.service;
    const [askable, favourites] = await Promise.all([
      askableFighters(db, me, [globalPersonId]),
      favouritesOf(db, me),
    ]);
    return { askable: askable.has(globalPersonId), favourite: favourites.has(globalPersonId) };
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
   * The fighters `me` may ask among this Event's roster (Find's Event block), those free to spar
   * now first, then by name, at most `AT_EVENT_MAX`, those who declared `weaponId` only when it
   * is set. Someone entered only in a Tournament hidden from `reader` is left out, as the people
   * lookup leaves them out. 400 `bad_event` unless the Event is public and `me` is on its roster
   * (as an ask names it, ruling 665). The free-now badge is an add-on to this page: if its read
   * fails the list still comes, with no badge, and the failure is logged.
   */
  async atEvent(
    me: string,
    eventId: string,
    weaponId: string | undefined,
    reader: PublicReader,
    now = new Date(),
  ): Promise<EventFindCard[]> {
    const db = this.supabase.service;
    const event = await this.publicEvent(eventId);
    if (!event || !(await isOnEventRoster(db, me, eventId))) {
      throw new BadRequestException({
        code: 'bad_event' satisfies SparRefusalCode,
        message: 'Find lists the people of a public Event you are at',
      });
    }
    const rows = await this.wholeRoster(eventId);
    const [hidden, askable, favourites] = await Promise.all([
      hiddenEntrantIds({ supabase: this.supabase, orgs: this.orgs }, event, reader),
      askableFighters(
        db,
        me,
        rows.map((row) => row.global_person_id),
        weaponId,
      ),
      favouritesOf(db, me),
    ]);
    const ids = rows
      .filter((row) => !hidden.has(row.id) && askable.has(row.global_person_id))
      .map((row) => row.global_person_id);
    const [read, free] = await Promise.all([
      readSparFighters(db, ids),
      freeAt(db, eventId, ids, now).catch((error: unknown) => {
        this.logger.error(`Free-now badge left off: ${logReason(error)}`);
        return new Set<string>();
      }),
    ]);
    const fighters = [...read.values()].sort(
      (a, b) =>
        Number(free.has(b.globalPersonId)) - Number(free.has(a.globalPersonId)) || byName(a, b),
    );
    const cards = await this.withWeapons(fighters.slice(0, AT_EVENT_MAX), favourites);
    return cards.map((card) => ({ ...card, freeNow: free.has(card.fighter.globalPersonId) }));
  }

  /**
   * One page of all of FightBook (ruling 675): every user `me` may ask, by family name, given
   * name, then id, narrowed by name (`browseNameFilter`) and weapon when set. One read of 21
   * rows: the 21st only says there is more. The blocks `me` made go in the query, so pages stay
   * full; past `IN_LIST_MAX` blocks the rest are dropped here, and such a page may run short.
   * Whether someone blocked `me` is never read (ruling 672).
   */
  async browse(
    me: string,
    q: string | undefined,
    weaponId: string | undefined,
    page: number,
  ): Promise<FindPage> {
    const db = this.supabase.service;
    const blocked = [...(await blockedBy(db, me))];
    const listed = blocked.slice(0, IN_LIST_MAX);
    let query = applyWeapon(
      applyFightBookOn(db.from('global_persons').select(weaponColumns('id', weaponId))),
      weaponId,
    ).neq('id', me);
    const name = browseNameFilter(q);
    if (name) query = query.or(name);
    if (listed.length > 0) query = query.not('id', 'in', `(${listed.join(',')})`);
    const from = page * FIND_PAGE_SIZE;
    const { data, error } = await query
      .order('family_name')
      .order('given_name')
      .order('id')
      .range(from, from + FIND_PAGE_SIZE);
    if (error) throw new Error(`FightBook browse read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<{ id: string }>;
    const dropped = new Set(blocked.slice(IN_LIST_MAX));
    const ids = rows
      .slice(0, FIND_PAGE_SIZE)
      .map((row) => row.id)
      .filter((id) => !dropped.has(id));
    const [fighters, favourites] = await Promise.all([
      readSparFighters(db, ids),
      favouritesOf(db, me),
    ]);
    const items = await this.withWeapons(
      ids.flatMap((id) => fighters.get(id) ?? []),
      favourites,
    );
    return { items, more: rows.length > FIND_PAGE_SIZE };
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
    // The caller's own free-now time is an add-on to this page: if its read fails the Events still
    // come, with `freeUntil` null, and the failure is logged.
    const own = await ownFreeUntil(this.supabase.service, me, now).catch((error: unknown) => {
      this.logger.error(`Free-now time left off: ${logReason(error)}`);
      return new Map<string, string>();
    });
    return rows
      .filter(isPublicEvent)
      .map((row) => ({ row, ...openEventDays(row, now) }))
      .filter((open) => open.days.length > 0)
      .sort((a, b) => a.days[0]!.localeCompare(b.days[0]!) || a.row.name.localeCompare(b.row.name))
      .map(({ row, days, today }) => ({
        id: row.id,
        name: row.name,
        days,
        today,
        freeUntil: own.get(row.id) ?? null,
      }));
  }

  /**
   * These fighters as Find cards, each with up to three declared weapons (the declared favourite
   * weapons first) and whether the caller hearted them. The one card builder: the Favourites
   * list calls it too. `favourites` is the caller's, read once by the caller of this method.
   */
  async withWeapons(fighters: SparFighter[], favourites: ReadonlySet<string>): Promise<FindCard[]> {
    const weapons = await readFighterWeaponNames(
      this.supabase.service,
      fighters.map((fighter) => fighter.globalPersonId),
      DIRECTORY_WEAPONS_SHOWN,
    );
    return fighters.map((fighter) => ({
      fighter,
      weapons: weapons.get(fighter.globalPersonId) ?? [],
      favourite: favourites.has(fighter.globalPersonId),
    }));
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
  private async rosterRows(eventId: string, personIds: string[]): Promise<ProfileRosterRow[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id')
      .eq('event_id', eventId)
      .in('id', [...new Set(personIds)]);
    if (error) throw new Error(`FightBook roster read failed: ${error.message}`);
    return withProfile((data ?? []) as RosterRow[]);
  }

  /**
   * The Event's whole roster, rows that name a profile. Read page by page after the last id until
   * a page comes back empty (`READ_PAGE`): PostgREST cuts one read at its max rows without a word.
   */
  private async wholeRoster(eventId: string): Promise<ProfileRosterRow[]> {
    const rows: RosterRow[] = [];
    for (;;) {
      let query = this.supabase.service
        .from('persons')
        .select('id, global_person_id')
        .eq('event_id', eventId)
        .order('id');
      const last = rows.at(-1);
      if (last) query = query.gt('id', last.id);
      const { data, error } = await query.limit(READ_PAGE);
      if (error) throw new Error(`FightBook roster read failed: ${error.message}`);
      const page = (data ?? []) as RosterRow[];
      if (page.length === 0) return withProfile(rows);
      rows.push(...page);
    }
  }
}
