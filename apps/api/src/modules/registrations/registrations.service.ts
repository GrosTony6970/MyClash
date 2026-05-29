import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { SupabaseService } from '../supabase/supabase.service';
import { detectCsvDelimiter } from '../persons/csv-import.service';
import {
  REGISTRATION_STATUS_TRANSITIONS,
  type CreateRegistrationDto,
} from './dto/registrations.dto';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

@Injectable()
export class RegistrationsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(tournamentId: string) {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select(
        `
        *,
        persons(id, given_name, family_name, email, club_id),
        global_persons(id, slug, display_name)
      `,
      )
      .eq('tournament_id', tournamentId)
      .order('bib_number', { ascending: true, nullsFirst: false });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Flat list of every registration under the given event. Joins through
   * `tournaments` with `!inner` so the PostgREST `.eq('tournaments.event_id', …)`
   * filter actually narrows the set instead of being silently dropped.
   *
   * The /persons sub-page in web-admin needs this exact view to drive its
   * tournament chips, per-tournament tab filter, and edit-modal delete fan-out
   * — it expects camelCase keys (`personId`, `tournamentId`, …), which is why
   * we map rather than returning raw rows like `list(tournamentId)` does.
   */
  async listForEvent(eventId: string): Promise<
    Array<{
      id: string;
      personId: string;
      tournamentId: string;
      tournamentName: string;
      status: string;
      seed: number | null;
    }>
  > {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select(
        `
        id,
        person_id,
        tournament_id,
        status,
        seed,
        bib_number,
        tournaments!inner(id, name, event_id)
      `,
      )
      .eq('tournaments.event_id', eventId)
      .order('bib_number', { ascending: true, nullsFirst: false });

    if (error) throw new BadRequestException(error.message);
    // PostgREST auto-types the joined `tournaments` as an array even when the
    // FK is many-to-one — runtime returns a single object. Cast via unknown
    // and handle either shape.
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      person_id: string;
      tournament_id: string;
      status: string;
      seed: number | null;
      tournaments:
        | { id: string; name: string; event_id: string }
        | { id: string; name: string; event_id: string }[]
        | null;
    }>;
    return rows.map((row) => {
      const tournament = Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments;
      return {
        id: row.id,
        personId: row.person_id,
        tournamentId: row.tournament_id,
        tournamentName: tournament?.name ?? '',
        status: row.status,
        seed: row.seed,
      };
    });
  }

  // ── Create (single) ──────────────────────────────────────────────────────────

  async create(tournamentId: string, dto: CreateRegistrationDto) {
    const fighterId = await this.resolveFighterForRegistration(dto);
    // Slice 2: capacity guard — returns 409 with reason='tournament_full' so
    // the admin UI can offer 'Add to waitlist instead?' as an explicit step.
    await this.assertCapacityForCreate(tournamentId);
    const bibNumber = dto.bibNumber ?? (await this.nextBibNumber(tournamentId));

    const { data, error } = await this.supabase.service
      .from('registrations')
      .insert({
        tournament_id: tournamentId,
        person_id: dto.personId,
        fighter_id: dto.fighterId ?? fighterId,
        seed: dto.seed ?? null,
        bib_number: bibNumber,
        status: 'registered',
      })
      .select('*')
      .single();

    if (error) {
      if (error.message.includes('unique')) {
        throw new BadRequestException('This person is already registered in this tournament');
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  private async assertCapacityForCreate(tournamentId: string): Promise<void> {
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('max_participants')
      .eq('id', tournamentId)
      .maybeSingle();
    const max =
      (tournament as { max_participants: number | null } | null)?.max_participants ?? null;
    if (max == null) return;
    const { data: countRows } = await this.supabase.service
      .from('registrations')
      .select('id')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);
    const registeredCount = (countRows ?? []).length;
    if (registeredCount >= max) {
      throw new ConflictException({
        reason: 'tournament_full',
        registeredCount,
        maxParticipants: max,
      });
    }
  }

  /**
   * Slice 2: explicit add-to-waitlist endpoint. Caller hits this after the
   * regular create returned 409 with reason='tournament_full'. Slots in at
   * `max(waitlist_position) + 1`; returns 409 with reason='waitlist_full'
   * when the queue is also capped and full.
   */
  async addToWaitlist(tournamentId: string, dto: CreateRegistrationDto) {
    const fighterId = await this.resolveFighterForRegistration(dto);

    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('max_waitlist')
      .eq('id', tournamentId)
      .maybeSingle();
    const maxWaitlist =
      (tournament as { max_waitlist: number | null } | null)?.max_waitlist ?? null;

    const { data: topRow } = await this.supabase.service
      .from('registrations')
      .select('waitlist_position')
      .eq('tournament_id', tournamentId)
      .eq('status', 'waitlist')
      .order('waitlist_position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const highestPosition =
      (topRow as { waitlist_position: number | null } | null)?.waitlist_position ?? 0;
    const nextPosition = highestPosition + 1;

    if (maxWaitlist != null && nextPosition > maxWaitlist) {
      throw new ConflictException({
        reason: 'waitlist_full',
        currentCount: highestPosition,
        maxWaitlist,
      });
    }

    const { data, error } = await this.supabase.service
      .from('registrations')
      .insert({
        tournament_id: tournamentId,
        person_id: dto.personId,
        fighter_id: dto.fighterId ?? fighterId,
        seed: dto.seed ?? null,
        // Waitlist entries don't get a bib until promoted; auto-assigning at
        // queue time would burn numbers that may never be used.
        bib_number: null,
        status: 'waitlist',
        waitlist_position: nextPosition,
      })
      .select('*')
      .single();

    if (error) {
      if (error.message.includes('unique')) {
        throw new BadRequestException(
          'This person is already registered or on the waitlist for this tournament',
        );
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  // ── CSV bulk import ──────────────────────────────────────────────────────────

  async importCsv(tournamentId: string, buffer: Buffer) {
    // Strip BOM
    let content = buffer.toString('utf-8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

    const delimiter = detectCsvDelimiter(content);

    let rows: Record<string, string>[];
    try {
      rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        delimiter,
      }) as Record<string, string>[];
    } catch (err) {
      throw new BadRequestException(`CSV parse error: ${String(err)}`);
    }

    const report = { created: 0, skipped: 0, errors: [] as string[] };

    for (const [idx, row] of rows.entries()) {
      const rowNum = idx + 2;
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        normalized[k.toLowerCase().trim()] = v ?? '';
      }

      const email = (normalized['email'] ?? '').trim().toLowerCase();
      if (!email) {
        report.errors.push(`Row ${rowNum}: missing email`);
        continue;
      }

      // Look up person by email within the tournament's event
      const { data: person } = await this.supabase.service
        .from('persons')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!person) {
        report.errors.push(`Row ${rowNum}: no person found with email ${email}`);
        continue;
      }

      const personId = (person as { id: string }).id;
      const bibNumber = normalized['bib_number']
        ? parseInt(normalized['bib_number'], 10)
        : await this.nextBibNumber(tournamentId);

      const { error } = await this.supabase.service.from('registrations').insert({
        tournament_id: tournamentId,
        person_id: personId,
        bib_number: bibNumber,
        status: 'registered',
      });

      if (error) {
        if (error.message.includes('unique')) {
          report.skipped++;
        } else {
          report.errors.push(`Row ${rowNum}: ${error.message}`);
        }
        continue;
      }

      report.created++;
    }

    return report;
  }

  // ── Status transition ────────────────────────────────────────────────────────

  async updateStatus(registrationId: string, newStatus: string) {
    const { data: reg, error: fetchError } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, status')
      .eq('id', registrationId)
      .maybeSingle();

    if (fetchError || !reg) throw new NotFoundException(`Registration ${registrationId} not found`);

    const currentStatus = (reg as { status: string }).status;
    const tournamentId = (reg as { tournament_id: string }).tournament_id;
    const allowed = REGISTRATION_STATUS_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from "${currentStatus}" to "${newStatus}". ` +
          `Allowed transitions: ${allowed.length ? allowed.join(', ') : 'none'}`,
      );
    }

    const { data, error } = await this.supabase.service
      .from('registrations')
      .update({ status: newStatus })
      .eq('id', registrationId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Slice 3a: when someone withdraws out of a competing seat, auto-promote
    // the position-1 waitlist entry to registered. Skip-the-queue is done
    // via the explicit promoteFromWaitlist endpoint instead.
    if (
      newStatus === 'withdrawn' &&
      (currentStatus === 'registered' || currentStatus === 'checked_in')
    ) {
      await this.autoPromoteFirstWaitlist(tournamentId);
    }

    return data;
  }

  /**
   * Slice 3a: flip position 1 to registered and shift positions 2..N up by
   * one. No-op when the waitlist is empty.
   */
  private async autoPromoteFirstWaitlist(tournamentId: string): Promise<void> {
    const { data: rows } = await this.supabase.service
      .from('registrations')
      .select('id, waitlist_position')
      .eq('tournament_id', tournamentId)
      .eq('status', 'waitlist')
      .order('waitlist_position', { ascending: true });
    const waitlist = (rows ?? []) as Array<{ id: string; waitlist_position: number }>;
    if (waitlist.length === 0) return;

    const first = waitlist[0];
    if (!first) return;
    await this.supabase.service
      .from('registrations')
      .update({ status: 'registered', waitlist_position: null })
      .eq('id', first.id);

    await this.shiftWaitlistPositionsDown(waitlist.slice(1));
  }

  /**
   * Slice 3b: explicit promote of any waitlist entry to registered. Lets
   * the operator skip the queue (sponsor commitments, etc.). Capacity is
   * still enforced — pass `force=true` to override and intentionally seat
   * the tournament above its cap.
   */
  async promoteFromWaitlist(registrationId: string, force = false) {
    const { data: reg } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, status, waitlist_position')
      .eq('id', registrationId)
      .maybeSingle();
    if (!reg) throw new NotFoundException(`Registration ${registrationId} not found`);
    const row = reg as {
      id: string;
      tournament_id: string;
      status: string;
      waitlist_position: number | null;
    };
    if (row.status !== 'waitlist' || row.waitlist_position == null) {
      throw new BadRequestException('Registration is not on the waitlist');
    }

    if (!force) {
      await this.assertCapacityForCreate(row.tournament_id);
    }

    await this.supabase.service
      .from('registrations')
      .update({ status: 'registered', waitlist_position: null })
      .eq('id', row.id);

    // Compact everyone with a position higher than the promoted row's.
    const { data: tail } = await this.supabase.service
      .from('registrations')
      .select('id, waitlist_position')
      .eq('tournament_id', row.tournament_id)
      .eq('status', 'waitlist')
      .order('waitlist_position', { ascending: true });
    const tailRows = ((tail ?? []) as Array<{ id: string; waitlist_position: number }>).filter(
      (r) => r.waitlist_position > row.waitlist_position!,
    );
    await this.shiftWaitlistPositionsDown(tailRows);
  }

  /**
   * Slice 3c: bulk reorder. Validates every id belongs to this tournament's
   * waitlist, then rewrites positions 1..N in the supplied order via a
   * two-pass write to dodge the partial unique-index collision.
   */
  async reorderWaitlist(tournamentId: string, orderedRegistrationIds: string[]) {
    const { data: rows } = await this.supabase.service
      .from('registrations')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('status', 'waitlist');
    const validIds = new Set(((rows ?? []) as Array<{ id: string }>).map((r) => r.id));
    for (const id of orderedRegistrationIds) {
      if (!validIds.has(id)) {
        throw new BadRequestException(
          `Registration ${id} is not a waitlist entry on this tournament`,
        );
      }
    }
    if (orderedRegistrationIds.length !== validIds.size) {
      throw new BadRequestException(
        `Reorder payload must list every waitlist entry exactly once (got ${orderedRegistrationIds.length}, expected ${validIds.size})`,
      );
    }
    // Pass 1: move every row to a negative slot to break the unique index
    // before reassigning the new positive positions.
    for (let i = 0; i < orderedRegistrationIds.length; i++) {
      await this.supabase.service
        .from('registrations')
        .update({ waitlist_position: -(i + 1) })
        .eq('id', orderedRegistrationIds[i]);
    }
    for (let i = 0; i < orderedRegistrationIds.length; i++) {
      await this.supabase.service
        .from('registrations')
        .update({ waitlist_position: i + 1 })
        .eq('id', orderedRegistrationIds[i]);
    }
  }

  /** Shared helper: shift the given rows' positions DOWN by 1 via the
   *  same two-pass write the reorder path uses. */
  private async shiftWaitlistPositionsDown(
    rows: Array<{ id: string; waitlist_position: number }>,
  ): Promise<void> {
    for (const row of rows) {
      await this.supabase.service
        .from('registrations')
        .update({ waitlist_position: -(row.waitlist_position - 1) })
        .eq('id', row.id);
    }
    for (const row of rows) {
      await this.supabase.service
        .from('registrations')
        .update({ waitlist_position: row.waitlist_position - 1 })
        .eq('id', row.id);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async delete(registrationId: string) {
    // Slice 3d: when the row being deleted was on the waitlist, compact
    // the positions of every row behind it. Already-registered deletions
    // don't touch the queue.
    const { data: existing } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, status, waitlist_position')
      .eq('id', registrationId)
      .maybeSingle();

    const { error } = await this.supabase.service
      .from('registrations')
      .delete()
      .eq('id', registrationId);

    if (error) throw new BadRequestException(error.message);

    if (existing) {
      const row = existing as {
        tournament_id: string;
        status: string;
        waitlist_position: number | null;
      };
      if (row.status === 'waitlist' && row.waitlist_position != null) {
        const { data: tail } = await this.supabase.service
          .from('registrations')
          .select('id, waitlist_position')
          .eq('tournament_id', row.tournament_id)
          .eq('status', 'waitlist')
          .order('waitlist_position', { ascending: true });
        const tailRows = ((tail ?? []) as Array<{ id: string; waitlist_position: number }>).filter(
          (r) => r.waitlist_position > row.waitlist_position!,
        );
        await this.shiftWaitlistPositionsDown(tailRows);
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async nextBibNumber(tournamentId: string): Promise<number> {
    const { data } = await this.supabase.service
      .from('registrations')
      .select('bib_number')
      .eq('tournament_id', tournamentId)
      .order('bib_number', { ascending: false })
      .limit(1);

    const rows = (data ?? []) as Array<{ bib_number: number | null }>;
    const max = rows[0]?.bib_number ?? 0;
    return max + 1;
  }

  private async resolveFighterForRegistration(dto: CreateRegistrationDto): Promise<string | null> {
    if (dto.fighterId) {
      if (dto.hemaRatingsId) {
        await this.supabase.service
          .from('global_persons')
          .update({ hema_ratings_id: dto.hemaRatingsId })
          .eq('id', dto.fighterId);
      }
      return dto.fighterId;
    }

    const { data: person, error } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, club_id, global_person_id')
      .eq('id', dto.personId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!person) throw new NotFoundException(`Person ${dto.personId} not found`);

    const p = person as {
      id: string;
      given_name: string;
      family_name: string;
      club_id: string | null;
      global_person_id: string | null;
    };

    if (p.global_person_id) {
      if (dto.hemaRatingsId) {
        await this.supabase.service
          .from('global_persons')
          .update({ hema_ratings_id: dto.hemaRatingsId })
          .eq('id', p.global_person_id);
      }
      return p.global_person_id;
    }

    const displayName = `${p.given_name} ${p.family_name}`;
    const baseSlug = slugify(displayName);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data: fighter, error: fighterError } = await this.supabase.service
      .from('global_persons')
      .insert({
        slug,
        display_name: displayName,
        given_name: p.given_name,
        family_name: p.family_name,
        club_id: p.club_id,
        hema_ratings_id: dto.hemaRatingsId ?? null,
        is_fighter: true,
      })
      .select('id')
      .single();

    if (fighterError || !fighter) {
      throw new BadRequestException(`Failed to create Fighter: ${fighterError?.message}`);
    }

    const fighterId = (fighter as { id: string }).id;

    await this.supabase.service
      .from('persons')
      .update({ global_person_id: fighterId })
      .eq('id', p.id);

    return fighterId;
  }
}
