import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { hasPlatformTier } from '../../common/auth/platform-role';

export type ExchangeEditRequestType = 'void_exchange' | 'revert_void_exchange';
export type ExchangeEditRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ExchangeForFrozenCheck {
  id: string;
  match_id: string;
  voided: boolean;
}

export interface FrozenReviewResponse {
  pendingReview: true;
  requestId: string;
  status: 'pending';
}

export interface ExchangeEditRequestRow {
  id: string;
  event_id: string;
  match_id: string;
  exchange_id: string;
  requested_by_user_id: string;
  request_type: ExchangeEditRequestType;
  reason: string;
  status: ExchangeEditRequestStatus;
  requested_payload: Record<string, unknown>;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface EventFreezeState {
  eventId: string;
  status: string;
}

@Injectable()
export class FrozenResultsGuard {
  private readonly logger = new Logger(FrozenResultsGuard.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
  ) {}

  async assertExchangeCreationAllowed(matchId: string, userId?: string): Promise<void> {
    return this.assertResultMutationAllowed(matchId, userId);
  }

  /**
   * Refuse any write that changes a match result once the event is completed.
   *
   * Named for what it guards rather than for its first caller: creating an
   * exchange and recording a result override are the same question — "may this
   * actor still change what happened?" — and answering it in two places is how
   * one of them ends up not asking. Super-admin remains the only bypass, in
   * line with `guardExchangeMutation`.
   */
  async assertResultMutationAllowed(matchId: string, userId?: string): Promise<void> {
    const state = await this.getEventStateForMatch(matchId);
    if (state.status !== 'completed') return;
    if (await this.isSuperAdmin(userId)) return;
    throw new ConflictException('Event results are frozen');
  }

  async guardExchangeMutation(input: {
    exchange: ExchangeForFrozenCheck;
    requestType: ExchangeEditRequestType;
    reason: string | null;
    userId?: string;
  }): Promise<FrozenReviewResponse | null> {
    const state = await this.getEventStateForMatch(input.exchange.match_id);
    if (state.status !== 'completed') return null;
    if (await this.isSuperAdmin(input.userId)) return null;
    if (!input.userId) throw new UnauthorizedException('Authentication required');

    const reason = input.reason?.trim() || 'Frozen results correction requested';
    const existing = await this.findPendingRequest(input.exchange.id, input.requestType);
    if (existing) return { pendingReview: true, requestId: existing.id, status: 'pending' };

    const payload = {
      exchange: input.exchange,
      requestedAction: input.requestType,
      requestedReason: reason,
    };
    const { data, error } = await this.supabase.service
      .from('exchange_edit_requests')
      .insert({
        event_id: state.eventId,
        match_id: input.exchange.match_id,
        exchange_id: input.exchange.id,
        requested_by_user_id: input.userId,
        request_type: input.requestType,
        reason,
        status: 'pending',
        requested_payload: payload,
      })
      .select('id')
      .single();

    if (error) {
      const duplicate = await this.findPendingRequest(input.exchange.id, input.requestType);
      if (duplicate) return { pendingReview: true, requestId: duplicate.id, status: 'pending' };
      throw new BadRequestException(error.message);
    }

    const requestId = (data as { id: string }).id;
    await this.writeAudit(input.userId, 'exchange_edit_request.create', requestId, payload);
    return { pendingReview: true, requestId, status: 'pending' };
  }

  async listRequests(status: ExchangeEditRequestStatus | 'all' = 'pending') {
    let query = this.supabase.service.from('exchange_edit_requests').select('*');
    if (status !== 'all') query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ExchangeEditRequestRow[];
  }

