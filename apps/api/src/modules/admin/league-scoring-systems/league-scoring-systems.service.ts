import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * Registry of reusable named league scoring systems.
 *
 * One built-in (`ffamhe_tf_2026`) ships from migration 0068. Super
 * admins can create additional presets here; any league can then
 * select one via its `scoring_system` code. Read-side resolution
 * happens in `LeagueScoringService` (consults this table at lookup
 * time, falls back to the legacy hard-coded behaviour).
 */
export interface LeagueScoringSystemRow {
  id: string;
  code: string;
  name: string;
  is_builtin: boolean;
  is_archived: boolean;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLeagueScoringSystemDto {
  code: string;
  name: string;
  pointsByRank: Record<string, number>;
  tieBreakers?: string[];
  description?: string | null;
}

export interface UpdateLeagueScoringSystemDto {
  name?: string;
  pointsByRank?: Record<string, number>;
  tieBreakers?: string[];
  description?: string | null;
}

const ALLOWED_TIE_BREAKERS = [
  'total_points',
  'participation_count',
  'medal_count',
  'double_hit_average',
] as const;

const DEFAULT_TIE_BREAKERS: string[] = [...ALLOWED_TIE_BREAKERS];

@Injectable()
export class LeagueScoringSystemsService {
  private readonly logger = new Logger(LeagueScoringSystemsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(): Promise<LeagueScoringSystemRow[]> {
    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .select('*')
      .eq('is_archived', false)
      .order('is_builtin', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as LeagueScoringSystemRow[];
  }

  async getByCode(code: string): Promise<LeagueScoringSystemRow | null> {
    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .select('*')
      .eq('code', code)
      .eq('is_archived', false)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return (data as LeagueScoringSystemRow | null) ?? null;
  }

  async create(dto: CreateLeagueScoringSystemDto, userId: string): Promise<LeagueScoringSystemRow> {
    await this.assertSuperAdmin(userId);
    const pointsByRank = this.validatePointsByRank(dto.pointsByRank);
    const tieBreakers = this.validateTieBreakers(dto.tieBreakers ?? DEFAULT_TIE_BREAKERS);
    const code = this.validateCode(dto.code);

    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .insert({
        code,
        name: dto.name.trim(),
        is_builtin: false,
        is_archived: false,
        points_by_rank: pointsByRank,
        tie_breakers: tieBreakers,
        description: dto.description ?? null,
        created_by_user_id: userId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate')) {
        throw new ConflictException(`Scoring system code "${code}" already exists`);
      }
      throw new BadRequestException(error.message);
    }
    const row = data as LeagueScoringSystemRow;
    await this.writeAuditLog(userId, 'league.scoring_system.created', row.id, {
      code: row.code,
      name: row.name,
    });
    return row;
  }

  async update(
    id: string,
    dto: UpdateLeagueScoringSystemDto,
    userId: string,
  ): Promise<LeagueScoringSystemRow> {
    await this.assertSuperAdmin(userId);
    const existing = await this.getById(id);
    if (existing.is_builtin) {
      throw new BadRequestException('Built-in scoring systems are read-only');
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.pointsByRank !== undefined) {
      updates['points_by_rank'] = this.validatePointsByRank(dto.pointsByRank);
    }
    if (dto.tieBreakers !== undefined) {
      updates['tie_breakers'] = this.validateTieBreakers(dto.tieBreakers);
    }
    if (dto.description !== undefined) updates['description'] = dto.description;

    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    const row = data as LeagueScoringSystemRow;
    await this.writeAuditLog(userId, 'league.scoring_system.updated', row.id, {
      code: row.code,
      name: row.name,
      changedFields: Object.keys(updates).filter((k) => k !== 'updated_at'),
    });
    return row;
  }

  async archive(id: string, userId: string): Promise<void> {
    await this.assertSuperAdmin(userId);
    const existing = await this.getById(id);
    if (existing.is_builtin) {
      throw new BadRequestException('Built-in scoring systems cannot be archived');
    }

    // Refuse if any league still references this code. The leagues table
    // stores the code string; we soft-archive but keep the row to preserve
    // historical references — yet new picks of an archived system are
    // hidden by the list() filter.
    const { count, error: countError } = await this.supabase.service
      .from('leagues')
      .select('id', { count: 'exact', head: true })
      .eq('scoring_system', existing.code);
    if (countError) throw new BadRequestException(countError.message);
    if ((count ?? 0) > 0) {
      throw new ConflictException(
        `Cannot archive: ${count} league(s) still use the "${existing.code}" scoring system.`,
      );
    }

    const { error } = await this.supabase.service
      .from('league_scoring_systems')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(userId, 'league.scoring_system.archived', id, {
      code: existing.code,
      name: existing.name,
    });
  }

  private async getById(id: string): Promise<LeagueScoringSystemRow> {
    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Scoring system ${id} not found`);
    return data as LeagueScoringSystemRow;
  }

  private async assertSuperAdmin(userId: string): Promise<void> {
    if (!userId) throw new ForbiddenException('Super admin access required');
    const { data, error } = await this.supabase.service
      .from('platform_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new ForbiddenException('Super admin access required');
  }

  private validateCode(code: string): string {
    const trimmed = (code ?? '').trim();
    if (!/^[a-z0-9_]{2,50}$/.test(trimmed)) {
      throw new BadRequestException(
        'Scoring-system code must be 2–50 chars, lowercase letters/digits/underscores only.',
      );
    }
    return trimmed;
  }

  private validatePointsByRank(input: unknown): Record<string, number> {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('pointsByRank must be an object of rank → points');
    }
    const out: Record<string, number> = {};
    for (const [rank, value] of Object.entries(input as Record<string, unknown>)) {
      const rankNum = Number(rank);
      const pts = Number(value);
      if (!Number.isInteger(rankNum) || rankNum < 1 || rankNum > 1024) {
        throw new BadRequestException(`Invalid rank key "${rank}" (1..1024 integers only)`);
      }
      if (!Number.isFinite(pts) || pts < 0 || pts > 1_000_000) {
        throw new BadRequestException(`Invalid points for rank ${rank}: ${value}`);
      }
      out[String(rankNum)] = Math.round(pts);
    }
    if (Object.keys(out).length === 0) {
      throw new BadRequestException('pointsByRank must contain at least one entry');
    }
    return out;
  }

  private validateTieBreakers(input: unknown): string[] {
    if (!Array.isArray(input)) {
      throw new BadRequestException('tieBreakers must be an array');
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of input) {
      const value = String(raw);
      if (!(ALLOWED_TIE_BREAKERS as readonly string[]).includes(value)) {
        throw new BadRequestException(`Unknown tie-breaker "${value}"`);
      }
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
    if (out.length === 0) {
      throw new BadRequestException('tieBreakers must list at least one tie-breaker');
    }
    return out;
  }

  /**
   * Audit-log helper. Mirrors AdminFeatureFlagsService.writeAuditLog —
   * swallow errors so audit logging never blocks the primary action.
   */
  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: actorUserId,
        action,
        entity_type: 'league_scoring_system',
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(
        `Could not write audit log for ${action} on league_scoring_system:${entityId}`,
      );
    }
  }
}
