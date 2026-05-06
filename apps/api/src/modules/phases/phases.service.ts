/**
 * PhasesService — orchestrates pool and bracket generation.
 * Persists phases, pools, pool_members, and matches to the DB.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  snakeSeed,
  localSearch,
  buildCostReport,
  bergerSchedule,
  singleElimBracket,
  type Fighter,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type {
  GenerateBracketDto,
  GeneratePoolsDto,
  UpdatePhaseVisibilityDto,
} from './dto/phases.dto';

@Injectable()
export class PhasesService {
  private readonly logger = new Logger(PhasesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional()
    private readonly hemaRatings?: HemaRatingsService,
    @Optional()
    private readonly orgs?: OrganizationsService,
  ) {}

  // ── Generate pools ────────────────────────────────────────────────────────

  /**
   * POST /events/:eventId/generate-pools
   *
   * Creates:
   *   - 1 Phase (type='pool')
   *   - N Pools
   *   - pool_members rows
   *   - Round-robin matches (Berger tables) for each pool
   *
   * Idempotent: returns 409 if a pool phase already exists, unless force=true.
   */
  async generatePools(tournamentId: string, dto: GeneratePoolsDto, force = false) {
    // Check for existing pool phase
    const { data: existing } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();

    if (existing && !force) {
      throw new ConflictException(
        'A pool phase already exists for this tournament. Use ?force=true to regenerate.',
      );
    }

    // Delete existing pool phase if force=true
    if (existing && force) {
      await this.supabase.service
        .from('phases')
        .delete()
        .eq('id', (existing as { id: string }).id);
    }

    // Fetch registrations
    const { data: regs, error: regsError } = await this.supabase.service
      .from('registrations')
      .select('id, seed, bib_number, persons(club_id), fighters(hema_ratings_id)')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);

    if (regsError) throw new BadRequestException(regsError.message);
    if (!regs || regs.length < 2) {
      throw new BadRequestException('Need at least 2 registered fighters to generate pools');
    }

    const fighterCount = regs.length;

    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('weapon')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    const tournamentWeapon = (tournament as { weapon?: string | null } | null)?.weapon ?? null;

    // Resolve pool count
    let poolCount: number;
    if (dto.poolCount !== undefined) {
      poolCount = dto.poolCount;
    } else {
      const targetSize = dto.targetSize ?? 8;
      poolCount = Math.max(1, Math.ceil(fighterCount / targetSize));
    }

    if (poolCount > fighterCount) {
      throw new BadRequestException(
        `Cannot create ${poolCount} pools with only ${fighterCount} fighters`,
      );
    }

    const hemaIds = Array.from(
      new Set(
        regs
          .map((reg) => {
            const r = reg as Record<string, unknown>;
            const fighter = r['fighters'] as { hema_ratings_id: string | null } | null;
            return fighter?.hema_ratings_id ?? null;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const weightedRatings =
      this.hemaRatings && tournamentWeapon
        ? await this.hemaRatings.resolveWeightedRatings(hemaIds, tournamentWeapon)
        : new Map<string, number>();

    // Map to Fighter type
    const fighters: Fighter[] = regs.map((reg, idx) => {
      const r = reg as Record<string, unknown>;
      const person = r['persons'] as { club_id: string | null } | null;
      const fighter = r['fighters'] as { hema_ratings_id: string | null } | null;
      const hemaRatingsId = fighter?.hema_ratings_id ?? null;
      return {
        registrationId: r['id'] as string,
        clubId: person?.club_id ?? null,
        skillRating: hemaRatingsId ? (weightedRatings.get(hemaRatingsId) ?? null) : null,
        seed: (r['seed'] as number | null) ?? (r['bib_number'] as number | null) ?? idx + 1,
      };
    });

    const settings = {
      enforceSchoolSeparation: dto.enforceSchoolSeparation ?? true,
      schoolSeparationStrictness: 'soft' as const,
      enforceSkillBalance: dto.enforceSkillBalance ?? true,
    };

    // Snake seed + local search
    const initial = snakeSeed(fighters, poolCount);
    const optimized = localSearch(
      initial,
      fighters,
      poolCount,
      settings,
      undefined,
      dto.seed ?? 42,
    );
    const costReport = buildCostReport(optimized, fighters, poolCount, settings);

    // Group by pool
    const poolMap = new Map<number, string[]>();
    for (const a of optimized) {
      const existing = poolMap.get(a.poolIndex) ?? [];
      existing.push(a.registrationId);
      poolMap.set(a.poolIndex, existing);
    }

    // Create phase
    const { data: phase, error: phaseError } = await this.supabase.service
      .from('phases')
      .insert({
        tournament_id: tournamentId,
        type: 'pool',
        sort_order: 1,
        status: 'pending',
        visibility_status: 'hidden',
        config_json: { poolCount, costReport },
      })
      .select('id')
      .single();

    if (phaseError || !phase)
      throw new BadRequestException(phaseError?.message ?? 'Failed to create phase');
    const phaseId = (phase as { id: string }).id;

    const createdPools: Array<{ id: string; name: string; matchCount: number }> = [];

    // Create pools + pool_members + matches
    for (let i = 0; i < poolCount; i++) {
      const poolName = `Pool ${String.fromCharCode(65 + i)}`;
      const registrationIds = poolMap.get(i) ?? [];

      const { data: pool, error: poolError } = await this.supabase.service
        .from('pools')
        .insert({ phase_id: phaseId, name: poolName, sort_order: i })
        .select('id')
        .single();

      if (poolError || !pool)
        throw new BadRequestException(poolError?.message ?? 'Failed to create pool');
      const poolId = (pool as { id: string }).id;

      // Insert pool_members
      await this.supabase.service.from('pool_members').insert(
        registrationIds.map((regId, seed) => ({
          pool_id: poolId,
          registration_id: regId,
          seed: seed + 1,
        })),
      );

      // Generate Berger matches
      const bergerMatches = bergerSchedule(registrationIds.length, {
        liceLabel: '1',
        poolLabel: String.fromCharCode(65 + i),
      });

      // Insert matches
      const matchInserts = bergerMatches.map((bm) => ({
        phase_id: phaseId,
        pool_id: poolId,
        lice_id: dto.liceId ?? null,
        red_registration_id: registrationIds[bm.homeIndex]!,
        blue_registration_id: registrationIds[bm.awayIndex]!,
        ruleset_code: 'TF_v1',
        ruleset_version: '1.0.0',
        match_number_label: bm.label,
        status: 'scheduled',
        red_score: 0,
        blue_score: 0,
      }));

      await this.supabase.service.from('matches').insert(matchInserts);

      createdPools.push({ id: poolId, name: poolName, matchCount: bergerMatches.length });
    }

    this.logger.log(`Generated ${poolCount} pools for tournament ${tournamentId}`);

    return {
      phaseId,
      poolCount,
      pools: createdPools,
      totalMatches: createdPools.reduce((s, p) => s + p.matchCount, 0),
      costReport,
    };
  }

  // ── Generate bracket ──────────────────────────────────────────────────────

  /**
   * POST /events/:eventId/generate-bracket
   *
   * Creates:
   *   - 1 Phase (type='single_elim')
   *   - bracket_slots rows (one per match slot)
   *
   * Idempotent: returns 409 if an elim phase already exists, unless force=true.
   */
  async generateBracket(tournamentId: string, dto: GenerateBracketDto, force = false) {
    // Check for existing elim phase
    const { data: existing } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'single_elim')
      .maybeSingle();

    if (existing && !force) {
      throw new ConflictException(
        'An elimination phase already exists. Use ?force=true to regenerate.',
      );
    }

    if (existing && force) {
      await this.supabase.service
        .from('phases')
        .delete()
        .eq('id', (existing as { id: string }).id);
    }

    // Determine qualify count
    let qualifyCount = dto.qualifyCount;

    if (!qualifyCount) {
      // Default: count all checked-in registrations
      const { data: regs } = await this.supabase.service
        .from('registrations')
        .select('id')
        .eq('tournament_id', tournamentId)
        .in('status', ['registered', 'checked_in', 'done']);

      qualifyCount = regs?.length ?? 0;
    }

    if (qualifyCount < 2) {
      throw new BadRequestException('Need at least 2 fighters to generate a bracket');
    }

    // Generate bracket structure
    const bracketOptions = dto.bracketSize !== undefined ? { bracketSize: dto.bracketSize } : {};
    const bracket = singleElimBracket(qualifyCount, bracketOptions);

    // Create phase
    const { data: phase, error: phaseError } = await this.supabase.service
      .from('phases')
      .insert({
        tournament_id: tournamentId,
        type: 'single_elim',
        sort_order: 2,
        status: 'pending',
        visibility_status: 'hidden',
        config_json: {
          bracketSize: bracket.bracketSize,
          fighterCount: bracket.fighterCount,
          byeCount: bracket.byeCount,
          rounds: bracket.rounds,
        },
      })
      .select('id')
      .single();

    if (phaseError || !phase)
      throw new BadRequestException(phaseError?.message ?? 'Failed to create phase');
    const phaseId = (phase as { id: string }).id;

    // Insert bracket slots
    const slotInserts = bracket.slots.map((slot) => ({
      phase_id: phaseId,
      round: slot.round,
      position: slot.position,
      source_a_type: slot.homeSeed !== null ? 'seed' : 'winner_of',
      source_a_ref: slot.homeSeed !== null ? String(slot.homeSeed) : slot.homeSource,
      source_b_type: slot.awaySeed !== null ? 'seed' : 'winner_of',
      source_b_ref: slot.awaySeed !== null ? String(slot.awaySeed) : slot.awaySource,
    }));

    await this.supabase.service.from('bracket_slots').insert(slotInserts);

    this.logger.log(
      `Generated ${bracket.rounds}-round bracket (size ${bracket.bracketSize}, ${bracket.byeCount} byes) for tournament ${tournamentId}`,
    );

    return {
      phaseId,
      bracketSize: bracket.bracketSize,
      fighterCount: bracket.fighterCount,
      byeCount: bracket.byeCount,
      rounds: bracket.rounds,
      totalSlots: bracket.slots.length,
    };
  }

  async updateVisibility(phaseId: string, actorUserId: string, dto: UpdatePhaseVisibilityDto) {
    if (!['hidden', 'published'].includes(dto.visibility)) {
      throw new BadRequestException('Invalid phase visibility');
    }

    const phase = await this.getPhaseForVisibility(phaseId);
    const tournament = phase['tournaments'] as Record<string, unknown> | null;
    const event = tournament?.['events'] as Record<string, unknown> | null;
    const orgId = event?.['organization_id'];
    if (!this.orgs || typeof orgId !== 'string') {
      throw new BadRequestException('Phase organization could not be resolved');
    }
    await this.orgs.assertOrgRole(orgId, actorUserId, 'admin');

    if (dto.visibility === 'hidden' && !dto.confirmStarted) {
      const started = await this.countStartedMatches(phaseId);
      if (started.startedMatchCount > 0 || started.completedMatchCount > 0) {
        throw new ConflictException({
          requiresConfirmation: true,
          ...started,
        });
      }
    }

    const patch =
      dto.visibility === 'published'
        ? {
            visibility_status: 'published',
            published_at: new Date().toISOString(),
            published_by_user_id: actorUserId,
          }
        : {
            visibility_status: 'hidden',
            published_at: null,
            published_by_user_id: null,
          };

    const { data, error } = await this.supabase.service
      .from('phases')
      .update(patch)
      .eq('id', phaseId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    await this.supabase.service.from('audit_log').insert({
      actor_user_id: actorUserId,
      action:
        dto.visibility === 'published'
          ? 'phase.visibility_published'
          : 'phase.visibility_unpublished',
      entity_type: 'phase',
      entity_id: phaseId,
      payload_json: {
        visibility: dto.visibility,
        phaseType: phase['type'],
        tournamentId: phase['tournament_id'],
      },
    });

    return data;
  }

  async listTournamentPools(tournamentId: string) {
    const { data: phase, error: phaseError } = await this.supabase.service
      .from('phases')
      .select('id, visibility_status')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();
    if (phaseError) throw new BadRequestException(phaseError.message);
    if (!phase) return { phaseId: null, visibility: 'hidden', pools: [] };

    const phaseId = (phase as { id: string }).id;
    const { data, error } = await this.supabase.service
      .from('pools')
      .select(
        'id, name, sort_order, pool_members(registration_id, seed, registrations(persons(given_name, family_name, clubs(name))))',
      )
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    return {
      phaseId,
      visibility: (phase as { visibility_status?: string }).visibility_status ?? 'hidden',
      pools: ((data ?? []) as Array<Record<string, unknown>>).map((pool) => ({
        id: pool['id'],
        name: pool['name'],
        members: ((pool['pool_members'] ?? []) as Array<Record<string, unknown>>).map((member) => {
          const registration = member['registrations'] as Record<string, unknown> | null;
          const person = registration?.['persons'] as Record<string, unknown> | null;
          const club = person?.['clubs'] as Record<string, unknown> | null;
          return {
            registrationId: member['registration_id'],
            personName: `${person?.['given_name'] ?? ''} ${person?.['family_name'] ?? ''}`.trim(),
            clubLabel: (club?.['name'] as string | null) ?? null,
            seed: member['seed'] ?? 0,
          };
        }),
      })),
    };
  }

  async getTournamentBracket(tournamentId: string) {
    const { data: phase, error: phaseError } = await this.supabase.service
      .from('phases')
      .select('id, visibility_status, config_json')
      .eq('tournament_id', tournamentId)
      .eq('type', 'single_elim')
      .maybeSingle();
    if (phaseError) throw new BadRequestException(phaseError.message);
    if (!phase) return null;

    const phaseId = (phase as { id: string }).id;
    const { data: slots, error } = await this.supabase.service
      .from('bracket_slots')
      .select('id, round, position')
      .eq('phase_id', phaseId)
      .order('round', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const config = ((phase as { config_json?: Record<string, unknown> }).config_json ?? {}) as {
      bracketSize?: number;
      fighterCount?: number;
      byeCount?: number;
      rounds?: number;
    };
    return {
      phaseId,
      visibility: (phase as { visibility_status?: string }).visibility_status ?? 'hidden',
      bracketSize: config.bracketSize ?? 0,
      fighterCount: config.fighterCount ?? 0,
      byeCount: config.byeCount ?? 0,
      rounds: config.rounds ?? 0,
      totalSlots: (slots ?? []).length,
      slots: slots ?? [],
    };
  }

  private async getPhaseForVisibility(phaseId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.service
      .from('phases')
      .select(
        'id, tournament_id, type, visibility_status, tournaments(event_id, events(organization_id))',
      )
      .eq('id', phaseId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Phase ${phaseId} not found`);
    return data as Record<string, unknown>;
  }

  private async countStartedMatches(phaseId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, status')
      .eq('phase_id', phaseId)
      .in('status', ['running', 'paused', 'completed']);

    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{ status: string }>;
    return {
      startedMatchCount: rows.filter((row) => row.status === 'running' || row.status === 'paused')
        .length,
      completedMatchCount: rows.filter((row) => row.status === 'completed').length,
    };
  }
}
