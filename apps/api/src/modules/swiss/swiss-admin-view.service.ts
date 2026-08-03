import { BadRequestException, Injectable } from '@nestjs/common';
import { recommendedRoundCount } from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';
// Value import, not `import type`: Nest DI metadata.
import { SwissPairingService } from './swiss-pairing.service';
import { activeEntrants, validateSwissRound, type SwissRoundValidation } from './swiss-snapshot';
import {
  boardNumber,
  buildFighterIndex,
  type EntrantNameRow,
  type PublicMatchRow,
} from './swiss-public-rounds.map';
import type { SwissConfig } from './dto/swiss-config.dto';

/**
 * Everything the organiser's Swiss route reads, in one request.
 *
 * The public projection deliberately does not serve this: an organiser needs
 * the configuration, the withdrawn flags and the per-round VALIDITY — the last
 * of which is the whole point of the set-sides escape hatch existing, and is
 * not something a spectator should be shown.
 *
 * Answers for a tournament with no Swiss phase too, because that is exactly
 * when the Configure tab has to propose a round count for the field size.
 */
@Injectable()
export class SwissAdminViewService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly pairing: SwissPairingService,
  ) {}

  async getAdminView(tournamentId: string): Promise<SwissAdminView> {
    const registeredCount = await this.countRegistrations(tournamentId);
    const phaseId = await this.findPhase(tournamentId);
    if (!phaseId) {
      return {
        phaseId: null,
        config: null,
        registeredCount,
        recommendedRoundCount: recommendedRoundCount(registeredCount),
        entrants: [],
        rounds: [],
      };
    }

    const context = await this.pairing.requireContext(phaseId);
    const [names, matches] = await Promise.all([
      this.loadEntrantNames(phaseId),
      this.loadMatches(phaseId),
    ]);

    const entrants: SwissAdminEntrant[] = context.entrants.map((entrant) => ({
      registrationId: entrant.registrationId,
      personName: names.get(entrant.registrationId)?.fighterName ?? '',
      clubLabel: names.get(entrant.registrationId)?.clubAbbrev ?? null,
      withdrawnAtRound: entrant.withdrawnAtRound,
    }));

    return {
      phaseId,
      config: context.config,
      registeredCount,
      // The recommendation for the CURRENT field, so a Configure tab opened on
      // a live phase compares its roundCount against the same number that was
      // proposed at generation.
      recommendedRoundCount: recommendedRoundCount(context.entrants.length || registeredCount),
      entrants,
      rounds: this.buildRounds(context, matches),
    };
  }

  private buildRounds(
    context: Awaited<ReturnType<SwissPairingService['requireContext']>>,
    matches: PublicMatchRow[],
  ): SwissAdminRound[] {
    const byRound = new Map<string, PublicMatchRow[]>();
    for (const match of matches) {
      if (!match.swiss_round_id) continue;
      const bucket = byRound.get(match.swiss_round_id);
      if (bucket) bucket.push(match);
      else byRound.set(match.swiss_round_id, [match]);
    }

    return context.rounds.map((round) => {
      const meta = round.pairingMeta ?? {};
      const adjustments = meta['manualAdjustments'];
      return {
        id: round.id,
        roundNumber: round.roundNumber,
        status: round.status,
        byeRegistrationId: round.byeRegistrationId,
        warnings: meta['warnings'] ?? [],
        manualAdjustments: Array.isArray(adjustments) ? adjustments : [],
        // The field as it stood FOR THAT ROUND: a fighter who withdrew at round
        // 4 was legitimately in round 3, so validating round 3 against today's
        // active list would report them as an intruder.
        validity: validateSwissRound(
          activeEntrants(context.entrants, round.roundNumber).map((e) => e.registrationId),
          round.matches,
          round.byeRegistrationId,
        ),
        matches: (byRound.get(round.id) ?? [])
          .sort((a, b) => boardNumber(a.match_number_label) - boardNumber(b.match_number_label))
          .map((match) => ({
            id: match.id,
            matchNumberLabel: match.match_number_label ?? '',
            status: match.status,
            scheduledAt: match.scheduled_at,
            liceName: match.lices?.name ?? null,
            redRegistrationId: match.red_registration_id,
            blueRegistrationId: match.blue_registration_id,
            redScore: match.red_score,
            blueScore: match.blue_score,
          })),
      };
    });
  }

  private async findPhase(tournamentId: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'swiss')
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  }

  /** The field a phase WOULD be generated from — same filter as the seeder. */
  private async countRegistrations(tournamentId: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);
    if (error) throw new BadRequestException(error.message);
    return count ?? 0;
  }

  private async loadEntrantNames(phaseId: string) {
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

export interface SwissAdminEntrant {
  registrationId: string;
  personName: string;
  clubLabel: string | null;
  withdrawnAtRound: number | null;
}

export interface SwissAdminMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  liceName: string | null;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  redScore: number | null;
  blueScore: number | null;
}

export interface SwissAdminRound {
  id: string;
  roundNumber: number;
  status: string;
  byeRegistrationId: string | null;
  warnings: unknown;
  manualAdjustments: unknown[];
  validity: SwissRoundValidation;
  matches: SwissAdminMatch[];
}

export interface SwissAdminView {
  phaseId: string | null;
  config: SwissConfig | null;
  registeredCount: number;
  recommendedRoundCount: number;
  entrants: SwissAdminEntrant[];
  rounds: SwissAdminRound[];
}