  async loadPendingRequest(id: string): Promise<ExchangeEditRequestRow> {
    const { data, error } = await this.supabase.service
      .from('exchange_edit_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) throw new BadRequestException(`Exchange edit request ${id} not found`);
    const request = data as ExchangeEditRequestRow;
    if (request.status !== 'pending') throw new BadRequestException('Request is already reviewed');
    return request;
  }

  async markApproved(request: ExchangeEditRequestRow, actorUserId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.service
      .from('exchange_edit_requests')
      .update({
        status: 'approved',
        reviewed_by_user_id: actorUserId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', request.id);
    if (error) throw new BadRequestException(error.message);
    await this.writeAudit(actorUserId, 'exchange_edit_request.approve', request.id, {
      request,
    });
  }

  async markRejected(
    request: ExchangeEditRequestRow,
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('Rejection reason is required');
    const now = new Date().toISOString();
    const { error } = await this.supabase.service
      .from('exchange_edit_requests')
      .update({
        status: 'rejected',
        reviewed_by_user_id: actorUserId,
        reviewed_at: now,
        rejection_reason: trimmed,
        updated_at: now,
      })
      .eq('id', request.id);
    if (error) throw new BadRequestException(error.message);
    await this.writeAudit(actorUserId, 'exchange_edit_request.reject', request.id, {
      request,
      reason: trimmed,
    });
    await this.notifications.sendImmediate({
      kind: 'exchange_edit_rejected',
      entityId: request.id,
      userId: request.requested_by_user_id,
      title: 'Exchange correction rejected',
      body: trimmed,
      url: '/notifications',
      preference: 'schedule_changes',
    });
  }

  /**
   * Close the pending edit requests on bouts that have just been un-completed.
   *
   * A request names an EXCHANGE, and un-completing a bout voids every exchange
   * on it. Both pending shapes then rot, in opposite directions:
   *
   *   - `void_exchange` can never be approved again. `voidExchange` refuses an
   *     already-voided exchange, so the row sits in the review queue forever,
   *     inflating the super-admin badge and — because
   *     `exchange_edit_requests_one_pending_idx` is UNIQUE on
   *     `(exchange_id, request_type) WHERE status = 'pending'` — holding the slot
   *     so no fresh request on that exchange can ever be filed.
   *   - `revert_void_exchange` is worse, because it still WORKS. Approving one
   *     un-voids a hit the revert deliberately threw away and recomputes the
   *     score of a bout nobody has fought yet.
   *
   * Rejected rather than deleted: the request was a real thing somebody asked
   * for, and the requester gets told why. `reviewed_by_user_id` is the actor or
   * NULL — the clock and the pad reach this with a staff account and no user id,
   * and inventing a sentinel uuid there would put a fictional reviewer in the
   * audit trail.
   *
   * Best-effort ON PURPOSE, the one place in this class that swallows. It runs
   * inside the un-completion owner AFTER the bout has been put back; throwing
   * here would fail a reset that has already happened, to tidy a queue.
   */
  async rejectPendingEditsForMatch(
    matchIds: readonly string[],
    reason: string,
    actorUserId?: string,
  ): Promise<void> {
    if (matchIds.length === 0) return;
    const now = new Date().toISOString();
    const { error } = await this.supabase.service
      .from('exchange_edit_requests')
      .update({
        status: 'rejected',
        reviewed_by_user_id: actorUserId ?? null,
        reviewed_at: now,
        rejection_reason: reason,
        updated_at: now,
      })
      .in('match_id', [...matchIds])
      .eq('status', 'pending');
    if (error) {
      this.logger.warn(
        `Could not close pending exchange edits for ${matchIds.join(', ')}: ${error.message}`,
      );
    }
  }

  private async getEventStateForMatch(matchId: string): Promise<EventFreezeState> {
    const { data: match, error: matchError } = await this.supabase.service
      .from('matches')
      .select('id, phase_id')
      .eq('id', matchId)
      .maybeSingle();
    if (matchError || !match) throw new BadRequestException(`Match ${matchId} not found`);

    const phaseId = (match as { phase_id: string }).phase_id;
    const { data: phase, error: phaseError } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .eq('id', phaseId)
      .maybeSingle();
    if (phaseError || !phase) throw new BadRequestException(`Phase ${phaseId} not found`);

    const tournamentId = (phase as { tournament_id: string }).tournament_id;
    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentError || !tournament) {
      throw new BadRequestException(`Tournament ${tournamentId} not found`);
    }

    const eventId = (tournament as { event_id: string }).event_id;
    const { data: event, error: eventError } = await this.supabase.service
      .from('events')
      .select('id, status')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError || !event) throw new BadRequestException(`Event ${eventId} not found`);

    return { eventId, status: (event as { status: string }).status };
  }

  /**
   * `super_admin`-EXACT. Bypassing the frozen-results interlock writes into a
   * completed event; a `platform_admin` has a sanctioned path for the same
   * outcome — approving an exchange-edit request — and does not get the
   * override.
   */
  private async isSuperAdmin(userId?: string): Promise<boolean> {
    return hasPlatformTier(this.supabase, userId, 'super_admin');
  }

  private async findPendingRequest(
    exchangeId: string,
    requestType: ExchangeEditRequestType,
  ): Promise<{ id: string } | null> {
    const { data } = await this.supabase.service
      .from('exchange_edit_requests')
      .select('id')
      .eq('exchange_id', exchangeId)
      .eq('request_type', requestType)
      .eq('status', 'pending')
      .maybeSingle();
    return (data as { id: string } | null) ?? null;
  }

  private async writeAudit(
    actorUserId: string,
    action: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // THROWS, unlike most audit writers: an exchange edit on a frozen result is
    // only defensible because it is recorded, so a silent audit failure would
    // leave an unexplained score change behind.
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId,
      action,
      entityType: 'exchange_edit_request',
      entityId,
      payload,
    });
    if (error) throw new BadRequestException(error.message);
  }
}
