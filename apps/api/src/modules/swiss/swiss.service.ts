import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { recommendedRoundCount } from '@myclash/rules/scheduling';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { FOUGHT_STATUSES } from '../matches/fought-match';
// Value imports, not `import type`: Nest DI metadata.
import { FighterStatusService } from '../matches/fighter-status.service';
import { SwissPairingService } from './swiss-pairing.service';
import { SwissSeedingService } from './swiss-seeding.service';
import type { SwissConfig } from './dto/swiss-config.dto';
import { writeSwissConfig } from './swiss-phase-config';
import { deleteRefusal, FIGHTER_OUT } from './swiss-refusals';
import { SWISS_DEFAULTS, type GenerateSwissDto, type UpdateSwissConfigDto } from './dto/swiss.dto';
import type { SwissSeeding } from './swiss-seeding.service';

/**
 * Swiss phase lifecycle: create it, configure it, freeze it, unfreeze it.
 *
 * The per-round commit path deliberately is NOT here — it lives in
 * SwissPairingService inside the leaf module, because MatchCompletionService
 * has to reach it and this module's dependencies would close a cycle. See
 * swiss-core.module.ts.
 */
@Injectable()
export class SwissService {
  private readonly logger = new Logger(SwissService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pairing: SwissPairingService,
    private readonly seeding: SwissSeedingService,
    private readonly fighterStatus: FighterStatusService,
  ) {}

  /**
   * Create the phase, freeze its field, and pair round 1.
   *
   * Coexists with a pool phase (decision 10): pools → Swiss → bracket is a
   * valid three-stage tournament, so this never touches an existing pool phase
   * and `sort_order` 2 keeps the three in running order.
   */
  async generateSwiss(
    tournamentId: string,
    dto: GenerateSwissDto,
    force = false,
    actorUserId: string | null = null,
  ) {
    await this.clearExistingPhase(tournamentId, force);

    const registrations = await this.seeding.loadRegistrations(tournamentId);
    if (registrations.length < 2) {
      throw new BadRequestException('A Swiss phase needs at least 2 registered fighters');
    }

    const ranked = await this.seeding.resolveSeeding(tournamentId, registrations, dto);
    const config = this.buildConfig(dto, registrations.length, ranked);

    const { data: inserted, error } = await this.supabase.service
      .from('phases')
      .insert({
        tournament_id: tournamentId,
        type: 'swiss',
        // pool = 1, swiss = 2, bracket = 3, so a three-stage tournament orders
        // deterministically wherever phases are listed.
        sort_order: 2,
        status: 'pending',
        config_json: config,
      })
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!inserted) throw new BadRequestException('Swiss phase insert persisted nothing');
    const phaseId = (inserted as { id: string }).id;

    await this.insertEntrants(phaseId, ranked.order);
    const committed = await this.pairing.commitNextRound(phaseId);
    await this.auditGeneration(tournamentId, phaseId, config, ranked.order.length, actorUserId);

