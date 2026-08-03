import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  planSwissRound,
  type SwissPlayer,
  type SwissRoundPlan,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';
// Value imports, not `import type`: Nest needs the runtime class for DI.
import { ProgrammeService } from '../programme/programme.service';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { matchRulesetForPhase } from '../phases/match-ruleset';
import { SwissStandingsService } from './swiss-standings.service';
import { parseSwissConfig, type SwissConfig } from './dto/swiss-config.dto';
import {
  activeEntrants,
  buildSwissPlayers,
  type SwissEntrantRecord,
  type SwissRoundRecord,
} from './swiss-snapshot';

/**
 * The Swiss commit path: plan a round, write it, schedule it.
 *
 * Lives in the LEAF module on purpose. Automatic advancement means
 * MatchCompletionService (PhasesModule) has to invoke this, so PhasesModule
 * gains an edge to Swiss. If that edge pointed at the full SwissModule the
 * graph would close a cycle, and a NestJS module cycle is invisible to tsc and
 * to vitest — it only surfaces when the API boots, i.e. in production. Keeping
 * the commit path here, with only leaf dependencies, is what makes the edge
 * safe. See module-graph.test.ts.
 *
 * Its collaborators are chosen the same way: ProgrammeService is a true leaf.
 * When the round-published notification is wired up it must come from the
 * NotificationSchedulingModule leaf — importing NotificationsModule instead
 * reaches WorkersModule → LeaguesModule → TournamentPlacementModule →
 * PhasesModule and closes the cycle after all. module-graph.test.ts forbids it.
 */
@Injectable()
export class SwissPairingService {
  private readonly logger = new Logger(SwissPairingService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly programme?: ProgrammeService,
    // Only read for score-band grouping; @Optional so the pairing path still
    // works if the standings provider is ever absent.
    @Optional() private readonly standings?: SwissStandingsService,
    // From the LEAF NotificationSchedulingModule — see this class's docblock.
    @Optional() private readonly notifications?: NotificationEventsService,
  ) {}

  /** Read-only preview of what the next round would be. Writes nothing. */
  async planNextRound(
    phaseId: string,
  ): Promise<{ roundNumber: number; plan: SwissRoundPlan } | null> {
    const context = await this.loadContext(phaseId);
    if (!context) return null;
    const { config, entrants, rounds } = context;

    const nextRoundNumber = rounds.length + 1;
    if (nextRoundNumber > config.roundCount) return null;

    const field = activeEntrants(entrants, nextRoundNumber);
    const players = buildSwissPlayers(field, rounds, config.points, this.seedOrderOf(rounds));

    return {
      roundNumber: nextRoundNumber,
      plan: planSwissRound(await this.withScores(players, context.tournamentId, config), {
        pairingMethod: config.pairingMethod,
        grouping: config.grouping,
      }),
    };
  }

