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
  RulesetRegistry,
  type FormulaConfig,
  type Ruleset,
  type RulesetGrammar,
} from '@myclash/rulesets';
import { EDITION_2026_10, isDecisionEdition, type DecisionEdition } from '@myclash/rules';
import { SupabaseService } from '../supabase/supabase.service';

const CACHE_TTL_MS = 5_000;

/** A read of a stored ruleset that failed: not "no such ruleset", and never cached. */
export class RulesetReadFailed extends Error {
  constructor(code: string, version: string, reason: string) {
    super(`The ruleset ${code}@${version} was not read: ${reason}`);
    this.name = 'RulesetReadFailed';
  }
}

interface CachedEntry {
  ruleset: Ruleset | null;
  expiresAt: number;
}

/**
 * The grammar columns, selected identically on BOTH resolution paths.
 *
 * Extracted after they drifted: 0145's two valuation columns were added to the
 * parent-row select and missed on the snapshot select, so a published ruleset
 * authored as `weighted` resolved as `fixed` — silently seeding the wrong
 * button grid. The unit test could not catch it either, because a Supabase
 * mock whose `.select()` is `mockReturnThis()` ignores its argument and returns
 * the whole fixture row regardless of what was asked for.
 *
 * One constant makes the divergence unrepresentable instead of merely tested.
 */
const GRAMMAR_COLUMNS =
  'targets, has_afterblow, afterblow_mode, afterblow_valuation, afterblow_fixed_value';

/**
 * Read on BOTH paths with the grammar, for the same reason: the end decision a
 * formula ruleset was published with (migration 0228).
 */
const SCORED_COLUMNS = `${GRAMMAR_COLUMNS}, decision_edition`;

/**
 * The grammar columns added by migration 0143, as they come off a row.
 * Present on both `custom_rulesets` and `custom_ruleset_versions`, so a
 * published version round-trips its grammar rather than silently resetting it.
 */
interface GrammarColumns {
  targets: Array<{ name: string; value: number }> | null;
  has_afterblow: boolean | null;
  afterblow_mode: 'full' | 'deductive' | null;
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
}

/** A stored formula as it comes off a row or a snapshot: the formula, the grammar, the edition. */
type StoredFormula = GrammarColumns & {
  score_formula: unknown;
  constants: unknown;
  tiebreakers: unknown;
  double_penalty_formula: unknown;
  decision_edition: unknown;
};

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
    afterblowValuation: row.afterblow_valuation,
    afterblowFixedValue: row.afterblow_fixed_value,
  };
}

