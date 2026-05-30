/**
 * apps/api/src/modules/phases/pool-generator.ts
 *
 * Pool generation service — orchestrates snake seeding + local search.
 * Calls the pure scheduling functions from @myclash/rulesets.
 *
 * Supports two configuration modes:
 *   - poolCount:    explicit number of pools (e.g. 4 pools)
 *   - targetSize:   target fighters per pool (e.g. 8 per pool)
 *
 * When targetSize is given, poolCount = ceil(fighters / targetSize).
 * The actual pool sizes are balanced within ±1 (hard constraint).
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  snakeSeed,
  localSearch,
  buildCostReport,
  computePoolSizes,
  type Fighter,
  type PoolAssignmentSettings,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';

export interface GeneratePoolsInput {
  tournamentId: string;

  /**
   * Exactly one of poolCount or targetSize must be provided.
   *
   * poolCount:   explicit number of pools (e.g. 4)
   * targetSize:  target fighters per pool (e.g. 8 → ceil(fighters/8) pools)
   *
   * If both are provided, poolCount takes precedence.
   * If neither is provided, defaults to targetSize=8.
   */
  poolCount?: number;
  targetSize?: number;

  settings: PoolAssignmentSettings;

  /** PRNG seed for determinism (default: 42) */
  seed?: number;
}

export interface GeneratePoolsResult {
  pools: Array<{
    name: string;
    registrationIds: string[];
    size: number;
  }>;
  poolCount: number;
  targetSize: number;
  actualSizes: number[];
  costReport: ReturnType<typeof buildCostReport>;
}

@Injectable()
export class PoolGeneratorService {
  private readonly logger = new Logger(PoolGeneratorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly hemaRatings: HemaRatingsService,
  ) {}

  async generatePools(input: GeneratePoolsInput): Promise<GeneratePoolsResult> {
    const { tournamentId, settings, seed = 42 } = input;

    // Fetch registrations with skill data
    const { data: regs, error } = await this.supabase.service
      .from('registrations')
      .select(
        // 0083 retired registrations.fighter_id; identity nests
        // through persons.global_person_id.
        `
        id, seed, bib_number,
        persons(club_id, global_persons(hema_ratings_id))
      `,
      )
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);

    if (error) throw new BadRequestException(error.message);
    if (!regs || regs.length === 0) {
      throw new BadRequestException('No registered fighters found for this tournament');
    }

    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('weapon')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tournamentError) throw new BadRequestException(tournamentError.message);
    const tournamentWeapon = (tournament as { weapon?: string | null } | null)?.weapon ?? null;

    const fighterCount = regs.length;

    // ── Resolve poolCount from input ────────────────────────────────────────
    let poolCount: number;
    let targetSize: number;

    if (input.poolCount !== undefined) {
      poolCount = input.poolCount;
      if (poolCount < 1) throw new BadRequestException('poolCount must be at least 1');
      if (poolCount > fighterCount) {
        throw new BadRequestException(
          `Cannot create ${poolCount} pools with only ${fighterCount} fighters`,
        );
      }
      targetSize = Math.ceil(fighterCount / poolCount);
    } else {
      targetSize = input.targetSize ?? 8;
      if (targetSize < 2) throw new BadRequestException('targetSize must be at least 2');
      poolCount = Math.max(1, Math.ceil(fighterCount / targetSize));
    }

    // Compute actual balanced pool sizes (within ±1)
    const actualSizes = computePoolSizes(fighterCount, poolCount);

    // Map to Fighter type for the scheduling algorithm
    const hemaIds = Array.from(
      new Set(
        regs
          .map((reg) => {
            const r = reg as Record<string, unknown>;
            const person = r['persons'] as {
              global_persons?: { hema_ratings_id: string | null } | null;
            } | null;
            return person?.global_persons?.hema_ratings_id ?? null;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const weightedRatings = await this.hemaRatings.resolveWeightedRatings(
      hemaIds,
      tournamentWeapon,
    );

    const fighters: Fighter[] = regs.map((reg, idx) => {
      const r = reg as Record<string, unknown>;
      const person = r['persons'] as {
        club_id: string | null;
        global_persons?: { hema_ratings_id: string | null } | null;
      } | null;
      const hemaRatingsId = person?.global_persons?.hema_ratings_id ?? null;
      return {
        registrationId: r['id'] as string,
        clubId: person?.club_id ?? null,
        skillRating: hemaRatingsId ? (weightedRatings.get(hemaRatingsId) ?? null) : null,
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

    const pools = Array.from({ length: poolCount }, (_, i) => {
      const registrationIds = poolMap.get(i) ?? [];
      return {
        name: `Pool ${i + 1}`, // Pool 1, Pool 2, ...
        registrationIds,
        size: registrationIds.length,
      };
    });

    this.logger.log(
      `Generated ${poolCount} pools (target size ${targetSize}) for tournament ${tournamentId}: ` +
        `sizes=[${actualSizes.join(',')}], ` +
        `cost=${costReport.totalCost.toFixed(2)}, ` +
        `sameClub=${costReport.sameClubPairsPerPool.reduce((s: number, p: { count: number }) => s + p.count, 0)}, ` +
        `skillVar=${costReport.skillVariance.toFixed(3)}`,
    );

    return { pools, poolCount, targetSize, actualSizes, costReport };
  }
}
