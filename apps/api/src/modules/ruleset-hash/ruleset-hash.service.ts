import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  canonicalizePenaltyDefinition,
  canonicalizeScoringBehaviour,
  projectPenaltyBucketFromLive,
  projectPenaltyBucketFromSnapshot,
  registry,
  stableStringify,
  type PenaltyBehaviourInput,
  type ScoringBehaviourInput,
} from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
import {
  normalizeRulesetVersion,
  resolveRulesetGrammar,
  type ResolvedRulesetGrammar,
} from '../events/ruleset-defaults';

type Row = Record<string, unknown>;

interface TournamentHashRow {
  id: string;
  event_id: string | null;
  ruleset_code: string | null;
  ruleset_version: string | null;
  ruleset_config: Row | null;
  scoring_config_json: Row | null;
  penalty_ruleset_id: string | null;
  penalty_ruleset_version: string | null;
}

type ScoringStructure =
  | { kind: 'coded'; engineCode: string; engineVersion: string }
  | {
      kind: 'formula';
      scoreFormula: unknown;
      constants: Record<string, number>;
      tiebreakers: ReadonlyArray<{ variable: string; direction: 'asc' | 'desc' }>;
      doublePenaltyFormula: unknown;
    };

/**
 * Computes a tournament's content-hash identity — a sha256 over the canonical
 * form (from @myclash/rulesets) of its EFFECTIVE (scoring, penalty) behaviour.
 * "Effective" means the resolved ruleset definition folded with the tournament's
 * pinned config + afterblowMode, so two TF_v1 tournaments that score differently
 * get different hashes. Read-only; the caller stamps the result.
 */
