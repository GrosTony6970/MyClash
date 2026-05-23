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
  TFv1ConfigSchema,
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
  match_format_defaults: Record<string, unknown> | null;
  double_penalty_formula: string | null;
  /**
   * Super-admin overrides for TF v1's TFv1ConfigSchema-shaped defaults
   * (winBonus, targetValues, matchFormat, doublePenaltyFormula, forfeitPolicy).
   * Merged over the static TFv1DefaultConfig by resolveRulesetConfigDefaults.
   * Null for non-system rulesets.
   */
  tf_config: Record<string, unknown> | null;
  is_default: boolean;
  is_system: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomRulesetVersionRow {
  id: string;
  custom_ruleset_id: string;
  version: string;
  name: string;
  description: string | null;
  score_formula: Record<string, unknown>;
  constants: Record<string, number>;
  tiebreakers: Array<{ variable: string; direction: 'asc' | 'desc' }>;
  match_format_defaults: Record<string, unknown> | null;
  double_penalty_formula: string | null;
  published_at: string;
  published_by_user_id: string | null;
  is_frozen: boolean;
}

/**
 * Auto-bump the patch component of a semver-ish string (e.g. '1.0.0' -> '1.0.1',
 * '2.3' -> '2.3.1'). Falls back to suffixing '.1' for non-numeric tails. The
 * operator can override this by passing an explicit `nextVersion` to publish().
 */
export function bumpPatchVersion(version: string): string {
  const trimmed = (version ?? '').trim();
  if (!trimmed) return '1.0.1';
  const parts = trimmed.split('.');
  if (parts.length === 0) return `${trimmed}.1`;
  const tail = parts[parts.length - 1] ?? '';
  const tailNum = Number.parseInt(tail, 10);
  if (Number.isFinite(tailNum) && /^\d+$/.test(tail)) {
    parts[parts.length - 1] = String(tailNum + 1);
    return parts.join('.');
  }
  return `${trimmed}.1`;
}

/**
 * Validate a super-admin `tf_config` patch. We accept any subset of the
 * TFv1ConfigSchema-shaped object (winBonus, targetValues, matchFormat,
 * doublePenaltyFormula, forfeitPolicy). The schema's defaults fill in any
 * missing fields at parse time, but we strip those back out so the stored
 * row reflects only the operator's explicit overrides — keeping the merge
 * inside resolveRulesetConfigDefaults predictable.
 */
export function validateTfConfigPatch(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('tfConfig must be an object');
  }
  const patch = raw as Record<string, unknown>;
  // Use the full schema's parse so each branch is validated in context, then
  // pick only the keys the caller actually provided. This catches type errors
  // (e.g. winBonus as a string) without smuggling defaults into the patch.
  try {
    TFv1ConfigSchema.parse({ ...patch });
  } catch (err) {
    const issues = (err as { issues?: Array<{ path: Array<string | number>; message: string }> })
      .issues;
    const msg = Array.isArray(issues)
      ? issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      : String(err);
    throw new BadRequestException(`Invalid tfConfig: ${msg}`);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    out[key] = patch[key];
  }
  return out;
}

/**
 * Whitelist-validate a free-string double-penalty formula like 'n*(n-1)/3'.
 * Only digits, the variable `n`, the operators + - * /, parentheses, decimal
 * points, and whitespace are allowed. We also evaluate it with a few sample
 * n values to confirm the expression produces finite numbers — rejecting
 * anything that throws or returns NaN.
 */
