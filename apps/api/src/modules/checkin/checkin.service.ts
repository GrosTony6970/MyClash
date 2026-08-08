import { BadRequestException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { SupabaseService } from '../supabase/supabase.service';
import { StaffService } from '../staff/staff.service';
import type { MarkArrivalDto } from './dto';
import {
  mapRosterRow,
  orderMissingByUrgency,
  type ArrivalRow,
  type MissingFighter,
  type RosterEntry,
  type RosterPersonRow,
} from './roster';

/** Roles allowed to work the desk. See `SCORING_ROLES` in staff.service.ts. */
const DESK_ROLES = ['checkin'] as const;

/**
 * The desk types three letters and expects to see the name. 40 is generous for
 * a name search and small enough that an empty query — which the first paint
 * and the missing-at-risk view both send — stays one screen.
 */
const ROSTER_LIMIT = 40;

/**
 * Everything the check-in desk reads and writes.
 *
 * Its own module rather than more of `staff.service.ts`, which is already past
 * 1500 lines and owns a different job (the scoring pad). It borrows exactly one
 * thing from there — `requireStaffWithRole` — so that what an mc_staff session
 * means has a single owner.
 *
 * EVENT-scoped throughout: every method resolves the session first and then
 * filters by that session's `event_id`. A desk account has no Lice assignment,
 * so there is no narrower scope available and none is wanted — a volunteer at
 * the door checks in anyone at the event.
 */
@Injectable()
export class CheckinService {
  constructor(
    private readonly supabase: SupabaseService,
    // Value import, not `import type` — a type-only import erases the DI
    // metadata Nest needs to resolve this.
    private readonly staff: StaffService,
  ) {}

  /**
   * The roster, filtered by name, each row carrying its arrival state.
   *
   * Photo comes from `global_persons.photo_url` — local `persons` has none —
   * and the club logo through `persons.club_id`. Both are on the row because
   * the desk's job is confirming the human standing in front of the volunteer:
   * two fighters with similar names is the failure this prevents, and a name
   * alone does not prevent it.
   */
  async searchRoster(req: FastifyRequest, q: string | undefined): Promise<RosterEntry[]> {
    const staff = await this.staff.requireStaffWithRole(req, DESK_ROLES);
    const people = await this.queryPeople(staff.event_id, q);
    if (people.length === 0) return [];

    const arrivals = await this.arrivalsFor(
      staff.event_id,
      people.map((person) => person.id),
    );
    return people.map((person) => mapRosterRow(person, arrivals.get(person.id) ?? null));
  }

  /**
   * Mark someone present.
   *
   * An upsert on (event_id, person_id), which the UNIQUE index in 0174 makes
   * idempotent: two volunteers tapping the same name at the same moment produce
   * one row, not a race. It also re-arms a previously undone arrival, which is
   * the "marked by mistake, then they actually showed up" case.
   */
  async markArrived(req: FastifyRequest, personId: string, dto: MarkArrivalDto) {
    const staff = await this.staff.requireStaffWithRole(req, DESK_ROLES);
    await this.assertPersonInEvent(staff.event_id, personId);

    const { data, error } = await this.supabase.service
      .from('event_arrivals')
      .upsert(
        {
          event_id: staff.event_id,
          person_id: personId,
          state: 'present',
          via: dto.via,
          marked_by_staff_account_id: staff.id,
          marked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,person_id' },
      )
      .select('person_id,state,via,marked_at,reversed_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Undo an arrival — a state change, never a delete.
   *
   * Deleting would erase the fact that a mis-tap happened, and "who marked
   * Marie present and then unmarked her" is exactly the question asked when a
   * fighter insists they checked in. The reversal keeps its own actor.
   */
  async undoArrival(req: FastifyRequest, personId: string) {
    const staff = await this.staff.requireStaffWithRole(req, DESK_ROLES);

    const { data, error } = await this.supabase.service
      .from('event_arrivals')
      .update({
        state: 'absent',
        reversed_by_staff_account_id: staff.id,
        reversed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('event_id', staff.event_id)
      .eq('person_id', personId)
      .select('person_id,state,via,marked_at,reversed_at')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    // No row means nobody ever marked them, which is already the desired end
    // state. Reporting 404 for an undo that had nothing to undo would make a
    // double-tap look like a failure.
    return data ?? { person_id: personId, state: 'absent', via: null };
  }

  /** Arrived / total, for the desk footer. */
  async getSummary(req: FastifyRequest): Promise<{ arrived: number; total: number }> {
    const staff = await this.staff.requireStaffWithRole(req, DESK_ROLES);
    return this.countArrivals(staff.event_id);
  }

  /**
   * Who has not arrived, ordered by how soon they fight.
   *
   * The organiser's screen, and the whole payoff of capturing arrival at all.
   * Ordered by urgency rather than alphabetically because urgency is the only
   * question being asked; the unscheduled group sits last rather than being
   * hidden, since they are still missing, just not yet costing anyone time.
   */
  async getMissingAtRisk(req: FastifyRequest): Promise<MissingFighter[]> {
    const staff = await this.staff.requireStaffWithRole(req, DESK_ROLES);
    const people = await this.queryPeople(staff.event_id, undefined, 500);
    const arrivals = await this.arrivalsFor(
      staff.event_id,
      people.map((person) => person.id),
    );
    const missing = people.filter(
      (person) => (arrivals.get(person.id)?.state ?? 'absent') !== 'present',
    );
    if (missing.length === 0) return [];

    const nextMatches = await this.nextMatchByPerson(missing.map((person) => person.id));
    return orderMissingByUrgency(
      missing.map((person) => ({
        person: mapRosterRow(person, arrivals.get(person.id) ?? null),
        next: nextMatches.get(person.id) ?? null,
      })),
    );
  }

  // ── queries ───────────────────────────────────────────────────────────────

  private async queryPeople(
    eventId: string,
    q: string | undefined,
    limit = ROSTER_LIMIT,
  ): Promise<RosterPersonRow[]> {
    let query = this.supabase.service
      .from('persons')
      .select(
        'id,given_name,family_name,club_id,global_person_id,clubs(name,logo_url),global_persons(photo_url)',
      )
      .eq('event_id', eventId)
      .order('family_name', { ascending: true })
      .limit(limit);

    const safe = q ? sanitizePostgrestFilterValue(q) : '';
    // Commas and parens would break out of the `or` grammar, so the sanitizer
    // strips them; an all-punctuation query sanitizes to '' and is treated as
    // no filter rather than as a match-nothing.
    if (safe.length >= 2) {
      query = query.or(
        `given_name.ilike.%${safe}%,family_name.ilike.%${safe}%`,
      ) as unknown as typeof query;
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as unknown as RosterPersonRow[];
  }

  private async arrivalsFor(
    eventId: string,
    personIds: string[],
  ): Promise<Map<string, ArrivalRow>> {
    if (personIds.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('event_arrivals')
      .select('person_id,state,via,marked_at,reversed_at')
      .eq('event_id', eventId)
      .in('person_id', personIds);
    if (error) throw new BadRequestException(error.message);
    return new Map(((data ?? []) as unknown as ArrivalRow[]).map((row) => [row.person_id, row]));
  }

  private async countArrivals(eventId: string): Promise<{ arrived: number; total: number }> {
    // PostgREST aggregate functions are DISABLED on this deployment, so counts
    // come from `head: true` + `count: 'exact'` rather than from a sum().
    const [{ count: total, error: totalErr }, { count: arrived, error: arrivedErr }] =
      await Promise.all([
        this.supabase.service
          .from('persons')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', eventId),
        this.supabase.service
          .from('event_arrivals')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', eventId)
          .eq('state', 'present'),
      ]);
    if (totalErr) throw new BadRequestException(totalErr.message);
    if (arrivedErr) throw new BadRequestException(arrivedErr.message);
    return { arrived: arrived ?? 0, total: total ?? 0 };
  }

  /**
   * Each person's soonest scheduled bout.
   *
   * Two hops because `matches` has NO event_id: person → registrations (scoped
   * to this event's tournaments by the registration ids we already hold) →
   * matches on either side.
   */
  private async nextMatchByPerson(personIds: string[]) {
    const { data: regs, error: regErr } = await this.supabase.service
      .from('registrations')
      .select('id,person_id')
      .in('person_id', personIds);
    if (regErr) throw new BadRequestException(regErr.message);

    const personByReg = new Map(
      ((regs ?? []) as Array<{ id: string; person_id: string }>).map((r) => [r.id, r.person_id]),
    );
    if (personByReg.size === 0) return new Map<string, never>();

    const regIds = [...personByReg.keys()];
    const { data: matches, error: matchErr } = await this.supabase.service
      .from('matches')
      .select(
        'id,scheduled_at,red_registration_id,blue_registration_id,lices(name),pools(name),phases(tournaments(name))',
      )
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .or(
        `red_registration_id.in.(${regIds.join(',')}),blue_registration_id.in.(${regIds.join(',')})`,
      )
      .order('scheduled_at', { ascending: true });
    if (matchErr) throw new BadRequestException(matchErr.message);

    return indexEarliestByPerson(
      (matches ?? []) as unknown as Array<Record<string, unknown>>,
      personByReg,
    );
  }

  private async assertPersonInEvent(eventId: string, personId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id')
      .eq('event_id', eventId)
      .eq('id', personId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    // A scan or a stale tab can name someone from another event. Refusing here
    // is what keeps a desk account's reach equal to its own event.
    if (!data) throw new BadRequestException('Person is not on this event roster');
  }
}

/**
 * First match wins per person — the query is already ordered by
 * `scheduled_at`, so the earliest is simply the first one seen.
 */
function indexEarliestByPerson(
  matches: Array<Record<string, unknown>>,
  personByReg: Map<string, string>,
) {
  const byPerson = new Map<string, MissingFighter['next']>();
  for (const match of matches) {
    const sides = [match['red_registration_id'], match['blue_registration_id']];
    for (const regId of sides) {
      const personId = typeof regId === 'string' ? personByReg.get(regId) : undefined;
      if (!personId || byPerson.has(personId)) continue;
      byPerson.set(personId, {
        scheduledAt: (match['scheduled_at'] as string | null) ?? null,
        liceName: (match['lices'] as { name?: string } | null)?.name ?? null,
        poolName: (match['pools'] as { name?: string } | null)?.name ?? null,
        tournamentName:
          (match['phases'] as { tournaments?: { name?: string } } | null)?.tournaments?.name ??
          null,
      });
    }
  }
  return byPerson;
}
