import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { resolveForfeitPolicy, type ForfeitReason } from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
// Value import ON PURPOSE — `import type` erases DI metadata and @Optional()
// silently injects undefined (see di-wiring.regression.test.ts).
import { BracketAdvanceService } from '../phases/bracket-advance.service';
import type { CreateMatchForfeitDto } from './dto/matches.dto';
import { ClockService } from './clock.service';
import { forfeitEndReason } from './forfeit-end-reason';

type Actor = { userId?: string; staffAccountId?: string };
type Row = Record<string, unknown>;

@Injectable()
export class MatchForfeitsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly bracketAdvance?: BracketAdvanceService,
    // Optional so direct `new MatchForfeitsService(supabase)` in tests still
    // works; in the app it's provided by MatchesModule (Supabase-only dep).
    @Optional() private readonly clock?: ClockService,
  ) {}

  async createForfeit(matchId: string, dto: CreateMatchForfeitDto, actor: Actor = {}) {
    const match = await this.loadMatch(matchId);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    if (match.status === 'completed' || match.status === 'voided') {
      throw new BadRequestException('Match is already closed');
    }
    if (
      ![match.red_registration_id, match.blue_registration_id].includes(
        dto.forfeitingRegistrationId,
      )
    ) {
      throw new BadRequestException('Forfeiting registration must belong to the current match');
    }

    const active = await this.loadActiveForfeit(matchId);
    if (active) return active;

    const phase = this.phase(match);
    const tournament = this.tournament(match);
    const policy = resolveForfeitPolicy(
      tournament.ruleset_config ?? {},
      dto.reason as ForfeitReason,
    );
    const winnerRegistrationId =
      dto.forfeitingRegistrationId === match.red_registration_id
        ? match.blue_registration_id
        : match.red_registration_id;

    const canContinue = this.resolveCanContinue(policy.tournamentState, dto.canContinue);
    const scores = this.resolveScores(match, dto.forfeitingRegistrationId, policy);
    const now = new Date().toISOString();
    const priorRegistration = await this.loadRegistration(dto.forfeitingRegistrationId);

    const forfeit = await this.insertForfeit({
      match_id: matchId,
      tournament_id: phase.tournament_id,
      forfeiting_registration_id: dto.forfeitingRegistrationId,
      winner_registration_id: winnerRegistrationId,
      reason: dto.reason,
      score_policy: policy.scorePolicy,
      forfeiting_score: scores.forfeitingScore,
      opponent_score: scores.opponentScore,
      can_continue: canContinue,
      auto_created: false,
      previous_match_state: this.matchSnapshot(match),
      previous_registration_state: priorRegistration ?? {},
      note: dto.note ?? null,
      by_user_id: actor.userId ?? null,
      staff_account_id: actor.staffAccountId ?? null,
    });

    await this.completeMatch(
      matchId,
      dto.forfeitingRegistrationId,
      winnerRegistrationId as string,
      scores,
      forfeitEndReason(dto.reason),
      now,
    );
    await this.applyTournamentState(
      dto.forfeitingRegistrationId,
      policy.tournamentState,
      canContinue,
    );

    const downstreamIds: string[] = [];
    if (phase.type === 'pool' && canContinue === false) {
      downstreamIds.push(
        ...(await this.autoForfeitFuturePoolMatches(
          match,
          dto.forfeitingRegistrationId,
          dto.reason as ForfeitReason,
          forfeit.id as string,
          phase.tournament_id,
          tournament.ruleset_config ?? {},
          actor,
        )),
      );
    }

    if (phase.type !== 'pool') {
      const bracketResult = await this.applyBracketForfeit(
        match,
        phase,
        dto.forfeitingRegistrationId,
      );
      downstreamIds.push(...bracketResult.downstreamIds);
      if (bracketResult.replacementRegistrationId) {
        await this.supabase.service
          .from('match_forfeits')
          .update({
            replacement_registration_id: bracketResult.replacementRegistrationId,
            downstream_match_ids: downstreamIds,
            updated_at: now,
          })
          .eq('id', forfeit.id as string);
      }
    }

    if (downstreamIds.length > 0) {
      await this.supabase.service
        .from('match_forfeits')
        .update({ downstream_match_ids: downstreamIds, updated_at: now })
        .eq('id', forfeit.id as string);
    }

    return { ...forfeit, downstream_match_ids: downstreamIds };
  }

  async voidForfeit(forfeitId: string, actor: Actor = {}) {
    const { data } = await this.supabase.service
      .from('match_forfeits')
      .select('*')
      .eq('id', forfeitId)
      .maybeSingle();
    if (!data) throw new NotFoundException(`Forfeit ${forfeitId} not found`);
    const forfeit = data as Row;
    if (forfeit['voided_at']) throw new BadRequestException('Forfeit is already voided');

    const downstreamIds = Array.isArray(forfeit['downstream_match_ids'])
      ? (forfeit['downstream_match_ids'] as string[])
      : [];
    if (downstreamIds.length > 0) {
      const { data: downstream } = await this.supabase.service
        .from('matches')
        .select('id, status')
        .in('id', downstreamIds);
      const started = (downstream ?? []).some((row) =>
        ['running', 'paused', 'completed'].includes(String((row as Row)['status'])),
      );
      if (started) {
        throw new BadRequestException('Cannot void forfeit after a dependent match has started');
      }
    }

    const previous = (forfeit['previous_match_state'] as Row | null) ?? {};
    await this.supabase.service
      .from('matches')
      .update({
        status: previous['status'] ?? 'scheduled',
        red_score: previous['red_score'] ?? 0,
        blue_score: previous['blue_score'] ?? 0,
        winner_registration_id: previous['winner_registration_id'] ?? null,
        ended_at: previous['ended_at'] ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', forfeit['match_id'] as string);

    const previousReg = (forfeit['previous_registration_state'] as Row | null) ?? {};
    if (previousReg['status']) {
      await this.supabase.service
        .from('registrations')
        .update({ status: previousReg['status'] })
        .eq('id', forfeit['forfeiting_registration_id'] as string);
    }

    const { data: updated } = await this.supabase.service
      .from('match_forfeits')
      .update({
        voided_at: new Date().toISOString(),
        voided_by_user_id: actor.userId ?? null,
        voided_by_staff_account_id: actor.staffAccountId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', forfeitId)
      .select('*')
      .single();
    return updated;
  }

  private async autoForfeitFuturePoolMatches(
    match: Row,
    registrationId: string,
    reason: ForfeitReason,
    parentForfeitId: string,
    tournamentId: string,
    rulesetConfig: unknown,
    actor: Actor,
  ): Promise<string[]> {
    const { data } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, red_score, blue_score, status, phases(id, type, tournament_id, tournaments(id, ruleset_config))',
      )
      .eq('pool_id', match['pool_id'] as string)
      .in('status', ['scheduled', 'paused'])
      .or(`red_registration_id.eq.${registrationId},blue_registration_id.eq.${registrationId}`);

    const ids: string[] = [];
    for (const row of data ?? []) {
      const future = row as Row;
      if (future['id'] === match['id']) continue;
      const result = await this.createAutoForfeit(
        future,
        registrationId,
        reason,
        parentForfeitId,
        tournamentId,
        rulesetConfig,
        actor,
      );
      ids.push(result.matchId);
    }
    return ids;
  }

  private async createAutoForfeit(
    match: Row,
    registrationId: string,
    reason: ForfeitReason,
    parentForfeitId: string,
    tournamentId: string,
    rulesetConfig: unknown,
    actor: Actor,
  ): Promise<{ matchId: string }> {
    const policy = resolveForfeitPolicy(rulesetConfig, reason);
    const winnerRegistrationId =
      registrationId === match['red_registration_id']
        ? (match['blue_registration_id'] as string)
        : (match['red_registration_id'] as string);
    const scores = this.resolveScores(match, registrationId, policy);

    await this.insertForfeit({
      match_id: match['id'],
      tournament_id: tournamentId,
      forfeiting_registration_id: registrationId,
      winner_registration_id: winnerRegistrationId,
      reason,
      score_policy: policy.scorePolicy,
      forfeiting_score: scores.forfeitingScore,
      opponent_score: scores.opponentScore,
      can_continue: false,
      auto_created: true,
      parent_forfeit_id: parentForfeitId,
      previous_match_state: this.matchSnapshot(match),
      previous_registration_state: {},
      by_user_id: actor.userId ?? null,
      staff_account_id: actor.staffAccountId ?? null,
    });
    await this.completeMatch(
      match['id'] as string,
      registrationId,
      winnerRegistrationId,
      scores,
      forfeitEndReason(reason),
    );
    return { matchId: match['id'] as string };
  }

  private async applyBracketForfeit(
    match: Row,
    phase: { type: string },
    forfeitingRegistrationId: string,
  ): Promise<{ downstreamIds: string[]; replacementRegistrationId?: string }> {
    const downstreamIds: string[] = [];
    const replacementRegistrationId = await this.tryReplaceMainRoundOneFighter(
      match,
      forfeitingRegistrationId,
    );
    if (replacementRegistrationId) {
      return { downstreamIds, replacementRegistrationId };
    }

    if (phase.type === 'single_elim' || phase.type === 'double_elim') {
      await this.bracketAdvance?.onMatchCompleted(match['id'] as string);
    }
    if (match['bracket_slot_id']) downstreamIds.push(match['id'] as string);
    return { downstreamIds };
  }

  private async tryReplaceMainRoundOneFighter(
    match: Row,
    forfeitingRegistrationId: string,
  ): Promise<string | null> {
    if (match['status'] !== 'scheduled' || !match['bracket_slot_id']) return null;

    const { data: slot } = await this.supabase.service
      .from('bracket_slots')
      .select(
        'id, phase_id, round, source_a_type, source_b_type, registration_a_id, registration_b_id',
      )
      .eq('id', match['bracket_slot_id'] as string)
      .maybeSingle();
    const bracketSlot = slot as Row | null;
    if (!bracketSlot || bracketSlot['round'] !== 1) return null;
    if (
      bracketSlot['source_a_type'] === 'winner_of' ||
      bracketSlot['source_b_type'] === 'winner_of'
    ) {
      return null;
    }

    const replacementId = await this.findNextReplacementRegistration(
      this.phase(match).tournament_id,
      bracketSlot['phase_id'] as string,
    );
    if (!replacementId) return null;

    const forfeitsOnA = bracketSlot['registration_a_id'] === forfeitingRegistrationId;
    await this.supabase.service
      .from('bracket_slots')
      .update(
        forfeitsOnA
          ? { registration_a_id: replacementId, updated_at: new Date().toISOString() }
          : { registration_b_id: replacementId, updated_at: new Date().toISOString() },
      )
      .eq('id', bracketSlot['id'] as string);

    await this.supabase.service
      .from('matches')
      .update(
        forfeitsOnA
          ? {
              red_registration_id: replacementId,
              status: 'scheduled',
              winner_registration_id: null,
              ended_at: null,
              red_score: 0,
              blue_score: 0,
              updated_at: new Date().toISOString(),
            }
          : {
              blue_registration_id: replacementId,
              status: 'scheduled',
              winner_registration_id: null,
              ended_at: null,
              red_score: 0,
              blue_score: 0,
              updated_at: new Date().toISOString(),
            },
      )
      .eq('id', match['id'] as string);

    return replacementId;
  }

  private async findNextReplacementRegistration(
    tournamentId: string,
    phaseId: string,
  ): Promise<string | null> {
    const { data: slots } = await this.supabase.service
      .from('bracket_slots')
      .select('registration_a_id, registration_b_id')
      .eq('phase_id', phaseId);
    const used = new Set<string>();
    for (const slot of slots ?? []) {
      const row = slot as Row;
      if (typeof row['registration_a_id'] === 'string') used.add(row['registration_a_id']);
      if (typeof row['registration_b_id'] === 'string') used.add(row['registration_b_id']);
    }

    const { data: registrations } = await this.supabase.service
      .from('registrations')
      .select('id, status, seed, bib_number')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in', 'done'])
      .order('seed', { ascending: true, nullsFirst: false });

    for (const registration of registrations ?? []) {
      const row = registration as Row;
      const id = row['id'] as string;
      if (!used.has(id)) return id;
    }
    return null;
  }

  private resolveScores(
    match: Row,
    forfeitingRegistrationId: string,
    policy: { scorePolicy: string; lossScore: number; opponentScore: number },
  ) {
    const redForfeits = forfeitingRegistrationId === match['red_registration_id'];
    const currentForfeitingScore =
      Number(redForfeits ? match['red_score'] : match['blue_score']) || 0;
    const currentOpponentScore =
      Number(redForfeits ? match['blue_score'] : match['red_score']) || 0;
    return {
      redScore:
        policy.scorePolicy === 'keep_current'
          ? Number(match['red_score'] ?? 0)
          : redForfeits
            ? policy.lossScore
            : policy.opponentScore,
      blueScore:
        policy.scorePolicy === 'keep_current'
          ? Number(match['blue_score'] ?? 0)
          : redForfeits
            ? policy.opponentScore
            : policy.lossScore,
      forfeitingScore:
        policy.scorePolicy === 'keep_current' ? currentForfeitingScore : policy.lossScore,
      opponentScore:
        policy.scorePolicy === 'keep_current' ? currentOpponentScore : policy.opponentScore,
    };
  }

  private async completeMatch(
    matchId: string,
    _forfeitingRegistrationId: string,
    winnerRegistrationId: string,
    scores: { redScore: number; blueScore: number },
    endReason: string,
    endedAt = new Date().toISOString(),
  ) {
    await this.supabase.service
      .from('matches')
      .update({
        status: 'completed',
        ended_at: endedAt,
        winner_registration_id: winnerRegistrationId,
        red_score: scores.redScore,
        blue_score: scores.blueScore,
        // 'black_card' | 'forfeit' — lets the pad + TV label the result.
        end_reason: endReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId);

    // A forfeit ends the bout — stop the clock too so it freezes and the
    // scoreboard's clock-driven endcard fires. Best-effort: the match is
    // already completed, so a clock-end failure must not fail the forfeit.
    // Only running/halted clocks can 'end' (idle/ended throw → skipped).
    if (this.clock) {
      try {
        const clk = await this.clock.getClockState(matchId);
        if (clk.status === 'running' || clk.status === 'halted') {
          await this.clock.clockAction(matchId, 'end', 'auto: forfeit', {
            canOverrideLocked: true,
          });
        }
      } catch {
        // swallow — clock end is best-effort
      }
    }
  }

  private async applyTournamentState(
    registrationId: string,
    state: string,
    canContinue: boolean | null,
  ) {
    if (state === 'disqualified') {
      await this.supabase.service
        .from('registrations')
        .update({ status: 'disqualified' })
        .eq('id', registrationId);
    } else if (state === 'withdrawn' || canContinue === false) {
      await this.supabase.service
        .from('registrations')
        .update({ status: 'withdrawn' })
        .eq('id', registrationId);
    }
  }

  private resolveCanContinue(state: string, input: boolean | undefined): boolean | null {
    if (state === 'ask') return input ?? true;
    if (state === 'match_only') return true;
    return false;
  }

  private async insertForfeit(row: Row): Promise<Row> {
    const { data, error } = await this.supabase.service
      .from('match_forfeits')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return (data as Row | null) ?? row;
  }

  private async loadActiveForfeit(matchId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('match_forfeits')
      .select('*')
      .eq('match_id', matchId)
      .is('voided_at', null)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private async loadMatch(matchId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('*, phases(id, type, tournament_id, config_json, tournaments(id, ruleset_config))')
      .eq('id', matchId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private async loadRegistration(registrationId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('registrations')
      .select('id, status')
      .eq('id', registrationId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private phase(match: Row) {
    const phase = Array.isArray(match['phases']) ? match['phases'][0] : match['phases'];
    return phase as { id: string; type: string; tournament_id: string; tournaments?: unknown };
  }

  private tournament(match: Row) {
    const phase = this.phase(match);
    const tournament = Array.isArray(phase.tournaments) ? phase.tournaments[0] : phase.tournaments;
    return (tournament ?? {}) as { id?: string; ruleset_config?: unknown };
  }

  private matchSnapshot(match: Row) {
    return {
      status: match['status'],
      red_score: match['red_score'],
      blue_score: match['blue_score'],
      winner_registration_id: match['winner_registration_id'] ?? null,
      ended_at: match['ended_at'] ?? null,
    };
  }
}
