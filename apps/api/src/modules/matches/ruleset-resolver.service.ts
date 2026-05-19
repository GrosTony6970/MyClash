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
} from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';

const CACHE_TTL_MS = 5_000;

interface CachedEntry {
  ruleset: Ruleset | null;
  expiresAt: number;
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

    // 1. In-memory code registry: TF_v1, TF_v1_no_afterblow, Generic_PointsCap.
    if (registry.has(code, version)) {
      const ruleset = registry.get(code, version);
      this.cache.set(cacheKey, { ruleset, expiresAt: now + CACHE_TTL_MS });
      return ruleset;
    }

    // 2. DB: only published, non-system rows are resolvable here.
    try {
      const { data } = await this.supabase.service
        .from('custom_rulesets')
        .select('code, version, name, status, is_system, score_formula, constants, tiebreakers')
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
      };
      if (row.status !== 'published' || row.is_system) {
        this.cache.set(cacheKey, { ruleset: null, expiresAt: now + CACHE_TTL_MS });
        return null;
      }
      const config: FormulaConfig = {
        scoreFormula: row.score_formula as FormulaConfig['scoreFormula'],
        constants: row.constants as FormulaConfig['constants'],
        tiebreakers: row.tiebreakers as FormulaConfig['tiebreakers'],
      };
      const ruleset = createFormulaRuleset(row.code, row.version, row.name, config);
      this.cache.set(cacheKey, { ruleset, expiresAt: now + CACHE_TTL_MS });
      return ruleset;
    } catch (err) {
      this.logger.warn(`Failed to resolve custom ruleset ${code}@${version}: ${String(err)}`);
      return null;
    }
  }

  /** Invalidate the cache for a single ruleset (call after upsert/publish/etc). */
  invalidate(code: string, version: string): void {
    this.cache.delete(`${code}@${version}`);
  }
}
