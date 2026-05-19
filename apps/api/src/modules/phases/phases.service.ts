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
  doubleElimBracket,
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
import type { BracketAdvanceService } from './bracket-advance.service';

@Injectable()
export class PhasesService {
  private readonly logger = new Logger(PhasesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional()
    private readonly hemaRatings?: HemaRatingsService,
    @Optional()
    private readonly orgs?: OrganizationsService,
    @Optional()
    private readonly bracketAdvance?: BracketAdvanceService,
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
      .select('id, seed, bib_number, persons(club_id), global_persons(hema_ratings_id)')
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
            const fighter = r['global_persons'] as { hema_ratings_id: string | null } | null;
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
      const fighter = r['global_persons'] as { hema_ratings_id: string | null } | null;
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
      const poolName = `Pool ${i + 1}`;
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
   *   - 1 Phase (type='single_elim' or 'double_elim')
   *   - bracket_slots rows (one per match slot)
   *   - Populates seed registrations and creates first-round matches
   *
   * Idempotent: returns 409 if an elim phase already exists, unless force=true.
   */
  async generateBracket(tournamentId: string, dto: GenerateBracketDto, force = false) {
    const phaseType =
      (dto as GenerateBracketDto & { phaseType?: string }).phaseType ?? 'single_elim';
    const isDoubleElim = phaseType === 'double_elim';

    // Check for existing elim phase
    const { data: existing } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .in('type', ['single_elim', 'double_elim'])
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

    // Load seeded registrations (sorted by seed / bib_number)
    const { data: seededRegs } = await this.supabase.service
      .from('registrations')
      .select('id, seed, bib_number')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in', 'done'])
      .order('seed', { ascending: true, nullsFirst: false });

    const registrationsBySeed = new Map<number, string>();
    ((seededRegs ?? []) as Array<{ id: string; seed: number | null; bib_number: number | null }>)
      .slice(0, qualifyCount)
      .forEach((reg, idx) => {
        const seedNum = reg.seed ?? reg.bib_number ?? idx + 1;
        registrationsBySeed.set(seedNum, reg.id);
      });

    // Generate bracket structure
    const bracketOptions = dto.bracketSize !== undefined ? { bracketSize: dto.bracketSize } : {};

    let configJson: Record<string, unknown>;
    let slotInserts: Array<Record<string, unknown>>;
    let totalSlots: number;
    let summaryRounds: number;

    if (isDoubleElim) {
      let bracket: ReturnType<typeof doubleElimBracket>;
      try {
        bracket = doubleElimBracket(qualifyCount, bracketOptions);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid bracket');
      }
      configJson = {
        bracketSize: bracket.bracketSize,
        mainBracketSize: bracket.bracketSize,
        fighterCount: bracket.fighterCount,
        byeCount: bracket.byeCount,
        byeSeedCount: bracket.byeCount,
        playInMatchCount: 0,
        hasPlayInRound: false,
        wbRounds: bracket.wbRounds,
        lbRounds: bracket.lbRounds,
        autoAdvance: true,
      };
      slotInserts = bracket.slots.map((slot) => {
        const regA =
          slot.homeSeed != null ? (registrationsBySeed.get(slot.homeSeed) ?? null) : null;
        const regB =
          slot.awaySeed != null ? (registrationsBySeed.get(slot.awaySeed) ?? null) : null;
        return {
          phase_id: '__PHASE_ID__',
          round: slot.round,
          position: slot.position,
          source_a_type: slot.sourceAType,
          source_a_ref: slot.homeSource,
          source_b_type: slot.sourceBType,
          source_b_ref: slot.awaySource,
          registration_a_id: regA,
          registration_b_id: regB,
        };
      });
      totalSlots = bracket.slots.length;
      summaryRounds = bracket.wbRounds + bracket.lbRounds + 1;
    } else {
      let bracket: ReturnType<typeof singleElimBracket>;
      try {
        bracket = singleElimBracket(qualifyCount, bracketOptions);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid bracket');
      }
      configJson = {
        bracketSize: bracket.bracketSize,
        mainBracketSize: bracket.mainBracketSize,
        fighterCount: bracket.fighterCount,
        byeCount: bracket.byeCount,
        byeSeedCount: bracket.byeSeedCount,
        playInMatchCount: bracket.playInMatchCount,
        hasPlayInRound: bracket.hasPlayInRound,
        rounds: bracket.rounds,
        autoAdvance: true,
      };
      slotInserts = bracket.slots.map((slot) => {
        const regA =
          slot.homeSeed != null ? (registrationsBySeed.get(slot.homeSeed) ?? null) : null;
        const regB =
          slot.awaySeed != null ? (registrationsBySeed.get(slot.awaySeed) ?? null) : null;
        return {
          phase_id: '__PHASE_ID__',
          round: slot.round,
          position: slot.position,
          source_a_type: slot.sourceAType,
          source_a_ref: slot.homeSource,
          source_b_type: slot.sourceBType,
          source_b_ref: slot.awaySource,
          registration_a_id: regA,
          registration_b_id: regB,
        };
      });
      totalSlots = bracket.slots.length;
      summaryRounds = (configJson['rounds'] as number) ?? 0;
    }

    // Create phase
    const { data: phase, error: phaseError } = await this.supabase.service
      .from('phases')
      .insert({
        tournament_id: tournamentId,
        type: phaseType,
        sort_order: 2,
        status: 'pending',
        visibility_status: 'hidden',
        config_json: configJson,
      })
      .select('id')
      .single();

    if (phaseError || !phase)
      throw new BadRequestException(phaseError?.message ?? 'Failed to create phase');
    const phaseId = (phase as { id: string }).id;

    // Insert bracket slots with real phase ID
    const finalInserts = slotInserts.map((s) => ({ ...s, phase_id: phaseId }));
    const { data: insertedSlots, error: slotInsertError } = await this.supabase.service
      .from('bracket_slots')
      .insert(finalInserts)
      .select('id, phase_id, source_b_type, registration_a_id, registration_b_id');

    if (slotInsertError) {
      throw new BadRequestException(slotInsertError.message);
    }

    await this.createInitialBracketMatches(insertedSlots ?? []);

    // Advance bye slots immediately
    if (this.bracketAdvance) {
      await this.bracketAdvance.advanceByeSlots(phaseId);
    }

    this.logger.log(
      `Generated ${phaseType} bracket (size ${(configJson['bracketSize'] as number) ?? qualifyCount}, ${(configJson['byeCount'] as number) ?? 0} byes) for tournament ${tournamentId}`,
    );

    return {
      phaseId,
      phaseType,
      bracketSize: (configJson['bracketSize'] as number) ?? qualifyCount,
      fighterCount: qualifyCount,
      byeCount: (configJson['byeCount'] as number) ?? 0,
      byeSeedCount: (configJson['byeSeedCount'] as number) ?? 0,
      playInMatchCount: (configJson['playInMatchCount'] as number) ?? 0,
      hasPlayInRound: (configJson['hasPlayInRound'] as boolean) ?? false,
      rounds: summaryRounds,
      totalSlots,
    };
  }

  private async createInitialBracketMatches(insertedSlots: unknown[]): Promise<void> {
    const readySlots = (insertedSlots as Array<Record<string, unknown>>).filter(
      (slot) =>
        slot['source_b_type'] !== 'bye' &&
        typeof slot['id'] === 'string' &&
        typeof slot['phase_id'] === 'string' &&
        typeof slot['registration_a_id'] === 'string' &&
        typeof slot['registration_b_id'] === 'string',
    );

    if (readySlots.length === 0) return;

    const matchInserts = readySlots.map((slot) => ({
      phase_id: slot['phase_id'],
      bracket_slot_id: slot['id'],
      red_registration_id: slot['registration_a_id'],
      blue_registration_id: slot['registration_b_id'],
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      status: 'scheduled',
      red_score: 0,
      blue_score: 0,
    }));

    const { error } = await this.supabase.service.from('matches').insert(matchInserts);
    if (error) throw new BadRequestException(error.message);
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
        'id, name, sort_order, pool_members(registration_id, seed, registrations(persons(given_name, family_name, clubs(name)), global_persons(hema_ratings_id)))',
      )
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const weightedRatings = await this.weightedRatingsForTournament(tournamentId);

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
          const fighter = registration?.['global_persons'] as Record<string, unknown> | null;
          const hemaRatingsId = (fighter?.['hema_ratings_id'] as string | null) ?? null;
          return {
            registrationId: member['registration_id'],
            personName: `${person?.['given_name'] ?? ''} ${person?.['family_name'] ?? ''}`.trim(),
            clubLabel: (club?.['name'] as string | null) ?? null,
            seed: member['seed'] ?? 0,
            hemaWeightedRating:
              hemaRatingsId && weightedRatings.has(hemaRatingsId)
                ? (weightedRatings.get(hemaRatingsId) ?? null)
                : null,
          };
        }),
      })),
    };
  }

  private async weightedRatingsForTournament(tournamentId: string): Promise<Map<string, number>> {
    if (!this.hemaRatings) return new Map<string, number>();
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('weapon')
      .eq('id', tournamentId)
      .maybeSingle();
    const weapon = (tournament as { weapon?: string | null } | null)?.weapon ?? null;
    if (!weapon) return new Map<string, number>();
    const { data: regs } = await this.supabase.service
      .from('registrations')
      .select('global_persons(hema_ratings_id)')
      .eq('tournament_id', tournamentId);
    const hemaIds = Array.from(
      new Set(
        ((regs ?? []) as Array<Record<string, unknown>>)
          .map((reg) => {
            const fighter = reg['global_persons'] as { hema_ratings_id: string | null } | null;
            return fighter?.hema_ratings_id ?? null;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (hemaIds.length === 0) return new Map<string, number>();
    return this.hemaRatings.resolveWeightedRatings(hemaIds, weapon);
  }

  async getTournamentBracket(tournamentId: string) {
    const { data: phase, error: phaseError } = await this.supabase.service
      .from('phases')
      .select('id, type, visibility_status, config_json')
      .eq('tournament_id', tournamentId)
      .in('type', ['single_elim', 'double_elim'])
      .maybeSingle();
    if (phaseError) throw new BadRequestException(phaseError.message);
    if (!phase) return null;

    const phaseId = (phase as { id: string }).id;
    const phaseType = (phase as { type: string }).type;
    const { data: slots, error } = await this.supabase.service
      .from('bracket_slots')
      .select(
        'id, round, position, source_a_type, source_a_ref, source_b_type, source_b_ref, registration_a_id, registration_b_id',
      )
      .eq('phase_id', phaseId)
      .order('round', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const config = ((phase as { config_json?: Record<string, unknown> }).config_json ?? {}) as {
      bracketSize?: number;
      mainBracketSize?: number;
      fighterCount?: number;
      byeCount?: number;
      byeSeedCount?: number;
      playInMatchCount?: number;
      hasPlayInRound?: boolean;
      rounds?: number;
      wbRounds?: number;
      lbRounds?: number;
      autoAdvance?: boolean;
    };
    return {
      phaseId,
      phaseType,
      visibility: (phase as { visibility_status?: string }).visibility_status ?? 'hidden',
      bracketSize: config.bracketSize ?? 0,
      mainBracketSize: config.mainBracketSize ?? config.bracketSize ?? 0,
      fighterCount: config.fighterCount ?? 0,
      byeCount: config.byeCount ?? 0,
      byeSeedCount: config.byeSeedCount ?? 0,
      playInMatchCount: config.playInMatchCount ?? 0,
      hasPlayInRound: config.hasPlayInRound ?? false,
      rounds: config.rounds ?? 0,
      wbRounds: config.wbRounds ?? null,
      lbRounds: config.lbRounds ?? null,
      autoAdvance: config.autoAdvance ?? true,
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

  // ── Pool edit endpoints ──────────────────────────────────────────────────

  private async getPoolContext(poolId: string) {
    const { data, error } = await this.supabase.service
      .from('pools')
      .select(
        'id, name, phase_id, sort_order, phases!inner(id, tournament_id, tournaments!inner(event_id, weapon, events!inner(organization_id)))',
      )
      .eq('id', poolId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Pool ${poolId} not found`);
    const row = data as Record<string, unknown>;
    const phase = row['phases'] as Record<string, unknown>;
    const tournament = phase['tournaments'] as Record<string, unknown>;
    const event = tournament['events'] as Record<string, unknown>;
    return {
      poolId: row['id'] as string,
      poolName: row['name'] as string,
      phaseId: phase['id'] as string,
      tournamentId: (tournament['tournament_id'] as string) ?? (phase['tournament_id'] as string),
      eventId: tournament['event_id'] as string,
      weapon: (tournament['weapon'] as string | null) ?? null,
      organizationId: event['organization_id'] as string,
    };
  }

  private async assertPoolEditable(poolId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, status', { count: 'exact', head: false })
      .eq('pool_id', poolId)
      .in('status', ['running', 'paused', 'completed']);
    if (error) throw new BadRequestException(error.message);
    if ((data ?? []).length > 0) {
      throw new ConflictException({
        message: 'Pool is locked because scoring has started in at least one match.',
        poolId,
        startedMatches: (data ?? []).length,
      });
    }
  }

  private async assertPoolEditAuth(poolId: string, userId: string) {
    const ctx = await this.getPoolContext(poolId);
    if (!this.orgs) {
      throw new BadRequestException('Organizations service not wired');
    }
    await this.orgs.assertOrgRole(ctx.organizationId, userId, 'admin');
    return ctx;
  }

  async renamePool(poolId: string, name: string, userId: string) {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('Pool name is required');
    await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    const { data, error } = await this.supabase.service
      .from('pools')
      .update({ name: trimmed })
      .eq('id', poolId)
      .select('id, name')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async addPoolMember(poolId: string, registrationId: string, userId: string) {
    const dst = await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    // Find any existing membership for this registration in pools of the same tournament.
    const { data: existing } = await this.supabase.service
      .from('pool_members')
      .select('id, pool_id, pools!inner(phase_id, phases!inner(tournament_id))')
      .eq('registration_id', registrationId);
    const stale = ((existing ?? []) as Array<Record<string, unknown>>).filter((row) => {
      const pool = row['pools'] as Record<string, unknown>;
      const phase = pool['phases'] as Record<string, unknown>;
      return (phase['tournament_id'] as string) === dst.tournamentId;
    });

    const sourcePoolIds = new Set<string>();
    for (const row of stale) {
      const fromPoolId = row['pool_id'] as string;
      if (fromPoolId === poolId) {
        // Already in destination; no-op
        return { poolId, registrationId, moved: false };
      }
      sourcePoolIds.add(fromPoolId);
      await this.assertPoolEditable(fromPoolId);
    }

    // Remove any stale membership rows for this registration
    if (stale.length > 0) {
      const { error: delErr } = await this.supabase.service
        .from('pool_members')
        .delete()
        .eq('registration_id', registrationId)
        .in(
          'pool_id',
          stale.map((row) => row['pool_id'] as string),
        );
      if (delErr) throw new BadRequestException(delErr.message);
    }

    // Append at the end (next seed in destination)
    const { data: dstMembers } = await this.supabase.service
      .from('pool_members')
      .select('seed')
      .eq('pool_id', poolId);
    const nextSeed =
      ((dstMembers ?? []) as Array<{ seed: number }>).reduce(
        (max, m) => Math.max(max, m.seed ?? 0),
        0,
      ) + 1;

    const { error: insErr } = await this.supabase.service.from('pool_members').insert({
      pool_id: poolId,
      registration_id: registrationId,
      seed: nextSeed,
    });
    if (insErr) throw new BadRequestException(insErr.message);

    await this.regeneratePoolMatches(poolId);
    for (const sourcePoolId of sourcePoolIds) {
      await this.regeneratePoolMatches(sourcePoolId);
    }
    return { poolId, registrationId, moved: true };
  }

  async removePoolMember(poolId: string, registrationId: string, userId: string) {
    await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    const { error } = await this.supabase.service
      .from('pool_members')
      .delete()
      .eq('pool_id', poolId)
      .eq('registration_id', registrationId);
    if (error) throw new BadRequestException(error.message);

    await this.regeneratePoolMatches(poolId);
    return { poolId, registrationId };
  }

  private async regeneratePoolMatches(poolId: string) {
    const ctx = await this.getPoolContext(poolId);

    // Wipe existing matches for the pool
    const { error: delErr } = await this.supabase.service
      .from('matches')
      .delete()
      .eq('pool_id', poolId);
    if (delErr) throw new BadRequestException(delErr.message);

    // Resequence seeds 1..N in current order
    const { data: members } = await this.supabase.service
      .from('pool_members')
      .select('id, registration_id, seed')
      .eq('pool_id', poolId)
      .order('seed', { ascending: true });
    const ordered = (members ?? []) as Array<{ id: string; registration_id: string; seed: number }>;
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i]!.seed !== i + 1) {
        await this.supabase.service
          .from('pool_members')
          .update({ seed: i + 1 })
          .eq('id', ordered[i]!.id);
      }
    }
    const registrationIds = ordered.map((m) => m.registration_id);
    if (registrationIds.length < 2) return; // no matches possible

    const poolNumberLabel =
      typeof ctx.poolName === 'string' ? ctx.poolName.replace(/\D+/gu, '') || '1' : '1';
    const bergerMatches = bergerSchedule(registrationIds.length, {
      liceLabel: '1',
      poolLabel: poolNumberLabel,
    });
    const matchInserts = bergerMatches.map((bm) => ({
      phase_id: ctx.phaseId,
      pool_id: poolId,
      red_registration_id: registrationIds[bm.homeIndex]!,
      blue_registration_id: registrationIds[bm.awayIndex]!,
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      match_number_label: bm.label,
      status: 'scheduled',
      red_score: 0,
      blue_score: 0,
    }));
    if (matchInserts.length > 0) {
      const { error: insErr } = await this.supabase.service.from('matches').insert(matchInserts);
      if (insErr) throw new BadRequestException(insErr.message);
    }
  }

  async listUnassignedFighters(tournamentId: string) {
    // 1. Fetch all confirmed registrations for the tournament
    const { data: regs, error: regErr } = await this.supabase.service
      .from('registrations')
      .select('id, persons(given_name, family_name, clubs(name)), global_persons(hema_ratings_id)')
      .eq('tournament_id', tournamentId);
    if (regErr) throw new BadRequestException(regErr.message);

    // 2. Fetch all pool_members for this tournament's pools
    const { data: pooled, error: poolErr } = await this.supabase.service
      .from('pool_members')
      .select('registration_id, pools!inner(phase_id, phases!inner(tournament_id))')
      .eq('pools.phases.tournament_id', tournamentId);
    if (poolErr) throw new BadRequestException(poolErr.message);
    const assignedIds = new Set(
      ((pooled ?? []) as Array<Record<string, unknown>>).map(
        (row) => row['registration_id'] as string,
      ),
    );

    const weightedRatings = await this.weightedRatingsForTournament(tournamentId);

    return ((regs ?? []) as Array<Record<string, unknown>>)
      .filter((reg) => !assignedIds.has(reg['id'] as string))
      .map((reg) => {
        const person = reg['persons'] as Record<string, unknown> | null;
        const club = person?.['clubs'] as Record<string, unknown> | null;
        const fighter = reg['global_persons'] as Record<string, unknown> | null;
        const hemaRatingsId = (fighter?.['hema_ratings_id'] as string | null) ?? null;
        return {
          registrationId: reg['id'] as string,
          personName: `${person?.['given_name'] ?? ''} ${person?.['family_name'] ?? ''}`.trim(),
          clubLabel: (club?.['name'] as string | null) ?? null,
          hemaWeightedRating:
            hemaRatingsId && weightedRatings.has(hemaRatingsId)
              ? (weightedRatings.get(hemaRatingsId) ?? null)
              : null,
        };
      });
  }
}
