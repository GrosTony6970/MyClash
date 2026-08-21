import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { StaffService } from '../staff/staff.service';
import { slugify } from '../fighters/weapon-import.util';
import type { RecordGearCheckDto } from './dto';
import { queryEventRoster, ROSTER_LIMIT } from './roster-query';
import { mapRosterRow, type DeskList } from './roster';
import {
  buildGearEntry,
  buildMatchGear,
  latestCheckPerWeapon,
  type GearEntry,
  type GearCheckRow,
  type MatchGear,
} from './gear';

/** The gear table's answer: the roster, and whether the ceiling cut it short. */
export type GearList = DeskList<GearEntry>;

/** Roles allowed to work the gear table. See `SCORING_ROLES` in staff.service.ts. */
const GEAR_ROLES = ['gear'] as const;

/**
 * Who may READ a gear result on a match: the piste as well as the gear table.
 *
 * The scoring role is the point of this list — the referee is who the result
 * was always meant to reach. Writing stays on GEAR_ROLES; a referee may see a
 * failed check and may not record one.
 */
const GEAR_READ_ROLES = ['gear', 'scoring'] as const;

interface CatalogWeapon {
  id: string;
  name: string;
}

/**
 * The gear-check desk.
 *
 * Deliberately the check-in desk's screen with a different action strip, so it
 * shares `queryEventRoster`: both desks answer "who is this person in front of
 * me?" first, and must answer it identically.
 *
 * INFORMATIONAL ONLY. Nothing here gates a match, and no scoring or scheduling
 * path reads `event_gear_checks`. The result is shown where the referee already
 * looks; the referee decides.
 */
@Injectable()
export class GearService {
  constructor(
    private readonly supabase: SupabaseService,
    // Value import, not `import type` — a type-only import erases the DI
    // metadata Nest needs to resolve this.
    private readonly staff: StaffService,
  ) {}

  /**
   * The whole event roster, each person expanded into one line per weapon.
   *
   * Unfiltered and unpaged for the same reason the desk is: the gear table
   * groups people into pass / conditional / fail / still-to-check tabs and puts
   * a count on each, and a count is only true of a list it was computed from.
   *
   * Every row's `next` stays null — this surface shows no schedule, and a gear
   * account has no reason to receive every fighter's next bout.
   */
  async listGearRoster(req: FastifyRequest, limit = ROSTER_LIMIT): Promise<GearList> {
    const staff = await this.staff.requireStaffWithRole(req, GEAR_ROLES);
    const { people, truncated } = await queryEventRoster(this.supabase, staff.event_id, limit);
    if (people.length === 0) return { entries: [], truncated };

    const personIds = people.map((person) => person.id);
    const [weaponsByPerson, latest] = await Promise.all([
      this.weaponsByPerson(staff.event_id, personIds),
      this.latestChecks(staff.event_id, personIds),
    ]);

    return {
      entries: people.map((person) =>
        buildGearEntry(mapRosterRow(person, null), weaponsByPerson.get(person.id) ?? [], latest),
      ),
      truncated,
    };
  }

  /**
   * Record one check. Appends — it never overwrites.
   *
   * A re-check after a failure is the point of the `fail` and `conditional`
   * states, and overwriting would destroy the only record that a fighter was
   * ever turned away.
   */
  async recordCheck(
    req: FastifyRequest,
    personId: string,
    weaponId: string,
    dto: RecordGearCheckDto,
  ) {
    const staff = await this.staff.requireStaffWithRole(req, GEAR_ROLES);
    await this.assertPersonInEvent(staff.event_id, personId);

    const { data, error } = await this.supabase.service
      .from('event_gear_checks')
      .insert({
        event_id: staff.event_id,
        person_id: personId,
        weapon_id: weaponId,
        result: dto.result,
        // Trimmed, so a reason of spaces cannot satisfy the DTO and then be
        // refused by the table's btrim CHECK as a 500 instead of a 400.
        reason: dto.reason?.trim() ? dto.reason.trim() : null,
        checked_by_staff_account_id: staff.id,
      })
      .select('person_id,weapon_id,result,reason,checked_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * The two fighters' gear standing for one match, for the pad.
   *
   * 0175 said the result "is displayed where the referee already looks" and
   * nothing displayed it: `event_gear_checks` was read only by the gear screen
   * itself, so a fighter turned away at the gear table walked to the piste with
   * nothing on the referee's screen to say so. This is that read.
   *
   * Still informational. It returns a result and never a verdict, and nothing
   * downstream of it gates a match.
   *
   * NOT on the public `GET /matches/:id/summary`: which named fighter failed an
   * equipment check is event-internal, and that endpoint answers to anyone.
   */
  async matchGear(req: FastifyRequest, matchId: string): Promise<MatchGear> {
    const staff = await this.staff.requireStaffWithRole(req, GEAR_READ_ROLES);
    const bout = await this.loadBout(matchId, staff.event_id);

    const persons = await this.personsByRegistration(
      [bout.redRegistrationId, bout.blueRegistrationId].filter(
        (id): id is string => typeof id === 'string',
      ),
    );
    const redPersonId = bout.redRegistrationId
      ? (persons.get(bout.redRegistrationId) ?? null)
      : null;
    const bluePersonId = bout.blueRegistrationId
      ? (persons.get(bout.blueRegistrationId) ?? null)
      : null;

    // Same slugify → weapon_catalog hop the gear screen uses. A second,
    // subtly different slugifier here is how the two-weapons bug returns.
    const slug = slugify(bout.weapon?.trim() ?? '');
    const weapon = slug ? ((await this.catalogBySlug([slug])).get(slug) ?? null) : null;

    const personIds = [redPersonId, bluePersonId].filter((id): id is string => Boolean(id));
    const latest = weapon
      ? await this.latestChecks(staff.event_id, personIds)
      : new Map<string, GearCheckRow>();

    return buildMatchGear({ weapon, redPersonId, bluePersonId, latest });
  }

  // ── queries ───────────────────────────────────────────────────────────────

  /**
   * The two registrations and the weapon of one bout, scoped to this event.
   *
   * A staff session is event-scoped, so a match in another event is not this
   * account's to read however valid its id — and it answers 404, not 403, so
   * the response cannot be used to confirm the match exists elsewhere.
   */
  private async loadBout(
    matchId: string,
    eventId: string,
  ): Promise<{
    redRegistrationId: string | null;
    blueRegistrationId: string | null;
    weapon: string | null;
  }> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, phases!inner(tournament_id, tournaments!inner(weapon, event_id))',
      )
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);

