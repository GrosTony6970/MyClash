import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_FORMULA_CONSTANTS,
  FormulaConfigSchema,
  FormulaConstantsSchema,
  FormulaNodeSchema,
  TiebreakerSchema,
  registry,
  type FormulaConfig,
  type RankingRule,
  type RulesetMetadata,
  type StandingsColumn,
  type Tiebreaker,
} from '@myclash/rulesets';
import { SupabaseService } from '../../supabase/supabase.service';
import type { CreateCustomRulesetDto, UpdateCustomRulesetDto } from './dto/custom-rulesets.dto';

export interface CustomRulesetRow {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  score_formula: Record<string, unknown>;
  constants: Record<string, number>;
  tiebreakers: Array<{ variable: string; direction: 'asc' | 'desc' }>;
  is_default: boolean;
  is_system: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * For `is_system: true` rows, the editable `tiebreakers` array is empty
 * because the real ranking rules live on the coded ruleset's
 * `rankingChain`. We surface them as a sibling field along with the
 * ruleset's audit-friendly metadata so the admin UI can render a
 * read-only "system ruleset details" panel.
 */
export interface CustomRulesetRowHydrated extends CustomRulesetRow {
  systemRankingChain?: RankingRule[];
  systemStandingsColumns?: StandingsColumn[];
  systemMetadata?: RulesetMetadata;
}

// Zod's `z.array(TiebreakerSchema).max(16)` — but we don't pull zod here. Use
// the FormulaConfigSchema's array shape via a manual length check below.
const MAX_TIEBREAKERS = 16;

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

@Injectable()
export class CustomRulesetsService {
  private readonly logger = new Logger(CustomRulesetsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(): Promise<CustomRulesetRow[]> {
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .select('*')
      .order('is_default', { ascending: false })
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as CustomRulesetRow[];
  }

  async getById(id: string): Promise<CustomRulesetRowHydrated> {
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Custom ruleset ${id} not found`);
    return this.hydrateSystemRow(data as CustomRulesetRow);
  }

  /**
   * For `is_system: true` rows, look up the coded ruleset in the registry
   * and attach its `rankingChain`, `standingsColumns`, and `metadata` so
   * the admin UI can render the real tie-breakers (currently hidden
   * because the DB row's `tiebreakers` array is empty for system rows).
   */
  private hydrateSystemRow(row: CustomRulesetRow): CustomRulesetRowHydrated {
    if (!row.is_system) return row;
    const coded = registry.has(row.code, row.version) ? registry.get(row.code, row.version) : null;
    if (!coded) return row;
    return {
      ...row,
      systemRankingChain: coded.rankingChain ?? [],
      systemStandingsColumns: coded.standingsColumns ?? [],
      systemMetadata: coded.metadata ?? {},
    };
  }

  async create(dto: CreateCustomRulesetDto, actorUserId: string): Promise<CustomRulesetRow> {
    const config = this.validateConfig({
      scoreFormula: dto.scoreFormula,
      constants: dto.constants,
      tiebreakers: dto.tiebreakers,
    });

    const baseSlug = slugify(dto.name);
    if (!baseSlug)
      throw new BadRequestException('Name must contain at least one alphanumeric character');
    const code = `custom_${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .insert({
        code,
        version: dto.version?.trim() || '1.0.0',
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        status: 'draft',
        score_formula: config.scoreFormula,
        constants: config.constants,
        tiebreakers: config.tiebreakers,
        is_default: false,
        is_system: false,
        created_by_user_id: actorUserId,
      })
      .select('*')
      .single();
    if (error || !data) {
      if (error?.message?.includes('unique')) {
        throw new ConflictException(`Ruleset code "${code}" already exists`);
      }
      throw new BadRequestException(error?.message ?? 'Insert failed');
    }

    await this.writeAuditLog(actorUserId, 'custom_ruleset.create', (data as CustomRulesetRow).id, {
      code,
    });
    return data as CustomRulesetRow;
  }

  async update(
    id: string,
    dto: UpdateCustomRulesetDto,
    actorUserId: string,
  ): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (existing.is_system) {
      throw new ForbiddenException('System rulesets cannot be edited');
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description?.trim() || null;
    if (dto.version !== undefined) updates['version'] = dto.version.trim() || '1.0.0';

    if (
      dto.scoreFormula !== undefined ||
      dto.constants !== undefined ||
      dto.tiebreakers !== undefined
    ) {
      const config = this.validateConfig({
        scoreFormula: dto.scoreFormula ?? existing.score_formula,
        constants: dto.constants ?? existing.constants,
        tiebreakers: dto.tiebreakers ?? existing.tiebreakers,
      });
      if (dto.scoreFormula !== undefined) updates['score_formula'] = config.scoreFormula;
      if (dto.constants !== undefined) updates['constants'] = config.constants;
      if (dto.tiebreakers !== undefined) updates['tiebreakers'] = config.tiebreakers;
    }

    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Update failed');

    await this.writeAuditLog(actorUserId, 'custom_ruleset.update', id, {
      fields: Object.keys(updates),
    });
    return data as CustomRulesetRow;
  }

  async clone(id: string, actorUserId: string): Promise<CustomRulesetRow> {
    const src = await this.getById(id);
    const baseSlug = slugify(`${src.name}-copy`);
    const code = `custom_${baseSlug}-${Date.now().toString(36)}`;
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .insert({
        code,
        version: '1.0.0',
        name: `${src.name} (copy)`,
        description: src.description,
        status: 'draft',
        score_formula: src.score_formula,
        constants: src.constants,
        tiebreakers: src.tiebreakers,
        is_default: false,
        is_system: false,
        created_by_user_id: actorUserId,
      })
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Clone failed');

    await this.writeAuditLog(actorUserId, 'custom_ruleset.clone', (data as CustomRulesetRow).id, {
      sourceId: id,
      code,
    });
    return data as CustomRulesetRow;
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const existing = await this.getById(id);
    if (existing.is_system) throw new ForbiddenException('System rulesets cannot be deleted');
    if (existing.is_default)
      throw new BadRequestException(
        'Cannot delete the default ruleset. Set another ruleset as default first.',
      );

    const { error } = await this.supabase.service.from('custom_rulesets').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'custom_ruleset.delete', id, { code: existing.code });
  }

  async publish(id: string, actorUserId: string): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (existing.is_system) throw new ForbiddenException('System rulesets are always published');

    // Re-validate before publishing — better to fail loudly here than at runtime.
    this.validateConfig({
      scoreFormula: existing.score_formula,
      constants: existing.constants,
      tiebreakers: existing.tiebreakers,
    });

    return this.updateStatus(id, 'published', actorUserId);
  }

