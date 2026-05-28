import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ClubResolution,
  CsvImportReport,
  GlobalPersonCandidate,
  ImportDecision,
  ImportPreviewResponse,
  Person,
  PreviewRow,
} from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { CsvImportService } from './csv-import.service';
import type { CsvRow } from './csv-import.service';
import type { CreatePersonDto, UpdatePersonDto } from './dto/persons.dto';

/**
 * Slug seed for newly-created global_persons rows. Mirrors the helper
 * in fighters.service.ts — kept inline here rather than shared because
 * it's eight cheap lines and the two callers don't otherwise overlap.
 */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly csv: CsvImportService,
    private readonly config: ConfigService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async listPersons(eventId: string): Promise<Person[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select(`*, clubs ( name )`)
      .eq('event_id', eventId)
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((p) => this.mapPerson(p as Record<string, unknown>));
  }

  // ── Get one ─────────────────────────────────────────────────────────────────

  async getPerson(personId: string): Promise<Person> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select(`*, clubs ( name )`)
      .eq('id', personId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Person ${personId} not found`);
    return this.mapPerson(data as Record<string, unknown>);
  }

  // ── Identity resolver ───────────────────────────────────────────────────────

  /**
   * Resolve a Supabase auth user_id to the matching global_persons.id, or null
   * if the user has not claimed any global person yet. Used by handlers that
   * start from a JWT (e.g. /my-schedule, fetchRefereeAssignments, notification
   * dispatch) to look up the canonical referee identity once per request.
   *
   * Backed by the partial UNIQUE index on global_persons.claimed_by_user_id
   * (migration 0063), so the lookup is deterministic.
   */
  async resolvePersonIdFromUserId(userId: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  async createPerson(
    eventId: string,
    dto: CreatePersonDto,
    createdByUserId: string,
  ): Promise<Person> {
    // Inline "Create new club" support. When the organizer accepted the
    // "+ Create new club X" dropdown row in the add-participant modal,
    // the client sends `newClubName` instead of `clubId`. Resolve it to
    // a real id (creating an unverified club if needed) before the rest
    // of the flow runs. clubId wins if both are set — DTO validation
    // rejects that combination, but the service is defensive.
    let resolvedClubId = dto.clubId ?? null;
    if (!resolvedClubId && dto.newClubName) {
      resolvedClubId = await this.resolveOrCreateClubByName(dto.newClubName);
    }

    const email = dto.email ? dto.email.toLowerCase().trim() : null;

    // Check email uniqueness within event when email is provided
    if (email) {
      const { data: existing } = await this.supabase.service
        .from('persons')
        .select('id')
        .eq('event_id', eventId)
        .ilike('email', email)
        .maybeSingle();

      if (existing) {
        throw new ConflictException(
          `A person with email ${this.csv.maskEmail(email)} already exists in this event`,
        );
      }
    }

    // Reject re-linking the same global profile to an event row twice. The
    // organizer UI greys this out preemptively; this is the server-side
    // backstop against direct API calls.
    if (dto.globalPersonId) {
      const { data: dupe } = await this.supabase.service
        .from('persons')
        .select('id')
        .eq('event_id', eventId)
        .eq('global_person_id', dto.globalPersonId)
        .maybeSingle();

      if (dupe) {
        throw new ConflictException(
          'This global profile is already linked to a participant in this event.',
        );
      }
    }

    // Resolve a global_persons row for every participant. Either the
    // caller supplied one (UI explicit link), or we match against
    // existing global identities by HEMA Ratings ID, then by
    // name+club+DOB. No confident match → create a fresh global row.
    // This is the canonical entry point: every persons row gets a
    // global_person_id, no exceptions, so downstream features (referees,
    // ratings, cross-event aggregation) never have to handle a null.
    const globalPersonId =
      dto.globalPersonId ??
      (await this.resolveOrCreateGlobalPerson({
        givenName: dto.givenName,
        familyName: dto.familyName,
        clubId: resolvedClubId,
        hemaRatingsId: dto.hemaRatingsId ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        email,
        genderCategory: dto.genderCategory ?? null,
      }));

    const { data, error } = await this.supabase.service
      .from('persons')
      .insert({
        event_id: eventId,
        given_name: dto.givenName.trim(),
        family_name: dto.familyName.trim(),
        email,
        club_id: resolvedClubId,
        hema_ratings_id: dto.hemaRatingsId ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
        gender_category: dto.genderCategory ?? null,
        notes: dto.notes ?? null,
        global_person_id: globalPersonId,
        claim_status: 'unclaimed',
        created_by_user_id: createdByUserId,
      })
      .select(`*, clubs ( name )`)
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapPerson(data as Record<string, unknown>);
  }

  /**
   * Resolve a participant to an existing global_persons row, or create
   * a new one. Two confidence tiers — anything below them produces a
   * fresh row rather than risking a false merge:
   *
   *   Tier 1: exact match on `hema_ratings_id` (when provided).
   *   Tier 2: exact match on name + club_id + date_of_birth (when all
   *           three provided).
   *
   * Either tier returning multiple hits falls through (treated as
   * "no confident match"). The conservatism is intentional: a wrong
   * auto-merge fragments cross-event identity in subtle ways that take
   * an admin merge tool to undo, while a missed merge is a one-click
   * fix from the global-profiles admin.
   */
  private async resolveOrCreateGlobalPerson(input: {
    givenName: string;
    familyName: string;
    clubId: string | null;
    hemaRatingsId: string | null;
    dateOfBirth: string | null;
    email: string | null;
    genderCategory: string | null;
  }): Promise<string> {
    const givenName = input.givenName.trim();
    const familyName = input.familyName.trim();
    const hemaRatingsId = input.hemaRatingsId?.trim() || null;
    const dateOfBirth = input.dateOfBirth?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;

    // Tier 1 — HEMA Ratings ID.
    if (hemaRatingsId) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id, email, date_of_birth')
        .eq('hema_ratings_id', hemaRatingsId)
        .limit(2);
      const rows = (hits ?? []) as Array<{
        id: string;
        email: string | null;
        date_of_birth: string | null;
      }>;
      if (rows.length === 1) {
        await this.backfillGlobalPersonIdentity(rows[0]!, { email, dateOfBirth });
        return rows[0]!.id;
      }
    }

    // Tier 2 — name + club + DOB. Each part must be present; partial
    // criteria are the easiest way to generate false-merges.
    if (input.clubId && dateOfBirth) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id, email, date_of_birth')
        .ilike('given_name', givenName)
        .ilike('family_name', familyName)
        .eq('club_id', input.clubId)
        .eq('date_of_birth', dateOfBirth)
        .limit(2);
      const rows = (hits ?? []) as Array<{
        id: string;
        email: string | null;
        date_of_birth: string | null;
      }>;
      if (rows.length === 1) {
        await this.backfillGlobalPersonIdentity(rows[0]!, { email, dateOfBirth });
        return rows[0]!.id;
      }
    }

    // No confident match — mint a fresh global identity.
    const displayName = `${givenName} ${familyName}`.trim();
    const slug = `${slugifyName(`${givenName}-${familyName}`)}-${Date.now().toString(36)}`;
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .insert({
        slug,
        display_name: displayName,
        given_name: givenName,
        family_name: familyName,
        club_id: input.clubId,
        hema_ratings_id: hemaRatingsId,
        date_of_birth: dateOfBirth,
        email,
        gender_category: input.genderCategory ?? null,
        is_fighter: true,
      })
      .select('id')
      .single();
    if (error) {
      // Likely a unique-email collision (partial unique index on
      // LOWER(email) for unmerged rows). Surface a row-level error
      // so the CSV importer can flag it cleanly.
      if (/duplicate key|unique/i.test(error.message)) {
        throw new BadRequestException(
          `Email ${this.csv.maskEmail(email ?? '')} is already linked to another global profile`,
        );
      }
      throw new BadRequestException(error.message);
    }
    return (data as { id: string }).id;
  }

  /**
   * After a Tier-1 or Tier-2 match, fill in email / date_of_birth on
   * the existing global_persons row when the column is currently NULL
   * and the CSV supplied a value. Never overwrites — a value already
   * on the row stays; conflicts surface as no-ops (organizers can use
   * the global-persons admin if they need to overwrite).
   *
   * Errors are swallowed (logged): the participant insert should
   * still succeed even if a backfill stumbles.
   */
  private async backfillGlobalPersonIdentity(
    row: { id: string; email: string | null; date_of_birth: string | null },
    incoming: { email: string | null; dateOfBirth: string | null },
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (incoming.email && !row.email) updates['email'] = incoming.email;
    if (incoming.dateOfBirth && !row.date_of_birth) updates['date_of_birth'] = incoming.dateOfBirth;
    if (Object.keys(updates).length === 0) return;

    const { error } = await this.supabase.service
      .from('global_persons')
      .update(updates)
      .eq('id', row.id);
    if (error) {
      this.logger.warn(`global_persons backfill failed for ${row.id}: ${error.message}`);
    }
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  async updatePerson(personId: string, dto: UpdatePersonDto): Promise<Person> {
    const updates: Record<string, unknown> = {};
    if (dto.givenName !== undefined) updates['given_name'] = dto.givenName.trim();
    if (dto.familyName !== undefined) updates['family_name'] = dto.familyName.trim();
    if (dto.email !== undefined)
      updates['email'] = dto.email ? dto.email.toLowerCase().trim() : null;
    if (dto.clubId !== undefined) updates['club_id'] = dto.clubId;
    if (dto.hemaRatingsId !== undefined) updates['hema_ratings_id'] = dto.hemaRatingsId;
    if (dto.dateOfBirth !== undefined) updates['date_of_birth'] = dto.dateOfBirth;
    if (dto.genderCategory !== undefined) updates['gender_category'] = dto.genderCategory;
    if (dto.notes !== undefined) updates['notes'] = dto.notes;
    updates['updated_at'] = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('persons')
      .update(updates)
      .eq('id', personId)
      .select(`*, clubs ( name )`)
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Person ${personId} not found`);
    return this.mapPerson(data as Record<string, unknown>);
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async deletePerson(personId: string): Promise<void> {
    const { data: regs } = await this.supabase.service
      .from('registrations')
      .select('id')
      .eq('person_id', personId)
      .limit(1);

    if (regs && regs.length > 0) {
      throw new BadRequestException(
        'Cannot delete a person who has tournament registrations. Withdraw them first.',
      );
    }

    const { error } = await this.supabase.service.from('persons').delete().eq('id', personId);
    if (error) throw new BadRequestException(error.message);
  }

  // ── Import preview (dry run) ─────────────────────────────────────────────────

  async previewImport(eventId: string, buffer: Buffer): Promise<ImportPreviewResponse> {
    const { rows, invalid } = this.csv.parse(buffer);

    const existingPersons = await this.fetchExistingPersons(eventId);
    const existingByEmail = this.indexByEmail(existingPersons);
    const existingByName = this.indexByName(existingPersons);

    const previewRows: PreviewRow[] = [];

    // Intra-batch tracking (no DB writes)
    const batchEmails = new Set<string>();
    const batchNames = new Set<string>();

    for (const inv of invalid) {
      previewRows.push({
        index: inv.row - 2, // convert back to 0-based
        givenName: '',
        familyName: '',
        status: 'invalid',
        invalidReason: inv.reason,
        defaultAction: 'create_new',
      });
    }

    for (const row of rows) {
      const nameKey = this.nameKey(row.given_name, row.family_name);
      const emailKey = row.email?.toLowerCase();

      // Duplicate detection: email first, then name
      const isDuplicateByEmail =
        emailKey && (existingByEmail.has(emailKey) || batchEmails.has(emailKey));
      const isDuplicateByName =
        !emailKey && (existingByName.has(nameKey) || batchNames.has(nameKey));

      if (isDuplicateByEmail || isDuplicateByName) {
        previewRows.push({
          index: row.rowNumber - 2,
          givenName: row.given_name,
          familyName: row.family_name,
          email: row.email,
          status: 'duplicate',
          defaultAction: 'create_new',
        });
        continue;
      }

      // Club resolution (read-only: no DB writes during preview)
      const clubResolution =
        row.club || row.club_abv
          ? await this.resolveClubPreview(row.club, row.club_abv, row.club_city)
          : undefined;

      // Global person match
      const globalPersonMatch = await this.findGlobalPersonMatch(row.given_name, row.family_name);

      previewRows.push({
        index: row.rowNumber - 2,
        givenName: row.given_name,
        familyName: row.family_name,
        email: row.email,
        status: 'ok',
        clubResolution,
        globalPersonMatch: globalPersonMatch ?? undefined,
        defaultAction: globalPersonMatch ? 'link' : 'create_new',
      });

      if (emailKey) batchEmails.add(emailKey);
      batchNames.add(nameKey);
    }

    const okRows = previewRows.filter((r) => r.status === 'ok');
    const toLink = okRows.filter((r) => r.defaultAction === 'link').length;

    return {
      summary: {
        toCreate: okRows.length - toLink,
        toLink,
        duplicates: previewRows.filter((r) => r.status === 'duplicate').length,
        invalid: previewRows.filter((r) => r.status === 'invalid').length,
      },
      newClubs: okRows
        .filter((r) => r.clubResolution?.confidence === 'new')
        .map((r) => r.clubResolution!.resolvedName),
      rows: previewRows,
    };
  }

  // ── Import commit ────────────────────────────────────────────────────────────

  async importCsv(
    eventId: string,
    buffer: Buffer,
    createdByUserId: string,
    decisions: ImportDecision[] = [],
  ): Promise<CsvImportReport> {
    const { rows, invalid } = this.csv.parse(buffer);

    const report: CsvImportReport = {
      created: 0,
      updated: 0,
      duplicates: [],
      invalid,
      newClubsForReview: [],
    };

    const existingPersons = await this.fetchExistingPersons(eventId);
    const existingByEmail = this.indexByEmail(existingPersons);
    const existingByName = this.indexByName(existingPersons);

    // Index decisions by row index for O(1) lookup
    const decisionByIndex = new Map<number, ImportDecision>();
    for (const d of decisions) {
      decisionByIndex.set(d.rowIndex, d);
    }

    for (const row of rows) {
      const emailKey = row.email?.toLowerCase();
      const nameKey = this.nameKey(row.given_name, row.family_name);
      const rowIndex = row.rowNumber - 2;

      const isDuplicate = emailKey ? existingByEmail.has(emailKey) : existingByName.has(nameKey);

      if (isDuplicate) {
        const ep = emailKey ? existingByEmail.get(emailKey) : existingByName.get(nameKey);
        report.duplicates.push({
          row: row.rowNumber,
          name: `${row.given_name} ${row.family_name}`,
          existingEmail: ep?.email ? this.csv.maskEmail(ep.email) : '(no email)',
        });
        continue;
      }

      // Resolve or create club
      let clubId: string | null = null;
      if (row.club || row.club_abv) {
        clubId = await this.resolveOrCreateClub(row.club, row.club_abv, row.club_city, report);
      }

      // Insert person
      const { data: newPerson, error } = await this.supabase.service
        .from('persons')
        .insert({
          event_id: eventId,
          given_name: row.given_name,
          family_name: row.family_name,
          email: emailKey ?? null,
          club_id: clubId,
          hema_ratings_id: row.hema_ratings_id ?? null,
          claim_status: 'unclaimed',
          created_by_user_id: createdByUserId,
        })
        .select('id')
        .single();

      if (error) {
        report.invalid.push({
          row: row.rowNumber,
          reason: `DB error: ${error.message}`,
          raw: `${row.given_name},${row.family_name},${emailKey ?? ''}`,
        });
        continue;
      }

      const personId = (newPerson as { id: string }).id;

      // Handle global person decision
      const decision = decisionByIndex.get(rowIndex);
      await this.applyGlobalPersonDecision(personId, row, decision, clubId, createdByUserId);

      // Track for intra-batch dedup
      if (emailKey)
        existingByEmail.set(emailKey, {
          id: personId,
          email: emailKey,
          givenName: row.given_name,
          familyName: row.family_name,
        });
      existingByName.set(nameKey, {
        id: personId,
        email: emailKey ?? null,
        givenName: row.given_name,
        familyName: row.family_name,
      });

      report.created++;
    }

    return report;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async fetchExistingPersons(eventId: string) {
    const { data } = await this.supabase.service
      .from('persons')
      .select('id, email, given_name, family_name')
      .eq('event_id', eventId);
    return (data ?? []) as Array<{
      id: string;
      email: string | null;
      given_name: string;
      family_name: string;
    }>;
  }

  private indexByEmail(
    persons: Array<{ id: string; email: string | null; given_name: string; family_name: string }>,
  ) {
    const map = new Map<
      string,
      { id: string; email: string | null; givenName: string; familyName: string }
    >();
    for (const p of persons) {
      if (p.email)
        map.set(p.email.toLowerCase(), {
          id: p.id,
          email: p.email,
          givenName: p.given_name,
          familyName: p.family_name,
        });
    }
    return map;
  }

  private indexByName(
    persons: Array<{ id: string; email: string | null; given_name: string; family_name: string }>,
  ) {
    const map = new Map<
      string,
      { id: string; email: string | null; givenName: string; familyName: string }
    >();
    for (const p of persons) {
      map.set(this.nameKey(p.given_name, p.family_name), {
        id: p.id,
        email: p.email,
        givenName: p.given_name,
        familyName: p.family_name,
      });
    }
    return map;
  }

  private nameKey(givenName: string, familyName: string): string {
    return `${givenName.toLowerCase().trim()} ${familyName.toLowerCase().trim()}`;
  }

  /** Read-only club resolution for preview (no DB writes). */
  private async resolveClubPreview(
    clubName?: string,
    clubAbv?: string,
    _clubCity?: string,
  ): Promise<ClubResolution> {
    const searchTerm = clubAbv ?? clubName ?? '';
    const { data: matches } = await this.supabase.service
      .rpc('find_club_by_name', { search_name: searchTerm, threshold: 0.4 })
      .limit(1);

    const first = (
      matches as Array<{
        id: string;
        name: string;
        abbreviation: string | null;
        city: string | null;
        match_score: number;
        confidence: string;
      }> | null
    )?.[0];

    if (first) {
      return {
        confidence: first.confidence as ClubResolution['confidence'],
        resolvedName: first.name,
        abbreviation: first.abbreviation ?? undefined,
      };
    }

    // If only abbreviation was provided and no match, fall back to full name search
    if (clubAbv && clubName) {
      const { data: nameMatches } = await this.supabase.service
        .rpc('find_club_by_name', { search_name: clubName, threshold: 0.4 })
        .limit(1);
      const nameFirst = (
        nameMatches as Array<{
          id: string;
          name: string;
          abbreviation: string | null;
          match_score: number;
          confidence: string;
        }> | null
      )?.[0];
      if (nameFirst) {
        return {
          confidence: nameFirst.confidence as ClubResolution['confidence'],
          resolvedName: nameFirst.name,
          abbreviation: nameFirst.abbreviation ?? undefined,
        };
      }
    }

    return {
      confidence: 'new',
      resolvedName: clubName ?? clubAbv ?? '',
      abbreviation: clubAbv,
    };
  }

  /**
   * Resolve a free-text club name to an existing club id, or create a
   * new unverified club row. Used by both:
   *   - CSV import (via the `resolveOrCreateClub` wrapper below, which
   *     also pushes the new club name into the import report).
   *   - The single-participant add flow (when an organizer types a
   *     club name that doesn't match any existing club and accepts the
   *     "+ Create new club" dropdown row).
   *
   * The lookup uses the `find_club_by_name` Postgres RPC (trigram +
   * unaccent) with threshold 0.4 — same as the CSV path. Returns null
   * only on a DB-level insert failure; callers may decide to surface
   * that as a 400 or just skip the club link.
   */
  private async resolveOrCreateClubByName(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const { data: matches } = await this.supabase.service
      .rpc('find_club_by_name', { search_name: trimmed, threshold: 0.4 })
      .limit(1);

    const first = (matches as Array<{ id: string; name: string; confidence: string }> | null)?.[0];
    if (first) return first.id;

    const slug = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    const { data: newClub, error } = await this.supabase.service
      .from('clubs')
      .insert({
        name: trimmed,
        slug: uniqueSlug,
        abbreviation: null,
        city: null,
        unverified: 'true',
      })
      .select('id')
      .single();

    if (error) {
      this.logger.warn(`Could not create club "${trimmed}": ${error.message}`);
      return null;
    }

    return (newClub as { id: string }).id;
  }

  /** CSV-flavoured wrapper: resolves a club name and also records it for the import report. */
  private async resolveOrCreateClub(
    clubName: string | undefined,
    clubAbv: string | undefined,
    clubCity: string | undefined,
    report: CsvImportReport,
  ): Promise<string | null> {
    const searchTerm = clubAbv ?? clubName ?? '';

    const { data: matches } = await this.supabase.service
      .rpc('find_club_by_name', { search_name: searchTerm, threshold: 0.4 })
      .limit(1);

    const first = (matches as Array<{ id: string; name: string; confidence: string }> | null)?.[0];
    if (first) return first.id;

    if (clubAbv && clubName) {
      const { data: nameMatches } = await this.supabase.service
        .rpc('find_club_by_name', { search_name: clubName, threshold: 0.4 })
        .limit(1);
      const nameFirst = (nameMatches as Array<{ id: string }> | null)?.[0];
      if (nameFirst) return nameFirst.id;
    }

    const name = clubName ?? clubAbv ?? '';
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    const { data: newClub, error } = await this.supabase.service
      .from('clubs')
      .insert({
        name,
        slug: uniqueSlug,
        abbreviation: clubAbv?.toUpperCase() ?? null,
        city: clubCity ?? null,
        unverified: 'true',
      })
      .select('id')
      .single();

    if (error) {
      this.logger.warn(`Could not create club "${name}": ${error.message}`);
      return null;
    }

    if (!report.newClubsForReview.includes(name)) {
      report.newClubsForReview.push(name);
    }

    return (newClub as { id: string }).id;
  }

  /** Query global_persons for a name match (threshold 0.85). */
  private async findGlobalPersonMatch(
    givenName: string,
    familyName: string,
  ): Promise<GlobalPersonCandidate | null> {
    const fullName = `${givenName} ${familyName}`;

    const { data } = await this.supabase.service
      .from('global_persons')
      .select(
        `
        id,
        given_name,
        family_name,
        display_name,
        clubs ( name, abbreviation )
      `,
      )
      .limit(5);

    if (!data) return null;

    // Filter by trigram similarity in JS (Supabase JS client doesn't expose similarity() directly)
    // We rely on the index for speed; filter by threshold client-side from the small result set.
    // For production scale, switch to an RPC function.
    const threshold = 0.85;
    type GpRow = {
      id: string;
      given_name: string;
      family_name: string;
      display_name: string;
      clubs: { name: string; abbreviation: string | null } | null;
    };

    const normalizedQuery = fullName.toLowerCase().trim();
    const candidates = (data as unknown as GpRow[]).filter((gp) => {
      const gpName = `${gp.given_name} ${gp.family_name}`.toLowerCase();
      return this.jaccardSimilarity(normalizedQuery, gpName) >= threshold;
    });

    if (candidates.length === 0) return null;

    const best = candidates[0]!;

    // Fetch a representative email from any linked person record
    const { data: linkedPerson } = await this.supabase.service
      .from('persons')
      .select('email')
      .eq('global_person_id', best.id)
      .not('email', 'is', null)
      .limit(1)
      .maybeSingle();

    return {
      id: best.id,
      displayName: best.display_name,
      clubName: best.clubs?.name ?? null,
      abbreviation: best.clubs?.abbreviation ?? null,
      email: (linkedPerson as { email: string | null } | null)?.email ?? null,
    };
  }

  /** Trigram-like Jaccard similarity on character bigrams. */
  private jaccardSimilarity(a: string, b: string): number {
    const bigrams = (s: string) => {
      const set = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 && setB.size === 0) return 1;
    let intersection = 0;
    for (const bg of setA) if (setB.has(bg)) intersection++;
    return intersection / (setA.size + setB.size - intersection);
  }

  /** Apply global person link or creation after person insert. */
  private async applyGlobalPersonDecision(
    personId: string,
    row: CsvRow,
    decision: ImportDecision | undefined,
    clubId: string | null,
    _createdByUserId: string,
  ): Promise<void> {
    const action = decision?.action ?? 'create_new';

    if (action === 'link' && decision?.globalPersonId) {
      await this.supabase.service
        .from('persons')
        .update({ global_person_id: decision.globalPersonId })
        .eq('id', personId);
      return;
    }

    // create_new: auto-create a global_persons record (same as registration flow)
    const displayName = `${row.given_name} ${row.family_name}`;
    const slug =
      `${row.given_name.toLowerCase()}-${row.family_name.toLowerCase()}-${Date.now().toString(36)}`
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    const { data: gp } = await this.supabase.service
      .from('global_persons')
      .insert({
        slug,
        display_name: displayName,
        given_name: row.given_name,
        family_name: row.family_name,
        club_id: clubId,
        is_fighter: true,
        claimed_by_user_id: null,
      })
      .select('id')
      .single();

    if (gp) {
      await this.supabase.service
        .from('persons')
        .update({ global_person_id: (gp as { id: string }).id })
        .eq('id', personId);
    }
  }

  private mapPerson(p: Record<string, unknown>): Person {
    const club = p['clubs'] as { name: string } | null;
    return {
      id: p['id'] as string,
      eventId: p['event_id'] as string,
      givenName: p['given_name'] as string,
      familyName: p['family_name'] as string,
      email: (p['email'] as string | null) ?? null,
      clubId: (p['club_id'] as string | null) ?? null,
      clubLabel: club?.name ?? null,
      hemaRatingsId: (p['hema_ratings_id'] as string | null) ?? null,
      dateOfBirth: (p['date_of_birth'] as string | null) ?? null,
      genderCategory: (p['gender_category'] as string | null) ?? null,
      notes: (p['notes'] as string | null) ?? null,
      claimStatus: (p['claim_status'] as 'unclaimed' | 'guest_active' | 'claimed') ?? 'unclaimed',
      claimedByUserId: (p['claimed_by_user_id'] as string | null) ?? null,
      globalPersonId: (p['global_person_id'] as string | null) ?? null,
      createdByUserId: (p['created_by_user_id'] as string | null) ?? null,
      createdAt: p['created_at'] as string,
      updatedAt: p['updated_at'] as string,
    };
  }
}