@Injectable()
export class RulesetResolver {
  private readonly logger = new Logger(RulesetResolver.name);
  private readonly cache = new Map<string, CachedEntry>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly registry: RulesetRegistry,
  ) {}

  /**
   * A CODED FORK (migration 0148) is a non-system row that carries `base_code`
   * — it reuses the coded algorithm of `base_code`@`base_version` rather than a
   * stored AST. Resolve it straight to the registry engine; its parameter and
   * grammar overrides live on the tournament (seeded from the fork), not on the
   * resolved Ruleset, so the engine is exactly the base's. Returns null (rather
   * than throwing) when the base is not registered, so a corrupt fork degrades
   * to "unresolvable" like any other unknown ruleset.
   *
   * `base_version` is stored canonical at fork time; the `?? '1.0.0'` only
   * guards a hand-written NULL.
   */
  private resolveCodedBase(baseCode: string, baseVersion: string | null): Ruleset | null {
    const v = baseVersion ?? '1.0.0';
    return this.registry.has(baseCode, v) ? this.registry.get(baseCode, v) : null;
  }

  /**
   * The end decision a formula row or snapshot was published with. A name read
   * from a column is checked where it comes in: an unknown one would throw in a
   * decider. The database refuses one (0228's CHECKs), so this answers the
   * decision every formula ruleset ran before 0228, and says so.
   */
  private editionOf(code: string, version: string, stored: unknown): DecisionEdition {
    if (isDecisionEdition(stored)) return stored;
    this.logger.warn(
      `The ruleset ${code}@${version} holds no known end decision (${String(stored)}): decided with ${EDITION_2026_10}`,
    );
    return EDITION_2026_10;
  }

  async resolve(code: string, version: string): Promise<Ruleset | null> {
    const cacheKey = `${code}@${version}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.ruleset;

    // 1. In-memory code registry: TF_v1, Generic_PointsCap.
    if (this.registry.has(code, version)) {
      const ruleset = this.registry.get(code, version);
      this.cache.set(cacheKey, { ruleset, expiresAt: now + CACHE_TTL_MS });
      return ruleset;
    }

    // 2. DB version snapshot. Once versioning is enabled, the snapshot table
    //    holds the immutable payload for every (code, version) pair that has
    //    ever been published. Tournaments pin a (code, version) at creation
    //    time, so we must read from the snapshot here instead of the parent
    //    row (which only reflects the latest version).
    //    A read that FAILED throws `RulesetReadFailed` through all of this, and nothing is
    //    cached: read as "none", a club formula bout was scored with TF_v1 for the five
    //    seconds the answer stayed cached, and a snapshot read that failed fell through to the
    //    parent row, which holds the LATEST version. The caller answers a 5xx; the pad resends.
    try {
      const snapshot = await this.resolveFromVersionSnapshot(code, version);
      if (snapshot) {
        this.cache.set(cacheKey, { ruleset: snapshot, expiresAt: now + CACHE_TTL_MS });
        return snapshot;
      }
    } catch (err) {
      if (err instanceof RulesetReadFailed) throw err;
      this.logger.warn(`Failed to resolve version snapshot ${code}@${version}: ${String(err)}`);
    }

    // 3. Fall back to the parent custom_rulesets row. This handles rows
    //    created before the versions table existed and the "current draft"
    //    case where nothing has been published yet.
    let ruleset: Ruleset | null;
    try {
      ruleset = await this.resolveFromParentRow(code, version);
    } catch (err) {
      if (err instanceof RulesetReadFailed) throw err;
      this.logger.warn(`Failed to resolve custom ruleset ${code}@${version}: ${String(err)}`);
      return null;
    }
    this.cache.set(cacheKey, { ruleset, expiresAt: now + CACHE_TTL_MS });
    return ruleset;
  }

  /**
   * Resolve the parent custom_rulesets row for (code, version). Returns null for
   * a missing or system row; a draft resolves (ruling 6). A coded fork (base_code set) resolves
   * to its base engine here too, so the fallback is correct independently of
   * whether the snapshot path already short-circuited.
   */
  private async resolveFromParentRow(code: string, version: string): Promise<Ruleset | null> {
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .select(
        `code, version, name, is_system, base_code, base_version, score_formula, constants, tiebreakers, double_penalty_formula, ${SCORED_COLUMNS}`,
      )
      .eq('code', code)
      .eq('version', version)
      .maybeSingle();
    if (error) throw new RulesetReadFailed(code, version, error.message);
    if (!data) return null;
    const row = data as {
      code: string;
      version: string;
      name: string;
      is_system: boolean;
      base_code: string | null;
      base_version: string | null;
    } & StoredFormula;
    // A ruleset that a tournament already pins must resolve forever, even after
    // it is retired from the catalog. Archiving is our soft-delete: it hides the
    // row from every picker/list (see SelectableRulesetsService and the org
    // Manage/Discover lists) but keeps THIS resolution path alive, so the pinned
    // tournament's standings never 400 — delist ≠ delete. A 'draft' resolves
    // too: a Tournament pinned to a draft is scored as its draft (ruling 6 of
    // "TF_v1 version", 2026-10-17), and the edit guard freezes a pinned draft.
    if (row.is_system) return null;
    if (row.base_code) return this.resolveCodedBase(row.base_code, row.base_version);
    return this.formulaRuleset(row.code, row.version, row.name, row);
  }

  /** A stored formula, a row's or a snapshot's, as the ruleset that scores with it. */
  private formulaRuleset(
    code: string,
    version: string,
    name: string,
    stored: StoredFormula,
  ): Ruleset {
    const config: FormulaConfig = {
      scoreFormula: stored.score_formula as FormulaConfig['scoreFormula'],
      constants: stored.constants as FormulaConfig['constants'],
      tiebreakers: stored.tiebreakers as FormulaConfig['tiebreakers'],
      doublePenaltyFormula: stored.double_penalty_formula as FormulaConfig['doublePenaltyFormula'],
    };
    const edition = this.editionOf(code, version, stored.decision_edition);
    return createFormulaRuleset(code, version, name, config, edition, toGrammar(stored));
  }

  /**
   * Look up a (code, version) snapshot in custom_ruleset_versions. We resolve
   * the parent ruleset by code first (one extra round-trip) to bridge the
   * snapshot table's UUID FK with the (code, version) lookup the rest of the
   * stack uses. Returns null when no snapshot exists for that version.
   */
  private async resolveFromVersionSnapshot(code: string, version: string): Promise<Ruleset | null> {
    const { data: parent, error: parentError } = await this.supabase.service
      .from('custom_rulesets')
      .select('id, name, is_system, base_code, base_version')
      .eq('code', code)
      .maybeSingle();
    if (parentError) throw new RulesetReadFailed(code, version, parentError.message);
    if (!parent) return null;
    const parentRow = parent as {
      id: string;
      name: string;
      is_system: boolean;
      base_code: string | null;
      base_version: string | null;
    };
    if (parentRow.is_system) return null;
    // A coded fork short-circuits to its base engine before we look for a
    // formula snapshot — it has none (its AST is empty by construction).
    if (parentRow.base_code)
      return this.resolveCodedBase(parentRow.base_code, parentRow.base_version);

    const { data, error } = await this.supabase.service
      .from('custom_ruleset_versions')
      .select(
        `version, score_formula, constants, tiebreakers, double_penalty_formula, ${SCORED_COLUMNS}`,
      )
      .eq('custom_ruleset_id', parentRow.id)
      .eq('version', version)
      .maybeSingle();
    if (error) throw new RulesetReadFailed(code, version, error.message);
    if (!data) return null;
    const snap = data as { version: string } & StoredFormula;
    return this.formulaRuleset(code, snap.version, parentRow.name, snap);
  }

  /** Invalidate the cache for a single ruleset (call after upsert/publish/etc). */
  invalidate(code: string, version: string): void {
    this.cache.delete(`${code}@${version}`);
  }
}
