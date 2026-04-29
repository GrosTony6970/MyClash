/**
 * apps/api/src/modules/phases/pool-generator.ts
 *
 * Pool generation service — orchestrates snake seeding + local search.
 * Calls the pure scheduling functions from @myclash/rulesets.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  snakeSeed,
  localSearch,
  buildCostReport,
  type Fighter,
  type PoolAssignmentSettings,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';

export interface GeneratePoolsInput {
  tournamentId: string;
  poolCount: number;
  settings: PoolAssignmentSettings;
  /** PRNG seed for determinism (default: 42) */
  seed?: number;
}

export interface GeneratePoolsResult {
  pools: Array<{
    name: string;
    registrationIds: string[];
  }>;
  costReport: ReturnType<typeof buildCostReport>;
}

@Injectable()
export class PoolGeneratorService {
  private readonly logger = new Logger(PoolGeneratorService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async generatePools(input: GeneratePoolsInput): Promise<GeneratePoolsResult> {
    const { tournamentId, poolCount, settings, seed = 42 } = input;

    if (poolCount < 1) throw new BadRequestException('poolCount must be at least 1');

    // Fetch registrations with skill data
    const { data: regs, error } = await this.supabase.service
      .from('registrations')
      .select(`
        id, seed, bib_number,
        persons(club_id),
        fighters(hema_ratings_id)
      `)
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);

    if (error) throw new BadRequestException(error.message);
    if (!regs || regs.length === 0) {
      throw new BadRequestException('No registered fighters found for this tournament');
    }

    if (regs.length < poolCount) {
      throw new BadRequestException(
        `Cannot create ${poolCount} pools with only ${regs.length} fighters`,
      );
    }

    // Map to Fighter type for the scheduling algorithm
    const fighters: Fighter[] = regs.map((reg, idx) => {
      const r = reg as Record<string, unknown>;
      const person = r['persons'] as { club_id: string | null } | null;
      return {
        registrationId: r['id'] as string,
        clubId: person?.club_id ?? null,
        skillRating: null, // TODO T-1102: populate from HEMA Ratings
        seed: (r['seed'] as number | null) ?? (r['bib_number'] as number | null) ?? idx + 1,
      };
    });

    // 1. Snake seed
    const initial = snakeSeed(fighters, poolCount);

    // 2. Local search optimization
    const optimized = localSearch(initial, fighters, poolCount, settings, undefined, seed);

    // 3. Build cost report
    const costReport = buildCostReport(optimized, fighters, poolCount, settings);

    // 4. Group by pool
    const poolMap = new Map<number, string[]>();
    for (const a of optimized) {
      const existing = poolMap.get(a.poolIndex) ?? [];
      existing.push(a.registrationId);
      poolMap.set(a.poolIndex, existing);
    }

    const pools = Array.from({ length: poolCount }, (_, i) => ({
      name: `Pool ${String.fromCharCode(65 + i)}`, // Pool A, Pool B, ...
      registrationIds: poolMap.get(i) ?? [],
    }));

    this.logger.log(
      `Generated ${poolCount} pools for tournament ${tournamentId}: ` +
      `cost=${costReport.totalCost.toFixed(2)}, ` +
      `sameClub=${costReport.sameClubPairsPerPool.reduce((s: number, p: { count: number }) => s + p.count, 0)}, ` +
      `skillVar=${costReport.skillVariance.toFixed(3)}`,
    );

    return { pools, costReport };
  }
}
