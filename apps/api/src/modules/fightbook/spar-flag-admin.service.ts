import { Injectable, NotFoundException } from '@nestjs/common';
import type { SparFlagListItem, SparFlagPage, SparFlagReason, SparKind } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { readSparEventNames, readSparFighters, unknownSparFighter } from './spar-fighters';

/** Reports per page of the lists. */
export const FLAGS_PAGE_SIZE = 20;

/** A row of `fightbook_flags_page` (0269): never the flagged fighter's account. */
type FlagRow = {
  id: string;
  created_at: string;
  reason: SparFlagReason;
  body: string;
  reporter_global_person_id: string | null;
  subject_global_person_id: string;
  kind: SparKind;
  event_id: string | null;
  organization_id: string | null;
  spar_day: string;
  place: string | null;
  weapons: string[];
  handled_at: string | null;
};

/**
 * The safety report lists and the "handled" mark (FightBook slice 4, ruling 692). Who must never
 * read a report (the flagged fighter, even as an admin) is decided by `fightbook_flags_page` and
 * `fightbook_flag_mark` alone: this service filters no row and re-decides nothing. The caller's
 * right to ask (club admin, super admin) is the controller's gate.
 *
 * The write side is bounded by one report per reporter-family per spar, deleted after two years.
 * The race it names: two admins marking the same report. Each mark is idempotent in the function
 * (`coalesce(handled_at, p_now)`), so the loser also answers 204.
 */
@Injectable()
export class SparFlagAdminService {
  constructor(private readonly supabase: SupabaseService) {}

  /** One page: `orgId` for a club's list, null for the platform's (which names each club). */
  async page(caller: string, orgId: string | null, page: number): Promise<SparFlagPage> {
    const { data, error } = await this.supabase.service.rpc('fightbook_flags_page', {
      p_caller: caller,
      p_org: orgId,
      p_offset: FLAGS_PAGE_SIZE * page,
      p_limit: FLAGS_PAGE_SIZE + 1,
    });
    if (error) throw new Error(`FightBook flags read failed: ${error.message}`);
    const rows = (data ?? []) as FlagRow[];
    const shown = rows.slice(0, FLAGS_PAGE_SIZE);
    return { items: await this.items(shown, orgId === null), more: rows.length > FLAGS_PAGE_SIZE };
  }

  /** Sets or clears "handled"; a report out of the caller's scope or hidden from them is a 404. */
  async mark(
    caller: string,
    orgId: string | null,
    flagId: string,
    handled: boolean,
    now = new Date(),
  ): Promise<void> {
    const { data, error } = await this.supabase.service.rpc('fightbook_flag_mark', {
      p_caller: caller,
      p_org: orgId,
      p_flag: flagId,
      p_handled: handled,
      p_now: now.toISOString(),
    });
    if (error) throw new Error(`FightBook flag mark failed: ${error.message}`);
    if (data !== true) throw new NotFoundException('Safety report not found');
  }

  private async items(rows: FlagRow[], withClub: boolean): Promise<SparFlagListItem[]> {
    const db = this.supabase.service;
    const people = (id: string | null) => (id === null ? [] : [id]);
    const [fighters, events, clubs] = await Promise.all([
      readSparFighters(
        db,
        rows.flatMap((r) => [r.subject_global_person_id, ...people(r.reporter_global_person_id)]),
      ),
      readSparEventNames(db, [...new Set(rows.flatMap((r) => people(r.event_id)))]),
      withClub ? this.clubNames(rows) : Promise.resolve(new Map<string, string>()),
    ]);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      reason: r.reason,
      text: r.body,
      reporter: r.reporter_global_person_id
        ? (fighters.get(r.reporter_global_person_id) ??
          unknownSparFighter(r.reporter_global_person_id))
        : null,
      flagged:
        fighters.get(r.subject_global_person_id) ?? unknownSparFighter(r.subject_global_person_id),
      kind: r.kind,
      eventName: r.event_id ? (events.get(r.event_id) ?? null) : null,
      club: r.organization_id ? (clubs.get(r.organization_id) ?? null) : null,
      day: r.spar_day,
      place: r.place,
      weapons: r.weapons,
      handled: r.handled_at !== null,
    }));
  }

  /** The clubs' names for the platform list: at most 20 ids, one read. */
  private async clubNames(rows: FlagRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((r) => (r.organization_id ? [r.organization_id] : [])))];
    if (ids.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id, name')
      .in('id', ids);
    if (error) throw new Error(`FightBook flag clubs read failed: ${error.message}`);
    return new Map(
      ((data ?? []) as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]),
    );
  }
}
