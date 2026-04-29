import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { SupabaseService } from '../supabase/supabase.service';
import {
  REGISTRATION_STATUS_TRANSITIONS,
  type CreateRegistrationDto,
} from './dto/registrations.dto';

@Injectable()
export class RegistrationsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(tournamentId: string) {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select(`
        *,
        persons(id, given_name, family_name, email, club_id),
        fighters(id, slug, display_name)
      `)
      .eq('tournament_id', tournamentId)
      .order('bib_number', { ascending: true, nullsFirst: false });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Create (single) ──────────────────────────────────────────────────────────

  async create(tournamentId: string, dto: CreateRegistrationDto) {
    const bibNumber = dto.bibNumber ?? await this.nextBibNumber(tournamentId);

    const { data, error } = await this.supabase.service
      .from('registrations')
      .insert({
        tournament_id: tournamentId,
        person_id: dto.personId,
        fighter_id: dto.fighterId ?? null,
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

      const { error } = await this.supabase.service
        .from('registrations')
        .insert({
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
}
