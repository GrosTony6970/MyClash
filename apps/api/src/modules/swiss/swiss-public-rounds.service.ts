import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value import, not `import type`: Nest DI metadata.
import { SwissPairingService } from './swiss-pairing.service';
import { parseSwissConfig } from './dto/swiss-config.dto';
import type { SwissRoundRecord } from './swiss-snapshot';

/**
 * The Swiss rounds as a spectator sees them.
 *
 * Separate from SwissPairingService because reading rounds and committing them
 * are different jobs: the commit path is the thing PhasesModule reaches for
 * auto-advance, and it should not grow a public projection alongside it.
 *
 * Carries the pairing metadata deliberately. Forced rematches and manual
 * adjustments are badged PUBLICLY (decision 16) — a fighter asked to replay an
 * opponent can see that no legal alternative existed, rather than assume the
 * draw was fixed.
 */
@Injectable()
export class SwissPublicRoundsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly pairing: SwissPairingService,
  ) {}

  async getRounds(tournamentId: string): Promise<PublicSwissRounds> {
    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('id, config_json')
      .eq('tournament_id', tournamentId)
      .eq('type', 'swiss')
      .maybeSingle();
    const phaseRow = phase as { id: string; config_json: unknown } | null;
    if (!phaseRow) return { phaseId: null, roundCount: 0, rounds: [] };

    const rounds = await this.pairing.loadRounds(phaseRow.id);
    return {
      phaseId: phaseRow.id,
      roundCount: parseSwissConfig(phaseRow.config_json)?.roundCount ?? rounds.length,
      rounds: rounds.map(toPublicRound),
    };
  }
}

export interface PublicSwissRound {
  id: string;
  roundNumber: number;
  status: string;
  /** Engine warnings — forced rematches and singleton bands, badged publicly. */
  warnings: unknown;
  byeRegistrationId: string | null;
  manuallyAdjusted: boolean;
  matches: Array<{
    id: string;
    redRegistrationId: string | null;
    blueRegistrationId: string | null;
    status: string;
  }>;
}

export interface PublicSwissRounds {
  phaseId: string | null;
  roundCount: number;
  rounds: PublicSwissRound[];
}

function toPublicRound(round: SwissRoundRecord): PublicSwissRound {
  const meta = (round as { pairingMeta?: Record<string, unknown> | null }).pairingMeta;
  const adjustments = meta?.['manualAdjustments'];
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    status: round.status,
    byeRegistrationId: round.byeRegistrationId,
    warnings: meta?.['warnings'] ?? [],
    manuallyAdjusted: Array.isArray(adjustments) && adjustments.length > 0,
    matches: round.matches.map((m) => ({
      id: m.id,
      redRegistrationId: m.redRegistrationId,
      blueRegistrationId: m.blueRegistrationId,
      status: m.status,
    })),
  };
}
