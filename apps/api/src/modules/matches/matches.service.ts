import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { ScoringService } from './scoring.service';
import type {
  CreateExchangeDto,
  CreateMatchDto,
  UpdateMatchStatusDto,
  VoidExchangeDto,
} from './dto/matches.dto';

@Injectable()
export class MatchesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly scoring: ScoringService,
    private readonly notifications: NotificationSchedulerService,
    private readonly followNotifications: FollowNotificationSchedulerService,
  ) {}

  // ── Matches ──────────────────────────────────────────────────────────────────

  async listByPhase(phaseId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('*')
      .eq('phase_id', phaseId)
      .order('match_number_label', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getMatch(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
    return data;
  }

  async createMatch(dto: CreateMatchDto) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .insert({
        phase_id: dto.phaseId,
        pool_id: dto.poolId ?? null,
        lice_id: dto.liceId ?? null,
        red_registration_id: dto.redRegistrationId,
        blue_registration_id: dto.blueRegistrationId,
        scheduled_at: dto.scheduledAt ?? null,
        ruleset_code: dto.rulesetCode ?? 'TF_v1',
        ruleset_version: dto.rulesetVersion ?? '1.0.0',
        match_number_label: dto.matchNumberLabel ?? null,
        status: 'scheduled',
        red_score: 0,
        blue_score: 0,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateStatus(matchId: string, dto: UpdateMatchStatusDto) {
    const updates: Record<string, unknown> = {
      status: dto.status,
      updated_at: new Date().toISOString(),
    };

    if (dto.status === 'running') updates['started_at'] = new Date().toISOString();
    if (dto.status === 'completed') {
      updates['ended_at'] = new Date().toISOString();
      if (dto.winnerRegistrationId) {
        updates['winner_registration_id'] = dto.winnerRegistrationId;
      }
    }

    const { data, error } = await this.supabase.service
      .from('matches')
      .update(updates)
      .eq('id', matchId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async voidMatch(matchId: string) {
    return this.updateStatus(matchId, { status: 'voided' });
  }

  async scheduleMatch(matchId: string, liceId: string | null, scheduledAt: string | null) {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    updates['lice_id'] = liceId || null;
    updates['scheduled_at'] = scheduledAt || null;

    const { data, error } = await this.supabase.service
      .from('matches')
      .update(updates)
      .eq('id', matchId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    await this.notifications.scheduleMatchStarting(matchId);
    await this.followNotifications.scheduleMatchStarting(matchId);
    return data;
  }

  // ── Exchanges ─────────────────────────────────────────────────────────────────

  async listExchanges(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('exchanges')
      .select('*')
      .eq('match_id', matchId)
      .order('sequence', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Insert an exchange — idempotent on client_uuid.
   * Recomputes match score after insert.
   *
   * AGENTS.md hard rule #1: score is derived from exchanges, never stored
   * as the source of truth.
   */
  async createExchange(matchId: string, dto: CreateExchangeDto) {
    // Idempotency check: if client_uuid already exists, return existing row
    const { data: existing } = await this.supabase.service
      .from('exchanges')
      .select('*')
      .eq('client_uuid', dto.clientUuid)
      .maybeSingle();

    if (existing) {
      // Idempotent — return the existing exchange without error
      return existing;
    }

    // Compute score deltas for materialized columns
    const { redDelta, blueDelta } = this.computeDeltas(dto);

    const { data, error } = await this.supabase.service
      .from('exchanges')
      .insert({
        client_uuid: dto.clientUuid,
        match_id: matchId,
        sequence: dto.sequence,
        type: dto.type,
        occurred_at: dto.occurredAt,
        recorded_at: new Date().toISOString(),
        duration_since_prev_ms: dto.durationSincePrevMs ?? null,
        first_striker_color: dto.firstStrikerColor ?? null,
        first_strike_value: dto.firstStrikeValue ?? null,
        afterblow_value: dto.afterblowValue ?? null,
        no_exchange_reason: dto.noExchangeReason ?? null,
        red_score_delta: redDelta,
        blue_score_delta: blueDelta,
        voided: false,
      })
      .select('*')
      .single();

    if (error) {
      // Handle race condition: another request inserted the same client_uuid
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        const { data: raceExisting } = await this.supabase.service
          .from('exchanges')
          .select('*')
          .eq('client_uuid', dto.clientUuid)
          .maybeSingle();
        if (raceExisting) return raceExisting;
      }
      throw new BadRequestException(error.message);
    }

    // Recompute authoritative match score from all non-voided exchanges
    await this.scoring.recomputeMatchScore(matchId);

    return data;
  }

  /**
   * Void an exchange — sets voided=true, never deletes.
   * Recomputes match score after void.
   *
   * AGENTS.md: "Voiding an exchange must never destroy the row."
   */
  async voidExchange(exchangeId: string, dto: VoidExchangeDto) {
    const { data: exchange, error: fetchError } = await this.supabase.service
      .from('exchanges')
      .select('id, match_id, voided')
      .eq('id', exchangeId)
      .maybeSingle();

    if (fetchError || !exchange) throw new NotFoundException(`Exchange ${exchangeId} not found`);

    const ex = exchange as { id: string; match_id: string; voided: boolean };
    if (ex.voided) {
      throw new BadRequestException('Exchange is already voided');
    }

    const { data, error } = await this.supabase.service
      .from('exchanges')
      .update({
        voided: true,
        voided_reason: dto.reason ?? null,
      })
      .eq('id', exchangeId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Recompute authoritative match score
    await this.scoring.recomputeMatchScore(ex.match_id);

    return data;
  }

  /**
   * Revert a voided exchange — sets voided=false, clears voided_reason.
   * Recomputes match score after restore.
   * AC: "Reverting a void restores the exchange."
   */
  async revertVoidExchange(exchangeId: string) {
    const { data: exchange, error: fetchError } = await this.supabase.service
      .from('exchanges')
      .select('id, match_id, voided')
      .eq('id', exchangeId)
      .maybeSingle();

    if (fetchError || !exchange) throw new NotFoundException(`Exchange ${exchangeId} not found`);

    const ex = exchange as { id: string; match_id: string; voided: boolean };
    if (!ex.voided) {
      throw new BadRequestException('Exchange is not voided');
    }

    const { data, error } = await this.supabase.service
      .from('exchanges')
      .update({ voided: false, voided_reason: null })
      .eq('id', exchangeId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Recompute authoritative match score
    await this.scoring.recomputeMatchScore(ex.match_id);

    return data;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private computeDeltas(dto: CreateExchangeDto): { redDelta: number; blueDelta: number } {
    let redDelta = 0;
    let blueDelta = 0;

    switch (dto.type) {
      case 'clean':
        if (dto.firstStrikerColor === 'red') redDelta = dto.firstStrikeValue ?? 0;
        else if (dto.firstStrikerColor === 'blue') blueDelta = dto.firstStrikeValue ?? 0;
        break;
      case 'afterblow':
        if (dto.firstStrikerColor === 'red') {
          redDelta = dto.firstStrikeValue ?? 0;
          blueDelta = dto.afterblowValue ?? 0;
        } else if (dto.firstStrikerColor === 'blue') {
          blueDelta = dto.firstStrikeValue ?? 0;
          redDelta = dto.afterblowValue ?? 0;
        }
        break;
      case 'double':
      case 'no_exchange':
        break;
    }

    return { redDelta, blueDelta };
  }
}
