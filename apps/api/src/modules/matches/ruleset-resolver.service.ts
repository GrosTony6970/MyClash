/**
 * RulesetResolver — looks up a ruleset by (code, version), trying the
 * in-memory @myclash/rulesets registry first and falling back to a DB
 * lookup against `custom_rulesets`. Custom rows are wrapped in a
 * FormulaRuleset plugin instance constructed from their stored AST,
 * constants, and tiebreakers.
 *
 * Resolved instances are cached for 5 seconds — the same TTL used by
 * the feature-flag cache. Long enough to coalesce hot scoring loops,
 * short enough that toggling publish on a custom ruleset takes effect
 * within a couple of seconds.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  createFormulaRuleset,
  registry,
  type FormulaConfig,
  type Ruleset,
  type RulesetGrammar,
} from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';

const CACHE_TTL_MS = 5_000;

interface CachedEntry {
  ruleset: Ruleset | null;
  expiresAt: number;
}

/**
 * The grammar columns added by migration 0143, as they come off a row.
 * Present on both `custom_rulesets` and `custom_ruleset_versions`, so a
 * published version round-trips its grammar rather than silently resetting it.
 */
interface GrammarColumns {
  targets: Array<{ name: string; value: number }> | null;
  has_afterblow: boolean | null;
  afterblow_mode: 'full' | 'deductive' | null;
}

/**
 * Rows written before 0143 read as nulls, which `createFormulaRuleset` turns
 * into "declares no afterblow" — matching what the UI has always done for a
 * custom ruleset, so nothing switches on at deploy.
 */
function toGrammar(row: GrammarColumns): RulesetGrammar {
  return {
    targets: row.targets,
    hasAfterblow: row.has_afterblow,
    defaultAfterblowMode: row.afterblow_mode,
  };
}

@Injectable()
export class RulesetResolver {
  private readonly logger = new Logger(RulesetResolver.name);
  private readonly cache = new Map<string, CachedEntry>();

  constructor(private readonly supabase: SupabaseService) {}

  async resolve(code: string, version: string): Promise<Ruleset | null> {
    const cacheKey = `${code}@${version}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.ruleset;

    // 1. In-memory code registry: TF_v1, Generic_PointsCap.
    if (registry.has(code, version)) {
      const ruleset = registry.get(code, version);
      this.cache.set(cacheKey, { ruleset, expiresAt: now + CACHE_TTL_MS });
      return ruleset;
    }

    // 2. DB version snapshot. Once versioning is enabled, the snapshot table
    //    holds the immutable payload for every (code, version) pair that has
    //    ever been published. Tournaments pin a (code, version) at creation
    //    time, so we must read from the snapshot here instead of the parent
    //    row (which only reflects the latest version).
    try {
      const snapshot = await this.resolveFromVersionSnapshot(code, version);
      if (snapshot) {
        this.cache.set(cacheKey, { ruleset: snapshot, expiresAt: now + CACHE_TTL_MS });
        return snapshot;
      }
    } catch (err) {
      this.logger.warn(`Failed to resolve version snapshot ${code}@${version}: ${String(err)}`);
    }

    // 3. Fall back to the parent custom_rulesets row. This handles rows
    //    created before the versions table existed and the "current draft"
    //    case where nothing has been published yet.
    try {
      const { data } = await this.supabase.service
        .from('custom_rulesets')
        .select(
          'code, version, name, status, is_system, score_formula, constants, tiebreakers, targets, has_afterblow, afterblow_mode',
        )
        .eq('code', code)
        .eq('version', version)
        .maybeSingle();
      if (!data) {
        this.cache.set(cacheKey, { ruleset: null, expiresAt: now + CACHE_TTL_MS });
        return null;
      }
      const row = data as {
        code: string;
        version: string;
        name: string;
        status: string;
        is_system: boolean;
        score_formula: unknown;
        constants: unknown;
        tiebreakers: unknown;
      } & GrammarColumns;
      if (row.status !== 'published' || row.is_system) {
        this.cache.set(cacheKey, { ruleset: null, expiresAt: now + CACHE_TTL_MS });
        return null;
      }
      const config: FormulaConfig = {
        scoreFormula: row.score_formula as FormulaConfig['scoreFormula'],
        constants: row.constants as FormulaConfig['constants'],
        tiebreakers: row.tiebreakers as FormulaConfig['tiebreakers'],
      };
      const ruleset = createFormulaRuleset(row.code, row.version, row.name, config, toGrammar(row));
      this.cache.set(cacheKey, { ruleset, expiresAt: now + CACHE_TTL_MS });
      return ruleset;
    } catch (err) {
      this.logger.warn(`Failed to resolve custom ruleset ${code}@${version}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Look up a (code, version) snapshot in custom_ruleset_versions. We resolve
   * the parent ruleset by code first (one extra round-trip) to bridge the
   * snapshot table's UUID FK with the (code, version) lookup the rest of the
   * stack uses. Returns null when no snapshot exists for that version.
   */
  private async resolveFromVersionSnapshot(code: string, version: string): Promise<Ruleset | null> {
    const { data: parent } = await this.supabase.service
      .from('custom_rulesets')
      .select('id, name, is_system')
      .eq('code', code)
      .maybeSingle();
    if (!parent) return null;
    const parentRow = parent as { id: string; name: string; is_system: boolean };
    if (parentRow.is_system) return null;

    const { data } = await this.supabase.service
      .from('custom_ruleset_versions')
      .select(
        'version, score_formula, constants, tiebreakers, targets, has_afterblow, afterblow_mode',
      )
      .eq('custom_ruleset_id', parentRow.id)
      .eq('version', version)
      .maybeSingle();
    if (!data) return null;
    const snap = data as {
      version: string;
      score_formula: unknown;
      constants: unknown;
      tiebreakers: unknown;
    } & GrammarColumns;
    const config: FormulaConfig = {
      scoreFormula: snap.score_formula as FormulaConfig['scoreFormula'],
      constants: snap.constants as FormulaConfig['constants'],
      tiebreakers: snap.tiebreakers as FormulaConfig['tiebreakers'],
    };
    return createFormulaRuleset(code, snap.version, parentRow.name, config, toGrammar(snap));
  }

  /** Invalidate the cache for a single ruleset (call after upsert/publish/etc). */
  invalidate(code: string, version: string): void {
    this.cache.delete(`${code}@${version}`);
  }
}
