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
  DOUBLE_PENALTY_FORMULA_KEYS,
  DoublePenaltySpecSchema,
  doublePenalty,
  FormulaConfigSchema,
  FormulaConstantsSchema,
  FormulaNodeSchema,
  TFv1ConfigSchema,
  TiebreakerSchema,
  registry,
  type DoublePenaltySpec,
  type FormulaConfig,
  type RankingRule,
  type RulesetMetadata,
  type StandingsColumn,
  type Tiebreaker,
} from '@myclash/rulesets';
import { SupabaseService } from '../../supabase/supabase.service';
import { customRulesetOrgVisibilityFilter } from '../../../common/custom-ruleset-visibility';
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
  double_penalty_formula: DoublePenaltySpec | null;
  /**
   * Super-admin overrides for TF v1's TFv1ConfigSchema-shaped defaults
   * (winBonus, targetValues, matchFormat, doublePenaltyFormula, forfeitPolicy).
   * Merged over the static TFv1DefaultConfig by resolveRulesetConfigDefaults.
   * Null for non-system rulesets.
   */
  tf_config: Record<string, unknown> | null;
  /**
   * The grammar half of the ruleset (migration 0143). First-class columns
   * rather than more tf_config JSONB, because tf_config is read only for
   * is_system rows — an org-authored ruleset could not declare any of this.
   */
  targets: Array<{ name: string; value: number }> | null;
  has_afterblow: boolean;
  /** Seeds a tournament's mode; the tournament stays authoritative. */
  afterblow_mode: 'full' | 'deductive' | null;
  /** Decides the button grid — see buildScoringButtons. */
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
  is_default: boolean;
  is_system: boolean;
  /** Set when an organizer authored the ruleset; null for platform/system rows. */
  owner_organization_id: string | null;
  /** True once a super-admin approves the submission for platform-wide sharing. */
  public_visibility: boolean;
  /** Non-null while a review is pending. Cleared on approve/reject. */
  submitted_for_review_at: string | null;
  /** Set by super-admin on rejection so the organizer knows why. */
  rejected_reason: string | null;
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
  double_penalty_formula: DoublePenaltySpec | null;
  // Grammar columns (migrations 0143/0145). A snapshot must carry these or a
  // tournament pinned to a published version resolves with NO grammar — the
  // resolver reads them off this row (ruleset-resolver.service.ts), so a
  // weighted-afterblow ruleset would resolve as no-afterblow once frozen.
  targets: Array<{ name: string; value: number }> | null;
  has_afterblow: boolean;
  afterblow_mode: 'full' | 'deductive' | null;
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
  published_at: string;
  published_by_user_id: string | null;
  is_frozen: boolean;
}

/**
 * The grammar columns a snapshot must copy from the parent and a rollback must
 * restore. One helper so the two directions cannot drift — the exact failure
 * that let 0145's valuation columns be added to one resolver select and missed
 * on the other.
 */
