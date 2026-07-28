import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { insertAuditLog } from '../../../common/audit-log';

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
  version: string;
  is_builtin: boolean;
  is_archived: boolean;
  /**
   * At most one row may carry is_default=true (partial unique index in
   * migration 0089). The league wizard pre-selects this row when
   * creating a new league.
   */
  is_default: boolean;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeagueScoringSystemVersionRow {
  id: string;
  league_scoring_system_id: string;
  version: string;
  name: string;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
  published_at: string;
  published_by_user_id: string | null;
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

    const nextVersion = bumpPatch(existing.version);
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      version: nextVersion,
    };
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

    await this.snapshotVersion(row, userId);

    await this.writeAuditLog(userId, 'league.scoring_system.updated', row.id, {
      code: row.code,
      name: row.name,
      from_version: existing.version,
      to_version: row.version,
      changedFields: Object.keys(updates).filter((k) => k !== 'updated_at' && k !== 'version'),
    });
    return row;
  }

  async listVersions(id: string): Promise<LeagueScoringSystemVersionRow[]> {
    const { data, error } = await this.supabase.service
      .from('league_scoring_system_versions')
      .select('*')
      .eq('league_scoring_system_id', id)
      .order('published_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as LeagueScoringSystemVersionRow[];
  }

  async rollback(id: string, versionId: string, userId: string): Promise<LeagueScoringSystemRow> {
    await this.assertSuperAdmin(userId);
    const existing = await this.getById(id);

    const { data: targetData, error: targetError } = await this.supabase.service
      .from('league_scoring_system_versions')
      .select('*')
      .eq('id', versionId)
      .eq('league_scoring_system_id', id)
      .maybeSingle();
    if (targetError) throw new BadRequestException(targetError.message);
    if (!targetData) {
      throw new NotFoundException(`Version ${versionId} not found for scoring system ${id}`);
    }
    const target = targetData as LeagueScoringSystemVersionRow;

    const nextVersion = bumpPatch(existing.version);
    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .update({
        version: nextVersion,
        name: target.name,
        points_by_rank: target.points_by_rank,
        tie_breakers: target.tie_breakers,
        description: target.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    const row = data as LeagueScoringSystemRow;

    await this.snapshotVersion(row, userId);

    await this.writeAuditLog(userId, 'league.scoring_system.rolled_back', row.id, {
      code: row.code,
      name: row.name,
      from_version: existing.version,
      to_version: row.version,
      restored_from_version: target.version,
      restored_from_version_id: target.id,
    });
    return row;
  }

  /**
   * Insert a snapshot of the current row state into the versions table.
   * Uses ON CONFLICT DO NOTHING semantics by checking first — Supabase
   * doesn't surface raw upsert(... onConflict ...) cleanly with composite
   * unique constraints in this codebase's style, so a probe+insert pair
   * is simpler and correct (concurrent edits on the same row are
   * prevented by the version-bump being part of the same UPDATE).
   */
  private async snapshotVersion(row: LeagueScoringSystemRow, userId: string): Promise<void> {
    const { data: existing, error: probeError } = await this.supabase.service
      .from('league_scoring_system_versions')
      .select('id')
      .eq('league_scoring_system_id', row.id)
      .eq('version', row.version)
      .maybeSingle();
    if (probeError) throw new BadRequestException(probeError.message);
    if (existing) return;

    const { error: insertError } = await this.supabase.service
      .from('league_scoring_system_versions')
      .insert({
        league_scoring_system_id: row.id,
        version: row.version,
        name: row.name,
        points_by_rank: row.points_by_rank,
        tie_breakers: row.tie_breakers,
        description: row.description,
        published_by_user_id: userId,
      });
    if (insertError) throw new BadRequestException(insertError.message);
  }

  async clone(id: string, userId: string): Promise<LeagueScoringSystemRow> {
    await this.assertSuperAdmin(userId);
    const source = await this.getById(id);
    const code = await this.allocateCloneCode(source.code);
    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .insert({
        code,
        name: `${source.name} (copy)`,
        is_builtin: false,
        is_archived: false,
        points_by_rank: source.points_by_rank,
        tie_breakers: source.tie_breakers,
        description: source.description,
        created_by_user_id: userId,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    const row = data as LeagueScoringSystemRow;
    await this.writeAuditLog(userId, 'league.scoring_system.cloned', row.id, {
      code: row.code,
      name: row.name,
      source_id: source.id,
      source_code: source.code,
    });
    return row;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.assertSuperAdmin(userId);
    const existing = await this.getById(id);

    // Refuse if any league still references this code. After migration
    // 0087, leagues.scoring_system is 'code@version' — match either the
    // raw code (pre-migration tolerant) OR the 'code@%' prefix.
    const { count, error: countError } = await this.supabase.service
      .from('leagues')
      .select('id', { count: 'exact', head: true })
      .or(`scoring_system.eq.${existing.code},scoring_system.like.${existing.code}@%`);
    if (countError) throw new BadRequestException(countError.message);
    if ((count ?? 0) > 0) {
      throw new ConflictException(
        `Cannot delete: ${count} league(s) still use the "${existing.code}" scoring system.`,
      );
    }

    // Hard delete. league_scoring_system_versions cascades via FK
    // ON DELETE CASCADE (migration 0087).
    const { error } = await this.supabase.service
      .from('league_scoring_systems')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(userId, 'league.scoring_system.deleted', id, {
      code: existing.code,
      name: existing.name,
    });
  }

  /**
   * Mark a single row as the catalogue default. The partial unique
   * index (migration 0089) guarantees at most one row carries the
   * flag, so we use a single bulk UPDATE that flips every other row
   * off in one statement — both safer and one round-trip cheaper than
   * the read-prior-clear-prior-set-new sequence.
   */
  async setDefault(id: string, userId: string): Promise<LeagueScoringSystemRow> {
    await this.assertSuperAdmin(userId);
    const existing = await this.getById(id);

    // UPDATE every row: target → is_default=true, others → is_default=false.
    // PostgREST exposes this via the column-expression `is_default=(id=$target)`,
    // but supabase-js only takes literal values, so emit two updates inside a
    // single supabase RPC isn't viable here without a stored proc. Do the
    // two-step sequence; the partial-unique index won't fire because we
    // clear before setting.
    const { error: clearErr } = await this.supabase.service
      .from('league_scoring_systems')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('is_default', true);
    if (clearErr) throw new BadRequestException(clearErr.message);

    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    const row = data as LeagueScoringSystemRow;

    await this.writeAuditLog(userId, 'league.scoring_system.default_set', row.id, {
      code: existing.code,
      name: existing.name,
    });
    return row;
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

  private async allocateCloneCode(sourceCode: string): Promise<string> {
    const base = `${sourceCode}_copy`;
    let candidate = base;
    for (let suffix = 2; suffix < 1000; suffix++) {
      const { data, error } = await this.supabase.service
        .from('league_scoring_systems')
        .select('id')
        .eq('code', candidate)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) return candidate;
      candidate = `${base}_${suffix}`;
    }
    throw new ConflictException(`Could not allocate clone code for "${sourceCode}"`);
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
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId,
      action,
      entityType: 'league_scoring_system',
      entityId,
      payload,
    });
    if (error) {
      this.logger.warn(
        `Could not write audit log for ${action} on league_scoring_system:${entityId}`,
      );
    }
  }
}

/**
 * Bump the patch component of a semver string (e.g. 1.0.0 → 1.0.1).
 * Tolerant of inputs that don't parse cleanly — falls back to '1.0.1'
 * so a malformed prior version never blocks an edit.
 */
export function bumpPatch(version: string | null | undefined): string {
  const parts = String(version ?? '1.0.0').split('.');
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return '1.0.1';
  }
  return `${major}.${minor}.${patch + 1}`;
}