    const row = data as unknown as {
      red_registration_id: string | null;
      blue_registration_id: string | null;
      phases: unknown;
    };
    // Many-to-one embeds come back as objects, but a mis-shaped one is an
    // array; normalise both hops rather than trust the shape.
    const phase = Array.isArray(row.phases) ? row.phases[0] : row.phases;
    const embed = (phase as { tournaments?: unknown } | null)?.tournaments;
    const tournament = (Array.isArray(embed) ? embed[0] : embed) as {
      weapon: string | null;
      event_id: string;
    } | null;
    if (!tournament || tournament.event_id !== eventId) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }

    return {
      redRegistrationId: row.red_registration_id,
      blueRegistrationId: row.blue_registration_id,
      weapon: tournament.weapon,
    };
  }

  private async personsByRegistration(
    registrationIds: string[],
  ): Promise<Map<string, string | null>> {
    if (registrationIds.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('id,person_id')
      .in('id', registrationIds);
    if (error) throw new BadRequestException(error.message);
    return new Map(
      ((data ?? []) as Array<{ id: string; person_id: string | null }>).map((row) => [
        row.id,
        row.person_id,
      ]),
    );
  }

  /**
   * Which catalog weapons each person is entered in, for this event.
   *
   * The join is person → registrations → tournaments → `tournaments.weapon`,
   * which is FREE TEXT, then slugified into `weapon_catalog`. That last hop is
   * the trap: keying on the raw text would make "Longsword" and "Long sword"
   * two weapons and ask one fighter to gear-check twice for one kit.
   *
   * `slugify` is the same helper the weapon importer uses to WRITE
   * `fighter_weapons`, so read and write agree. It is not byte-identical to the
   * SQL expression 0017 seeded the catalog with — the SQL keeps a trailing
   * hyphen that this trims — but they agree on every weapon name that is not
   * pure punctuation, and using a second, subtly different slugifier here is
   * precisely how the two-weapons bug gets reintroduced.
   */
  private async weaponsByPerson(
    eventId: string,
    personIds: string[],
  ): Promise<Map<string, CatalogWeapon[]>> {
    if (personIds.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('person_id,tournaments!inner(weapon,event_id)')
      .in('person_id', personIds);
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as unknown as Array<{
      person_id: string;
      tournaments: { weapon: string | null; event_id: string } | null;
    }>;
    const slugsByPerson = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.tournaments?.event_id !== eventId) continue;
      const slug = slugify(row.tournaments.weapon?.trim() ?? '');
      if (!slug) continue;
      const held = slugsByPerson.get(row.person_id) ?? new Set<string>();
      held.add(slug);
      slugsByPerson.set(row.person_id, held);
    }

    const catalog = await this.catalogBySlug([
      ...new Set([...slugsByPerson.values()].flatMap((set) => [...set])),
    ]);
    const out = new Map<string, CatalogWeapon[]>();
    for (const [personId, slugs] of slugsByPerson) {
      const weapons = [...slugs]
        .map((slug) => catalog.get(slug))
        .filter((weapon): weapon is CatalogWeapon => Boolean(weapon))
        .sort((a, b) => a.name.localeCompare(b.name));
      out.set(personId, weapons);
    }
    return out;
  }

  private async catalogBySlug(slugs: string[]): Promise<Map<string, CatalogWeapon>> {
    if (slugs.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('weapon_catalog')
      .select('id,slug,name')
      .in('slug', slugs);
    if (error) throw new BadRequestException(error.message);
    return new Map(
      ((data ?? []) as Array<{ id: string; slug: string; name: string }>).map((row) => [
        row.slug,
        { id: row.id, name: row.name },
      ]),
    );
  }

  private async latestChecks(
    eventId: string,
    personIds: string[],
  ): Promise<Map<string, GearCheckRow>> {
    if (personIds.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('event_gear_checks')
      .select('person_id,weapon_id,result,reason,checked_at')
      .eq('event_id', eventId)
      .in('person_id', personIds)
      .order('checked_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return latestCheckPerWeapon((data ?? []) as unknown as GearCheckRow[]);
  }

  private async assertPersonInEvent(eventId: string, personId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id')
      .eq('event_id', eventId)
      .eq('id', personId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Person is not on this event roster');
  }
}
