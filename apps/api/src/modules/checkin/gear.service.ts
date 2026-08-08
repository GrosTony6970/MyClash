import { BadRequestException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { StaffService } from '../staff/staff.service';
import { slugify } from '../fighters/weapon-import.util';
import type { RecordGearCheckDto } from './dto';
import { queryEventRoster } from './roster-query';
import { mapRosterRow } from './roster';
import { buildGearEntry, latestCheckPerWeapon, type GearEntry, type GearCheckRow } from './gear';

/** Roles allowed to work the gear table. See `SCORING_ROLES` in staff.service.ts. */
const GEAR_ROLES = ['gear'] as const;

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

  /** The roster, each person expanded into one line per weapon they are entered in. */
  async searchGearRoster(req: FastifyRequest, q: string | undefined): Promise<GearEntry[]> {
    const staff = await this.staff.requireStaffWithRole(req, GEAR_ROLES);
    const people = await queryEventRoster(this.supabase, staff.event_id, q);
    if (people.length === 0) return [];

    const personIds = people.map((person) => person.id);
    const [weaponsByPerson, latest] = await Promise.all([
      this.weaponsByPerson(staff.event_id, personIds),
      this.latestChecks(staff.event_id, personIds),
    ]);

    return people.map((person) =>
      buildGearEntry(mapRosterRow(person, null), weaponsByPerson.get(person.id) ?? [], latest),
    );
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

  /** How many of this event's fighters have every entered weapon checked. */
  async getSummary(req: FastifyRequest): Promise<{ checked: number; total: number }> {
    const staff = await this.staff.requireStaffWithRole(req, GEAR_ROLES);
    const people = await queryEventRoster(this.supabase, staff.event_id, undefined, 1000);
    const personIds = people.map((person) => person.id);
    const [weaponsByPerson, latest] = await Promise.all([
      this.weaponsByPerson(staff.event_id, personIds),
      this.latestChecks(staff.event_id, personIds),
    ]);

    // A fighter counts as checked when every weapon they are entered in has a
    // result. Partial coverage is NOT checked: a longsword pass says nothing
    // about the rapier they fight with after lunch.
    const checked = people.filter((person) => {
      const weapons = weaponsByPerson.get(person.id) ?? [];
      return (
        weapons.length > 0 && weapons.every((weapon) => latest.has(`${person.id}:${weapon.id}`))
      );
    }).length;
    return { checked, total: people.length };
  }

  // ── queries ───────────────────────────────────────────────────────────────

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