  /**
   * Pair and persist the next round.
   *
   * Idempotent by construction against the one race that matters: two matches
   * of the final round completing at the same instant both see "round complete"
   * and both call this. `swiss_rounds UNIQUE (phase_id, round_number)` makes the
   * loser of that race a 23505, which is treated as a benign no-op rather than
   * an error — the round exists, which is all the caller wanted.
   */
  async commitNextRound(phaseId: string): Promise<{ roundId: string; roundNumber: number } | null> {
    const planned = await this.planNextRound(phaseId);
    if (!planned) return null;
    const { roundNumber, plan } = planned;

    const { data: inserted, error } = await this.supabase.service
      .from('swiss_rounds')
      .insert({
        phase_id: phaseId,
        round_number: roundNumber,
        status: 'pending',
        bye_registration_id: plan.byeRegistrationId,
        pairing_meta_json: {
          warnings: plan.warnings,
          ranked: plan.pairings.flatMap((p) => [p.aId, p.bId]),
          manualAdjustments: [],
          generatedAt: new Date().toISOString(),
        },
      })
      .select('id')
      .maybeSingle();

    if (error) {
      // 23505 = another completion already committed this round.
      if (isUniqueViolation(error)) {
        this.logger.log(`swiss round ${roundNumber} for phase ${phaseId} already committed`);
        return null;
      }
      throw new BadRequestException(error.message);
    }
    if (!inserted) throw new BadRequestException('Swiss round insert persisted nothing');
    const roundId = (inserted as { id: string }).id;

    const matchIds = await this.insertRoundMatches(phaseId, roundId, roundNumber, plan);
    await this.scheduleRound(phaseId, matchIds);
    // AFTER scheduling, so the message can name the piste. Swallowed on
    // failure for the same reason `scheduleRound` is: this runs inside
    // MatchCompletionService, which is documented as never throwing, and an
    // un-notified round is recoverable where an unpaired one is not.
    await this.notifyRoundPublished(roundId, roundNumber);

    this.logger.log(
      `swiss round ${roundNumber} committed phase=${phaseId} matches=${matchIds.length} bye=${plan.byeRegistrationId ?? 'none'}`,
    );
    return { roundId, roundNumber };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Attach the ruleset score, but ONLY when the pairing actually groups on it.
   *
   * Score-band grouping is the one mode that reads `SwissPlayer.score`; points
   * grouping never looks at it. Computing full standings on every match
   * completion just to discard the number would make the common path pay for
   * the rare one.
   */
  private async withScores(
    players: SwissPlayer[],
    tournamentId: string,
    config: SwissConfig,
  ): Promise<SwissPlayer[]> {
    if (config.grouping.kind !== 'scoreBands' || !this.standings) return players;

    const standings = await this.standings.getSwissStandings(tournamentId);
    const scoreOf = new Map(
      standings.rows.map((row) => [row.registrationId, Number(row.stats['score'] ?? 0)]),
    );
    return players.map((player) => ({
      ...player,
      score: scoreOf.get(player.registrationId) ?? null,
    }));
  }

  private async insertRoundMatches(
    phaseId: string,
    roundId: string,
    roundNumber: number,
    plan: SwissRoundPlan,
  ): Promise<string[]> {
    if (plan.pairings.length === 0) return [];

    // The tournament's ruleset, stamped per match: generation used to hardcode
    // TF_v1 and score non-TF tournaments with the wrong engine.
    const stamp = await matchRulesetForPhase(this.supabase.service, phaseId);

    const rows = plan.pairings.map((pairing) => ({
      phase_id: phaseId,
      swiss_round_id: roundId,
      red_registration_id: pairing.aId,
      blue_registration_id: pairing.bId,
      status: 'scheduled',
      match_number_label: `SW-R${roundNumber}-M${pairing.board}`,
      ...stamp,
    }));

    const { data, error } = await this.supabase.service.from('matches').insert(rows).select('id');
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  /**
   * Hand the round to the programme so it lands on pistes.
   *
   * `mode: 'pool'` is the greedy fan-out, which is what a Swiss round wants: a
   * round is a flat set of simultaneous bouts spread ACROSS pistes, with no
   * tree to respect. Failure is logged, not thrown — an unscheduled round is
   * recoverable from the schedule grid, an unpaired one is not.
   */
  private async scheduleRound(phaseId: string, matchIds: string[]): Promise<void> {
    if (!this.programme || matchIds.length === 0) return;
    try {
      const context = await this.eventAndLices(phaseId);
      if (!context || context.liceIds.length === 0) return;
      await this.programme.scheduleGroup(context.eventId, {
        matchIds,
        liceIds: context.liceIds,
        startTime: new Date().toISOString(),
        mode: 'pool',
      });
    } catch (err) {
      this.logger.warn(`swiss round scheduling failed for phase ${phaseId}: ${describe(err)}`);
    }
  }

  /**
   * Announce the round to its field (decision 17).
   *
   * Never throws: the notification service applies its own status gate and
   * preference gate, and a delivery failure must not roll back a round that is
   * already written and scheduled.
   */
  private async notifyRoundPublished(roundId: string, roundNumber: number): Promise<void> {
    if (!this.notifications) return;
    try {
      await this.notifications.swissRoundPublished(roundId);
    } catch (err) {
      this.logger.warn(`swiss round ${roundNumber} notification failed: ${describe(err)}`);
    }
  }

  private async eventAndLices(
    phaseId: string,
  ): Promise<{ eventId: string; liceIds: string[] } | null> {
    const { data } = await this.supabase.service
      .from('phases')
      .select('tournaments(event_id)')
      .eq('id', phaseId)
      .maybeSingle();
    const embed = (data as { tournaments?: unknown } | null)?.tournaments;
    // Many-to-one embeds are objects; normalise defensively (embed-flip trap).
    const tournament = Array.isArray(embed) ? embed[0] : embed;
    const eventId = (tournament as { event_id?: string } | null)?.event_id;
    if (!eventId) return null;

    const { data: lices } = await this.supabase.service
      .from('lices')
      .select('id')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    return { eventId, liceIds: ((lices ?? []) as Array<{ id: string }>).map((l) => l.id) };
  }

  /**
   * Round 1's draw order, used to break point ties in every later round.
   *
   * Persisted on the round rather than recomputed because the whole point of a
   * seeded draw is that it can be replayed months later when someone contests
   * it — recomputing would make the tiebreak depend on today's data.
   */
  private seedOrderOf(rounds: SwissRoundRecord[]): string[] {
    const first = rounds.find((r) => r.roundNumber === 1);
    if (!first) return [];
    const ranked = first.pairingMeta?.['ranked'];
    return Array.isArray(ranked) ? ranked.filter((id): id is string => typeof id === 'string') : [];
  }

  async loadContext(phaseId: string): Promise<SwissContext | null> {
    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('id, type, config_json, tournament_id')
      .eq('id', phaseId)
      .maybeSingle();
    const row = phase as {
      id: string;
      type: string;
      config_json: unknown;
      tournament_id: string;
    } | null;
    if (!row || row.type !== 'swiss') return null;

    const config = parseSwissConfig(row.config_json);
    if (!config) throw new BadRequestException(`Swiss phase ${phaseId} has an invalid config`);

    return {
      phaseId,
      tournamentId: row.tournament_id,
      config,
      entrants: await this.loadEntrants(phaseId),
      rounds: await this.loadRounds(phaseId),
    };
  }

  async loadEntrants(phaseId: string): Promise<SwissEntrantRecord[]> {
    const { data, error } = await this.supabase.service
      .from('swiss_entrants')
      .select('registration_id, withdrawn_at_round')
      .eq('phase_id', phaseId);
    if (error) throw new BadRequestException(error.message);
    return (
      (data ?? []) as Array<{ registration_id: string; withdrawn_at_round: number | null }>
    ).map((r) => ({
      registrationId: r.registration_id,
      withdrawnAtRound: r.withdrawn_at_round,
    }));
  }

  async loadRounds(phaseId: string): Promise<SwissRoundRecord[]> {
    const { data, error } = await this.supabase.service
      .from('swiss_rounds')
      .select(
        'id, round_number, status, bye_registration_id, pairing_meta_json, ' +
          'matches(id, red_registration_id, blue_registration_id, winner_registration_id, status, end_reason)',
      )
      .eq('phase_id', phaseId)
      .order('round_number', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    // Double cast: the concatenated select string defeats Supabase's literal
    // type inference, which then resolves the row type to GenericStringError.
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row['id'] as string,
      roundNumber: row['round_number'] as number,
      status: row['status'] as string,
      byeRegistrationId: (row['bye_registration_id'] as string | null) ?? null,
      pairingMeta: (row['pairing_meta_json'] as Record<string, unknown> | null) ?? null,
      matches: ((row['matches'] ?? []) as Array<Record<string, unknown>>).map((m) => ({
        id: m['id'] as string,
        redRegistrationId: (m['red_registration_id'] as string | null) ?? null,
        blueRegistrationId: (m['blue_registration_id'] as string | null) ?? null,
        winnerRegistrationId: (m['winner_registration_id'] as string | null) ?? null,
        status: m['status'] as string,
        endReason: (m['end_reason'] as string | null) ?? null,
      })),
    })) as SwissRoundRecord[];
  }

  /** Throwing variant for callers that treat a missing phase as a 404. */
  async requireContext(phaseId: string): Promise<SwissContext> {
    const context = await this.loadContext(phaseId);
    if (!context) throw new NotFoundException(`Swiss phase ${phaseId} not found`);
    return context;
  }
}

export interface SwissContext {
  phaseId: string;
  tournamentId: string;
  config: SwissConfig;
  entrants: SwissEntrantRecord[];
  rounds: SwissRoundRecord[];
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || /duplicate key value/i.test(error.message ?? '');
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));
