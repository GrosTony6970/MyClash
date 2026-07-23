import { Injectable } from '@nestjs/common';
import {
  computeFinalRanking,
  type FinalRankingResultKind,
  type PoolEntry,
  type RankingSlot,
} from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
// Value imports (NOT `import type`) — DI-injected, so the runtime needs the
// class metadata preserved.
import { PhasesService } from '../phases/phases.service';
import { PoolStandingsService, type StandingsRow } from '../pool-standings/pool-standings.service';

/** A single registration's final placement in one decided tournament, derived
 *  from the shared `computeFinalRanking` — the SAME ordering the public
 *  tournament page, fighter profiles, and now league scoring all render.
 *  `place` is 1-indexed; `totalRanked` is the size of the ranked field. */
export interface TournamentPlacement {
  place: number;
  resultKind: FinalRankingResultKind;
  totalRanked: number;
}

/** The full-field placement of a tournament: the ordered list, a per-registration
 *  lookup, and whether the tournament is decided at all. `decided:false` (empty
 *  map) means the Final isn't settled yet, or a pool-only tournament still has
 *  matches to play — callers must award nothing in that case. */
export interface TournamentPlacements {
  byRegistrationId: Map<string, TournamentPlacement>;
  ordered: Array<{ registrationId: string } & TournamentPlacement>;
  decided: boolean;
}

const UNDECIDED: TournamentPlacements = Object.freeze({
  byRegistrationId: new Map(),
  ordered: [],
  decided: false,
});

/**
 * The single authority for "where did each fighter finish in this tournament".
 *
 * Combines the overall pool standings (`PoolStandingsService`) with the bracket
 * (`PhasesService`) through the shared `computeFinalRanking` so every surface —
 * public FinalRankingTab, fighter career, and league scoring — agrees on the
 * podium. Pool-only tournaments fall back to the overall pool rank once every
 * match is in. A tournament that isn't decided yet returns `decided:false` with
 * an empty map, never a guessed mid-play ranking.
 */
@Injectable()
export class TournamentPlacementService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly phases: PhasesService,
    private readonly poolStandings: PoolStandingsService,
  ) {}

  /**
   * Full-field placement for one tournament. Best-effort on the two external
   * reads: a failing pool-standings fetch degrades to an empty pool tail rather
   * than throwing, matching the career-dashboard contract.
   */
  async getTournamentPlacements(tournamentId: string): Promise<TournamentPlacements> {
    let rows: StandingsRow[] = [];
    try {
      const standings = (await this.poolStandings.getPoolStandings(tournamentId, 'overall')) as {
        rows?: StandingsRow[];
      };
      rows = standings.rows ?? [];
    } catch {
      rows = [];
    }
    const poolEntries: PoolEntry[] = rows.map((row) => {
      const rawScore = row.stats?.['score'];
      const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
      return {
        registrationId: row.registrationId,
        fighterName: row.displayName,
        clubAbbrev: row.club?.abbreviation ?? row.club?.name ?? null,
        poolScore: Number.isFinite(score) ? score : null,
      };
    });

    const bracket = await this.phases.getTournamentBracket(tournamentId);
    const hasBracket = Boolean(bracket?.slots?.length);
    if (bracket?.slots?.length) {
      const slots: RankingSlot[] = bracket.slots.map((slot) => ({
        id: slot.id,
        round: slot.round,
        position: slot.position,
        status: slot.status,
        redRegistrationId: slot.redRegistrationId ?? null,
        blueRegistrationId: slot.blueRegistrationId ?? null,
        redFighterName: slot.redFighterName ?? null,
        blueFighterName: slot.blueFighterName ?? null,
        redClubAbbrev: slot.redClubAbbrev ?? null,
        blueClubAbbrev: slot.blueClubAbbrev ?? null,
        redScore: slot.redScore ?? null,
        blueScore: slot.blueScore ?? null,
        winnerRegistrationId: slot.winnerRegistrationId ?? null,
      }));
      // 2-arg call (no explicit bronzeSlotId) to match the public FinalRankingTab.
      const ranking = computeFinalRanking(slots, poolEntries);
      if (ranking.length > 0) {
        const totalRanked = ranking.length;
        const byRegistrationId = new Map<string, TournamentPlacement>();
        const ordered = ranking.map((entry) => {
          const placement: TournamentPlacement = {
            place: entry.place,
            resultKind: entry.resultKind,
            totalRanked,
          };
          byRegistrationId.set(entry.registrationId, placement);
          return { registrationId: entry.registrationId, ...placement };
        });
        return { byRegistrationId, ordered, decided: true };
      }
    }

    // A bracket that exists but isn't decided yet has NO placement — falling back
    // to pool rank here would crown the mid-event pool leader (a bracket entrant
    // can still lose in the quarters). computeFinalRanking returning [] is exactly
    // that "not decided" signal, so bail rather than guess.
    if (hasBracket) return UNDECIDED;

    // Pool-only tournament: the overall pool rank IS the final result — but only
    // once every match is in, otherwise the standings are a mid-play snapshot.
    if (!(await this.isTournamentFullyPlayed(tournamentId))) return UNDECIDED;
    const ranked = rows.filter((row) => Number.isFinite(row.rank)).sort((a, b) => a.rank - b.rank);
    if (ranked.length === 0) return UNDECIDED;
    const totalRanked = ranked.length;
    const byRegistrationId = new Map<string, TournamentPlacement>();
    const ordered = ranked.map((row) => {
      const placement: TournamentPlacement = {
        place: row.rank,
        resultKind: 'pool',
        totalRanked,
      };
      byRegistrationId.set(row.registrationId, placement);
      return { registrationId: row.registrationId, ...placement };
    });
    return { byRegistrationId, ordered, decided: true };
  }

  /** True when a tournament has no unfinished match left (voided ones don't
   *  block). On error, assume NOT decided — better a missing placement than a
   *  wrong one. */
  private async isTournamentFullyPlayed(tournamentId: string): Promise<boolean> {
    const { count, error } = await this.supabase.service
      .from('matches')
      .select('id, phases!inner(tournament_id)', { count: 'exact', head: true })
      .eq('phases.tournament_id', tournamentId)
      .not('status', 'in', '("completed","voided")');
    return !error && (count ?? 1) === 0;
  }
}
