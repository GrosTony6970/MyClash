import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CsvImportReport, Person } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { CsvImportService } from './csv-import.service';
import type { CreatePersonDto, UpdatePersonDto } from './dto/persons.dto';

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
      .select(
        `
        *,
        clubs ( name )
      `,
      )
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

  // ── Create ──────────────────────────────────────────────────────────────────

  async createPerson(
    eventId: string,
    dto: CreatePersonDto,
    createdByUserId: string,
  ): Promise<Person> {
    const email = dto.email.toLowerCase().trim();

    // Check uniqueness within event
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

    const { data, error } = await this.supabase.service
      .from('persons')
      .insert({
        event_id: eventId,
        given_name: dto.givenName.trim(),
        family_name: dto.familyName.trim(),
        email,
        club_id: dto.clubId ?? null,
        hema_ratings_id: dto.hemaRatingsId ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
        gender_category: dto.genderCategory ?? null,
        notes: dto.notes ?? null,
        claim_status: 'unclaimed',
        created_by_user_id: createdByUserId,
      })
      .select(`*, clubs ( name )`)
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapPerson(data as Record<string, unknown>);
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  async updatePerson(personId: string, dto: UpdatePersonDto): Promise<Person> {
    const updates: Record<string, unknown> = {};
    if (dto.givenName !== undefined) updates['given_name'] = dto.givenName.trim();
    if (dto.familyName !== undefined) updates['family_name'] = dto.familyName.trim();
    if (dto.email !== undefined) updates['email'] = dto.email.toLowerCase().trim();
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
    // Check for registrations — cannot delete if registered to a tournament
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

  // ── CSV import ───────────────────────────────────────────────────────────────

  async importCsv(
    eventId: string,
    buffer: Buffer,
    createdByUserId: string,
  ): Promise<CsvImportReport> {
    const { rows, invalid } = this.csv.parse(buffer);

    const report: CsvImportReport = {
      created: 0,
      updated: 0,
      duplicates: [],
      invalid,
      newClubsForReview: [],
    };

    // Fetch existing persons for this event (for duplicate detection)
    const { data: existingPersons } = await this.supabase.service
      .from('persons')
      .select('id, email, given_name, family_name')
      .eq('event_id', eventId);

    const existingByEmail = new Map<
      string,
      { id: string; givenName: string; familyName: string }
    >();
    for (const p of existingPersons ?? []) {
      const ep = p as { id: string; email: string; given_name: string; family_name: string };
      existingByEmail.set(ep.email.toLowerCase(), {
        id: ep.id,
        givenName: ep.given_name,
        familyName: ep.family_name,
      });
    }

    for (const row of rows) {
      const email = row.email.toLowerCase();
      const existing = existingByEmail.get(email);

      if (existing) {
        report.duplicates.push({
          row: row.rowNumber,
          name: `${row.given_name} ${row.family_name}`,
          existingEmail: this.csv.maskEmail(email),
        });
        continue;
      }

      // Resolve or create club
      let clubId: string | null = null;
      if (row.club) {
        clubId = await this.resolveOrCreateClub(row.club, report);
      }

      // Insert person
      const { data: newPerson, error } = await this.supabase.service
        .from('persons')
        .insert({
          event_id: eventId,
          given_name: row.given_name,
          family_name: row.family_name,
          email,
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
          raw: `${row.given_name},${row.family_name},${email}`,
        });
        continue;
      }

      // Add to local map to catch intra-batch duplicates
      existingByEmail.set(email, {
        id: (newPerson as { id: string }).id,
        givenName: row.given_name,
        familyName: row.family_name,
      });

      report.created++;
    }

    return report;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async resolveOrCreateClub(
    clubName: string,
    report: CsvImportReport,
  ): Promise<string | null> {
    // Try fuzzy match using pg_trgm similarity
    const { data: matches } = await this.supabase.service
      .rpc('find_club_by_name', { search_name: clubName, threshold: 0.4 })
      .limit(1);

    if (matches && (matches as Array<{ id: string }>).length > 0) {
      return (matches as Array<{ id: string }>)[0]!.id;
    }

    // No match — create new club marked as unverified
    const slug = clubName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    const { data: newClub, error } = await this.supabase.service
      .from('clubs')
      .insert({ name: clubName, slug: uniqueSlug, unverified: 'true' })
      .select('id')
      .single();

    if (error) {
      this.logger.warn(`Could not create club "${clubName}": ${error.message}`);
      return null;
    }

    if (!report.newClubsForReview.includes(clubName)) {
      report.newClubsForReview.push(clubName);
    }

    return (newClub as { id: string }).id;
  }

  private mapPerson(p: Record<string, unknown>): Person {
    const club = p['clubs'] as { name: string } | null;
    return {
      id: p['id'] as string,
      eventId: p['event_id'] as string,
      givenName: p['given_name'] as string,
      familyName: p['family_name'] as string,
      email: p['email'] as string,
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
