import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  canonicalizePenaltyDefinition,
  canonicalizeScoringBehaviour,
  projectPenaltyBucketFromLive,
  projectPenaltyBucketFromSnapshot,
  RulesetRegistry,
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
      decisionEdition: string | null;
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

  constructor(
    private readonly supabase: SupabaseService,
    private readonly registry: RulesetRegistry,
  ) {}

  /** The (scoring, penalty) pair-hash for a tournament, or null if it is gone. */
  async computeTournamentContentHash(tournamentId: string): Promise<string | null> {
    const tournament = await this.loadTournament(tournamentId);
    if (!tournament) return null;
    const scoring = await this.buildScoringCanonical(tournament);
    const penalty = await this.buildPenaltyCanonical(tournament);
    return createHash('sha256').update(stableStringify({ scoring, penalty })).digest('hex');
  }

  /**
   * Recompute + persist a tournament's effective content hash, or throw. Only a
   * hash that changed is written: most saves change nothing here. For the door
   * whose whole job is the hash ("Acknowledge"): answered done after a write that
   * failed, its banner went away and came back at the next read, with nothing said.
   */
  async writeTournamentContentHash(tournamentId: string): Promise<void> {
    const { current, drifted } = await this.describeTournamentDrift(tournamentId);
    if (!drifted) return;
    const { error } = await this.supabase.service
      .from('tournaments')
      .update({ ruleset_content_hash: current })
      .eq('id', tournamentId);
    if (error) throw new Error(error.message);
  }

  /** Recompute + persist a tournament's effective content hash. Callers invoke
   *  this after any change to its ruleset/config/penalty pin. */
  async stampTournamentContentHash(tournamentId: string): Promise<void> {
    // Best-effort: a hash-compute failure (e.g. an out-of-domain stored config
    // the canonical normalizer rejects) must never fail the write that triggered
    // the stamp — the hash is metadata, not the source of truth for scoring. A
    // read that fails throws here too, so it is logged and no hash built on a
    // fallback is written.
    // A write the database refuses is logged the same way: its answer was never
    // read, so the old hash stayed in place and nothing said so. The settings
    // page then shows its drift banner, and "acknowledge" writes the hash again.
    try {
      await this.writeTournamentContentHash(tournamentId);
    } catch (err) {
      this.logger.warn(
        `Failed to stamp content hash for tournament ${tournamentId}: ${String(err)}`,
      );
    }
  }

  /**
   * Restamp every tournament that INHERITS an event's default penalty (its own
   * penalty_ruleset_id is NULL) — their effective penalty changed with the event
   * default, so their content hash must be refreshed too. Answers their ids:
   * the caller moves the bouts not started of each one.
   */
  async stampEventInheritingTournaments(eventId: string): Promise<string[]> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId)
      .is('penalty_ruleset_id', null);
    // A failed read is not "none inherits": read as none, their hashes stayed on the old default.
    if (error)
      throw new Error(`The Tournaments of Event ${eventId} were not read: ${error.message}`);
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    for (const id of ids) {
      await this.stampTournamentContentHash(id);
    }
    return ids;
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
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('ruleset_content_hash')
      .eq('id', tournamentId)
      .maybeSingle();
    // A failed read is not "no hash stored": read as one, any hash looked like a change.
    if (error)
      throw new Error(`The hash of Tournament ${tournamentId} was not read: ${error.message}`);
    const stored =
      (data as { ruleset_content_hash?: string | null } | null)?.ruleset_content_hash ?? null;
    const current = await this.computeTournamentContentHash(tournamentId);
    return { stored, current, drifted: stored !== current };
  }

  private async loadTournament(id: string): Promise<TournamentHashRow | null> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select(
        'id, event_id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json, penalty_ruleset_id, penalty_ruleset_version',
      )
      .eq('id', id)
      .maybeSingle();
    // A failed read is not "no Tournament": read as one, it hashed as nothing, and the stamp
    // wrote an empty hash over the real one.
    if (error) throw new Error(`Tournament ${id} was not read for its hash: ${error.message}`);
    return (data as TournamentHashRow | null) ?? null;
  }

  private async buildScoringCanonical(t: TournamentHashRow): Promise<Record<string, unknown>> {
    const code = t.ruleset_code ?? 'TF_v1';
    const version = normalizeRulesetVersion(t.ruleset_version ?? '1');
    const grammar = await resolveRulesetGrammar(this.supabase, this.registry, code, version);
    const config = t.ruleset_config ?? {};
    const scoringConfig = t.scoring_config_json ?? {};
    const matchFormat = (config['matchFormat'] as Row | undefined) ?? null;
    const tournamentPolicy = config['tournamentPolicy'] ?? null;
    const afterblowMode =
      (scoringConfig['afterblowMode'] as string | undefined) ??
      grammar.defaultAfterblowMode ??
      null;
    const structure = await this.resolveScoringStructure(code, version);
    const grammarInput = grammarInputFrom(config, grammar, structure.kind);
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
            decisionEdition: structure.decisionEdition,
            forfeitPolicy: config['forfeitPolicy'] ?? null,
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
    if (this.registry.has(code, version))
      return { kind: 'coded', engineCode: code, engineVersion: version };
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .select(
        'id, is_system, base_code, base_version, score_formula, constants, tiebreakers, double_penalty_formula, decision_edition',
      )
      .eq('code', code)
      .maybeSingle();
    // A failed read is not "no club ruleset": read as none, a club formula hashed as a coded engine.
    if (error)
      throw new Error(`Ruleset ${code}@${version} was not read for its hash: ${error.message}`);
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
    // No published snapshot: the row itself, a draft included. The resolver
    // scores a Tournament pinned to a draft as its draft (ruling 6), so the
    // fingerprint describes that formula too.
    const def = snapshot ?? parent;
    return {
      kind: 'formula',
      scoreFormula: def['score_formula'],
      constants: (def['constants'] as Record<string, number>) ?? {},
      tiebreakers:
        (def['tiebreakers'] as ReadonlyArray<{ variable: string; direction: 'asc' | 'desc' }>) ??
        [],
      doublePenaltyFormula: def['double_penalty_formula'] ?? null,
      // The edition a published version keeps (0228): the formula alone is not its behaviour.
      decisionEdition: (def['decision_edition'] as string | null | undefined) ?? null,
    };
  }

  private async loadScoringSnapshot(customRulesetId: string, version: string): Promise<Row | null> {
    const { data, error } = await this.supabase.service
      .from('custom_ruleset_versions')
      .select('score_formula, constants, tiebreakers, double_penalty_formula, decision_edition')
      .eq('custom_ruleset_id', customRulesetId)
      .eq('version', version)
      .maybeSingle();
    // Read as "no snapshot", the hash described the parent row: the latest version, not this one.
    if (error) throw new Error(`Snapshot ${version} was not read for its hash: ${error.message}`);
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
      const { data, error } = await this.supabase.service
        .from('events')
        .select('penalty_ruleset_id, penalty_ruleset_version')
        .eq('id', t.event_id)
        .maybeSingle();
      if (error)
        throw new Error(`The card pin of Event ${t.event_id} was not read: ${error.message}`);
      const event = data as Row | null;
      if (event?.['penalty_ruleset_id']) {
        return {
          id: event['penalty_ruleset_id'] as string,
          version: (event['penalty_ruleset_version'] as string | null) ?? null,
        };
      }
    }
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id, version')
      .eq('built_in', true)
      .is('owner_organization_id', null)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`The built-in card rules were not read: ${error.message}`);
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
      const { data, error } = await this.supabase.service
        .from('penalty_ruleset_versions')
        .select(
          'accumulation_scope, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, entries',
        )
        .eq('penalty_ruleset_id', id)
        .eq('version', version)
        .maybeSingle();
      if (error) throw new Error(`Card rules ${id}@${version} were not read: ${error.message}`);
      if (data) return projectPenaltyBucketFromSnapshot(data as Row);
    }
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select(
        'accumulation_scope, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, penalty_ruleset_entries(group_number, ref_number, sanctions)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Card rules ${id} were not read: ${error.message}`);
    return data ? projectPenaltyBucketFromLive(data as Row) : null;
  }
}

/** Effective grammar for the hash. A coded engine (TF_v1, a fork) scores the
 *  tournament's ruleset_config.targets (a fork/tf_config edit writes them) over
 *  its static grammar; a formula ruleset scores its OWN targets (the resolver's
 *  grammar), whatever default list the tournament's settings carry (operator
 *  ruling "Formula targets", 2026-10-19). The pressed button's value — set by
 *  targets — decides each hit. */
function grammarInputFrom(
  config: Row,
  grammar: ResolvedRulesetGrammar,
  kind: ScoringStructure['kind'],
) {
  const ownTargets = config['targets'] as Array<{ name: string; value: number }> | undefined;
  return {
    targets: kind === 'coded' ? (ownTargets ?? grammar.targets) : grammar.targets,
    hasAfterblow: grammar.hasAfterblow,
    afterblowValuation: grammar.hasAfterblow ? grammar.afterblowValuation : null,
    afterblowFixedValue: grammar.hasAfterblow ? grammar.afterblowFixedValue : null,
  };
}