export function validateDoublePenaltyFormula(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BadRequestException('Double-penalty formula cannot be empty');
  }
  if (!/^[0-9n+\-*/().\s]+$/i.test(trimmed)) {
    throw new BadRequestException(
      'Double-penalty formula may only contain digits, the variable n, ' +
        'operators + - * /, parentheses, decimal points, and whitespace.',
    );
  }
  // Sanity-evaluate with sample inputs. We allow Function here because the
  // input has already been character-whitelisted.
  let fn: (n: number) => number;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    fn = new Function('n', `return (${trimmed});`) as (n: number) => number;
  } catch {
    throw new BadRequestException('Double-penalty formula is not a valid expression');
  }
  for (const n of [0, 1, 2, 5, 10]) {
    let value: number;
    try {
      value = fn(n);
    } catch {
      throw new BadRequestException(`Double-penalty formula errored when n=${n}`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(
        `Double-penalty formula did not return a finite number for n=${n}`,
      );
    }
  }
  return trimmed;
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

    const doublePenaltyFormula = dto.doublePenaltyFormula
      ? validateDoublePenaltyFormula(dto.doublePenaltyFormula)
      : null;

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
        match_format_defaults: dto.matchFormatDefaults ?? null,
        double_penalty_formula: doublePenaltyFormula,
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

    // Frozen version (any tournament already references this code@version):
    // reject the edit and prompt the caller to publish a new version instead.
    // Only relevant for non-system rulesets — system rows live in the version
    // snapshot table separately (see Round 6 + Round 7 design notes).
    if (!existing.is_system && (await this.isCurrentVersionFrozen(existing))) {
      throw new ConflictException(
        'This version is locked because a tournament already references it. ' +
          'Publish a new version to apply edits.',
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description?.trim() || null;
    if (dto.version !== undefined) updates['version'] = dto.version.trim() || '1.0.0';

    // For system rulesets, the parent row's score_formula / constants /
    // tiebreakers are empty placeholders (the real values live in the code
    // plugin). Skip the FormulaConfig validation path entirely for them — the
    // operator edits TF v1 via `tfConfig` instead.
    if (
      !existing.is_system &&
      (dto.scoreFormula !== undefined ||
        dto.constants !== undefined ||
        dto.tiebreakers !== undefined)
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

    if (dto.matchFormatDefaults !== undefined) {
      updates['match_format_defaults'] = dto.matchFormatDefaults;
    }
    if (dto.doublePenaltyFormula !== undefined) {
      updates['double_penalty_formula'] = dto.doublePenaltyFormula
        ? validateDoublePenaltyFormula(dto.doublePenaltyFormula)
        : null;
    }
    if (dto.tfConfig !== undefined) {
      // Validate against TFv1ConfigSchema.partial() — accept any subset of the
      // schema's fields. Only meaningful for TF v1; on non-system rows the
      // column is set but the resolver never reads it.
      updates['tf_config'] = validateTfConfigPatch(dto.tfConfig);
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
        match_format_defaults: src.match_format_defaults,
        double_penalty_formula: src.double_penalty_formula,
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

  async publish(id: string, actorUserId: string, nextVersion?: string): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (existing.is_system) throw new ForbiddenException('System rulesets are always published');

    // Re-validate before publishing — better to fail loudly here than at runtime.
    this.validateConfig({
      scoreFormula: existing.score_formula,
      constants: existing.constants,
      tiebreakers: existing.tiebreakers,
    });

    // Snapshot the current row payload as an immutable version, then auto-bump
    // the parent row's version (patch) so subsequent edits target a fresh slot.
    // Caller can override the next version string via `nextVersion` (e.g. for
    // a minor/major bump).
    await this.snapshotVersion(existing, actorUserId);

    const bumped = (nextVersion && nextVersion.trim()) || bumpPatchVersion(existing.version);

    const { error: bumpError } = await this.supabase.service
      .from('custom_rulesets')
      .update({ version: bumped, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (bumpError) throw new BadRequestException(bumpError.message);

    await this.writeAuditLog(actorUserId, 'custom_ruleset.version.snapshot', id, {
      version: existing.version,
      nextVersion: bumped,
    });

    return this.updateStatus(id, 'published', actorUserId);
  }

  /**
   * Insert a snapshot row into custom_ruleset_versions capturing the parent
   * row's current payload. Called from publish() and never directly from
   * the controller.
   */
  private async snapshotVersion(existing: CustomRulesetRow, actorUserId: string): Promise<void> {
    const { error } = await this.supabase.service.from('custom_ruleset_versions').insert({
      custom_ruleset_id: existing.id,
      version: existing.version,
      name: existing.name,
      description: existing.description,
      score_formula: existing.score_formula,
      constants: existing.constants,
      tiebreakers: existing.tiebreakers,
      match_format_defaults: existing.match_format_defaults,
      double_penalty_formula: existing.double_penalty_formula,
      published_by_user_id: actorUserId === 'unknown' ? null : actorUserId,
    });
    if (error) {
      // A unique-constraint hit means we've already snapshotted this version
      // (e.g. publish → unpublish → publish without changes). That's harmless;
      // skip silently.
      if (!/unique|duplicate/i.test(error.message)) {
        throw new BadRequestException(error.message);
      }
    }
  }

  /**
   * True if the current (code, version) pair on the parent row is referenced by
   * at least one tournament, in which case further edits would silently change
   * scoring for those tournaments.
   */
  private async isCurrentVersionFrozen(row: CustomRulesetRow): Promise<boolean> {
    const { count } = await this.supabase.service
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('ruleset_code', row.code)
      .eq('ruleset_version', row.version);
    return (count ?? 0) > 0;
  }

  /**
   * Mark all snapshots matching (code, version) as frozen. Called from
   * EventsService.createTournament once a tournament insert succeeds.
   * No-op for unknown (code, version) — system rulesets are never snapshotted.
   */
  async freezeVersion(code: string, version: string): Promise<void> {
    const { data: ruleset } = await this.supabase.service
      .from('custom_rulesets')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (!ruleset) return;
    const rulesetId = (ruleset as { id: string }).id;
    await this.supabase.service
      .from('custom_ruleset_versions')
      .update({ is_frozen: true })
      .eq('custom_ruleset_id', rulesetId)
      .eq('version', version);
  }

  /** History of published snapshots, most recent first. */
  async listVersions(id: string): Promise<CustomRulesetVersionRow[]> {
    await this.getById(id); // 404 if missing
    const { data, error } = await this.supabase.service
      .from('custom_ruleset_versions')
      .select('*')
      .eq('custom_ruleset_id', id)
      .order('published_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as CustomRulesetVersionRow[];
  }

  /**
   * Restore a prior snapshot onto the parent row as a fresh draft. The
   * parent row's `version` is unchanged — the operator will assign the next
   * version string when they next publish. The restored payload becomes
   * editable again (status flips to draft).
   */
  async rollback(id: string, versionId: string, actorUserId: string): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (existing.is_system) {
      throw new ForbiddenException('System rulesets cannot be rolled back');
    }

    const { data: snap, error: snapErr } = await this.supabase.service
      .from('custom_ruleset_versions')
      .select('*')
      .eq('id', versionId)
      .eq('custom_ruleset_id', id)
      .maybeSingle();
    if (snapErr) throw new BadRequestException(snapErr.message);
    if (!snap) throw new NotFoundException(`Version ${versionId} not found for ruleset ${id}`);
    const snapshot = snap as CustomRulesetVersionRow;

    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .update({
        name: snapshot.name,
        description: snapshot.description,
        score_formula: snapshot.score_formula,
        constants: snapshot.constants,
        tiebreakers: snapshot.tiebreakers,
        match_format_defaults: snapshot.match_format_defaults,
        double_penalty_formula: snapshot.double_penalty_formula,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Rollback failed');

    await this.writeAuditLog(actorUserId, 'custom_ruleset.rollback', id, {
      restoredVersion: snapshot.version,
      versionId,
    });
    return data as CustomRulesetRow;
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
