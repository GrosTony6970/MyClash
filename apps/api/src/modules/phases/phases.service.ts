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
  NotImplementedException,
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
import { SettingsService } from '../referees/settings.service';
import type {
  GenerateBracketDto,
  GeneratePoolsDto,
  UpdatePhaseVisibilityDto,
} from './dto/phases.dto';
import type { EditBracketConfigDto } from './dto/edit-bracket-config.dto';
import type { ReseedBracketDto } from './dto/reseed-bracket.dto';
import type { PopulateBracketDto } from './dto/populate-bracket.dto';
// Value import (not `import type`): NestJS DI dependency. A type-only import is
// erased at runtime so the @Optional() param silently resolves to `undefined`.
import { BracketAdvanceService } from './bracket-advance.service';
import { buildRoundCode } from '../matches/round-code.helper';
import { distributePoolMatches, rotateLicesFrom } from './pool-auto-distribute';
import { computePoolReschedule } from './pool-reschedule';
import { poolMatchSortKey } from './pool-match-sort';
import {
  buildCrossPoolSnakeRanking,
  buildR1SeedingPlan,
  parseSeed,
  type RankedRegistration,
} from './bracket-r1-seeding';
// Value import (not `import type`): NestJS DI dependency. Type-only erases the
// runtime metadata, so poolStandings resolved to `undefined` — which made
// computePoolGate vacuously "complete" and populateBracket fall back to
// registration-seed instead of seeding from pool standings.
import { PoolStandingsService } from '../pool-standings/pool-standings.service';

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
    @Optional()
    private readonly settingsService?: SettingsService,
    @Optional()
    private readonly poolStandings?: PoolStandingsService,
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
    this.logger.log(
      `generatePools: tournament=${tournamentId} dto=${JSON.stringify(dto)} force=${force}`,
    );
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
      .select(
        // Walk persons.global_person_id to reach global_persons —
        // registrations.fighter_id was retired in 0083.
        'id, seed, bib_number, persons(club_id, global_persons(hema_ratings_id))',
      )
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);

    if (regsError) throw new BadRequestException(regsError.message);
    const allRegs = regs ?? [];
    const fighterCount = allRegs.length;

    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('weapon, event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    const tournamentWeapon = (tournament as { weapon?: string | null } | null)?.weapon ?? null;
    const eventId = (tournament as { event_id?: string | null } | null)?.event_id ?? null;

    // Merge any referee constraint overrides from the DTO into pool_assignment_settings
    // and persist them so they survive across regenerations.
    if (this.settingsService && eventId) {
      const anyRefereeOverride =
        dto.enforceRefereeNoBackToBack !== undefined ||
        dto.refereeRestMinSlots !== undefined ||
        dto.enforceDedicatedRefereeRest !== undefined ||
        dto.preferHighRatedReferees !== undefined;
      if (anyRefereeOverride) {
        await this.settingsService.upsertSettings(eventId, tournamentId, {
          ...(dto.enforceRefereeNoBackToBack !== undefined && {
            enforceRefereeNoBackToBack: dto.enforceRefereeNoBackToBack,
          }),
          ...(dto.refereeRestMinSlots !== undefined && {
            refereeRestMinSlots: dto.refereeRestMinSlots,
          }),
          ...(dto.enforceDedicatedRefereeRest !== undefined && {
            enforceDedicatedRefereeRest: dto.enforceDedicatedRefereeRest,
          }),
          // enforceFighterRefereeNoOverlap is a HARD constraint (always true) and excluded from upsert
          ...(dto.preferHighRatedReferees !== undefined && {
            ratingBasedOrdering: dto.preferHighRatedReferees,
          }),
        });
      }
    }

    // Resolve pool count. When there are zero fighters we still need a sensible
    // default so the operator can stand up the layout before any registrations
    // exist — fall back to the explicit `poolCount` or 1.
    let poolCount: number;
    if (dto.poolCount !== undefined) {
      poolCount = dto.poolCount;
    } else if (fighterCount === 0) {
      poolCount = 1;
    } else {
      const targetSize = dto.targetSize ?? 8;
      poolCount = Math.max(1, Math.ceil(fighterCount / targetSize));
      // Round-robin requires ≥ 2 fighters per pool. With a small targetSize
      // and an odd fighterCount, the ceil rounds up and snakeSeed leaves the
      // last pool with one fighter — bergerSchedule(1) throws and the whole
      // request 500s (prod incident 2026-05-29). Cap poolCount at
      // floor(N/2): the operator gets a slightly larger last pool instead of
      // a meaningless singleton.
      const maxRoundRobinPools = Math.floor(fighterCount / 2);
      if (maxRoundRobinPools >= 1 && poolCount > maxRoundRobinPools) {
        poolCount = maxRoundRobinPools;
      }
    }

    // Still guard against an obviously-impossible request (e.g. 5 pools for
    // 3 fighters would leave silent gaps). Allowed when fighterCount is 0
    // because every pool is intentionally empty.
    if (fighterCount > 0 && poolCount > fighterCount) {
      throw new BadRequestException(
        `Cannot create ${poolCount} pools with only ${fighterCount} fighters`,
      );
    }

    // Algorithm phase. When no fighters are registered we skip seeding +
    // local search entirely and just stand up the empty pool layout.
    const poolMap = new Map<number, string[]>();
    let costReport: unknown = null;

    if (fighterCount > 0) {
      const hemaIds = Array.from(
        new Set(
          allRegs
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
      const weightedRatings =
        this.hemaRatings && tournamentWeapon
          ? await this.hemaRatings.resolveWeightedRatings(hemaIds, tournamentWeapon)
          : new Map<string, number>();

      const fighters: Fighter[] = allRegs.map((reg, idx) => {
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

      const settings = {
        enforceSchoolSeparation: dto.enforceSchoolSeparation ?? true,
        schoolSeparationStrictness: 'soft' as const,
        enforceSkillBalance: dto.enforceSkillBalance ?? true,
      };

      const initial = snakeSeed(fighters, poolCount);
      const optimized = localSearch(
        initial,
        fighters,
        poolCount,
        settings,
        undefined,
        dto.seed ?? 42,
      );
      costReport = buildCostReport(optimized, fighters, poolCount, settings);

      for (const a of optimized) {
        const existing = poolMap.get(a.poolIndex) ?? [];
        existing.push(a.registrationId);
        poolMap.set(a.poolIndex, existing);
      }
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

      // Insert pool_members — only when this pool has fighters. PostgREST
      // doesn't accept empty array inserts (used to surface as an opaque 500).
      let bergerMatches: ReturnType<typeof bergerSchedule> = [];
      if (registrationIds.length > 0) {
        const memberRes = await this.supabase.service.from('pool_members').insert(
          registrationIds.map((regId, seed) => ({
            pool_id: poolId,
            registration_id: regId,
            seed: seed + 1,
          })),
        );
        if (memberRes.error)
          throw new BadRequestException(memberRes.error.message ?? 'Failed to insert pool members');

        // bergerSchedule throws for n < 2 ("Need at least 2 players for a
        // round-robin"). The poolCount cap above prevents this on the
        // auto-distribution path, but an explicit dto.poolCount can still
        // land us here when fighterCount === 1. Skip match generation; the
        // pool + lone pool_member row stand on their own.
        if (registrationIds.length >= 2) {
          bergerMatches = bergerSchedule(registrationIds.length, {
            liceLabel: '1',
            poolLabel: String.fromCharCode(65 + i),
          });

          if (bergerMatches.length > 0) {
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
            const matchRes = await this.supabase.service.from('matches').insert(matchInserts);
            if (matchRes.error)
              throw new BadRequestException(matchRes.error.message ?? 'Failed to insert matches');
          }
        }
      }

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
    const phaseType = dto.phaseType ?? 'single_elim';
    const isDoubleElim = phaseType === 'double_elim';
    const seedingStrategy = dto.seedingStrategy ?? 'snake';
    if (seedingStrategy !== 'snake') {
      throw new NotImplementedException(
        `Seeding strategy "${seedingStrategy}" is not yet implemented`,
      );
    }
    const grandFinalReset = isDoubleElim ? (dto.grandFinalReset ?? false) : false;

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

    // R1 registration seeding is intentionally NOT applied here.
    // generateBracket creates the bracket STRUCTURE only; the
    // operator triggers seeding via POST /populate-bracket once
    // pools are finished (or, for no-pool tournaments, anytime).
    // See populateBracket() below.

    // Generate bracket structure
    const bracketOptions = dto.bracketSize !== undefined ? { bracketSize: dto.bracketSize } : {};

    let configJson: Record<string, unknown>;
    let slotInserts: Array<Record<string, unknown>>;

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
        grandFinalReset,
        seedingStrategy,
      };
      slotInserts = bracket.slots.map((slot) => ({
        phase_id: '__PHASE_ID__',
        round: slot.round,
        position: slot.position,
        source_a_type: slot.sourceAType,
        source_a_ref: slot.homeSource,
        source_b_type: slot.sourceBType,
        source_b_ref: slot.awaySource,
        registration_a_id: null,
        registration_b_id: null,
      }));
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
        seedingStrategy,
      };
      slotInserts = bracket.slots.map((slot) => ({
        phase_id: '__PHASE_ID__',
        round: slot.round,
        position: slot.position,
        source_a_type: slot.sourceAType,
        source_a_ref: slot.homeSource,
        source_b_type: slot.sourceBType,
        source_b_ref: slot.awaySource,
        registration_a_id: null,
        registration_b_id: null,
      }));
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
      .select(
        'id, phase_id, round, position, source_a_type, source_b_type, registration_a_id, registration_b_id',
      );

    if (slotInsertError) {
      throw new BadRequestException(slotInsertError.message);
    }

    // Single-elim: identify the bronze slot (source_a_type === 'loser_of') and
    // record its id in config_json so the frontend can locate it directly.
    if (!isDoubleElim) {
      const bronzeSlot = (insertedSlots ?? []).find(
        (s) => (s as { source_a_type?: string }).source_a_type === 'loser_of',
      ) as { id: string } | undefined;
      if (bronzeSlot) {
        configJson['bronzeSlotId'] = bronzeSlot.id;
        await this.supabase.service
          .from('phases')
          .update({ config_json: configJson })
          .eq('id', phaseId);
      }
    }

    await this.createInitialBracketMatches(insertedSlots ?? []);

    // Note: bye advancement moved to populateBracket — it only
    // makes sense once R1 has registrations.

    this.logger.log(
      `Generated ${phaseType} bracket structure (size ${(configJson['bracketSize'] as number) ?? qualifyCount}, ${(configJson['byeCount'] as number) ?? 0} byes) for tournament ${tournamentId} — call POST /populate-bracket to seed R1`,
    );

    // Read back the canonical bracket so the response shape matches the GET
    // endpoint (includes `slots`, `visibility`, `wbRounds`, etc.) — the bracket
    // page renders <BracketView slots={bracket.slots} /> immediately after a
    // successful POST, and a missing `slots` field crashes the render.
    return this.getTournamentBracket(tournamentId);
  }

  private async createInitialBracketMatches(insertedSlots: unknown[]): Promise<void> {
    // Pre-create a placeholder matches row for EVERY non-bye bracket
    // slot at generation time, regardless of whether its registrations
    // are resolved yet. Downstream slots whose fighters won't be known
    // until upstream rounds complete carry null registrations on the
    // row; bracket-advance later UPDATEs the registrations into the
    // existing row instead of INSERTing a fresh one. Bye slots stay
    // excluded — no match is ever played at a bye.
    //
    // The schedule grid keys off `matches` rows existing; pre-creating
    // them is what lets an operator drag every R2/QF/SF/F/Bronze slot
    // onto the day's grid before any match has been played.
    const readySlots = (insertedSlots as Array<Record<string, unknown>>).filter(
      (slot) =>
        slot['source_b_type'] !== 'bye' &&
        typeof slot['id'] === 'string' &&
        typeof slot['phase_id'] === 'string',
    );

    if (readySlots.length === 0) return;

    const matchInserts = readySlots.map((slot) => ({
      phase_id: slot['phase_id'],
      bracket_slot_id: slot['id'],
      red_registration_id:
        typeof slot['registration_a_id'] === 'string' ? slot['registration_a_id'] : null,
      blue_registration_id:
        typeof slot['registration_b_id'] === 'string' ? slot['registration_b_id'] : null,
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      status: 'scheduled',
      red_score: 0,
      blue_score: 0,
      // Stamp the bracket-local match number so buildRoundCode renders
      // the same canonical code (LSW-R16-M1) the bracket view shows.
      // Without this stamp the scoreboard fell through to B{round}.
      match_number_label: typeof slot['position'] === 'number' ? String(slot['position']) : null,
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

  /**
   * PATCH /api/v1/phases/:id/bracket-config
   *
   * Edits a generated bracket's configuration without regenerating slots
   * or destroying match history. Currently only `grandFinalReset` is
   * editable (double-elim). Refuses when the final or bronze match has
   * already completed.
   */
  async editBracketConfig(phaseId: string, actorUserId: string, dto: EditBracketConfigDto) {
    const phase = await this.getPhaseForVisibility(phaseId);
    const phaseType = phase['type'] as string;
    if (phaseType !== 'single_elim' && phaseType !== 'double_elim') {
      throw new BadRequestException(`Phase ${phaseId} is not a bracket phase`);
    }
    const tournament = phase['tournaments'] as Record<string, unknown> | null;
    const event = tournament?.['events'] as Record<string, unknown> | null;
    const orgId = event?.['organization_id'];
    if (!this.orgs || typeof orgId !== 'string') {
      throw new BadRequestException('Phase organization could not be resolved');
    }
    await this.orgs.assertOrgRole(orgId, actorUserId, 'admin');

    const { data: phaseRow, error: phaseErr } = await this.supabase.service
      .from('phases')
      .select('config_json')
      .eq('id', phaseId)
      .maybeSingle();
    if (phaseErr) throw new BadRequestException(phaseErr.message);
    if (!phaseRow) throw new NotFoundException(`Phase ${phaseId} not found`);
    const config = ((phaseRow as { config_json?: Record<string, unknown> }).config_json ??
      {}) as Record<string, unknown>;

    // Refuse if the final or bronze match has already completed.
    const { data: completed } = await this.supabase.service
      .from('matches')
      .select('id')
      .eq('phase_id', phaseId)
      .eq('status', 'completed')
      .limit(1);
    if ((completed ?? []).length > 0) {
      throw new ConflictException(
        'Bracket configuration is locked because at least one match has completed.',
      );
    }

    const next = { ...config };
    if (dto.grandFinalReset !== undefined) {
      if (phaseType !== 'double_elim') {
        throw new BadRequestException('grandFinalReset only applies to double-elim brackets');
      }
      next['grandFinalReset'] = dto.grandFinalReset;
    }

    const { data: updated, error: updateErr } = await this.supabase.service
      .from('phases')
      .update({ config_json: next })
      .eq('id', phaseId)
      .select('id, config_json')
      .single();
    if (updateErr) throw new BadRequestException(updateErr.message);

    await this.supabase.service.from('audit_log').insert({
      actor_user_id: actorUserId,
      action: 'phase.bracket_config_edited',
      entity_type: 'phase',
      entity_id: phaseId,
      payload_json: { changes: dto, phaseType },
    });

    return updated;
  }

  /**
   * POST /api/v1/phases/:id/reseed
   *
   * Re-applies Round 1 seeding without regenerating the bracket structure.
   * Refuses when any R1 match has already started (status != 'scheduled').
   * Today only `snake` is implemented; the other strategies return 501.
   */
  async reseedBracketRoundOne(phaseId: string, actorUserId: string, dto: ReseedBracketDto) {
    if (dto.strategy !== 'snake') {
      throw new NotImplementedException(
        `Seeding strategy "${dto.strategy}" is not yet implemented`,
      );
    }

    const phase = await this.getPhaseForVisibility(phaseId);
    const phaseType = phase['type'] as string;
    if (phaseType !== 'single_elim' && phaseType !== 'double_elim') {
      throw new BadRequestException(`Phase ${phaseId} is not a bracket phase`);
    }
    const tournamentId = phase['tournament_id'] as string;
    const tournament = phase['tournaments'] as Record<string, unknown> | null;
    const event = tournament?.['events'] as Record<string, unknown> | null;
    const orgId = event?.['organization_id'];
    if (!this.orgs || typeof orgId !== 'string') {
      throw new BadRequestException('Phase organization could not be resolved');
    }
    await this.orgs.assertOrgRole(orgId, actorUserId, 'admin');

    // Load all R1 bracket slots for this phase.
    const r1Round = phaseType === 'double_elim' ? 1 : 1;
    const { data: r1Slots, error: slotsErr } = await this.supabase.service
      .from('bracket_slots')
      .select(
        'id, round, position, source_a_ref, source_b_ref, registration_a_id, registration_b_id',
      )
      .eq('phase_id', phaseId)
      .eq('round', r1Round)
      .order('position', { ascending: true });
    if (slotsErr) throw new BadRequestException(slotsErr.message);
    const slots = (r1Slots ?? []) as Array<{
      id: string;
      round: number;
      position: number;
      source_a_ref: string | null;
      source_b_ref: string | null;
      registration_a_id: string | null;
      registration_b_id: string | null;
    }>;

    // Refuse if any R1 match has started.
    const slotIds = slots.map((s) => s.id);
    if (slotIds.length > 0) {
      const { data: blockingMatches } = await this.supabase.service
        .from('matches')
        .select('id, bracket_slot_id, status')
        .in('bracket_slot_id', slotIds)
        .not('status', 'eq', 'scheduled')
        .not('status', 'eq', 'voided');
      if ((blockingMatches ?? []).length > 0) {
        throw new ConflictException({
          message: 'Cannot reseed Round 1 — at least one match has already started.',
          blockingMatchIds: (blockingMatches ?? []).map((m) => (m as { id: string }).id),
        });
      }
    }

    // Re-fetch seeded registrations in seed order.
    const { data: seededRegs } = await this.supabase.service
      .from('registrations')
      .select('id, seed, bib_number')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in', 'done'])
      .order('seed', { ascending: true, nullsFirst: false });
    const ordered = (seededRegs ?? []) as Array<{
      id: string;
      seed: number | null;
      bib_number: number | null;
    }>;

    // Build seed → registrationId map (snake: respect existing seed order).
    const bySeed = new Map<number, string>();
    ordered.forEach((reg, idx) => {
      const seedNum = reg.seed ?? reg.bib_number ?? idx + 1;
      bySeed.set(seedNum, reg.id);
    });

    // For each R1 slot, recompute red/blue from the slot's intended seeds.
    // The generator already encodes the standard distribution (seed K vs
    // seed size+1−K, seeds 1 & 2 in opposite halves) in source_a_ref/
    // source_b_ref ("seed N"); map seed K → the registration seeded K. The old
    // (2P−1, 2P) math ignored those labels and paired adjacent seeds.
    for (const slot of slots) {
      const homeSeed = parseSeed(slot.source_a_ref);
      const awaySeed = parseSeed(slot.source_b_ref);
      const regA = homeSeed == null ? null : (bySeed.get(homeSeed) ?? null);
      const regB = awaySeed == null ? null : (bySeed.get(awaySeed) ?? null);
      const { error: updateErr } = await this.supabase.service
        .from('bracket_slots')
        .update({ registration_a_id: regA, registration_b_id: regB })
        .eq('id', slot.id);
      if (updateErr) throw new BadRequestException(updateErr.message);

      // Update any scheduled match for this slot to point to the new fighters.
      const { data: existingMatches } = await this.supabase.service
        .from('matches')
        .select('id, status')
        .eq('bracket_slot_id', slot.id)
        .eq('status', 'scheduled');
      if (regA && regB) {
        if ((existingMatches ?? []).length > 0) {
          const matchId = (existingMatches![0] as { id: string }).id;
          await this.supabase.service
            .from('matches')
            .update({ red_registration_id: regA, blue_registration_id: regB })
            .eq('id', matchId);
        } else {
          await this.supabase.service.from('matches').insert({
            phase_id: phaseId,
            bracket_slot_id: slot.id,
            red_registration_id: regA,
            blue_registration_id: regB,
            ruleset_code: 'TF_v1',
            ruleset_version: '1.0.0',
            status: 'scheduled',
            red_score: 0,
            blue_score: 0,
          });
        }
      }
    }

    // Persist the chosen strategy in config_json for future reference.
    const { data: phaseRow } = await this.supabase.service
      .from('phases')
      .select('config_json')
      .eq('id', phaseId)
      .maybeSingle();
    const config = ((phaseRow as { config_json?: Record<string, unknown> })?.config_json ??
      {}) as Record<string, unknown>;
    config['seedingStrategy'] = dto.strategy;
    await this.supabase.service.from('phases').update({ config_json: config }).eq('id', phaseId);

    await this.supabase.service.from('audit_log').insert({
      actor_user_id: actorUserId,
      action: 'phase.bracket_reseeded',
      entity_type: 'phase',
      entity_id: phaseId,
      payload_json: { strategy: dto.strategy, r1SlotCount: slots.length },
    });

    return { phaseId, strategy: dto.strategy, r1SlotCount: slots.length };
  }

  /**
   * POST /api/v1/tournaments/:tournamentId/populate-bracket
   *
   * Populate bracket R1 from pool standings (or registration seed when
   * no pool phase exists). Splits the seeding responsibility out of
   * generateBracket so the operator can choose when fighters land in
   * the bracket — typically AFTER all pool matches are complete.
   *
   * Auto-hook path: scoring services pass actorUserId='system' and
   * options.silentIfGateNotMet=true so a no-op return is safe when
   * pools aren't done yet OR a bracket R1 match has already started.
   */
  async populateBracket(
    tournamentId: string,
    dto: PopulateBracketDto,
    actorUserId: string,
    options?: { silentIfGateNotMet?: boolean },
  ): Promise<{
    phaseId: string;
    seedingMode: 'overall' | 'top-n-per-pool';
    slotsSeeded: number;
    skipped?: string;
    /**
     * Which ranking source drove the bracket seeding. The FE branches
     * the success toast on this so straight-to-bracket tournaments
     * (no pool phase → registration-seed fallback) don't display the
     * misleading "Bracket populated from pool standings" message.
     */
    source: 'pool-standings' | 'registration-seed';
  }> {
    // 1. Bracket phase + auth context (joined via tournaments + events).
    const { data: bracketPhase } = await this.supabase.service
      .from('phases')
      .select(
        'id, type, config_json, tournament_id, tournaments!inner(event_id, events!inner(organization_id))',
      )
      .eq('tournament_id', tournamentId)
      .in('type', ['single_elim', 'double_elim'])
      .maybeSingle();
    if (!bracketPhase) {
      if (options?.silentIfGateNotMet) {
        return {
          phaseId: '',
          seedingMode: 'overall',
          slotsSeeded: 0,
          skipped: 'no_bracket',
          source: 'pool-standings',
        };
      }
      throw new BadRequestException(
        'No bracket phase exists for this tournament. Generate one first.',
      );
    }
    const phaseRow = bracketPhase as Record<string, unknown>;
    const phaseId = phaseRow['id'] as string;
    const config = (phaseRow['config_json'] ?? {}) as Record<string, unknown>;
    const tournamentEmbed = phaseRow['tournaments'] as Record<string, unknown>;
    const eventEmbed = tournamentEmbed['events'] as Record<string, unknown>;
    const organizationId = eventEmbed['organization_id'] as string;

    // 2. Auth — non-system actors must be org admins.
    if (actorUserId !== 'system') {
      if (!this.orgs) throw new BadRequestException('Organizations service not wired');
      await this.orgs.assertOrgRole(organizationId, actorUserId, 'admin');
    }

    // 3. Resolve seeding mode (DTO > persisted > default).
    const persistedMode = config['populateSeedingMode'] as 'overall' | 'top-n-per-pool' | undefined;
    const seedingMode: 'overall' | 'top-n-per-pool' = dto.seedingMode ?? persistedMode ?? 'overall';

    // 4. R1 slots for this phase.
    const { data: r1Slots } = await this.supabase.service
      .from('bracket_slots')
      .select('id, round, position, source_a_ref, source_b_ref')
      .eq('phase_id', phaseId)
      .eq('round', 1)
      .order('position', { ascending: true });
    const slots = (
      (r1Slots ?? []) as Array<{
        id: string;
        round: number;
        position: number;
        source_a_ref: string | null;
        source_b_ref: string | null;
      }>
    ).map((s) => ({
      id: s.id,
      position: s.position,
      // Map each side to the fighter whose rank == the slot's intended seed.
      seedA: parseSeed(s.source_a_ref),
      seedB: parseSeed(s.source_b_ref),
    }));

    // 5. Refuse if any R1 match has already started.
    if (slots.length > 0) {
      const slotIds = slots.map((s) => s.id);
      const { data: blockingMatches } = await this.supabase.service
        .from('matches')
        .select('id, bracket_slot_id, status')
        .in('bracket_slot_id', slotIds)
        .not('status', 'eq', 'scheduled')
        .not('status', 'eq', 'voided');
      if ((blockingMatches ?? []).length > 0) {
        if (options?.silentIfGateNotMet) {
          return {
            phaseId,
            seedingMode,
            slotsSeeded: 0,
            skipped: 'r1_already_started',
            source: 'pool-standings',
          };
        }
        throw new ConflictException({
          message: 'Cannot populate Round 1 — at least one match has already started.',
          blockingMatchIds: (blockingMatches ?? []).map((m) => (m as { id: string }).id),
        });
      }
    }

    // 6. Resolve rankings: pool standings (gated on completion) or
    //    registration seed fallback.
    const { data: poolPhase } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();

    let rankings: RankedRegistration[] = [];
    let source: 'pool-standings' | 'registration-seed' = 'pool-standings';

    if (poolPhase && this.poolStandings) {
      // Need per-pool data to (a) check completion + (b) feed the
      // snake builder for top-n-per-pool mode. We fetch by-pool
      // regardless of mode for a single source of truth.
      const byPoolResponse = await this.poolStandings.getPoolStandings(tournamentId, 'by-pool');
      const perPool = 'pools' in byPoolResponse ? byPoolResponse.pools : [];
      // Empty perPool means "pool phase exists but no pools created
      // yet" (or the standings query produced nothing). `.every()`
      // returns true vacuously for an empty array, which silently
      // bypassed the gate before this guard — operator would see a
      // 200 with slotsSeeded:0 and a misleading "populated from pool
      // standings" toast. Refuse explicitly so the FE surfaces a 409.
      if (perPool.length === 0) {
        if (options?.silentIfGateNotMet) {
          return {
            phaseId,
            seedingMode,
            slotsSeeded: 0,
            skipped: 'no_pool_data',
            source: 'pool-standings',
          };
        }
        throw new ConflictException(
          'No pool data available — generate pools and play matches first.',
        );
      }
      const allComplete = perPool.every((p) => p.status === 'completed');
      if (!allComplete) {
        if (options?.silentIfGateNotMet) {
          return {
            phaseId,
            seedingMode,
            slotsSeeded: 0,
            skipped: 'pools_not_finished',
            source: 'pool-standings',
          };
        }
        throw new ConflictException('Pools have not finished yet');
      }

      if (seedingMode === 'top-n-per-pool') {
        const topN =
          dto.topNPerPool ??
          (perPool.length > 0 ? Math.floor((slots.length * 2) / perPool.length) : 0);
        if (topN <= 0) {
          throw new BadRequestException(
            'topNPerPool must be >= 1 (or omit it to default to bracket_size / pool_count).',
          );
        }
        rankings = buildCrossPoolSnakeRanking(
          perPool.map((p) => ({
            poolId: p.poolId,
            rows: p.rows.map((r) => ({
              rank: r.rank,
              registrationId: r.registrationId,
            })),
          })),
          topN,
        );
      } else {
        const overallResponse = await this.poolStandings.getPoolStandings(tournamentId, 'overall');
        const rows = 'rows' in overallResponse ? overallResponse.rows : [];
        rankings = rows.map((r) => ({ rank: r.rank, registrationId: r.registrationId }));
      }
    } else {
      // No pool phase → registration seed fallback (mirrors the
      // legacy generateBracket behaviour for straight-to-bracket
      // tournaments). FE branches the success toast on `source` so
      // the operator sees an honest "from registration seed" message
      // instead of the pool-standings text.
      source = 'registration-seed';
      const { data: seededRegs } = await this.supabase.service
        .from('registrations')
        .select('id, seed, bib_number')
        .eq('tournament_id', tournamentId)
        .in('status', ['registered', 'checked_in', 'done'])
        .order('seed', { ascending: true, nullsFirst: false });
      rankings = (
        (seededRegs ?? []) as Array<{
          id: string;
          seed: number | null;
          bib_number: number | null;
        }>
      ).map((reg, idx) => ({
        rank: reg.seed ?? reg.bib_number ?? idx + 1,
        registrationId: reg.id,
      }));
    }

    // 7. Compute the plan + apply per-slot updates + match upsert.
    const plan = buildR1SeedingPlan(rankings, slots);
    let slotsSeeded = 0;
    const slotPosById = new Map<string, number>(slots.map((s) => [s.id, s.position]));
    for (const update of plan) {
      const { error: slotErr } = await this.supabase.service
        .from('bracket_slots')
        .update({
          registration_a_id: update.registrationAId,
          registration_b_id: update.registrationBId,
        })
        .eq('id', update.slotId);
      if (slotErr) throw new BadRequestException(slotErr.message);

      // Match row: update existing scheduled match, or insert when both
      // sides are known. Slots with a null side are byes and get handled
      // by advanceByeSlots below — no match row needed yet.
      if (update.registrationAId && update.registrationBId) {
        const { data: existingMatch } = await this.supabase.service
          .from('matches')
          .select('id, status')
          .eq('bracket_slot_id', update.slotId)
          .maybeSingle();
        if (existingMatch) {
          await this.supabase.service
            .from('matches')
            .update({
              red_registration_id: update.registrationAId,
              blue_registration_id: update.registrationBId,
            })
            .eq('id', (existingMatch as { id: string }).id);
        } else {
          await this.supabase.service.from('matches').insert({
            phase_id: phaseId,
            bracket_slot_id: update.slotId,
            red_registration_id: update.registrationAId,
            blue_registration_id: update.registrationBId,
            ruleset_code: 'TF_v1',
            ruleset_version: '1.0.0',
            status: 'scheduled',
            red_score: 0,
            blue_score: 0,
            match_number_label: String(slotPosById.get(update.slotId) ?? ''),
          });
        }
        slotsSeeded++;
      }
    }

    // 8. Persist seeding mode + topN on the phase config so the
    //    auto-hook can reapply with the operator's last choice.
    config['populateSeedingMode'] = seedingMode;
    if (seedingMode === 'top-n-per-pool' && dto.topNPerPool !== undefined) {
      config['populateTopNPerPool'] = dto.topNPerPool;
    }
    await this.supabase.service.from('phases').update({ config_json: config }).eq('id', phaseId);

    // 9. Advance bye slots so single-side R1 slots cascade.
    if (this.bracketAdvance) {
      await this.bracketAdvance.advanceByeSlots(phaseId);
    }

    // 10. Audit log.
    await this.supabase.service.from('audit_log').insert({
      actor_user_id: actorUserId,
      action: 'phase.bracket_populated',
      entity_type: 'phase',
      entity_id: phaseId,
      payload_json: {
        seedingMode,
        topNPerPool: dto.topNPerPool ?? null,
        slotsSeeded,
        rankingsCount: rankings.length,
      },
    });

    this.logger.log(
      `Populated bracket (phase=${phaseId}, mode=${seedingMode}, slotsSeeded=${slotsSeeded}, source=${source})`,
    );
    return { phaseId, seedingMode, slotsSeeded, source };
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
        // 0083 retired registrations.fighter_id; identity flows via
        // persons.global_person_id.
        'id, name, sort_order, pool_members(registration_id, seed, registrations(persons(given_name, family_name, clubs(name), global_persons(hema_ratings_id))))',
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
          const fighter = person?.['global_persons'] as Record<string, unknown> | null;
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
      .select('persons(global_persons(hema_ratings_id))')
      .eq('tournament_id', tournamentId);
    const hemaIds = Array.from(
      new Set(
        ((regs ?? []) as Array<Record<string, unknown>>)
          .map((reg) => {
            const person = reg['persons'] as {
              global_persons?: { hema_ratings_id: string | null } | null;
            } | null;
            return person?.global_persons?.hema_ratings_id ?? null;
          })
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (hemaIds.length === 0) return new Map<string, number>();
    return this.hemaRatings.resolveWeightedRatings(hemaIds, weapon);
  }

  /**
   * DELETE /api/v1/phases/:phaseId
   *
   * Delete a bracket phase end-to-end. Cascades via existing FKs:
   *   - bracket_slots.phase_id ON DELETE CASCADE (migration 0001)
   *   - matches.phase_id       ON DELETE CASCADE (migration 0057)
   *   - match_events.match_id  ON DELETE CASCADE (migration 0001)
   * referee_assignments.match_id is ON DELETE SET NULL, which would leave
   * orphan rows with scope_type='match' + match_id=NULL — clean those up
   * explicitly before deleting the phase so the assignment board stays tidy.
   *
   * Refuses pool-type phases — those go through DELETE /pools/:poolId.
   */
  async deleteBracketPhase(phaseId: string, actorUserId: string): Promise<void> {
    const phase = await this.getPhaseForVisibility(phaseId);
    const phaseType = phase['type'] as string;
    if (phaseType !== 'single_elim' && phaseType !== 'double_elim') {
      throw new BadRequestException(
        `Phase ${phaseId} is type "${phaseType}" — pool phases are deleted via DELETE /pools/:poolId`,
      );
    }

    const tournament = phase['tournaments'] as Record<string, unknown> | null;
    const event = tournament?.['events'] as Record<string, unknown> | null;
    const orgId = event?.['organization_id'];
    if (!this.orgs || typeof orgId !== 'string') {
      throw new BadRequestException('Phase organization could not be resolved');
    }
    await this.orgs.assertOrgRole(orgId, actorUserId, 'admin');

    // Clear referee_assignments scoped to this phase's matches before the
    // matches cascade away. referee_assignments.match_id is ON DELETE SET NULL,
    // so without this step we'd leave dangling rows.
    const { data: matchRows } = await this.supabase.service
      .from('matches')
      .select('id')
      .eq('phase_id', phaseId);
    const matchIds = ((matchRows ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (matchIds.length > 0) {
      const { error: refErr } = await this.supabase.service
        .from('referee_assignments')
        .delete()
        .in('match_id', matchIds);
      if (refErr) throw new BadRequestException(refErr.message);
    }

    // Drop the phase — bracket_slots, matches, and match_events cascade.
    const { error: delErr } = await this.supabase.service.from('phases').delete().eq('id', phaseId);
    if (delErr) throw new BadRequestException(delErr.message);

    await this.supabase.service.from('audit_log').insert({
      actor_user_id: actorUserId,
      action: 'phase.bracket_deleted',
      entity_type: 'phase',
      entity_id: phaseId,
      payload_json: { phaseType, matchCount: matchIds.length },
    });
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

    // Enrich slots so the response shape matches BracketSlotData on
    // the frontend. The projection used to return raw bracket_slots
    // rows, which left `redFighterName`, scores, status etc. as
    // undefined — every MatchCard rendered the '-' placeholder,
    // including after a successful manual override. Two extra
    // fetches: the matches keyed by bracket_slot_id (status +
    // scores + matchId), and the registrations referenced by either
    // side of any slot (with persons + clubs embeds for the name +
    // club label).
    type RawSlot = {
      id: string;
      round: number;
      position: number;
      source_a_type: string | null;
      source_a_ref: string | null;
      source_b_type: string | null;
      source_b_ref: string | null;
      registration_a_id: string | null;
      registration_b_id: string | null;
    };
    const rawSlots = (slots ?? []) as RawSlot[];
    const slotIds = rawSlots.map((s) => s.id);

    const matchBySlot = new Map<
      string,
      {
        id: string;
        status: string;
        red_score: number | null;
        blue_score: number | null;
        lice_id: string | null;
      }
    >();
    if (slotIds.length > 0) {
      const { data: matchRows } = await this.supabase.service
        .from('matches')
        .select('id, bracket_slot_id, status, red_score, blue_score, lice_id')
        .in('bracket_slot_id', slotIds);
      for (const m of (matchRows ?? []) as Array<{
        id: string;
        bracket_slot_id: string;
        status: string;
        red_score: number | null;
        blue_score: number | null;
        lice_id: string | null;
      }>) {
        matchBySlot.set(m.bracket_slot_id, {
          id: m.id,
          status: m.status,
          red_score: m.red_score,
          blue_score: m.blue_score,
          lice_id: m.lice_id ?? null,
        });
      }
    }

    type EmbeddedPerson = {
      given_name: string | null;
      family_name: string | null;
      clubs: { name: string | null } | Array<{ name: string | null }> | null;
    };
    type RegRow = { id: string; persons: EmbeddedPerson | EmbeddedPerson[] | null };
    const regIds = Array.from(
      new Set(
        rawSlots
          .flatMap((s) => [s.registration_a_id, s.registration_b_id])
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const regById = new Map<string, { fighterName: string | null; clubAbbrev: string | null }>();
    if (regIds.length > 0) {
      const { data: regRows } = await this.supabase.service
        .from('registrations')
        .select('id, persons(given_name, family_name, clubs(name))')
        .in('id', regIds);
      for (const r of (regRows ?? []) as RegRow[]) {
        const person = Array.isArray(r.persons) ? (r.persons[0] ?? null) : r.persons;
        const clubsEmbed = person?.clubs ?? null;
        const club = Array.isArray(clubsEmbed) ? (clubsEmbed[0] ?? null) : clubsEmbed;
        const name = `${person?.given_name ?? ''} ${person?.family_name ?? ''}`.trim();
        regById.set(r.id, {
          fighterName: name || null,
          clubAbbrev: club?.name ?? null,
        });
      }
    }

    const enrichedSlots = rawSlots.map((s) => {
      const match = matchBySlot.get(s.id) ?? null;
      const red = s.registration_a_id ? (regById.get(s.registration_a_id) ?? null) : null;
      const blue = s.registration_b_id ? (regById.get(s.registration_b_id) ?? null) : null;
      return {
        id: s.id,
        round: s.round,
        position: s.position,
        redFighterName: red?.fighterName ?? null,
        blueFighterName: blue?.fighterName ?? null,
        redClubAbbrev: red?.clubAbbrev ?? null,
        blueClubAbbrev: blue?.clubAbbrev ?? null,
        redScore: match?.red_score ?? null,
        blueScore: match?.blue_score ?? null,
        status: match?.status ?? 'scheduled',
        matchId: match?.id ?? null,
        liceId: match?.lice_id ?? null,
        // CamelCase aliases for the BracketSlotData shape on the FE
        // (the inline forfeit modal needs both regIds without an
        // extra fetch). Snake-case copies stay for backwards
        // compatibility with consumers that already key on them.
        redRegistrationId: s.registration_a_id,
        blueRegistrationId: s.registration_b_id,
        source_a_type: s.source_a_type,
        source_a_ref: s.source_a_ref,
        source_b_type: s.source_b_type,
        source_b_ref: s.source_b_ref,
        registration_a_id: s.registration_a_id,
        registration_b_id: s.registration_b_id,
      };
    });

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
      grandFinalReset?: boolean;
      seedingStrategy?: string;
      bronzeSlotId?: string;
    };
    // Surface the same "pools done" gate the populateBracket
    // endpoint uses ([phases.service.ts:populateBracket]), so the FE
    // can warn the operator before the click instead of catching a
    // 409 after. Straight-to-bracket tournaments (no pool phase) and
    // setups without the standings service wired report `true` —
    // populate falls through to the registration-seed fallback in
    // those cases.
    const { hasPoolPhase, poolsCompleted } = await this.computePoolGate(tournamentId);

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
      grandFinalReset: config.grandFinalReset ?? false,
      seedingStrategy: config.seedingStrategy ?? 'snake',
      bronzeSlotId: config.bronzeSlotId ?? null,
      totalSlots: enrichedSlots.length,
      slots: enrichedSlots,
      hasPoolPhase,
      poolsCompleted,
    };
  }

  /**
   * Two orthogonal signals the bracket-summary read returns so the FE
   * can choose between (a) gating the auto-populate button and (b)
   * surfacing a confirm dialog before falling back to registration
   * seeds:
   *
   * - `hasPoolPhase` — does a pool phase row exist for this tournament?
   *   When false, populateBracket will go down the registration-seed
   *   branch; the FE shows a confirm modal first so the operator
   *   doesn't accidentally seed from the registration list when they
   *   thought pools would drive the bracket.
   * - `poolsCompleted` — when a pool phase exists, are ALL pools in
   *   `status === 'completed'`? Mirrors the gate populateBracket
   *   enforces server-side; the FE disables the button when this is
   *   false. Empty perPool reads as not-completed (no pools = nothing
   *   to be completed). When no pool phase exists at all, returns
   *   `true` (no gate to enforce).
   *
   * Defensive: when `poolStandings` is not wired, return
   * `{ hasPoolPhase, poolsCompleted: true }` — the populate endpoint
   * re-checks the gate, so the FE just doesn't block the click.
   */
  private async computePoolGate(
    tournamentId: string,
  ): Promise<{ hasPoolPhase: boolean; poolsCompleted: boolean }> {
    const { data: poolPhase } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();
    if (!poolPhase) return { hasPoolPhase: false, poolsCompleted: true };
    if (!this.poolStandings) return { hasPoolPhase: true, poolsCompleted: true };
    try {
      const byPool = await this.poolStandings.getPoolStandings(tournamentId, 'by-pool');
      const perPool = 'pools' in byPool ? byPool.pools : [];
      if (perPool.length === 0) return { hasPoolPhase: true, poolsCompleted: false };
      return {
        hasPoolPhase: true,
        poolsCompleted: perPool.every((p) => p.status === 'completed'),
      };
    } catch {
      return { hasPoolPhase: true, poolsCompleted: true };
    }
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

  /**
   * Set (or clear) the lice for every match in a pool.
   *
   * Mirrors the per-match `liceId` field on PATCH /matches/:id but applied
   * to every match in the pool in one UPDATE — the matches-tab pool-header
   * lets the operator pick once instead of N times.
   */
  async setPoolLice(
    poolId: string,
    liceId: string | null,
    userId: string,
  ): Promise<{ poolId: string; liceId: string | null }> {
    await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    const { error } = await this.supabase.service
      .from('matches')
      .update({ lice_id: liceId })
      .eq('pool_id', poolId);
    if (error) throw new BadRequestException(error.message);

    return { poolId, liceId };
  }

  /**
   * Move a whole pool to (liceId, startAtIso): set every match's lice to
   * `liceId` and shift the timed matches so the pool starts at
   * `startAtIso`, preserving their internal spacing. Backs the referee
   * board's drag-drop (drop a pool card on a lice/timeslot cell). Unlike
   * autoDistributePool this keeps the existing layout instead of re-fanning.
   */
  async reschedulePool(
    poolId: string,
    dto: { liceId: string | null; startAtIso: string },
    userId: string,
  ): Promise<{
    poolId: string;
    updated: Array<{ matchId: string; liceId: string | null; scheduledAt: string | null }>;
  }> {
    await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    const { data: matchesData, error: matchesErr } = await this.supabase.service
      .from('matches')
      .select('id, scheduled_at')
      .eq('pool_id', poolId)
      .order('match_number_label', { ascending: true });
    if (matchesErr) throw new BadRequestException(matchesErr.message);
    const matches = ((matchesData ?? []) as Array<{ id: string; scheduled_at: string | null }>).map(
      (m) => ({ id: m.id, scheduledAt: m.scheduled_at }),
    );
    if (matches.length === 0) return { poolId, updated: [] };

    const updates = computePoolReschedule(matches, dto.liceId ?? null, dto.startAtIso);

    // One UPDATE per row (PostgREST can't set different rows to different
    // values in one statement); independent rows, last-write-wins is safe.
    await Promise.all(
      updates.map(async (u) => {
        const { error } = await this.supabase.service
          .from('matches')
          .update({ lice_id: u.liceId, scheduled_at: u.scheduledAt })
          .eq('id', u.matchId);
        if (error) throw new BadRequestException(error.message);
      }),
    );

    return { poolId, updated: updates };
  }

  /**
   * Auto-distribute every match in a pool across the event's lices
   * starting at (startAtIso, startLiceId). Match i goes to lice
   * (i % parallelLices) at time start + floor(i / parallelLices) *
   * durationMinutes. The lice list is the event's `lices` ordered by
   * sort_order, rotated so it begins at startLiceId; if
   * `parallelLices` is below the event's lice count we slice off the
   * head, so the operator can fan a pool across 2 lices on a 4-lice
   * setup.
   */
  async autoDistributePool(
    poolId: string,
    dto: {
      startAtIso: string;
      startLiceId: string | null;
      durationMinutes: number;
      parallelLices: number;
    },
    userId: string,
  ): Promise<{
    poolId: string;
    updated: Array<{ matchId: string; liceId: string; scheduledAt: string }>;
  }> {
    const ctx = await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    if (dto.parallelLices <= 0) {
      throw new BadRequestException('parallelLices must be >= 1');
    }
    if (dto.durationMinutes <= 0) {
      throw new BadRequestException('durationMinutes must be >= 1');
    }

    // 1. Pool matches ordered by match_number_label — the Berger
    //    generator emits labels like P1M1, P1M2, P2M1, … whose
    //    lexicographic order matches the desired left-to-right,
    //    top-to-bottom layout. matches has no sort_order column;
    //    selecting it crashed autoDistributePool with `column
    //    matches.sort_order does not exist`.
    const { data: matchesData, error: matchesErr } = await this.supabase.service
      .from('matches')
      .select('id, match_number_label')
      .eq('pool_id', poolId)
      .order('match_number_label', { ascending: true });
    if (matchesErr) throw new BadRequestException(matchesErr.message);
    const matchIds = ((matchesData ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (matchIds.length === 0) return { poolId, updated: [] };

    // 2. Event lices ordered by sort_order, rotated to start at the
    //    operator's chosen lice, then truncated to `parallelLices`.
    const { data: licesData, error: licesErr } = await this.supabase.service
      .from('lices')
      .select('id, sort_order')
      .eq('event_id', ctx.eventId)
      .order('sort_order', { ascending: true });
    if (licesErr) throw new BadRequestException(licesErr.message);
    const orderedLiceIds = ((licesData ?? []) as Array<{ id: string }>).map((l) => l.id);
    if (orderedLiceIds.length === 0) {
      throw new BadRequestException('Event has no lices configured.');
    }
    const rotated = rotateLicesFrom(orderedLiceIds, dto.startLiceId);
    const liceIds = rotated.slice(0, Math.min(dto.parallelLices, rotated.length));

    // 3. Pure math → one (matchId, liceId, scheduledAt) per match.
    const assignments = distributePoolMatches({
      matchIds,
      liceIds,
      startAtIso: dto.startAtIso,
      durationMinutes: dto.durationMinutes,
    });

    // 4. Fan UPDATEs out: one per match (PostgREST can't UPDATE
    //    different rows to different values in a single statement).
    //    Parallel network round-trips → still fast on a typical 6-match
    //    pool. Last write wins per row — independent rows, no ordering.
    const results = await Promise.all(
      assignments.map(async (a) => {
        const { error } = await this.supabase.service
          .from('matches')
          .update({ lice_id: a.liceId, scheduled_at: a.scheduledAt })
          .eq('id', a.matchId);
        if (error) throw new BadRequestException(error.message);
        return a;
      }),
    );

    return { poolId, updated: results };
  }

  /**
   * Set (or clear) the referee for one role on every match in a pool.
   *
   * Mirrors `MatchesService.setRefereeRoleAssignment` but fans out to
   * every match in the pool. Idempotent — always deletes existing
   * (match_id, role) rows for those matches before inserting fresh
   * ones. When `refereeId` is null we just clear.
   */
  async setPoolRefereeRoleAssignment(
    poolId: string,
    role: string,
    refereeId: string | null,
    userId: string,
  ): Promise<{ poolId: string; role: string; refereeId: string | null }> {
    const ctx = await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    const { data: matches, error: matchesErr } = await this.supabase.service
      .from('matches')
      .select('id, lice_id')
      .eq('pool_id', poolId);
    if (matchesErr) throw new BadRequestException(matchesErr.message);

    const rows = (matches ?? []) as Array<{ id: string; lice_id: string | null }>;
    if (rows.length === 0) {
      return { poolId, role, refereeId };
    }

    const matchIds = rows.map((m) => m.id);

    const { error: delErr } = await this.supabase.service
      .from('referee_assignments')
      .delete()
      .eq('scope_type', 'match')
      .eq('role', role)
      .in('match_id', matchIds);
    if (delErr) throw new BadRequestException(delErr.message);

    if (refereeId === null) {
      return { poolId, role, refereeId: null };
    }

    const inserts = rows.map((m) => ({
      event_id: ctx.eventId,
      person_id: refereeId,
      scope_type: 'match',
      pool_id: null,
      match_id: m.id,
      lice_id: m.lice_id,
      role,
      auto_assigned: false,
      status: 'assigned',
      conflicts_jsonb: [],
    }));

    const { error: insErr } = await this.supabase.service
      .from('referee_assignments')
      .insert(inserts);
    if (insErr) throw new BadRequestException(insErr.message);

    return { poolId, role, refereeId };
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

    // Defence in depth: only ACTIVE registrations can be pooled. The
    // unassigned panel filters these out too, but a stale FE list (or any
    // other caller) must not be able to pool a waitlisted/withdrawn fighter.
    const { data: registration } = await this.supabase.service
      .from('registrations')
      .select('id, status')
      .eq('id', registrationId)
      .maybeSingle();
    if (!registration) {
      throw new BadRequestException(`Registration ${registrationId} not found`);
    }
    const regStatus = (registration as { status: string }).status;
    if (regStatus !== 'registered' && regStatus !== 'checked_in') {
      throw new BadRequestException(
        `Cannot add a '${regStatus}' registration to a pool — only active (registered / checked-in) fighters can be pooled`,
      );
    }

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
    // 1. Fetch the tournament's ACTIVE registrations. Same status filter as
    //    generatePools: waitlist / withdrawn / disqualified rows must never
    //    surface in the unassigned panel — they'd look like fighters waiting
    //    to be pooled and could be dragged into a pool.
    const { data: regs, error: regErr } = await this.supabase.service
      .from('registrations')
      .select(
        // 0083 retired registrations.fighter_id; identity nests
        // through persons.global_person_id.
        'id, persons(given_name, family_name, clubs(name), global_persons(hema_ratings_id))',
      )
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);
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
        const fighter = person?.['global_persons'] as Record<string, unknown> | null;
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

  // ── Pool lifecycle (delete one / delete all / add empty) ─────────────────

  /**
   * Delete a single pool: clears the matches scheduled in it, removes the
   * pool_members rows, drops the pool itself. If the pool's phase ends up
   * with no remaining pools, the phase row is dropped too so operators
   * return to the "no pool layout yet" state cleanly.
   */
  async deletePool(poolId: string, userId: string): Promise<void> {
    const ctx = await this.assertPoolEditAuth(poolId, userId);
    await this.assertPoolEditable(poolId);

    // Cascade by hand — FK cascade is not enabled everywhere in the schema.
    const matchesRes = await this.supabase.service.from('matches').delete().eq('pool_id', poolId);
    if (matchesRes.error) throw new BadRequestException(matchesRes.error.message);

    const membersRes = await this.supabase.service
      .from('pool_members')
      .delete()
      .eq('pool_id', poolId);
    if (membersRes.error) throw new BadRequestException(membersRes.error.message);

    const poolRes = await this.supabase.service.from('pools').delete().eq('id', poolId);
    if (poolRes.error) throw new BadRequestException(poolRes.error.message);

    // If this was the last pool in the phase, drop the phase too.
    const { data: siblings } = await this.supabase.service
      .from('pools')
      .select('id')
      .eq('phase_id', ctx.phaseId);
    if (!siblings || siblings.length === 0) {
      await this.supabase.service.from('phases').delete().eq('id', ctx.phaseId);
    }
  }

  /**
   * Drop the entire pool layout for a tournament — every pool, every member
   * row, every match in those pools, and the phase row. No-op when there is
   * no pool phase yet.
   */
  async deleteAllPools(tournamentId: string, userId: string): Promise<void> {
    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();
    if (!phase) return;
    if (this.orgs) {
      const { data: tournament } = await this.supabase.service
        .from('tournaments')
        .select('events ( organization_id )')
        .eq('id', tournamentId)
        .maybeSingle();
      const organizationId = (tournament as { events?: { organization_id?: string } | null } | null)
        ?.events?.organization_id;
      if (!organizationId) throw new BadRequestException('Could not resolve organization');
      await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    }

    const phaseId = (phase as { id: string }).id;

    // Order matters: matches → pool_members → pools → phase.
    const matchesRes = await this.supabase.service.from('matches').delete().eq('phase_id', phaseId);
    if (matchesRes.error) throw new BadRequestException(matchesRes.error.message);

    const { data: pools } = await this.supabase.service
      .from('pools')
      .select('id')
      .eq('phase_id', phaseId);
    const poolIds = (pools ?? []).map((p) => (p as { id: string }).id);
    if (poolIds.length > 0) {
      const membersRes = await this.supabase.service
        .from('pool_members')
        .delete()
        .in('pool_id', poolIds);
      if (membersRes.error) throw new BadRequestException(membersRes.error.message);

      const poolsRes = await this.supabase.service.from('pools').delete().eq('phase_id', phaseId);
      if (poolsRes.error) throw new BadRequestException(poolsRes.error.message);
    }

    const phaseRes = await this.supabase.service.from('phases').delete().eq('id', phaseId);
    if (phaseRes.error) throw new BadRequestException(phaseRes.error.message);
  }

  /**
   * Append a single empty pool to the existing layout. If no pool phase
   * exists yet, this stands one up first. Useful when operators want to
   * pre-stage pools before fighters register, or carve out an extra pool
   * by hand after generation.
   */
  async addEmptyPool(
    tournamentId: string,
    userId: string,
  ): Promise<{ id: string; name: string; sortOrder: number }> {
    // Org auth — same check generatePools does (org admin).
    if (this.orgs) {
      const { data: tournament } = await this.supabase.service
        .from('tournaments')
        .select('events ( organization_id )')
        .eq('id', tournamentId)
        .maybeSingle();
      const organizationId = (tournament as { events?: { organization_id?: string } | null } | null)
        ?.events?.organization_id;
      if (!organizationId) throw new BadRequestException('Could not resolve organization');
      await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    }

    let phaseId: string;
    const { data: existingPhase } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();
    if (existingPhase) {
      phaseId = (existingPhase as { id: string }).id;
    } else {
      const { data: phase, error: phaseError } = await this.supabase.service
        .from('phases')
        .insert({
          tournament_id: tournamentId,
          type: 'pool',
          sort_order: 1,
          status: 'pending',
          visibility_status: 'hidden',
          config_json: { poolCount: 0, costReport: null },
        })
        .select('id')
        .single();
      if (phaseError || !phase)
        throw new BadRequestException(phaseError?.message ?? 'Failed to create phase');
      phaseId = (phase as { id: string }).id;
    }

    // Next sort_order = max existing + 1.
    const { data: existingPools } = await this.supabase.service
      .from('pools')
      .select('sort_order')
      .eq('phase_id', phaseId);
    const nextSortOrder =
      ((existingPools ?? []).reduce(
        (max, p) => Math.max(max, (p as { sort_order: number }).sort_order ?? 0),
        -1,
      ) ?? -1) + 1;

    const { data: pool, error: poolError } = await this.supabase.service
      .from('pools')
      .insert({
        phase_id: phaseId,
        name: `Pool ${nextSortOrder + 1}`,
        sort_order: nextSortOrder,
      })
      .select('id, name, sort_order')
      .single();
    if (poolError || !pool)
      throw new BadRequestException(poolError?.message ?? 'Failed to create pool');

    const row = pool as { id: string; name: string; sort_order: number };
    return { id: row.id, name: row.name, sortOrder: row.sort_order };
  }

  /**
   * Returns pools with their enriched matches for the Matches tab.
   * Queries the vw_tournament_query_matches view (red_name, blue_name, lice_id …)
   * and supplements referee_id from the raw matches table.
   */
  async listPoolsWithMatches(
    tournamentId: string,
  ): Promise<Array<{ poolId: string; poolName: string; matches: unknown[] }>> {
    // 1. Get the pool phase
    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();

    if (!phase) return [];
    const phaseId = (phase as { id: string }).id;

    // 1b. Tournament weapon — needed by buildRoundCode so the FE
    // renders the same canonical code (LSW-P1-M1) that the
    // scoreboard ships from getMatchSummary.
    // event_id is read alongside the weapon so the referee_assignments
    // fetch below can scope by event (post-0063 the FK lives on
    // referee_assignments.event_id → events.id and the table is shared
    // across every tournament in the deploy).
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('event_id, weapon')
      .eq('id', tournamentId)
      .maybeSingle();
    const weapon = (tournament as { weapon: string | null } | null)?.weapon ?? null;
    const eventId = (tournament as { event_id: string | null } | null)?.event_id ?? null;

    // 2. Get pools ordered by sort_order
    const { data: pools } = await this.supabase.service
      .from('pools')
      .select('id, name, sort_order')
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });

    if (!pools || pools.length === 0) return [];

    // 3. Get enriched matches from view
    const { data: viewMatches } = await this.supabase.service
      .from('vw_tournament_query_matches')
      .select(
        'match_id, pool_id, lice_id, lice_name, lice_number, red_registration_id, blue_registration_id, red_name, blue_name, red_club, blue_club, red_score, blue_score, status, match_number_label',
      )
      .eq('tournament_id', tournamentId)
      .eq('phase_type', 'pool')
      .order('match_number_label', { ascending: true });

    // 4. Get referee_id from raw matches table (not in view)
    const { data: rawMatches } = await this.supabase.service
      .from('matches')
      .select('id, referee_id')
      .eq('phase_id', phaseId);

    const refereeMap = new Map<string, string | null>(
      ((rawMatches ?? []) as Array<{ id: string; referee_id: string | null }>).map((m) => [
        m.id,
        m.referee_id,
      ]),
    );

    // 4b. Per-role match referee assignments (scope_type='match').
    // The pool tab renders one column per role with the referee's NAME
    // — distinct from the legacy matches.referee_id single field which
    // PATCH /matches/:id still writes.
    //
    // Post-0063: referee_assignments.person_id → global_persons(id).
    // The legacy `persons(...)` embed silently 400'd because there is
    // no FK from referee_assignments to the per-event persons table;
    // matching shape is at conflict-check.controller.ts:80.
    type GlobalPersonEmbed = {
      display_name: string | null;
      given_name: string | null;
      family_name: string | null;
    };
    // Referee assignments live in two row shapes:
    //   - scope_type='pool', pool_id=X, match_id=null
    //       Written by the Referees → Assignments tab. Acts as the
    //       DEFAULT for every match in pool X.
    //   - scope_type='match', match_id=Y, pool_id=null
    //       Written by the Matches tab (per-row picker + pool-header
    //       strip). Acts as an OVERRIDE for one specific match.
    // The Matches tab read merges them: pool defaults flow onto every
    // match, per-match rows replace the role for that one match.
    type RefereeAssignmentRow = {
      match_id: string | null;
      pool_id: string | null;
      role: string;
      person_id: string;
      // PostgREST returns embedded relations as either a single row or
      // an array depending on the resolved FK cardinality; tolerate both.
      global_persons: GlobalPersonEmbed | GlobalPersonEmbed[] | null;
    };
    type RoleAssignment = { refereeId: string; refereeName: string };

    const matchIds = ((viewMatches ?? []) as Array<{ match_id: string }>).map((m) => m.match_id);
    const poolDefaults = new Map<string, Map<string, RoleAssignment>>();
    const perMatchAssignments = new Map<string, Map<string, RoleAssignment>>();
    let assignmentRows: RefereeAssignmentRow[] = [];
    if (matchIds.length > 0 && eventId) {
      const { data, error: assignErr } = await this.supabase.service
        .from('referee_assignments')
        .select(
          'match_id, pool_id, role, person_id, global_persons(display_name, given_name, family_name)',
        )
        .eq('event_id', eventId)
        .in('scope_type', ['pool', 'match']);
      if (assignErr) throw new BadRequestException(assignErr.message);
      assignmentRows = (data ?? []) as unknown as RefereeAssignmentRow[];
    }
    for (const row of assignmentRows) {
      const person: GlobalPersonEmbed | null = Array.isArray(row.global_persons)
        ? (row.global_persons[0] ?? null)
        : row.global_persons;
      const display =
        person?.display_name ?? [person?.given_name, person?.family_name].filter(Boolean).join(' ');
      const entry: RoleAssignment = {
        refereeId: row.person_id,
        refereeName: display || row.person_id,
      };
      if (row.match_id) {
        const byRole = perMatchAssignments.get(row.match_id) ?? new Map<string, RoleAssignment>();
        byRole.set(row.role, entry);
        perMatchAssignments.set(row.match_id, byRole);
      } else if (row.pool_id) {
        const byRole = poolDefaults.get(row.pool_id) ?? new Map<string, RoleAssignment>();
        byRole.set(row.role, entry);
        poolDefaults.set(row.pool_id, byRole);
      }
    }

    function resolveReferees(
      matchId: string,
      poolId: string | null,
    ): Array<{ role: string; refereeId: string; refereeName: string }> {
      const merged = new Map<string, RoleAssignment>();
      if (poolId) {
        const defaults = poolDefaults.get(poolId);
        if (defaults) for (const [role, val] of defaults) merged.set(role, val);
      }
      const overrides = perMatchAssignments.get(matchId);
      if (overrides) for (const [role, val] of overrides) merged.set(role, val);
      return Array.from(merged, ([role, val]) => ({ role, ...val }));
    }

    // 5. Group matches by pool
    type ViewMatch = {
      match_id: string;
      pool_id: string | null;
      lice_id: string | null;
      red_registration_id: string | null;
      blue_registration_id: string | null;
      red_name: string | null;
      blue_name: string | null;
      red_club: string | null;
      blue_club: string | null;
      red_score: number | null;
      blue_score: number | null;
      status: string;
      match_number_label: string | null;
    };

    const matchesByPool = new Map<string, ViewMatch[]>();
    for (const m of (viewMatches ?? []) as ViewMatch[]) {
      if (!m.pool_id) continue;
      const existing = matchesByPool.get(m.pool_id) ?? [];
      existing.push(m);
      matchesByPool.set(m.pool_id, existing);
    }

    // The view query orders by match_number_label as a string, which
    // puts M10 ahead of M2 once a pool reaches double-digit fights.
    // Re-sort each pool by the numeric M-suffix so the Matches tab
    // renders LSW-P1-…-M1, M2, M3, …, M10, M11.
    for (const arr of matchesByPool.values()) {
      arr.sort(
        (a, b) => poolMatchSortKey(a.match_number_label) - poolMatchSortKey(b.match_number_label),
      );
    }

    return ((pools ?? []) as Array<{ id: string; name: string; sort_order: number }>).map(
      (pool) => {
        const poolNumber = pool.sort_order + 1;
        return {
          poolId: pool.id,
          poolName: pool.name,
          matches: (matchesByPool.get(pool.id) ?? []).map((m, idx) => ({
            id: m.match_id,
            pool_id: m.pool_id,
            round_number: idx + 1,
            red_registration_id: m.red_registration_id,
            blue_registration_id: m.blue_registration_id,
            red_name: m.red_name ?? '',
            red_club_abbrev: m.red_club ?? null,
            blue_name: m.blue_name ?? '',
            blue_club_abbrev: m.blue_club ?? null,
            red_score: m.red_score,
            blue_score: m.blue_score,
            status: m.status,
            lice_id: m.lice_id,
            referee_id: refereeMap.get(m.match_id) ?? null,
            match_number_label: m.match_number_label,
            referees: resolveReferees(m.match_id, m.pool_id),
            roundCode: buildRoundCode({
              weapon,
              poolNumber,
              bracketRound: null,
              bracketSize: null,
              matchNumberLabel: m.match_number_label,
              roundNumber: idx + 1,
            }),
          })),
        };
      },
    );
  }

  /**
   * Lightweight per-tournament match-score snapshot. Used by the pools
   * Matches tab's 30s fallback poll to merge score updates in place
   * without re-fetching the whole `pools-with-matches` payload.
   *
   * Deliberately narrow SELECT: only the four fields the FE needs to
   * decide "did the score / status change for this row?". Privileged
   * fields (referee_id, lice_id) intentionally not exposed here so
   * this cheap polling endpoint can't be used to siphon assignment
   * data.
   */
  async listMatchScores(
    tournamentId: string,
  ): Promise<
    Array<{ id: string; status: string; red_score: number | null; blue_score: number | null }>
  > {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, status, red_score, blue_score')
      .eq('tournament_id', tournamentId);
    if (error) return [];
    return (data ?? []) as Array<{
      id: string;
      status: string;
      red_score: number | null;
      blue_score: number | null;
    }>;
  }
}