@Injectable()
export class RulesetHashService {
  private readonly logger = new Logger(RulesetHashService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** The (scoring, penalty) pair-hash for a tournament, or null if it is gone. */
  async computeTournamentContentHash(tournamentId: string): Promise<string | null> {
    const tournament = await this.loadTournament(tournamentId);
    if (!tournament) return null;
    const scoring = await this.buildScoringCanonical(tournament);
    const penalty = await this.buildPenaltyCanonical(tournament);
    return createHash('sha256').update(stableStringify({ scoring, penalty })).digest('hex');
  }

  /** Recompute + persist a tournament's effective content hash. Callers invoke
   *  this after any change to its ruleset/config/penalty pin. */
  async stampTournamentContentHash(tournamentId: string): Promise<void> {
    // Best-effort: a hash-compute failure (e.g. an out-of-domain stored config
    // the canonical normalizer rejects) must never fail the write that triggered
    // the stamp — the hash is metadata, not the source of truth for scoring.
    try {
      const hash = await this.computeTournamentContentHash(tournamentId);
      await this.supabase.service
        .from('tournaments')
        .update({ ruleset_content_hash: hash })
        .eq('id', tournamentId);
    } catch (err) {
      this.logger.warn(
        `Failed to stamp content hash for tournament ${tournamentId}: ${String(err)}`,
      );
    }
  }

  /**
   * Restamp every tournament that INHERITS an event's default penalty (its own
   * penalty_ruleset_id is NULL) — their effective penalty changed with the event
   * default, so their content hash must be refreshed too.
   */
  async stampEventInheritingTournaments(eventId: string): Promise<void> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId)
      .is('penalty_ruleset_id', null);
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    for (const id of ids) {
      await this.stampTournamentContentHash(id);
    }
  }

  /**
   * Compare a tournament's STORED content hash with a freshly recomputed one.
   * `drifted` is true when they disagree — the effective behaviour changed but
   * the stamp was not refreshed (an integrity check; the stamp sites keep it
   * current, so drift signals a bug or an out-of-band edit).
   */
  async describeTournamentDrift(
    tournamentId: string,
  ): Promise<{ stored: string | null; current: string | null; drifted: boolean }> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('ruleset_content_hash')
      .eq('id', tournamentId)
      .maybeSingle();
    const stored =
      (data as { ruleset_content_hash?: string | null } | null)?.ruleset_content_hash ?? null;
    const current = await this.computeTournamentContentHash(tournamentId);
    return { stored, current, drifted: stored !== current };
  }

  private async loadTournament(id: string): Promise<TournamentHashRow | null> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select(
        'id, event_id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json, penalty_ruleset_id, penalty_ruleset_version',
      )
      .eq('id', id)
      .maybeSingle();
    return (data as TournamentHashRow | null) ?? null;
  }

  private async buildScoringCanonical(t: TournamentHashRow): Promise<Record<string, unknown>> {
    const code = t.ruleset_code ?? 'TF_v1';
    const version = normalizeRulesetVersion(t.ruleset_version ?? '1');
    const grammar = await resolveRulesetGrammar(this.supabase, code, version);
    const config = t.ruleset_config ?? {};
    const scoringConfig = t.scoring_config_json ?? {};
    const matchFormat = (config['matchFormat'] as Row | undefined) ?? null;
    const tournamentPolicy = config['tournamentPolicy'] ?? null;
    const afterblowMode =
      (scoringConfig['afterblowMode'] as string | undefined) ??
      grammar.defaultAfterblowMode ??
      null;
    const grammarInput = grammarInputFrom(config, grammar);
    const structure = await this.resolveScoringStructure(code, version);
    const input: ScoringBehaviourInput =
      structure.kind === 'coded'
        ? {
            kind: 'coded',
            engineCode: structure.engineCode,
            engineVersion: structure.engineVersion,
            grammar: grammarInput,
            tournamentPolicy,
            matchFormat,
            afterblowMode,
            winBonus: (config['winBonus'] as number | undefined) ?? null,
            doublePenaltyFormula: config['doublePenaltyFormula'] ?? null,
            forfeitPolicy: config['forfeitPolicy'] ?? null,
          }
        : {
            kind: 'formula',
            grammar: grammarInput,
            matchFormat,
            afterblowMode,
            tournamentPolicy,
            scoreFormula: structure.scoreFormula,
            constants: structure.constants,
            tiebreakers: structure.tiebreakers,
            doublePenaltyFormula: structure.doublePenaltyFormula,
          };
    return canonicalizeScoringBehaviour(input);
  }

  /**
   * Determine the scoring definition's kind + engine/formula, mirroring
   * RulesetResolver's tiers: registry/system → coded engine token; a base_code
   * fork → its base engine; a formula ruleset → its AST (from the pinned version
   * snapshot, else the parent row).
   */
  private async resolveScoringStructure(code: string, version: string): Promise<ScoringStructure> {
    if (registry.has(code, version))
      return { kind: 'coded', engineCode: code, engineVersion: version };
    const { data } = await this.supabase.service
      .from('custom_rulesets')
      .select(
        'id, is_system, status, base_code, base_version, score_formula, constants, tiebreakers, double_penalty_formula',
      )
      .eq('code', code)
      .maybeSingle();
    const parent = data as Row | null;
    if (!parent || parent['is_system']) {
      return { kind: 'coded', engineCode: code, engineVersion: version };
    }
    if (parent['base_code']) {
      return {
        kind: 'coded',
        engineCode: parent['base_code'] as string,
        engineVersion: (parent['base_version'] as string | null) ?? '1.0.0',
      };
    }
    const snapshot = await this.loadScoringSnapshot(parent['id'] as string, version);
    // No published snapshot AND the parent is not published: RulesetResolver
    // returns null for a draft, so the scorer falls back to TF_v1. Mirror that —
    // otherwise the fingerprint describes a formula that never scored a bout.
    if (!snapshot && parent['status'] !== 'published') {
      return { kind: 'coded', engineCode: 'TF_v1', engineVersion: '1.0.0' };
    }
    const def = snapshot ?? parent;
    return {
      kind: 'formula',
      scoreFormula: def['score_formula'],
      constants: (def['constants'] as Record<string, number>) ?? {},
      tiebreakers:
        (def['tiebreakers'] as ReadonlyArray<{ variable: string; direction: 'asc' | 'desc' }>) ??
        [],
      doublePenaltyFormula: def['double_penalty_formula'] ?? null,
    };
  }

  private async loadScoringSnapshot(customRulesetId: string, version: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('custom_ruleset_versions')
      .select('score_formula, constants, tiebreakers, double_penalty_formula')
      .eq('custom_ruleset_id', customRulesetId)
      .eq('version', version)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private async buildPenaltyCanonical(
    t: TournamentHashRow,
  ): Promise<Record<string, unknown> | null> {
    const pin = await this.resolveEffectivePenalty(t);
    if (!pin) return null;
    const definition = await this.loadPenaltyDefinition(pin.id, pin.version);
    return definition ? canonicalizePenaltyDefinition(definition) : null;
  }

  /** tournament pin → event default → platform built-in (by built_in flag, not
   *  the stale version constant). */
  private async resolveEffectivePenalty(
    t: TournamentHashRow,
  ): Promise<{ id: string; version: string | null } | null> {
    if (t.penalty_ruleset_id) {
      return { id: t.penalty_ruleset_id, version: t.penalty_ruleset_version };
    }
    if (t.event_id) {
      const { data } = await this.supabase.service
        .from('events')
        .select('penalty_ruleset_id, penalty_ruleset_version')
        .eq('id', t.event_id)
        .maybeSingle();
      const event = data as Row | null;
      if (event?.['penalty_ruleset_id']) {
        return {
          id: event['penalty_ruleset_id'] as string,
          version: (event['penalty_ruleset_version'] as string | null) ?? null,
        };
      }
    }
    const { data } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id, version')
      .eq('built_in', true)
      .is('owner_organization_id', null)
      .limit(1)
      .maybeSingle();
    const builtin = data as Row | null;
    return builtin
      ? { id: builtin['id'] as string, version: (builtin['version'] as string) ?? null }
      : null;
  }

  /** Prefer the immutable frozen snapshot for the pinned version; fall back to
   *  the live parent + entries (built-in / never-published). */
  private async loadPenaltyDefinition(
    id: string,
    version: string | null,
  ): Promise<PenaltyBehaviourInput | null> {
    if (version) {
      const { data } = await this.supabase.service
        .from('penalty_ruleset_versions')
        .select(
          'accumulation_scope, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, entries',
        )
        .eq('penalty_ruleset_id', id)
        .eq('version', version)
        .maybeSingle();
      if (data) return projectPenaltyBucketFromSnapshot(data as Row);
    }
    const { data } = await this.supabase.service
      .from('penalty_rulesets')
      .select(
        'accumulation_scope, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, penalty_ruleset_entries(group_number, ref_number, sanctions)',
      )
      .eq('id', id)
      .maybeSingle();
    return data ? projectPenaltyBucketFromLive(data as Row) : null;
  }
}

/** Effective grammar for the hash: prefer the tournament's ruleset_config.targets
 *  (a fork/tf_config edit writes them) over the ruleset's static grammar targets,
 *  since the pressed button's value — set by targets — decides each hit. */
function grammarInputFrom(config: Row, grammar: ResolvedRulesetGrammar) {
  return {
    targets:
      (config['targets'] as Array<{ name: string; value: number }> | undefined) ?? grammar.targets,
    hasAfterblow: grammar.hasAfterblow,
    afterblowValuation: grammar.hasAfterblow ? grammar.afterblowValuation : null,
    afterblowFixedValue: grammar.hasAfterblow ? grammar.afterblowFixedValue : null,
  };
}
