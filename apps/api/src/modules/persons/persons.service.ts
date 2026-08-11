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
  IdentityMintReason,
  ImportPreviewResponse,
  Person,
  PersonCreated,
  PreviewRow,
} from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { GlobalPersonResolverService } from '../identity/global-person-resolver.service';
import type { ResolveGlobalPersonResult } from '../identity/global-person-resolver.service';
import { replaceFighterWeaponsFromCell } from '../fighters/weapon-import.util';
import { CsvImportService } from './csv-import.service';
import type { CsvRow } from './csv-import.service';
import { detectDuplicate, personNameKey } from './duplicate-guard';
import type { CreatePersonDto, UpdatePersonDto } from './dto/persons.dto';

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly csv: CsvImportService,
    private readonly config: ConfigService,
    private readonly globalPersonResolver: GlobalPersonResolverService,
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
  ): Promise<PersonCreated> {
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

    // Same rule as the CSV import, shared in duplicate-guard.ts: the email
    // decides when there is one, the name only when there is not. Before this,
    // the import caught a repeated name and the manual add did not, so the same
    // organizer typing the same email-less fighter twice got two roster rows.
    //
    // `.limit(1)` on a list, never `.maybeSingle()` — maybeSingle NULLS its data
    // on multiple rows, so the name lookup (which can legitimately match several
    // people) would report "no duplicate" precisely when there are the most.
    const emailMatch = email ? await this.rosterMatchesEmail(eventId, email) : false;
    const nameMatch = email
      ? false
      : await this.rosterMatchesName(eventId, dto.givenName, dto.familyName);

    switch (detectDuplicate({ hasEmail: email !== null, emailMatch, nameMatch })) {
      case 'email':
        throw new ConflictException(
          `A person with email ${this.csv.maskEmail(email as string)} already exists in this event`,
        );
      case 'name':
        // A name match is a suspicion, not a fact — two real fighters can share
        // a name, and with no email there is nothing else to tell them apart.
        // So this is overridable: the client re-sends with allowDuplicateName
        // once the organizer confirms. `details.resolution` is how it knows the
        // conflict is resolvable (the exception filter preserves extra keys).
        if (!dto.allowDuplicateName) {
          throw new ConflictException({
            message: `${dto.givenName} ${dto.familyName} is already on this event's roster with no email. Add them anyway?`,
            resolution: 'allowDuplicateName',
          });
        }
        break;
      default:
        break;
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
    //
    // An explicit link from the UI mints nothing by definition, so only the
    // resolver branch can raise the alarm.
    let globalPersonId = dto.globalPersonId ?? null;
    let mintedIdentity: IdentityMintReason | null = null;
    if (!globalPersonId) {
      const resolved = await this.globalPersonResolver.resolveOrCreateGlobalPerson({
        givenName: dto.givenName,
        familyName: dto.familyName,
        clubId: resolvedClubId,
        hemaRatingsId: dto.hemaRatingsId ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        email,
        genderCategory: dto.genderCategory ?? null,
      });
      globalPersonId = resolved.id;
      mintedIdentity = resolved.mintReason;
    }

    // If the caller didn't supply a club, inherit it from the linked
    // global profile. Keeps persons.club_id and global_persons.club_id
    // in sync at insert time so the tournament-query views can drop
    // the local/global COALESCE on every read. NULL stays NULL —
    // independent / unaffiliated fighters are a real domain case.
    if (!resolvedClubId) {
      const { data: gp } = await this.supabase.service
        .from('global_persons')
        .select('club_id')
        .eq('id', globalPersonId)
        .maybeSingle();
      resolvedClubId = (gp as { club_id: string | null } | null)?.club_id ?? null;
    }

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
    return { ...this.mapPerson(data as Record<string, unknown>), mintedIdentity };
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
      const nameKey = personNameKey(row.given_name, row.family_name);
      const emailKey = row.email?.toLowerCase();

      // Shared rule (duplicate-guard.ts): the email decides when there is one,
      // the name only when there is not. `batch*` extends the roster with rows
      // earlier in this same file, so a CSV that repeats someone self-detects.
      const duplicate = detectDuplicate({
        hasEmail: Boolean(emailKey),
        emailMatch: Boolean(
          emailKey && (existingByEmail.has(emailKey) || batchEmails.has(emailKey)),
        ),
        nameMatch: existingByName.has(nameKey) || batchNames.has(nameKey),
      });

      if (duplicate) {
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

      // Global person match — HEMA Ratings ID lookup takes priority over
      // name fuzz when the CSV row carries one.
      const globalPersonMatch = await this.findGlobalPersonMatch(
        row.given_name,
        row.family_name,
        row.hema_ratings_id ?? null,
      );

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
      unmatchableIdentities: [],
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
      const nameKey = personNameKey(row.given_name, row.family_name);
      const rowIndex = row.rowNumber - 2;

      const duplicate = detectDuplicate({
        hasEmail: Boolean(emailKey),
        emailMatch: Boolean(emailKey && existingByEmail.has(emailKey)),
        nameMatch: existingByName.has(nameKey),
      });

      if (duplicate) {
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
          date_of_birth: row.date_of_birth ?? null,
          gender_category: row.gender_category ?? null,
          notes: row.notes ?? null,
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
      const minted = await this.applyGlobalPersonDecision(
        personId,
        row,
        decision,
        clubId,
        createdByUserId,
      );
      // Only the unmatchable kind is worth an organizer's attention: a first
      // sighting links on its own next time, this one never will.
      if (minted === 'unmatchable') {
        report.unmatchableIdentities.push(`${row.given_name} ${row.family_name}`.trim());
      }

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

  /**
   * Is this email already on the event's roster?
   *
   * A list with `.limit(1)`, not `.maybeSingle()`: maybeSingle returns
   * `data: null` when the query matches more than one row, which would turn
   * "definitely a duplicate" into "no duplicate found".
   */
  private async rosterMatchesEmail(eventId: string, email: string): Promise<boolean> {
    const { data } = await this.supabase.service
      .from('persons')
      .select('id')
      .eq('event_id', eventId)
      .ilike('email', email)
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  /**
   * Is this name already on the event's roster?
   *
   * Matched on the normalized `personNameKey`, so it has to be done in memory —
   * PostgREST cannot express "lower(given)||' '||lower(family) = x". The roster
   * is one event's people (hundreds, not millions) and this runs once per manual
   * add, which is a human typing.
   */
  private async rosterMatchesName(
    eventId: string,
    givenName: string,
    familyName: string,
  ): Promise<boolean> {
    const key = personNameKey(givenName, familyName);
    const { data } = await this.supabase.service
      .from('persons')
      .select('given_name, family_name')
      .eq('event_id', eventId);
    return (data ?? []).some(
      (p) => personNameKey(p.given_name as string, p.family_name as string) === key,
    );
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
      map.set(personNameKey(p.given_name, p.family_name), {
        id: p.id,
        email: p.email,
        givenName: p.given_name,
        familyName: p.family_name,
      });
    }
    return map;
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
    hemaRatingsId?: string | null,
  ): Promise<GlobalPersonCandidate | null> {
    type GpRow = {
      id: string;
      given_name: string;
      family_name: string;
      display_name: string;
      clubs: { name: string; abbreviation: string | null } | null;
    };
    const SELECT = `
      id,
      given_name,
      family_name,
      display_name,
      clubs ( name, abbreviation )
    `;

    // Tier 1: HEMA Ratings ID — unique identifier; takes priority over
    // name fuzz when the CSV row carries one. Exact equality lookup.
    if (hemaRatingsId) {
      const { data } = await this.supabase.service
        .from('global_persons')
        .select(SELECT)
        .eq('hema_ratings_id', hemaRatingsId)
        .limit(1);
      const hit = (data as unknown as GpRow[] | null)?.[0];
      if (hit) return this.hydrateGlobalPersonMatch(hit);
    }

    // Tier 2: name search. The previous implementation issued a bare
    // `.limit(5)` and trusted the JS jaccard filter to pick the match
    // from the first 5 rows — which only worked when the right person
    // happened to be in those 5. For an N-row CSV against an M-row
    // global pool this degenerated to "5 of N link, the rest are
    // misclassified as create_new". Filter by name in SQL so the
    // candidate set actually contains the row we care about.
    const givenLike = `%${givenName.trim()}%`;
    const familyLike = `%${familyName.trim()}%`;
    let { data } = await this.supabase.service
      .from('global_persons')
      .select(SELECT)
      .ilike('given_name', givenLike)
      .ilike('family_name', familyLike)
      .limit(20);

    // Loosened fallback when the joined filter found nothing — the
    // surname alone is more distinctive than the first name and
    // handles minor encoding drift in the given_name column.
    if (!data || data.length === 0) {
      const fallback = await this.supabase.service
        .from('global_persons')
        .select(SELECT)
        .ilike('family_name', familyLike)
        .limit(20);
      data = fallback.data ?? null;
    }
    if (!data) return null;

    const threshold = 0.85;

    const fullName = `${givenName} ${familyName}`;
    const normalizedQuery = fullName.toLowerCase().trim();
    const candidates = (data as unknown as GpRow[]).filter((gp) => {
      const gpName = `${gp.given_name} ${gp.family_name}`.toLowerCase();
      return this.jaccardSimilarity(normalizedQuery, gpName) >= threshold;
    });

    if (candidates.length === 0) return null;

    return this.hydrateGlobalPersonMatch(candidates[0]!);
  }

  /**
   * Side-fetch a representative email for a matched `global_persons` row
   * and shape the response. Shared by the HEMA-ID and name branches of
   * `findGlobalPersonMatch` so the two paths return identical shapes.
   */
  private async hydrateGlobalPersonMatch(best: {
    id: string;
    display_name: string;
    clubs: { name: string; abbreviation: string | null } | null;
  }): Promise<GlobalPersonCandidate> {
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

  /**
   * Apply global person link or creation after person insert. Returns the mint
   * reason when a fresh identity was minted, `null` when one was linked or
   * reused — the import report collects the unmatchable ones for the organizer.
   */
  private async applyGlobalPersonDecision(
    personId: string,
    row: CsvRow,
    decision: ImportDecision | undefined,
    clubId: string | null,
    _createdByUserId: string,
  ): Promise<IdentityMintReason | null> {
    const action = decision?.action ?? 'create_new';

    if (action === 'link' && decision?.globalPersonId) {
      // Inherit the global profile's club when the CSV row didn't
      // supply one. Keeps persons.club_id consistent with
      // global_persons.club_id at link time so views can drop the
      // local/global COALESCE.
      const updates: { global_person_id: string; club_id?: string } = {
        global_person_id: decision.globalPersonId,
      };
      if (!clubId) {
        const { data: gp } = await this.supabase.service
          .from('global_persons')
          .select('club_id')
          .eq('id', decision.globalPersonId)
          .maybeSingle();
        const inherited = (gp as { club_id: string | null } | null)?.club_id ?? null;
        if (inherited) updates.club_id = inherited;
      }
      await this.supabase.service.from('persons').update(updates).eq('id', personId);
      return null;
    }

    // create_new: resolve to an existing global identity or mint a fresh one,
    // via the shared resolver (Tier hema/name+club+DOB/name+club/email). This
    // is what stops a roster imported per-event without email/DOB from minting
    // a duplicate global_persons row per event.
    let resolved: ResolveGlobalPersonResult;
    try {
      resolved = await this.globalPersonResolver.resolveOrCreateGlobalPerson({
        givenName: row.given_name,
        familyName: row.family_name,
        clubId,
        hemaRatingsId: row.hema_ratings_id ?? null,
        dateOfBirth: row.date_of_birth ?? null,
        email: row.email ?? null,
        genderCategory: row.gender_category ?? null,
      });
    } catch (resolveError) {
      // One un-resolvable row must not abort the whole import.
      this.logger.warn(
        `import: global person resolve failed for person ${personId}: ${
          resolveError instanceof Error ? resolveError.message : String(resolveError)
        }`,
      );
      return null;
    }

    await this.supabase.service
      .from('persons')
      .update({ global_person_id: resolved.id })
      .eq('id', personId);

    // Set weapons on a freshly minted profile only. Linking to an existing
    // profile leaves its curated weapons untouched.
    if (resolved.created && row.weapons) {
      try {
        await replaceFighterWeaponsFromCell(
          this.supabase.service as never,
          resolved.id,
          row.weapons,
        );
      } catch (weaponsError) {
        this.logger.warn(
          `import: weapons set failed for global person ${resolved.id}: ${
            weaponsError instanceof Error ? weaponsError.message : String(weaponsError)
          }`,
        );
      }
    }

    return resolved.mintReason;
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
