import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value import, not `import type`: Nest DI metadata.
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import { rankByRating, rankRandom, type SeedableRegistration } from '../phases/r1-ranking';
import { SWISS_DEFAULTS, type GenerateSwissDto } from './dto/swiss.dto';
import type { RankedRegistration } from '../phases/bracket-r1-seeding';

export interface RatingCoverage {
  rated: number;
  total: number;
  percent: number;
}

export interface SwissSeeding {
  /** Registration ids in round-1 rank order. */
  order: string[];
  /** Persisted when the draw was random, so it can be replayed exactly. */
  seed: number | null;
  coverage: RatingCoverage | null;
  /**
   * The phase the order was actually read from, for `by-pool-rank`.
   *
   * Resolved here rather than left to the caller because `rankFromCompletedPools`
   * is what picks it when the request does not name one — and the config schema
   * REQUIRES it, so a null here writes a phase whose own config cannot be parsed
   * back. It is also the honest audit trail: a three-stage tournament should
   * record which pool phase its Swiss draw came from.
   */
  sourcePhaseId: string | null;
}

/**
 * Round-1 order for a Swiss phase.
 *
 * Split from SwissService because "how the field is ordered before a single
 * bout" is its own question with three independent answers, and it is the part
 * that talks to HEMA Ratings and to a previous phase's standings. The lifecycle
 * service just asks for an order.
 *
 * The rule every strategy shares: REFUSE rather than degrade. A draw that
 * silently falls back to registration order is worse than an error — it looks
 * like a seeded draw, it gets defended as one, and nobody finds out until
 * somebody checks. `phases.service` set that precedent and this follows it.
 */
@Injectable()
export class SwissSeedingService {
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly hemaRatings?: HemaRatingsService,
  ) {}

  async resolveSeeding(
    tournamentId: string,
    registrations: SeedableRegistration[],
    dto: GenerateSwissDto,
  ): Promise<SwissSeeding> {
    const strategy = dto.seedingStrategy ?? SWISS_DEFAULTS.seedingStrategy;

    if (strategy === 'by-pool-rank') {
      const { order, sourcePhaseId } = await this.rankFromCompletedPools(
        tournamentId,
        dto.sourcePhaseId ?? null,
      );
      return { order, seed: null, coverage: null, sourcePhaseId };
    }

    if (strategy === 'by-rating') {
      const { ratings, coverage } = await this.ratingsFor(tournamentId, registrations);
      const threshold = dto.minRatingCoveragePercent ?? 0;
      if (coverage.percent < threshold) {
        throw new BadRequestException(
          `Only ${coverage.rated} of ${coverage.total} fighters (${coverage.percent}%) have a HEMA rating, below the ${threshold}% required. Seed by random draw instead, or lower the threshold.`,
        );
      }
      return {
        order: idsOf(rankByRating(registrations, ratings)),
        seed: null,
        coverage,
        sourcePhaseId: null,
      };
    }

    // Random: the seed is persisted so the draw can be replayed exactly.
    const seed = dto.seedingRandomSeed ?? Math.floor(Math.random() * 2_147_483_647);
    return {
      order: idsOf(rankRandom(registrations, seed)),
      seed,
      coverage: null,
      sourcePhaseId: null,
    };
  }

  async ratingsFor(
    tournamentId: string,
    registrations: SeedableRegistration[],
  ): Promise<{ ratings: Map<string, number>; coverage: RatingCoverage }> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('weapon')
      .eq('id', tournamentId)
      .maybeSingle();
    const weapon = (data as { weapon?: string | null } | null)?.weapon ?? null;

    const hemaIds = registrations
      .map((r) => r.hemaRatingsId)
      .filter((id): id is string => Boolean(id));

    // A tournament with no weapon yields an empty rating map, which the
    // coverage check below catches as 0% rather than seeding everyone equal.
    const ratings =
      this.hemaRatings && weapon
        ? await this.hemaRatings.resolveWeightedRatings(hemaIds, weapon)
        : new Map<string, number>();

    const rated = registrations.filter(
      (r) => r.hemaRatingsId && ratings.has(r.hemaRatingsId),
    ).length;
    const total = registrations.length;
    return {
      ratings,
      coverage: { rated, total, percent: total === 0 ? 0 : Math.round((rated / total) * 100) },
    };
  }

  /**
   * Cross-pool ranking from a COMPLETED pool phase, refusing anything less.
   *
   * Returns the phase it read alongside the order: when the request does not
   * name one this is the only place that knows which it was, and the config
   * schema requires it.
   */
  async rankFromCompletedPools(
    tournamentId: string,
    sourcePhaseId: string | null,
  ): Promise<{ order: string[]; sourcePhaseId: string }> {
    const query = this.supabase.service
      .from('phases')
      .select('id, type, status')
      .eq('tournament_id', tournamentId);
    const { data } = sourcePhaseId
      ? await query.eq('id', sourcePhaseId)
      : await query.eq('type', 'pool');

    const phase = ((data ?? []) as Array<{ id: string; type: string; status: string }>)[0];
    if (!phase) {
      throw new BadRequestException(
        'by-pool-rank seeding needs a pool phase on this tournament; none was found.',
      );
    }

    const { data: matches } = await this.supabase.service
      .from('matches')
      .select('id, status')
      .eq('phase_id', phase.id);
    const rows = (matches ?? []) as Array<{ status: string }>;
    if (rows.length === 0 || rows.some((m) => m.status !== 'completed')) {
      throw new BadRequestException(
        'by-pool-rank seeding needs the pool phase to be complete; some bouts are still open.',
      );
    }

    const { data: members } = await this.supabase.service
      .from('pool_members')
      .select('registration_id, seed, pools!inner(sort_order, phase_id)')
      .eq('pools.phase_id', phase.id);

    // Snake across pools: pool A #1, pool B #1, … then the #2s. Reuses the
    // shape bracket seeding already uses so the two agree on what "pool rank"
    // means.
    return { order: snakeAcrossPools(members ?? []), sourcePhaseId: phase.id };
  }

  async loadRegistrations(tournamentId: string): Promise<SeedableRegistration[]> {
    const { data, error } = await this.supabase.service
      .from('registrations')
      // persons.global_person_id is the route to global_persons; 0083 retired
      // registrations.fighter_id.
      .select('id, seed, bib_number, persons(club_id, global_persons(hema_ratings_id))')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);
    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const person = row['persons'] as { global_persons?: { hema_ratings_id?: string } } | null;
      return {
        id: row['id'] as string,
        seed: (row['seed'] as number | null) ?? null,
        bibNumber: (row['bib_number'] as number | null) ?? null,
        hemaRatingsId: person?.global_persons?.hema_ratings_id ?? null,
      };
    });
  }
}

const idsOf = (ranked: RankedRegistration[]): string[] =>
  [...ranked].sort((a, b) => a.rank - b.rank).map((r) => r.registrationId);

/**
 * Snake the pool members into one list: every pool's #1, then every pool's #2, …
 *
 * Ties on seed break on the pool's own `sort_order`, so the order is stable
 * across runs rather than dependent on however PostgREST returned the rows.
 */
function snakeAcrossPools(members: unknown[]): string[] {
  return (members as Array<Record<string, unknown>>)
    .map((row) => {
      const pool = row['pools'] as { sort_order?: number } | null;
      return {
        registrationId: row['registration_id'] as string,
        poolOrder: pool?.sort_order ?? 0,
        seed: (row['seed'] as number | null) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.seed - b.seed || a.poolOrder - b.poolOrder)
    .map((row) => row.registrationId);
}
