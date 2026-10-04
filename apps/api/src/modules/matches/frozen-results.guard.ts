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
import { isOver } from '../../common/live-status';
import { correctionWithNoReason } from '../notifications/notice-texts/notice-texts';
import {
  closeAnsweredRequests,
  closeResetRequests,
  tellApproved,
  tellRejected,
  tellResetRequests,
  type DirectCorrection,
  type RequestClosureDeps,
} from './answered-requests';

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

  private get closure(): RequestClosureDeps {
    return { supabase: this.supabase, notifications: this.notifications, logger: this.logger };
  }

  async assertExchangeCreationAllowed(matchId: string, userId?: string): Promise<void> {
    return this.assertResultMutationAllowed(matchId, userId);
  }

  /**
   * Refuse any write that changes a match result once the Event is over:
   * completed, or archived, which an Event becomes on its own a day later and
   * never leaves (ruling 222a).
   *
   * Named for what it guards rather than for its first caller: creating an
   * exchange and recording a result override are the same question — "may this
   * actor still change what happened?" — and answering it in two places is how
   * one of them ends up not asking. Super-admin remains the only bypass, in
   * line with `guardExchangeMutation`.
   */
  async assertResultMutationAllowed(matchId: string, userId?: string): Promise<void> {
    const state = await this.getEventStateForMatch(matchId);
    if (!isOver(state.status)) return;
    if (await this.isSuperAdmin(userId)) return;
    // The object form: the pad and web-admin map it by `code`. A bare string
    // put this English sentence in front of a French referee.
    throw new ConflictException({
      message: 'Event results are frozen',
      code: 'event_results_frozen',
    });
  }

  /**
   * Is the Event of this bout over? A fact, not a permission: no super-admin
   * bypass. The recompute asks it to know whether anybody is still there to end
   * a bout again (rulings 225 to 230).
   */
  async isEventOver(matchId: string): Promise<boolean> {
    return isOver((await this.getEventStateForMatch(matchId)).status);
  }

  /** The Event of this bout when it is over, else null: `isEventOver` with the Event's id. */
  async overEventId(matchId: string): Promise<string | null> {
    const state = await this.getEventStateForMatch(matchId);
    return isOver(state.status) ? state.eventId : null;
  }

  async guardExchangeMutation(input: {
    exchange: ExchangeForFrozenCheck;
    requestType: ExchangeEditRequestType;
    reason: string | null;
    userId?: string;
  }): Promise<FrozenReviewResponse | null> {
    const state = await this.getEventStateForMatch(input.exchange.match_id);
    if (!isOver(state.status)) return null;
    if (await this.isSuperAdmin(input.userId)) return null;
    if (!input.userId) throw new UnauthorizedException('Authentication required');

    const reason = input.reason?.trim() || correctionWithNoReason();
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

  /**
   * A review closes its request only while it still waits. A direct correction
   * may have closed it since the review read it (`closeAnswered`); that call
   * told who asked, and a second, opposite notice would follow this one.
   */
  private async closeReviewed(
    id: string,
    verdict: { status: 'approved' } | { status: 'rejected'; rejection_reason: string },
    actorUserId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.service
      .from('exchange_edit_requests')
      .update({ ...verdict, reviewed_by_user_id: actorUserId, reviewed_at: now, updated_at: now })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('Request is already reviewed');
  }

  async markApproved(request: ExchangeEditRequestRow, actorUserId: string): Promise<void> {
    await this.closeReviewed(request.id, { status: 'approved' }, actorUserId);
    await this.writeAudit(actorUserId, 'exchange_edit_request.approve', request.id, {
      request,
    });
    await tellApproved(this.closure, request);
  }

  /**
   * A correction that asked no review has landed on this hit: close the
   * requests it answers (rulings 253, 254). An approval closes its own request
   * (`markApproved`), so it is not asked here. Never throws.
   */
  async closeAnswered(
    exchangeId: string,
    did: DirectCorrection,
    actor?: { userId?: string; bypassFrozenReview?: boolean },
  ): Promise<void> {
    if (actor?.bypassFrozenReview) return;
    await closeAnsweredRequests(this.closure, { exchangeId, did, actorUserId: actor?.userId });
  }

  async markRejected(
    request: ExchangeEditRequestRow,
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('Rejection reason is required');
    await this.closeReviewed(
      request.id,
      { status: 'rejected', rejection_reason: trimmed },
      actorUserId,
    );
    await this.writeAudit(actorUserId, 'exchange_edit_request.reject', request.id, {
      request,
      reason: trimmed,
    });
    await tellRejected(this.closure, request, trimmed);
  }

  /**
   * Close the pending requests of bouts whose hits a reset voided, and hand
   * back the ones this call closed. Never throws (`closeResetRequests`).
   */
  async rejectPendingEditsForMatch(
    matchIds: readonly string[],
    actorUserId?: string,
  ): Promise<ExchangeEditRequestRow[]> {
    return closeResetRequests(this.closure, matchIds, actorUserId);
  }

  /** Tell who asked, once the reset has done its last step. Never throws. */
  async tellClosedByReset(closed: readonly ExchangeEditRequestRow[]): Promise<void> {
    await tellResetRequests(this.closure, closed);
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
