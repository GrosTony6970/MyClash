import { Injectable } from '@nestjs/common';
import type { Exchange, RankingRule, StandingsColumn } from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
// Value import ON PURPOSE — `import type` erases the DI metadata Nest needs.
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { computeStandingsRows, type StandingsMember } from '../pool-standings/compute-rows';
import { applyRanking, type StandingsRow } from '@myclash/rules/results';
import type { SwissConfig } from './dto/swiss-config.dto';
import {
  loadScoringInputs,
  loadSwissContext,
  resolveTournamentRuleset,
  type EntrantRow,
  type MatchRow,
  type ResolvedRuleset,
  type RoundRow,
  type SwissLoadContext,
} from './swiss-standings-loader';
import {
  buildSwissRankingChain,
  headToHeadWithin,
  opponentTiebreaks,
  type SwissOutcome,
  type SwissResultRecord,
} from '@myclash/rules/results';

export interface SwissStandingsRow extends StandingsRow {
  /** Decision 11: a withdrawal keeps its row, ranked on what it played. */
  withdrawn: boolean;
  withdrawnAtRound: number | null;
}

export interface SwissStandingsResponse {
  phaseId: string | null;
  rulesetCode: string;
  rulesetVersion: string;
  columns: StandingsColumn[];
  rankBy: 'swissPts' | 'rulesetScore';
  tiebreakChain: string[];
  roundsCompleted: number;
  roundCount: number;
  finalized: SwissConfig['finalized'];
  rows: SwissStandingsRow[];
}

/**
 * Swiss standings, in four passes.
 *
 *   A  load everything, and get the ruleset-driven stats from the SHARED pool
 *      helper (W/D/L, points for and against, hits, doubles, forfeits, score)
 *   B  Swiss points, opponents and byes — the things only Swiss has
 *   C  opponent-derived tiebreaks, which need every fighter's total from B
 *   D  build the chain and rank
 *
 * plus a third ranking pass for `headToHead`, which is not a scalar over the
 * field: "who beat whom among the people still level with me" is only knowable
 * once the chain above it has been applied. `applyRanking` itself is untouched.
 *
 * The ruleset score is computed REGARDLESS of whether the ruleset declares a
 * `score` column, because ranking by it is offered on every ruleset. When there
 * is no declared column, a `score` column is added to the display — never rank
 * on a value the reader cannot see. The pool path keeps its own guard and is
 * unaffected.
 */
