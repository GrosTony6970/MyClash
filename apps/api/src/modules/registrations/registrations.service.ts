import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { IdentityMintReason } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { GlobalPersonResolverService } from '../identity/global-person-resolver.service';
import {
  FighterStatusService,
  isEntryStatusChanged,
  type EntryStatus,
  type SettleInput,
} from '../matches/fighter-status.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import {
  REGISTRATION_STATUS_TRANSITIONS,
  type CreateRegistrationDto,
} from './dto/registrations.dto';

/**
 * A written registration row plus the identity notice for THIS write. The row
 * keeps its index signature so existing callers read their own columns off it
 * unchanged; `mintedIdentity` rides alongside rather than inside it, because it
 * describes the write and not the registration.
 */
type RegistrationWithMintNotice = Record<string, unknown> & {
  mintedIdentity: IdentityMintReason | null;
};

/** What a hand door reads of an entry before it settles. */
interface EntryRow {
  id: string;
  tournament_id: string;
  entry_status: EntryStatus;
  waitlist_position: number | null;
}

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly globalPersonResolver: GlobalPersonResolverService,
    private readonly fighterStatus: FighterStatusService,
    private readonly frozenResults: FrozenResultsGuard,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(tournamentId: string) {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select(
        // Identity nests through persons after 0083 retired
        // registrations.fighter_id. Walk persons.global_person_id
        // to reach global_persons.
        `
        *,
        persons(id, given_name, family_name, email, club_id, global_persons(id, slug, display_name))
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
      waitlistPosition: number | null;
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
        waitlist_position,
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
      waitlist_position: number | null;
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
        waitlistPosition: row.waitlist_position,
      };
    });
  }

  // ── Create (single) ──────────────────────────────────────────────────────────

  async create(
    tournamentId: string,
    dto: CreateRegistrationDto,
  ): Promise<RegistrationWithMintNotice> {
    // Ensures persons.global_person_id is populated (mints a global_persons row
    // if needed). Identity now flows via person_id → persons.global_person_id;
    // registrations.fighter_id is being retired. The mint, when there is one, is
    // reported back on the response — see resolveFighterForRegistration.
    const { mintedIdentity } = await this.resolveFighterForRegistration(dto);
    // Slice 2: capacity guard — returns 409 with reason='tournament_full' so
    // the admin UI can offer 'Add to waitlist instead?' as an explicit step.
    await this.assertCapacityForCreate(tournamentId);
    const bibNumber = dto.bibNumber ?? (await this.nextBibNumber(tournamentId));

    const { data, error } = await this.supabase.service
      .from('registrations')
      .insert({
        tournament_id: tournamentId,
        person_id: dto.personId,
        seed: dto.seed ?? null,
        bib_number: bibNumber,
        status: 'registered',
        entry_status: 'registered',
      })
      .select('*')
      .single();

    if (error) {
      if (error.message.includes('unique')) {
        throw new BadRequestException('This person is already registered in this tournament');
      }
      throw new BadRequestException(error.message);
    }
    return { ...(data as Record<string, unknown>), mintedIdentity };
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
  async addToWaitlist(
    tournamentId: string,
    dto: CreateRegistrationDto,
  ): Promise<RegistrationWithMintNotice> {
    // Same call as create() — populates the canonical persons.global_person_id
    // link; we no longer write fighter_id.
    const { mintedIdentity } = await this.resolveFighterForRegistration(dto);

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
        seed: dto.seed ?? null,
        // Waitlist entries don't get a bib until promoted; auto-assigning at
        // queue time would burn numbers that may never be used.
        bib_number: null,
        status: 'waitlist',
        entry_status: 'waitlist',
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
    return { ...(data as Record<string, unknown>), mintedIdentity };
  }

  // ── Status transition ────────────────────────────────────────────────────────

  /**
   * The organiser's hand (`entry_status`, keyed by the transitions table): check-in, a withdrawal
   * and its undo (ruling 110). The status itself is the settle's, the hand one of its causes. A
   * withdrawal and its undo can move the Fighter in or out, and so their bouts and the standings:
   * on an Event that is over they are a super admin's, as every result change there (check-in
   * changes no bout and stays open). The undo takes a seat as an entry does, so a Tournament the
   * withdrawal's promote filled refuses it (`tournament_full`).
   */
  async updateStatus(registrationId: string, newStatus: string, userId?: string) {
    const reg = await this.readEntry(registrationId);
    const allowed = REGISTRATION_STATUS_TRANSITIONS[reg.entry_status] ?? [];
    if (!allowed.includes(newStatus)) {
      // A retry of a change that took: its first send may have stopped before the settle.
      if (newStatus === reg.entry_status) await this.settle(reg);
      throw new BadRequestException(
        `Cannot transition from "${reg.entry_status}" to "${newStatus}". ` +
          `Allowed transitions: ${allowed.length ? allowed.join(', ') : 'none'}`,
      );
    }
    if (newStatus !== 'checked_in') {
      await this.frozenResults.assertTournamentResultsOpen(reg.tournament_id, userId);
    }
    if (newStatus === 'registered') await this.assertCapacityForCreate(reg.tournament_id);
    await this.settle(reg, { status: newStatus as EntryStatus, expected: reg.entry_status });

    // Slice 3a: a withdrawal frees a seat, whatever else holds the Fighter out, so the
    // position-1 waitlist entry is promoted. Skip-the-queue is promoteFromWaitlist's.
    if (newStatus === 'withdrawn') await this.autoPromoteFirstWaitlist(reg.tournament_id);
    return this.readRow(registrationId);
  }

  private async readEntry(registrationId: string): Promise<EntryRow> {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, entry_status, waitlist_position')
      .eq('id', registrationId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException(`Registration ${registrationId} not found`);
    return data as EntryRow;
  }

  private async readRow(registrationId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('*')
      .eq('id', registrationId)
      .single();
    // The change is saved: a read that fails after it is a server error, not a refusal.
    if (error)
      throw new Error(`Registration ${registrationId} was not read back: ${error.message}`);
    return data as Record<string, unknown>;
  }

  /** The Fighter's status settled, with the hand's change when there is one. */
  private settle(reg: EntryRow, entry?: SettleInput['entry']) {
    return this.fighterStatus.settle({
      registrationId: reg.id,
      tournamentId: reg.tournament_id,
      entry,
    });
  }

  /** A waitlisted entry seated: false when another promote seated it first. */
  private async seat(reg: EntryRow): Promise<boolean> {
    try {
      await this.settle(reg, { status: 'registered', expected: 'waitlist', clearWaitlist: true });
      return true;
    } catch (error) {
      if (isEntryStatusChanged(error)) return false;
      throw error;
    }
  }

  /**
   * Slice 3a: flip position 1 to registered and shift positions 2..N up by
   * one. No-op when the waitlist is empty, or when another promote seated
   * position 1 first (it closed the queue itself).
   */
  private async autoPromoteFirstWaitlist(tournamentId: string): Promise<void> {
    const { data: rows } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, entry_status, waitlist_position')
      .eq('tournament_id', tournamentId)
      .eq('status', 'waitlist')
      .order('waitlist_position', { ascending: true });
    const waitlist = (rows ?? []) as EntryRow[];
    const first = waitlist[0];
    if (!first || !(await this.seat(first))) return;
    await this.shiftWaitlistPositionsDown(
      waitlist.slice(1) as Array<{ id: string; waitlist_position: number }>,
    );
  }

  /**
   * Slice 3b: explicit promote of any waitlist entry to registered. Lets
   * the operator skip the queue (sponsor commitments, etc.). Capacity is
   * still enforced — pass `force=true` to override and intentionally seat
   * the tournament above its cap.
   */
  async promoteFromWaitlist(registrationId: string, force = false, userId?: string) {
    const row = await this.readEntry(registrationId);
    if (row.entry_status !== 'waitlist' || row.waitlist_position == null) {
      // A retry of a promote that took: its first send may have stopped before the settle.
      await this.settle(row);
      throw new BadRequestException('Registration is not on the waitlist');
    }
    // A seated Fighter is drawn into the bouts: a result change, refused on an Event that is over.
    await this.frozenResults.assertTournamentResultsOpen(row.tournament_id, userId);

    if (!force) {
      await this.assertCapacityForCreate(row.tournament_id);
    }

    // Two promotes of one entry at once: the second is refused (`entry_status_changed`), and
    // only the first closes the queue.
    await this.settle(row, { status: 'registered', expected: 'waitlist', clearWaitlist: true });

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

  /**
   * Ensures `persons.global_person_id` is populated, minting a global identity
   * when nothing matches. `mintedIdentity` reports that mint to the caller: a
   * registration is the moment a person starts contributing league points, so
   * an identity minted here that can never be matched again is the one that
   * scatters those points across events. Advisory — it never blocks the write.
   */
  private async resolveFighterForRegistration(
    dto: CreateRegistrationDto,
  ): Promise<{ fighterId: string | null; mintedIdentity: IdentityMintReason | null }> {
    const { data: person, error } = await this.supabase.service
      .from('persons')
      .select(
        'id, given_name, family_name, club_id, date_of_birth, email, hema_ratings_id, global_person_id',
      )
      .eq('id', dto.personId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!person) throw new NotFoundException(`Person ${dto.personId} not found`);

    const p = person as {
      id: string;
      given_name: string;
      family_name: string;
      club_id: string | null;
      date_of_birth: string | null;
      email: string | null;
      hema_ratings_id: string | null;
      global_person_id: string | null;
    };

    // A linked profile is left as it is, whatever HEMA Ratings id the entry
    // carries (operator ruling 35): other Events and the fighter share it, and
    // only the fighter or a super admin may change its details. The entry's id
    // is not stored: the Event reads the roster row's own id first
    // (eventHemaRatingsId, ruling 39), which the roster page saves beforehand.
    if (p.global_person_id) {
      return { fighterId: p.global_person_id, mintedIdentity: null };
    }

    // Reuse an existing global identity when one matches (HEMA id, name+club+DOB,
    // or a unique name+club) — only mint when there's no confident match. This
    // is what stops a person registered across events from accumulating a
    // duplicate global_persons row per event.
    const { id: fighterId, mintReason } =
      await this.globalPersonResolver.resolveOrCreateGlobalPerson({
        givenName: p.given_name,
        familyName: p.family_name,
        clubId: p.club_id,
        hemaRatingsId: dto.hemaRatingsId ?? p.hema_ratings_id ?? null,
        dateOfBirth: p.date_of_birth ?? null,
        email: p.email ?? null,
        genderCategory: null,
      });

    await this.supabase.service
      .from('persons')
      .update({ global_person_id: fighterId })
      .eq('id', p.id);

    return { fighterId, mintedIdentity: mintReason };
  }
}
