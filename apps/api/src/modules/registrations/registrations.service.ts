import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { SupabaseService } from '../supabase/supabase.service';
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

  // ── Create (single) ──────────────────────────────────────────────────────────

  async create(tournamentId: string, dto: CreateRegistrationDto) {
    const fighterId = await this.resolveFighterForRegistration(dto);
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

  // ── CSV bulk import ──────────────────────────────────────────────────────────

  async importCsv(tournamentId: string, buffer: Buffer) {
    // Strip BOM
    let content = buffer.toString('utf-8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

    let rows: Record<string, string>[];
    try {
      rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
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
      .select('id, status')
      .eq('id', registrationId)
      .maybeSingle();

    if (fetchError || !reg) throw new NotFoundException(`Registration ${registrationId} not found`);

    const currentStatus = (reg as { status: string }).status;
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
    return data;
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async delete(registrationId: string) {
    const { error } = await this.supabase.service
      .from('registrations')
      .delete()
      .eq('id', registrationId);

    if (error) throw new BadRequestException(error.message);
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