    return {
      phaseId,
      entrants: ranked.order.length,
      roundCount: config.roundCount,
      seedingStrategy: config.seedingStrategy,
      ratingCoverage: ranked.coverage,
      firstRound: committed,
    };
  }

  /**
   * Edit a live phase.
   *
   * `pairingMethod`, `points` and `grouping` are frozen once round 2 exists:
   * all three retroactively change what the already-played rounds were worth,
   * so changing them mid-phase would silently rewrite the standings the earlier
   * pairings were computed from. `roundCount` may only grow past what has
   * already been generated.
   */
  async updateConfig(
    phaseId: string,
    dto: UpdateSwissConfigDto,
    actorUserId: string | null = null,
  ) {
    const context = await this.pairing.requireContext(phaseId);
    const generated = context.rounds.length;

    const retroactive = (['pairingMethod', 'points', 'grouping'] as const).filter(
      (key) => dto[key] !== undefined,
    );
    if (generated > 1 && retroactive.length > 0) {
      throw new ConflictException(
        `Cannot change ${retroactive.join(', ')} after round 2 — it would change what the rounds already played were worth.`,
      );
    }
    if (dto.roundCount !== undefined && dto.roundCount < generated) {
      throw new ConflictException(
        `Round count cannot drop below the ${generated} round(s) already generated.`,
      );
    }

    const next: SwissConfig = { ...context.config, ...stripUndefined(dto) };
    await writeSwissConfig(this.supabase, phaseId, next);
    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'swiss.config_update',
      entityType: 'phase',
      entityId: phaseId,
      payload: { changed: Object.keys(stripUndefined(dto)) },
    });
    // More rounds can reopen a phase over by its rounds (rulings 127, 129).
    if (dto.roundCount !== undefined) {
      await this.fighterStatus.followReopenedSwissPhase(phaseId, context.tournamentId, {
        userId: actorUserId ?? undefined,
      });
    }
    return next;
  }

  /**
   * Withdraw a fighter (decision 11).
   *
   * Excluded from every later pairing; the rounds they already played stand,
   * their opponents keep those results, and their own row stays in the
   * standings flagged as withdrawn. Deleting them would silently rewrite every
   * opponent's record.
   *
   * Written by `swiss_withdraw` (0243) under the phase's row lock, which the
   * round's write takes too: the round it counts from is read after any round
   * written before it. Read first and written after, a round committed between
   * stored the Fighter as withdrawn from a round that already held them.
   */
  async withdraw(phaseId: string, registrationId: string, actorUserId: string | null = null) {
    const { data, error } = await this.supabase.service.rpc('swiss_withdraw', {
      p_phase: phaseId,
      p_registration: registrationId,
      p_by: 'hand',
    });
    if (error?.code === 'P0002') {
      throw new NotFoundException(`Fighter ${registrationId} is not in this Swiss phase`);
    }
    if (error) throw new BadRequestException(error.message);
    if (!data)
      throw new BadRequestException(`The withdrawal of ${registrationId} was answered nothing`);
    const { withdrawnAtRound, changed } = data as { withdrawnAtRound: number; changed: boolean };
    if (!changed) return { withdrawnAtRound };

    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'swiss.withdraw',
      entityType: 'phase',
      entityId: phaseId,
      payload: { registrationId, withdrawnAtRound },
    });
    return { withdrawnAtRound };
  }

  /**
   * Put a withdrawn fighter back in the pairings (rulings 108, 121, 122), whoever withdrew them.
   *
   * Paired again from the next round; the rounds paired while they were withdrawn count nothing
   * for them, and stay valid rounds (`missedRounds`). Refused while the fighter is out of the
   * Tournament: `swiss_put_back` (0244) reads their status under the phase's row lock, which the
   * status reconcile's withdraw waits on, so a put-back never leaves an out fighter paired.
   */
  async reinstate(phaseId: string, registrationId: string, actorUserId: string | null = null) {
    const { data, error } = await this.supabase.service.rpc('swiss_put_back', {
      p_phase: phaseId,
      p_registration: registrationId,
      p_by: 'hand',
    });
    if (error?.code === 'P0002') {
      throw new NotFoundException(`Fighter ${registrationId} is not in this Swiss phase`);
    }
    if (error?.code === 'P0001' && error.message.startsWith(FIGHTER_OUT)) {
      throw new ConflictException({
        message: 'This fighter is out of the tournament: bring them back first',
        code: FIGHTER_OUT,
      });
    }
    if (error) throw new BadRequestException(error.message);
    if (!data)
      throw new BadRequestException(`The put-back of ${registrationId} was answered nothing`);
    const answer = data as { status: 'in' | 'put_back'; missedRounds: number[] };
    if (answer.status === 'put_back') {
      await insertAuditLog(this.supabase.service, {
        actorUserId,
        action: 'swiss.reinstate',
        entityType: 'phase',
        entityId: phaseId,
        payload: { registrationId, missedRounds: answer.missedRounds },
      });
    }
    return answer;
  }

  /**
   * Delete the last round, provided nothing in it has started and no black card or forfeit on its
   * bouts holds a Fighter out.
   *
   * One step, `swiss_delete_last_round` (0244), under the phase's row lock: the bouts go FIRST
   * (`matches.swiss_round_id` is ON DELETE SET NULL, so a bout left behind would survive with no
   * round), then the round, then its number from every entrant's missed rounds. FOUGHT_STATUSES,
   * not `!== 'scheduled'`: a VOIDED bout is not under way, and this is the remedy the un-completion
   * refusal sends organisers to by name — "delete that round first".
   */
  async deleteRound(phaseId: string, roundNumber: number, actorUserId: string | null = null) {
    const { data, error } = await this.supabase.service.rpc('swiss_delete_last_round', {
      p_phase: phaseId,
      p_round: roundNumber,
      p_fought: [...FOUGHT_STATUSES],
    });
    if (error) throw deleteRefusal(error, roundNumber);
    const matches = (data as { matches?: number } | null)?.matches;
    if (matches === undefined) {
      throw new BadRequestException(`The delete of round ${roundNumber} was answered nothing`);
    }

    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'swiss.round_delete',
      entityType: 'phase',
      entityId: phaseId,
      payload: { roundNumber, matches },
    });
    return { deleted: roundNumber };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private buildConfig(
    dto: GenerateSwissDto,
    fighterCount: number,
    ranked: SwissSeeding,
  ): SwissConfig {
    return {
      roundCount: dto.roundCount ?? recommendedRoundCount(fighterCount),
      seedingStrategy: dto.seedingStrategy ?? SWISS_DEFAULTS.seedingStrategy,
      seedingRandomSeed: ranked.seed,
      // The phase the order was ACTUALLY read from, which for `by-pool-rank` is
      // resolved by the seeder when the request does not name one. Writing the
      // request's null instead persisted a config that failed its own schema —
      // the phase row and its entrants were inserted, then every read of it
      // 400'd with "has an invalid config". Never the request's own id: only
      // the seeder checks it against this tournament, and only for
      // `by-pool-rank`; any other draw reads no phase and records none.
      sourcePhaseId: ranked.sourcePhaseId,
      pairingMethod: dto.pairingMethod ?? SWISS_DEFAULTS.pairingMethod,
      grouping: dto.grouping ?? SWISS_DEFAULTS.grouping,
      rankBy: dto.rankBy ?? SWISS_DEFAULTS.rankBy,
      points: dto.points ?? { ...SWISS_DEFAULTS.points },
      tiebreakChain: dto.tiebreakChain ?? [...SWISS_DEFAULTS.tiebreakChain],
      minRatingCoveragePercent: dto.minRatingCoveragePercent ?? null,
      finalized: null,
    };
  }

  private async insertEntrants(phaseId: string, registrationIds: string[]): Promise<void> {
    if (registrationIds.length === 0) return;
    const { error } = await this.supabase.service
      .from('swiss_entrants')
      .insert(registrationIds.map((id) => ({ phase_id: phaseId, registration_id: id })));
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Record the draw. The seed matters most: without it a random draw cannot be
   * reproduced, and "the computer shuffled them" is not an answer to a fighter
   * who thinks their round-1 opponent was chosen.
   */
  private async auditGeneration(
    tournamentId: string,
    phaseId: string,
    config: SwissConfig,
    entrants: number,
    actorUserId: string | null,
  ): Promise<void> {
    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'swiss.generate',
      entityType: 'phase',
      entityId: phaseId,
      payload: {
        tournamentId,
        entrants,
        seedingStrategy: config.seedingStrategy,
        seedingRandomSeed: config.seedingRandomSeed ?? null,
        roundCount: config.roundCount,
      },
    });
    this.logger.log(
      `generateSwiss tournament=${tournamentId} phase=${phaseId} entrants=${entrants} rounds=${config.roundCount} seeding=${config.seedingStrategy}`,
    );
  }

  /**
   * Make room for a new Swiss phase, refusing to destroy a live one.
   *
   * `force` is how an organiser redraws a phase they generated by mistake, but
   * it stops at the first bout: once anything has been fought, deleting the
   * phase would cascade the rounds and their results away.
   */
  private async clearExistingPhase(tournamentId: string, force: boolean): Promise<void> {
    const existing = await this.findPhase(tournamentId);
    if (!existing) return;
    if (!force) {
      throw new ConflictException(
        'A Swiss phase already exists for this tournament. Use ?force=true to regenerate.',
      );
    }
    if (await this.hasStartedMatch(existing)) {
      throw new ConflictException(
        'This Swiss phase has a bout under way and cannot be regenerated.',
      );
    }
    await this.supabase.service.from('phases').delete().eq('id', existing);
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

  /**
   * Is any bout in this phase being fought?
   *
   * FOUGHT_STATUSES, not `.neq('status','scheduled')`. The old spelling counted
   * a VOIDED bout as under way, so a phase whose only activity had already been
   * undone could not be regenerated even with `?force=true` — and voided is the
   * one status that is neither scheduled nor in play.
   *
   * The set rather than `hasBeenFought`, because this is an existence probe:
   * `.limit(1)` has to stay, and calling the predicate would mean loading every
   * match in the phase to filter it in JS.
   */
  private async hasStartedMatch(phaseId: string): Promise<boolean> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('id, status')
      .eq('phase_id', phaseId)
      .in('status', [...FOUGHT_STATUSES])
      .limit(1);
    return ((data ?? []) as unknown[]).length > 0;
  }
}

export function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