  async unpublish(id: string, actorUserId: string): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (existing.is_system) throw new ForbiddenException('System rulesets cannot be unpublished');
    if (existing.is_default) {
      throw new BadRequestException(
        'Cannot unpublish the default ruleset. Set another ruleset as default first.',
      );
    }
    return this.updateStatus(id, 'draft', actorUserId);
  }

  async setDefault(id: string, actorUserId: string): Promise<CustomRulesetRow> {
    const target = await this.getById(id);
    if (target.status !== 'published') {
      throw new BadRequestException('Only published rulesets can be set as the default');
    }

    // Two-step: clear the existing default, set the new one. The DB unique
    // index over (is_default) WHERE is_default=true enforces correctness even
    // if a concurrent writer races.
    const { error: clearError } = await this.supabase.service
      .from('custom_rulesets')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('is_default', true);
    if (clearError) throw new BadRequestException(clearError.message);

    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Set default failed');

    await this.writeAuditLog(actorUserId, 'custom_ruleset.set_default', id, { code: target.code });
    return data as CustomRulesetRow;
  }

  private async updateStatus(
    id: string,
    status: 'draft' | 'published' | 'archived',
    actorUserId: string,
  ): Promise<CustomRulesetRow> {
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Status update failed');

    await this.writeAuditLog(actorUserId, `custom_ruleset.status.${status}`, id, {});
    return data as CustomRulesetRow;
  }

  private validateConfig(raw: {
    scoreFormula: unknown;
    constants: unknown;
    tiebreakers: unknown;
  }): FormulaConfig {
    let scoreFormula;
    try {
      scoreFormula = FormulaNodeSchema.parse(raw.scoreFormula);
    } catch (err) {
      throw new BadRequestException(`Invalid score formula: ${this.formatZodError(err)}`);
    }

    let constants;
    try {
      constants = FormulaConstantsSchema.parse({
        ...DEFAULT_FORMULA_CONSTANTS,
        ...(raw.constants ?? {}),
      });
    } catch (err) {
      throw new BadRequestException(`Invalid constants: ${this.formatZodError(err)}`);
    }

    const rawTb = Array.isArray(raw.tiebreakers) ? raw.tiebreakers : [];
    if (rawTb.length > MAX_TIEBREAKERS) {
      throw new BadRequestException(`At most ${MAX_TIEBREAKERS} tiebreakers allowed`);
    }
    let tiebreakers: Tiebreaker[];
    try {
      tiebreakers = rawTb.map((tb) => TiebreakerSchema.parse(tb));
    } catch (err) {
      throw new BadRequestException(`Invalid tiebreakers: ${this.formatZodError(err)}`);
    }

    return FormulaConfigSchema.parse({ scoreFormula, constants, tiebreakers });
  }

  private formatZodError(err: unknown): string {
    const issues = (err as { issues?: Array<{ path: Array<string | number>; message: string }> })
      .issues;
    if (Array.isArray(issues)) {
      return issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
    }
    return String(err);
  }

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
        entity_type: 'custom_ruleset',
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(`Could not write audit log for ${action} on custom_ruleset:${entityId}`);
    }
  }
}