export function grammarColumnsFrom(row: {
  targets: Array<{ name: string; value: number }> | null;
  has_afterblow: boolean;
  afterblow_mode: 'full' | 'deductive' | null;
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
}): Record<string, unknown> {
  return {
    targets: row.targets,
    has_afterblow: row.has_afterblow,
    afterblow_mode: row.afterblow_mode,
    afterblow_valuation: row.afterblow_valuation,
    afterblow_fixed_value: row.afterblow_fixed_value,
  };
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
 * Validate the `double_penalty_formula` TEXT column against the engine's
 * WHITELIST.
 *
 * This used to accept any character-whitelisted expression and sanity-check it
 * with `new Function('n', ...)`, justified by the characters having been
 * filtered. AGENTS.md hard rule #5 admits no such exemption: no eval, no
 * Function(). The character filter also cannot make code execution safe — it
 * only makes it narrow.
 *
 * Keeping the column key-only closes a second hole: resolveRulesetConfigDefaults
 * injects it into a TF_v1-shaped config, so a free-text value like 'n*2' passed
 * the old validator and then made every tournament create/update on that
 * ruleset fail Zod parsing — and if it slipped through, the engine silently
 * used the federal formula, so the stored expression was a lie either way.
 *
 * NOTE — this is no longer the only way to express a double penalty, and the
 * docblock used to claim it was. A club with a house rule authors a
 * `FormulaNode` AST, which is accepted through `tf_config.doublePenaltyFormula`
 * (JSONB) because TFv1ConfigSchema takes `key | AST` since 2f195eeb, and
 * validateTfConfigPatch parses the whole config. That path is Zod-validated and
 * evaluated by our own interpreter, so rule #5 still holds — the rule forbids
 * EXECUTING input, not authoring formulas.
 *
 * The TEXT column stays key-only on purpose rather than being widened to JSONB:
 * a formula-kind ruleset expresses its double penalty inside `scoreFormula`
 * using the `doubleHits` variable, so the column is meaningless there.
 */
export function validateDoublePenaltyFormula(raw: unknown): DoublePenaltySpec {
  // A whitelist KEY: keep the friendly "allowed values" error rather than a
  // raw Zod union failure.
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new BadRequestException('Double-penalty formula cannot be empty');
    }
    if (!(DOUBLE_PENALTY_FORMULA_KEYS as readonly string[]).includes(trimmed)) {
      throw new BadRequestException(
        `Unsupported double-penalty formula "${trimmed}". Allowed values: ${DOUBLE_PENALTY_FORMULA_KEYS.join(', ')}.`,
      );
    }
    return trimmed as DoublePenaltySpec;
  }

  // An authored AST: Zod-validate the shape, then a finite-output dry-run — the
  // same sanity check as before, on OUR AST rather than constructed code (rule
  // #5). FormulaNodeSchema already rejects Infinity literals and evaluateFormula
  // maps x/0 to 0, so a valid AST is finite by construction; the dry-run guards
  // against a future grammar change silently reintroducing a non-finite path.
  let spec: DoublePenaltySpec;
  try {
    spec = DoublePenaltySpecSchema.parse(raw);
  } catch (err) {
    throw new BadRequestException(
      `Invalid double-penalty formula: ${formatDoublePenaltyError(err)}`,
    );
  }
  for (const n of [0, 1, 2, 5, 10, 50]) {
    if (!Number.isFinite(doublePenalty(n, spec))) {
      throw new BadRequestException('Double-penalty formula must produce a finite value');
    }
  }
  return spec;
}