@Injectable()
export class SwissStandingsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly rulesets: RulesetResolver,
  ) {}

  async getSwissStandings(tournamentId: string): Promise<SwissStandingsResponse> {
    const context = await loadSwissContext(this.supabase, tournamentId);
    if (!context) {
      const fallback = await resolveTournamentRuleset(this.supabase, this.rulesets, tournamentId);
      return {
        phaseId: null,
        rulesetCode: fallback.code,
        rulesetVersion: fallback.version,
        columns: fallback.columns,
        rankBy: 'swissPts',
        tiebreakChain: [],
        roundsCompleted: 0,
        roundCount: 0,
        finalized: null,
        rows: [],
      };
    }
    return this.build(context);
  }

  private async build(context: SwissLoadContext): Promise<SwissStandingsResponse> {
    const { config, entrants, rounds, matches } = context;
    const ruleset = await resolveTournamentRuleset(
      this.supabase,
      this.rulesets,
      context.tournamentId,
    );
    const completed = matches.filter((m) => m.status === 'completed');
    const { exchangesByMatch, forfeitCountByReg } = await loadScoringInputs(
      this.supabase,
      completed.map((m) => m.id),
    );

    const columns = this.displayColumns(ruleset.columns);
    const baseRows = this.rulesetStats(context, ruleset, columns, completed, {
      exchangesByMatch,
      forfeitCountByReg,
    });

    // ── B + C: Swiss points and the opponent-derived keys built on them ──────
    const records = this.swissRecords(entrants, rounds, matches, config);
    const rows = this.decorate(baseRows, records, entrants, this.byeCounts(rounds));

    // ── D: rank ──────────────────────────────────────────────────────────────
    const chain = buildSwissRankingChain(
      config.rankBy,
      config.tiebreakChain,
      ruleset.ruleset.rankingChain,
    );

    return {
      phaseId: context.phaseId,
      rulesetCode: ruleset.code,
      rulesetVersion: ruleset.version,
      columns: this.swissColumns(columns, config),
      rankBy: config.rankBy,
      tiebreakChain: config.tiebreakChain,
      roundsCompleted: rounds.filter((r) => r.status === 'completed').length,
      roundCount: config.roundCount,
      finalized: config.finalized ?? null,
      rows: this.rankWithHeadToHead(rows, chain, records),
    };
  }

  /**
   * The ruleset-driven half of the table, from the SHARED pool helper.
   *
   * `forceScore` is the Swiss opt-in the pool path deliberately does not take:
   * ranking by the ruleset score is offered on every ruleset, so the value is
   * always computed here even when no `score` column is declared.
   *
   * `rankingChain: []` because the ranking is redone afterwards with the Swiss
   * chain — this call is wanted only for its stats.
   */
  private rulesetStats(
    context: SwissLoadContext,
    ruleset: ResolvedRuleset,
    columns: StandingsColumn[],
    completed: MatchRow[],
    scoring: {
      exchangesByMatch: Map<string, Exchange[]>;
      forfeitCountByReg: Map<string, number>;
    },
  ): StandingsRow[] {
    return computeStandingsRows({
      members: context.entrants.map((e) => ({
        registration_id: e.registration_id,
        registrations: e.registrations,
      })) satisfies StandingsMember[],
      completedMatches: completed.map((m) => ({
        id: m.id,
        red_registration_id: m.red_registration_id!,
        blue_registration_id: m.blue_registration_id!,
        red_score: m.red_score,
        blue_score: m.blue_score,
        winner_registration_id: m.winner_registration_id,
        // Swiss already LOADS this column and scores its own points column off
        // it. Dropping it from the projection is what made one row say double
        // loss in `swissPts` and draw in W/L/D, from the same helper.
        end_reason: m.end_reason,
      })),
      columns,
      rankingChain: [],
      status: this.phaseStatus(context.rounds, context.config),
      exchangesByMatch: scoring.exchangesByMatch,
      forfeitCountByReg: scoring.forfeitCountByReg,
      // Swiss has no forfeit-draws policy of its own; the bout's own result
      // stands, exactly as the pool path treats it when the policy is off.
      drawnForfeitMatchIds: new Set<string>(),
      ruleset: ruleset.ruleset,
      runtimeConfig: ruleset.runtimeConfig,
      afterblowMode: ruleset.afterblowMode,
      forceScore: true,
    });
  }

  /**
   * The ruleset's columns, plus a `score` column when it declares none.
   *
   * Ranking by the ruleset score is offered on EVERY ruleset, so the value is
   * always computed — but a reader must be able to see the number a placing was
   * decided on, so the column is added rather than the value hidden.
   */
  private displayColumns(rulesetColumns: StandingsColumn[]): StandingsColumn[] {
    if (rulesetColumns.some((c) => c.key === 'score')) return rulesetColumns;
    return [...rulesetColumns, { key: 'score', label: 'Score' } as StandingsColumn];
  }

  /** Splice the Swiss-only stats onto the ruleset-driven rows. */
  private decorate(
    baseRows: StandingsRow[],
    records: SwissResultRecord[],
    entrants: EntrantRow[],
    byeCount: Map<string, number>,
  ): SwissStandingsRow[] {
    const byId = new Map(records.map((r) => [r.registrationId, r]));
    const withdrawnAt = new Map(entrants.map((e) => [e.registration_id, e.withdrawn_at_round]));
    const opponentKeys = opponentTiebreaks(records);

    return baseRows.map((row) => {
      const keys = opponentKeys.get(row.registrationId);
      const withdrawn = withdrawnAt.get(row.registrationId) ?? null;
      return {
        ...row,
        stats: {
          ...row.stats,
          swissPts: byId.get(row.registrationId)?.swissPts ?? 0,
          buchholz: keys?.buchholz ?? 0,
          buchholzCut1: keys?.buchholzCut1 ?? 0,
          sonnebornBerger: keys?.sonnebornBerger ?? 0,
          opponentWinPct: keys?.opponentWinPct ?? 0,
          byes: byeCount.get(row.registrationId) ?? 0,
          // Filled by the third pass, and only when the chain uses it.
          headToHead: 0,
        },
        withdrawn: withdrawn !== null,
        withdrawnAtRound: withdrawn,
      };
    });
  }

  /**
   * Rank, then resolve head-to-head inside whatever blocks are still exactly
   * tied, then rank again.
   *
   * Skipped entirely when the chain does not use the key, so the ordinary case
   * pays for one ranking pass.
   */
  private rankWithHeadToHead(
    rows: SwissStandingsRow[],
    chain: RankingRule[],
    records: SwissResultRecord[],
  ): SwissStandingsRow[] {
    const index = chain.findIndex((rule) => rule.key === 'headToHead');
    const first = applyRanking(rows, chain) as SwissStandingsRow[];
    if (index === -1) return first;

    // Rank on the chain UP TO head-to-head; fighters whose deciding tiebreak is
    // null against the row above are still exactly level at that point, which
    // is precisely the block head-to-head is meant to separate.
    const upTo = applyRanking(rows, chain.slice(0, index)) as SwissStandingsRow[];
    const blocks: string[][] = [];
    for (const row of upTo) {
      if (row.decidingTiebreak === null && blocks.length > 0) {
        blocks[blocks.length - 1]!.push(row.registrationId);
      } else {
        blocks.push([row.registrationId]);
      }
    }

    const resolved = new Map<string, number>();
    for (const block of blocks) {
      if (block.length < 2) continue;
      for (const [id, net] of headToHeadWithin(block, records)) resolved.set(id, net);
    }
    if (resolved.size === 0) return first;

    return applyRanking(
      rows.map((row) => ({
        ...row,
        stats: { ...row.stats, headToHead: resolved.get(row.registrationId) ?? 0 },
      })),
      chain,
    ) as SwissStandingsRow[];
  }

  // ── B helpers ──────────────────────────────────────────────────────────────

  private swissRecords(
    entrants: EntrantRow[],
    rounds: RoundRow[],
    matches: MatchRow[],
    config: SwissConfig,
  ): SwissResultRecord[] {
    const roundById = new Map(rounds.map((r) => [r.id, r]));
    const points = config.points;
    const byId = new Map<string, SwissResultRecord>(
      entrants.map((e) => [
        e.registration_id,
        { registrationId: e.registration_id, swissPts: 0, bouts: [] },
      ]),
    );

    for (const round of rounds) {
      const record = round.bye_registration_id ? byId.get(round.bye_registration_id) : undefined;
      if (record) record.swissPts += points.bye;
    }

    for (const match of matches) {
      if (match.status !== 'completed') continue;
      if (!match.swiss_round_id || !roundById.has(match.swiss_round_id)) continue;
      const red = match.red_registration_id;
      const blue = match.blue_registration_id;
      if (!red || !blue) continue;

      const [redOutcome, blueOutcome] = outcomes(match);
      for (const [id, opponentId, outcome] of [
        [red, blue, redOutcome],
        [blue, red, blueOutcome],
      ] as const) {
        const record = byId.get(id);
        if (!record) continue;
        record.bouts.push({ opponentId, outcome });
        record.swissPts += points[outcome === 'win' ? 'win' : outcome === 'draw' ? 'draw' : 'loss'];
      }
    }
    return [...byId.values()];
  }

  private byeCounts(rounds: RoundRow[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const round of rounds) {
      if (!round.bye_registration_id) continue;
      out.set(round.bye_registration_id, (out.get(round.bye_registration_id) ?? 0) + 1);
    }
    return out;
  }

  private phaseStatus(rounds: RoundRow[], config: SwissConfig): 'in_progress' | 'completed' {
    if (config.finalized) return 'completed';
    const done = rounds.filter((r) => r.status === 'completed').length;
    return done > 0 && done === config.roundCount ? 'completed' : 'in_progress';
  }

  /** The ruleset's columns plus the Swiss-only ones the chain can rank on. */
  private swissColumns(base: StandingsColumn[], config: SwissConfig): StandingsColumn[] {
    const extra: StandingsColumn[] = [{ key: 'swissPts', label: 'Pts' } as StandingsColumn];
    for (const key of config.tiebreakChain) {
      if (key === 'rulesetChain' || base.some((c) => c.key === key)) continue;
      if (extra.some((c) => c.key === key)) continue;
      extra.push({ key, label: TIEBREAK_LABELS[key] ?? key } as StandingsColumn);
    }
    return [...extra, ...base];
  }
}

const TIEBREAK_LABELS: Record<string, string> = {
  buchholz: 'Buchholz',
  buchholzCut1: 'Buchholz −1',
  sonnebornBerger: 'SB',
  opponentWinPct: 'Opp win %',
  headToHead: 'H2H',
};

/** Outcomes for (red, blue) from one completed bout. */
function outcomes(match: MatchRow): [SwissOutcome, SwissOutcome] {
  // A double cap is a mutual loss — both fighters failed to win it.
  if (match.end_reason === 'max_doubles') return ['loss', 'loss'];
  if (match.winner_registration_id === null) return ['draw', 'draw'];
  return match.winner_registration_id === match.red_registration_id
    ? ['win', 'loss']
    : ['loss', 'win'];
}
