import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { sideColorsFromScoringConfig } from '../events/side-colors';
import { parseSwissConfig } from './dto/swiss-config.dto';
import {
  buildFighterIndex,
  toPublicRounds,
  type EntrantNameRow,
  type PublicMatchRow,
  type PublicRoundRow,
  type PublicSwissRounds,
} from './swiss-public-rounds.map';

export type {
  PublicSwissMatch,
  PublicSwissRound,
  PublicSwissRounds,
} from './swiss-public-rounds.map';

/**
 * The Swiss rounds as a spectator sees them.
 *
 * Separate from SwissPairingService because reading rounds and committing them
 * are different jobs: the commit path is what PhasesModule reaches for
 * auto-advance, and it should not grow a public projection alongside it. This
 * service therefore runs its OWN queries rather than borrowing the commit
 * path's loader — the projection needs scores, pistes and names that the
 * pairing loader has no reason to fetch on every match completion.
 *
 * Carries the pairing metadata deliberately. Forced rematches and manual
 * adjustments are badged PUBLICLY (decision 16) — a fighter asked to replay an
 * opponent can see that no legal alternative existed, rather than assume the
 * draw was fixed.
 */
@Injectable()
export class SwissPublicRoundsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getRounds(tournamentId: string): Promise<PublicSwissRounds> {
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('scoring_config_json')
      .eq('id', tournamentId)
      .maybeSingle();
    // Per-ITEM side colours: each tournament configures its own, so this is
    // read here rather than assumed to be red/blue.
    const sideColors = sideColorsFromScoringConfig(
      (tournament as { scoring_config_json?: unknown } | null)?.scoring_config_json,
    );

    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('id, config_json')
      .eq('tournament_id', tournamentId)
      .eq('type', 'swiss')
      .maybeSingle();
    const phaseRow = phase as { id: string; config_json: unknown } | null;
    if (!phaseRow) {
      return {
        phaseId: null,
        roundCount: 0,
        roundsCompleted: 0,
        finalized: null,
        sideColors,
        rounds: [],
      };
    }

    const config = parseSwissConfig(phaseRow.config_json);
    const [fighters, rounds, matches] = await Promise.all([
      this.loadFighters(phaseRow.id),
      this.loadRounds(phaseRow.id),
      this.loadMatches(phaseRow.id),
    ]);

    return {
      phaseId: phaseRow.id,
      roundCount: config?.roundCount ?? rounds.length,
      roundsCompleted: rounds.filter((round) => round.status === 'completed').length,
      finalized: config?.finalized
        ? { atRound: config.finalized.atRound, at: config.finalized.at }
        : null,
      sideColors,
      rounds: toPublicRounds(rounds, matches, fighters),
    };
  }

  /**
   * Names for every entrant, withdrawn included.
   *
   * A withdrawal's played bouts stay on the board (decision 11), so dropping
   * them here would blank the opponent's name on a round that was actually
   * fought.
   */
  private async loadFighters(phaseId: string) {
    const { data, error } = await this.supabase.service
      .from('swiss_entrants')
      .select(
        'registration_id, ' +
          'registrations(id, persons(id, given_name, family_name, clubs(id, name, abbreviation)))',
      )
      .eq('phase_id', phaseId);
    if (error) throw new BadRequestException(error.message);
    return buildFighterIndex((data ?? []) as unknown as EntrantNameRow[]);
  }

  private async loadRounds(phaseId: string): Promise<PublicRoundRow[]> {
    const { data, error } = await this.supabase.service
      .from('swiss_rounds')
      .select('id, round_number, status, bye_registration_id, pairing_meta_json')
      .eq('phase_id', phaseId)
      .order('round_number', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as unknown as PublicRoundRow[];
  }

  private async loadMatches(phaseId: string): Promise<PublicMatchRow[]> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id, swiss_round_id, match_number_label, status, scheduled_at, ' +
          'red_registration_id, blue_registration_id, red_score, blue_score, ' +
          'winner_registration_id, lices(name, color_hex)',
      )
      .eq('phase_id', phaseId);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as unknown as PublicMatchRow[];
  }
}
