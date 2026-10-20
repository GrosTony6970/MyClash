import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  canonicalizePenaltyDefinition,
  canonicalizeScoringBehaviour,
  projectPenaltyBucketFromLive,
  RulesetRegistry,
  stableStringify,
  type PenaltyBehaviourInput,
  type ScoringBehaviourInput,
} from '@myclash/rulesets';
import { afterblowModeInForce } from '@myclash/types';
import {
  mergeForfeitRules,
  type BlackCardEffectName,
  type ForfeitChanges,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';
import { SupabaseService } from '../supabase/supabase.service';
import {
  normalizeRulesetVersion,
  resolveRulesetGrammar,
  type ResolvedRulesetGrammar,
} from '../events/ruleset-defaults';
import { scoringStructureOf, type ScoringStructure } from './scoring-structure';

type Row = Record<string, unknown>;

/** The columns of a Tournament its fingerprint reads: its scoring rules and its card pin. */
export interface TournamentHashRow {
  id: string;
  event_id: string | null;
  ruleset_code: string | null;
  ruleset_version: string | null;
  ruleset_config: Row | null;
  scoring_config_json: Row | null;
  penalty_ruleset_id: string | null;
  /** The Tournament's own changes of its forfeit rules (ruling 65): they change results. */
  forfeit_rules: ForfeitChanges | null;
}

/** The columns `scoringCanonicalOf` reads: the scoring rules alone. */
export type TournamentScoringRow = Pick<
  TournamentHashRow,
  'ruleset_code' | 'ruleset_version' | 'ruleset_config' | 'scoring_config_json'
>;

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
    return tournament ? this.contentHashOf(tournament) : null;
  }

  /**
   * The (scoring, penalty) pair-hash of a Tournament row as given, read from nowhere else: the
   * audited rules write hashes the row it is about to write (`p_next` over the read row).
   */
  async contentHashOf(tournament: TournamentHashRow): Promise<string> {
    const scoring = await this.scoringCanonicalOf(tournament);
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
        'id, event_id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json, penalty_ruleset_id, forfeit_rules',
      )
      .eq('id', id)
      .maybeSingle();
    // A failed read is not "no Tournament": read as one, it hashed as nothing, and the stamp
    // wrote an empty hash over the real one.
    if (error) throw new Error(`Tournament ${id} was not read for its hash: ${error.message}`);
    return (data as TournamentHashRow | null) ?? null;
  }

  /**
   * The scoring canonical of a Tournament row as given: what its fingerprint hashes, and what
   * `scoringDiff` compares on each side of a rules change.
   */
  async scoringCanonicalOf(t: TournamentScoringRow): Promise<Record<string, unknown>> {
    const code = t.ruleset_code ?? 'TF_v1';
    const version = normalizeRulesetVersion(t.ruleset_version ?? '1');
    const grammar = await resolveRulesetGrammar(this.supabase, this.registry, code, version);
    const config = t.ruleset_config ?? {};
    const scoringConfig = t.scoring_config_json ?? {};
    const matchFormat = (config['matchFormat'] as Row | undefined) ?? null;
    // What the scorer plays (operator ruling 47): a missing mode is `full`, never the grammar's
    // seed (a ruleset only SEEDS a Tournament; `packages/rules/src/afterblow.ts`).
    const afterblowMode = afterblowModeInForce(scoringConfig);
    const structure = await scoringStructureOf(this.supabase, this.registry, code, version);
    const grammarInput = grammarInputFrom(config, grammar, structure.kind);
    const input: ScoringBehaviourInput =
      structure.kind === 'coded'
        ? {
            kind: 'coded',
            engineCode: structure.engineCode,
            engineVersion: structure.engineVersion,
            grammar: grammarInput,
            matchFormat,
            afterblowMode,
            winBonus: (config['winBonus'] as number | undefined) ?? null,
            doublePenaltyFormula: config['doublePenaltyFormula'] ?? null,
          }
        : {
            kind: 'formula',
            grammar: grammarInput,
            matchFormat,
            afterblowMode,
            scoreFormula: structure.scoreFormula,
            constants: structure.constants,
            tiebreakers: structure.tiebreakers,
            doublePenaltyFormula: structure.doublePenaltyFormula,
            decisionEdition: structure.decisionEdition,
          };
    return canonicalizeScoringBehaviour(input);
  }

  private async buildPenaltyCanonical(
    t: TournamentHashRow,
  ): Promise<Record<string, unknown> | null> {
    const id = await this.resolveEffectivePenalty(t);
    if (!id) return null;
    const definition = await this.loadPenaltyDefinition(id);
    return definition
      ? canonicalizePenaltyDefinition(withForfeitChanges(definition, t.forfeit_rules))
      : null;
  }

  /** tournament pin → event default → platform built-in (by built_in flag, not
   *  the stale version constant). `card-rules-pin.ts` holds the same chain. */
  private async resolveEffectivePenalty(t: TournamentHashRow): Promise<string | null> {
    if (t.penalty_ruleset_id) return t.penalty_ruleset_id;
    if (t.event_id) {
      const { data, error } = await this.supabase.service
        .from('events')
        .select('penalty_ruleset_id')
        .eq('id', t.event_id)
        .maybeSingle();
      if (error)
        throw new Error(`The card pin of Event ${t.event_id} was not read: ${error.message}`);
      const eventPin = (data as Row | null)?.['penalty_ruleset_id'];
      if (typeof eventPin === 'string' && eventPin) return eventPin;
    }
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id')
      .eq('built_in', true)
      .is('owner_organization_id', null)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`The built-in card rules were not read: ${error.message}`);
    return ((data as Row | null)?.['id'] as string | undefined) ?? null;
  }

  /**
   * The LIVE row and its entries: what the engine scores cards and forfeits by (every scorer
   * reads the live row, rulings A and G). A snapshot of the pinned version is not read: after a
   * pin, an unpin, an edit and a re-pin it no longer says what the engine does.
   */
  private async loadPenaltyDefinition(id: string): Promise<PenaltyBehaviourInput | null> {
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select(
        'accumulation_scope, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, forfeit_rules, penalty_ruleset_entries(group_number, ref_number, sanctions)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Card rules ${id} were not read: ${error.message}`);
    return data ? projectPenaltyBucketFromLive(data as Row) : null;
  }
}

/**
 * The card and forfeit rules a Tournament plays: its changes laid over its ruleset's, by the one
 * merge of the scorer and the screens. No changes leaves the definition as read, so the stamp of a
 * Tournament that changes nothing stays what it was.
 */
function withForfeitChanges(
  definition: PenaltyBehaviourInput,
  changes: ForfeitChanges | null,
): PenaltyBehaviourInput {
  if (!changes) return definition;
  const { firstBlackCard, secondBlackCard, ...forfeitRules } = mergeForfeitRules(
    {
      ...(definition.forfeitRules as ForfeitRules),
      firstBlackCard: definition.firstBlackCardForfeit as BlackCardEffectName,
      secondBlackCard: definition.secondBlackCardForfeit as BlackCardEffectName,
    },
    changes,
  );
  return {
    ...definition,
    firstBlackCardForfeit: firstBlackCard,
    secondBlackCardForfeit: secondBlackCard,
    forfeitRules,
  };
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