function formatDoublePenaltyError(err: unknown): string {
  const issues = (err as { issues?: Array<{ path: Array<string | number>; message: string }> })
    .issues;
  return Array.isArray(issues)
    ? issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    : String(err);
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

/**
 * Map authored grammar onto its columns.
 *
 * `hasAfterblow: false` forces the mode to NULL rather than leaving a stale one
 * behind: a mode without the concept is meaningless and would seed a tournament
 * with a setting the ruleset's own grammar cannot produce.
 */
export function grammarColumns(dto: {
  targets?: Array<{ name: string; value: number }>;
  hasAfterblow?: boolean;
  afterblowMode?: 'full' | 'deductive';
  afterblowValuation?: 'fixed' | 'weighted';
  afterblowFixedValue?: number;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (dto.targets !== undefined) out['targets'] = dto.targets;
  if (dto.hasAfterblow !== undefined) {
    out['has_afterblow'] = dto.hasAfterblow;
    // Turning afterblow off clears everything that only means something while
    // it is on, rather than leaving a stale rule behind for the next reader.
    if (!dto.hasAfterblow) {
      out['afterblow_mode'] = null;
      out['afterblow_valuation'] = null;
      out['afterblow_fixed_value'] = null;
    }
  }
  if (dto.hasAfterblow === false) return out;
  if (dto.afterblowMode !== undefined) out['afterblow_mode'] = dto.afterblowMode;
  if (dto.afterblowValuation !== undefined) {
    out['afterblow_valuation'] = dto.afterblowValuation;
  }
  if (dto.afterblowFixedValue !== undefined) {
    out['afterblow_fixed_value'] = dto.afterblowFixedValue;
  }
  return out;
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
        ...grammarColumns(dto),
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
    Object.assign(updates, grammarColumns(dto));
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

  /**
   * Copy a ruleset into a new draft.
   *
   * This was the only write path that could produce a row `create`,
   * `createForOrg` and `update` would all have rejected: it copied the source
   * columns straight into the INSERT without running `validateConfig`. Both
   * checks below close that gap, and they close it at different levels.
   *
   * The `is_system` guard is the specific case. System rows carry EMPTY
   * `score_formula` / `constants` / `tiebreakers` placeholders — migration 0038
   * seeds them and says so: "their formula/constants/tiebreakers fields are
   * nominal — the runtime always prefers the in-code plugin for these codes".
   * That holds only while `is_system` is true. Cloning flipped it to false and
   * turned the placeholders load-bearing: the resolver stops short-circuiting
   * to the registry, builds a FormulaRuleset from `{}`, and standings blow up
   * with "Cannot read properties of undefined" while match scoring silently
   * carries on under Generic_PointsCap's semantics. The clone also dropped
   * `tf_config`, which is where every one of TF v1's real tunables lives, so
   * there was nothing to salvage either.
   *
   * `validateConfig` is the general invariant: a clone must satisfy what every
   * other writer satisfies, whatever the source row. It also catches a
   * corrupt non-system source, which the guard alone would let through.
   *
   * Cloning a built-in is still supported — through the org flow
   * (`/org/:slug/rulesets/scoring/new?cloneFrom=<id>`), which pre-fills the
   * form from the built-in and requires the operator to author a score
   * formula before `createForOrg` will accept it.
   */
  async clone(id: string, actorUserId: string): Promise<CustomRulesetRow> {
    const src = await this.getById(id);
    if (src.is_system) {
      throw new ForbiddenException(
        'System rulesets cannot be cloned directly — their scoring lives in code, not in the row. ' +
          'Create a ruleset for your organisation from this one instead.',
      );
    }
    const config = this.validateConfig({
      scoreFormula: src.score_formula,
      constants: src.constants,
      tiebreakers: src.tiebreakers,
    });
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
        score_formula: config.scoreFormula,
        constants: config.constants,
        tiebreakers: config.tiebreakers,
        match_format_defaults: src.match_format_defaults,
        double_penalty_formula: src.double_penalty_formula,
        is_default: false,
        is_system: false,
        // Carry the source's grammar. Dropping it here would repeat the bug
        // that made cloning TF_v1 produce a ruleset with nothing in it.
        targets: src.targets,
        has_afterblow: src.has_afterblow,
        afterblow_mode: src.afterblow_mode,
        afterblow_valuation: src.afterblow_valuation,
        afterblow_fixed_value: src.afterblow_fixed_value,
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
      ...grammarColumnsFrom(existing),
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
        ...grammarColumnsFrom(snapshot),
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

  // ── Organizer-side authoring (Round 2) ───────────────────────────────────

  /**
   * List scoring rulesets visible to a given organisation:
   *   - system rulesets (TF_v1, etc.) — always visible.
   *   - rulesets owned by this org — drafts, pending, approved.
   *   - other orgs' rulesets that a super-admin approved for public sharing.
   *
   * Authorisation is org-scoped: caller must hold an admin role in the org.
   * No-op for super-admins (they should use `list()` for the unscoped view).
   */
  async listForOrg(orgId: string, _actorUserId: string): Promise<CustomRulesetRowHydrated[]> {
    void _actorUserId; // role check happens at the controller via SuperAdminGuard or org-role assertion
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .select('*')
      .or(customRulesetOrgVisibilityFilter(orgId))
      .order('is_system', { ascending: false })
      .order('owner_organization_id', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    // Hydrate system rows with the coded rankingChain + metadata (incl. the
    // score formula) so the org-facing ruleset view can render the read-only
    // "System ruleset details" panel — the org list is the only org-visible
    // source for built-ins (the owner-gated detail endpoint can't return them).
    return ((data ?? []) as CustomRulesetRow[]).map((r) => this.hydrateSystemRow(r));
  }

  /**
   * Create a scoring ruleset on an organization's behalf. The row is stamped
   * with `owner_organization_id` and is **immediately usable** on that org's
   * tournaments — no review required. The "submit for review" action is a
   * separate step (`submitForReview` below).
   */
  async createForOrg(
    orgId: string,
    dto: CreateCustomRulesetDto,
    actorUserId: string,
  ): Promise<CustomRulesetRow> {
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
        status: 'published', // org-scoped rulesets are usable immediately
        score_formula: config.scoreFormula,
        constants: config.constants,
        tiebreakers: config.tiebreakers,
        match_format_defaults: dto.matchFormatDefaults ?? null,
        double_penalty_formula: doublePenaltyFormula,
        is_default: false,
        is_system: false,
        ...grammarColumns(dto),
        owner_organization_id: orgId,
        public_visibility: false,
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

    await this.writeAuditLog(
      actorUserId,
      'custom_ruleset.create_for_org',
      (data as CustomRulesetRow).id,
      {
        code,
        orgId,
      },
    );
    return data as CustomRulesetRow;
  }

  /**
   * Assert the row exists AND is owned by `orgId`. Used by the org-scoped
   * controller before edit/delete/submit actions.
   */
  async assertOrgOwns(id: string, orgId: string): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (existing.owner_organization_id !== orgId) {
      throw new ForbiddenException(`Ruleset ${id} does not belong to organisation ${orgId}`);
    }
    return existing;
  }

  /**
   * Mark a row as submitted for super-admin review. Org-admin only;
   * controller checks org ownership before calling this.
   */
  async submitForReview(id: string, actorUserId: string): Promise<CustomRulesetRow> {
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .update({
        submitted_for_review_at: new Date().toISOString(),
        rejected_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Submit failed');

    await this.writeAuditLog(actorUserId, 'custom_ruleset.submit_for_review', id, {});
    return data as CustomRulesetRow;
  }

  /**
   * Super-admin approves a submission for platform-wide sharing.
   * Flips `public_visibility=true`, clears the review state.
   */
  async approveForPublic(id: string, actorUserId: string): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (!existing.submitted_for_review_at) {
      throw new BadRequestException('No pending submission to approve');
    }
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .update({
        public_visibility: true,
        submitted_for_review_at: null,
        rejected_reason: null,
        status: 'published',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Approve failed');

    await this.writeAuditLog(actorUserId, 'custom_ruleset.approve_public', id, {});
    return data as CustomRulesetRow;
  }

  /**
   * Super-admin rejects a submission. Captures the reason so the org can
   * see it and fix the issue. The row remains org-private; the org can
   * resubmit after editing.
   */
  async rejectSubmission(
    id: string,
    reason: string,
    actorUserId: string,
  ): Promise<CustomRulesetRow> {
    const existing = await this.getById(id);
    if (!existing.submitted_for_review_at) {
      throw new BadRequestException('No pending submission to reject');
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('A rejection reason is required');
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .update({
        submitted_for_review_at: null,
        rejected_reason: trimmed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Reject failed');

    await this.writeAuditLog(actorUserId, 'custom_ruleset.reject_submission', id, {
      reason: trimmed,
    });
    return data as CustomRulesetRow;
  }

  /**
   * Delete an org-owned ruleset. The caller (controller) verified ownership
   * via assertOrgOwns first. System rows are protected by their own guard
   * in `remove()`; org-owned rows are freely deletable by their org admin.
   */
  async deleteForOrg(id: string, actorUserId: string): Promise<void> {
    const { error } = await this.supabase.service.from('custom_rulesets').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.writeAuditLog(actorUserId, 'custom_ruleset.delete_for_org', id, {});
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
