/**
 * review-queue.service.ts — Unified super-admin review queue
 *
 * Aggregates 5 request types (deletion, exchange_edit, club_review,
 * league_tournament_request, league_membership_request) into a single
 * normalised list and dispatches approve/reject actions to the
 * appropriate type-specific handler.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { EventsService } from '../events/events.service';
import { LeagueMembershipRequestsService } from '../leagues/league-membership-requests.service';
import { LeaguesService } from '../leagues/leagues.service';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';
import { UserDirectoryService } from '../user-directory/user-directory.service';

// ── Public interface ──────────────────────────────────────────────────────────

export interface ReviewQueueItem {
  type:
    | 'deletion'
    | 'exchange_edit'
    | 'club_review'
    | 'league_tournament_request'
    | 'league_membership_request';
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'linked' | 'cancelled';
  targetLabel: string;
  targetHref: string | null;
  requesterUserId: string;
  requesterName: string | null;
  requesterEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  reason: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ReviewQueueService {
  private readonly logger = new Logger(ReviewQueueService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly eventsService: EventsService,
    private readonly exchangeEditService: ExchangeEditRequestsAdminService,
    private readonly leaguesService: LeaguesService,
    private readonly membershipRequestsService: LeagueMembershipRequestsService,
    private readonly userDirectory: UserDirectoryService,
  ) {}

  // ── listAll ──────────────────────────────────────────────────────────────────

  async listAll(
    typeFilter: string | null,
    statusFilter: string | null,
  ): Promise<ReviewQueueItem[]> {
    const effectiveStatus = statusFilter === null ? 'pending' : statusFilter;

    const [deletions, exchanges, clubReviews, leagueTournamentReqs, leagueMembershipReqs] =
      await Promise.all([
        !typeFilter || typeFilter === 'deletion'
          ? this.fetchDeletions(effectiveStatus)
          : Promise.resolve([] as ReviewQueueItem[]),
        !typeFilter || typeFilter === 'exchange_edit'
          ? this.fetchExchangeEdits(effectiveStatus)
          : Promise.resolve([] as ReviewQueueItem[]),
        !typeFilter || typeFilter === 'club_review'
          ? this.fetchClubReviews(effectiveStatus)
          : Promise.resolve([] as ReviewQueueItem[]),
        !typeFilter || typeFilter === 'league_tournament_request'
          ? this.fetchLeagueTournamentRequests(effectiveStatus)
          : Promise.resolve([] as ReviewQueueItem[]),
        !typeFilter || typeFilter === 'league_membership_request'
          ? this.fetchLeagueMembershipRequests(effectiveStatus)
          : Promise.resolve([] as ReviewQueueItem[]),
      ]);

    const all = [
      ...deletions,
      ...exchanges,
      ...clubReviews,
      ...leagueTournamentReqs,
      ...leagueMembershipReqs,
    ];
    all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return all;
  }

  // ── approve ──────────────────────────────────────────────────────────────────

  async approve(
    type: string,
    id: string,
    actorUserId: string,
    confirmation?: { typedConfirmation?: string },
  ): Promise<void> {
    switch (type) {
      case 'deletion':
        await this.approveDeletion(id, actorUserId, confirmation);
        break;
      case 'exchange_edit':
        await this.exchangeEditService.approve(id, actorUserId);
        break;
      case 'club_review':
        await this.approveClubReview(id, actorUserId);
        break;
      case 'league_tournament_request':
        await this.leaguesService.reviewTournamentLink(id, { status: 'approved' }, actorUserId);
        await this.writeAuditLog(
          actorUserId,
          'league.tournament_request.approved',
          'league_tournament_link',
          id,
          {},
        );
        break;
      case 'league_membership_request':
        await this.membershipRequestsService.review(id, { status: 'approved' }, actorUserId);
        await this.writeAuditLog(
          actorUserId,
          'league.membership_request.approved',
          'league_membership_request',
          id,
          {},
        );
        break;
      default:
        throw new BadRequestException(`Unknown review queue type: ${type}`);
    }
  }

  // ── reject ───────────────────────────────────────────────────────────────────

  async reject(
    type: string,
    id: string,
    actorUserId: string,
    rejectionReason: string,
  ): Promise<void> {
    switch (type) {
      case 'deletion':
        await this.rejectRow(
          'deletion_requests',
          id,
          actorUserId,
          rejectionReason,
          'deletion.reject',
          'deletion_request',
        );
        break;
      case 'exchange_edit':
        await this.exchangeEditService.reject(id, actorUserId, rejectionReason);
        break;
      case 'club_review':
        await this.rejectRow(
          'club_review_requests',
          id,
          actorUserId,
          rejectionReason,
          'club_review.reject',
          'club_review_request',
        );
        break;
      case 'league_tournament_request':
        await this.leaguesService.reviewTournamentLink(id, { status: 'rejected' }, actorUserId);
        await this.writeAuditLog(
          actorUserId,
          'league.tournament_request.rejected',
          'league_tournament_link',
          id,
          { rejectionReason },
        );
        break;
      case 'league_membership_request':
        await this.membershipRequestsService.review(
          id,
          { status: 'rejected', reviewNote: rejectionReason },
          actorUserId,
        );
        await this.writeAuditLog(
          actorUserId,
          'league.membership_request.rejected',
          'league_membership_request',
          id,
          { rejectionReason },
        );
        break;
      default:
        throw new BadRequestException(`Unknown review queue type: ${type}`);
    }
  }

  // ── countPending ─────────────────────────────────────────────────────────────

  /**
   * Total pending items across the five review-queue sources. Drives the
   * sidebar badge + the header notification-bell pill — both poll this
   * via /admin/notifications/summary on a 60 s cadence so the call must
   * stay cheap: each source uses Supabase's `head: true, count: 'exact'`
   * so no row data is returned.
   *
   * Tolerant to a missing source: any table that errors out (e.g. a
   * partial fresh deploy where league migrations haven't landed yet)
   * contributes 0, logged via `this.logger.warn`, so the bell still
   * surfaces the surviving counts.
   */
  async countPending(): Promise<number> {
    const sources: Array<{ table: string; status: string }> = [
      { table: 'deletion_requests', status: 'pending' },
      { table: 'exchange_edit_requests', status: 'pending' },
      { table: 'club_review_requests', status: 'pending' },
      // league_tournament_links + league_membership_requests use 'requested'
      // as the wire word for pending — match listAll's translation.
      { table: 'league_tournament_links', status: 'requested' },
      { table: 'league_membership_requests', status: 'requested' },
    ];

    const counts = await Promise.all(
      sources.map(async ({ table, status }) => {
        const { count, error } = await this.supabase.service
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('status', status);
        if (error) {
          this.logger.warn(`countPending: ${table} failed — ${error.message}; contributing 0.`);
          return 0;
        }
        return count ?? 0;
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  }

  // ── Private: fetch helpers ────────────────────────────────────────────────────

  private async fetchDeletions(statusFilter: string): Promise<ReviewQueueItem[]> {
    let q = this.supabase.service
      .from('deletion_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];

    // Batch resolve: user names + org names + target labels
    const userIds = [
      ...new Set([
        ...rows.map((r) => r['requester_user_id'] as string),
        ...rows
          .map((r) => r['reviewed_by_user_id'] as string | null)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const orgIds = [...new Set(rows.map((r) => r['organization_id'] as string).filter(Boolean))];
    const targetIds = {
      event: rows.filter((r) => r['target_type'] === 'event').map((r) => r['target_id'] as string),
      tournament: rows
        .filter((r) => r['target_type'] === 'tournament')
        .map((r) => r['target_id'] as string),
    };

    const [userMap, orgMap, eventMap, tournMap] = await Promise.all([
      this.userDirectory.resolveUsers(userIds),
      this.resolveOrgNames(orgIds),
      targetIds.event.length
        ? this.resolveEventNames(targetIds.event)
        : Promise.resolve(new Map<string, string>()),
      targetIds.tournament.length
        ? this.resolveTournamentNames(targetIds.tournament)
        : Promise.resolve(new Map<string, string>()),
    ]);

    return rows.map((r) => {
      const targetType = r['target_type'] as string;
      const targetId = r['target_id'] as string;
      const targetName =
        targetType === 'event'
          ? (eventMap.get(targetId) ?? targetId)
          : (tournMap.get(targetId) ?? targetId);
      const orgId = r['organization_id'] as string | null;
      const reqId = r['requester_user_id'] as string;
      const reqUser = userMap.get(reqId);
      const revId = (r['reviewed_by_user_id'] as string | null) ?? null;
      const revUser = revId ? userMap.get(revId) : null;
      return {
        type: 'deletion' as const,
        id: r['id'] as string,
        status: r['status'] as ReviewQueueItem['status'],
        targetLabel: `${targetType} ${targetName}`,
        targetHref:
          targetType === 'event' ? `/admin/events/${targetId}` : `/admin/tournaments/${targetId}`,
        requesterUserId: reqId,
        requesterName: reqUser?.name ?? null,
        requesterEmail: reqUser?.email ?? null,
        organizationId: orgId,
        organizationName: orgId ? (orgMap.get(orgId) ?? null) : null,
        reason: (r['reason'] as string | null) ?? null,
        rejectionReason: (r['rejection_reason'] as string | null) ?? null,
        reviewedByUserId: revId,
        reviewedByName: revUser?.name ?? null,
        reviewedByEmail: revUser?.email ?? null,
        reviewedAt: (r['reviewed_at'] as string | null) ?? null,
        createdAt: r['created_at'] as string,
      };
    });
  }

  private async fetchExchangeEdits(statusFilter: string): Promise<ReviewQueueItem[]> {
    let q = this.supabase.service
      .from('exchange_edit_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];

    const userIds = [
      ...new Set([
        ...rows.map((r) => r['requested_by_user_id'] as string),
        ...rows
          .map((r) => r['reviewed_by_user_id'] as string | null)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const userMap = await this.userDirectory.resolveUsers(userIds);

    return rows.map((r) => {
      const reqId = r['requested_by_user_id'] as string;
      const reqUser = userMap.get(reqId);
      const revId = (r['reviewed_by_user_id'] as string | null) ?? null;
      const revUser = revId ? userMap.get(revId) : null;
      return {
        type: 'exchange_edit' as const,
        id: r['id'] as string,
        status: r['status'] as ReviewQueueItem['status'],
        targetLabel: `match ${r['match_id'] as string} exchange ${r['exchange_id'] as string}`,
        targetHref: null,
        requesterUserId: reqId,
        requesterName: reqUser?.name ?? null,
        requesterEmail: reqUser?.email ?? null,
        organizationId: null,
        organizationName: null,
        reason: (r['reason'] as string | null) ?? null,
        rejectionReason: (r['rejection_reason'] as string | null) ?? null,
        reviewedByUserId: revId,
        reviewedByName: revUser?.name ?? null,
        reviewedByEmail: revUser?.email ?? null,
        reviewedAt: (r['reviewed_at'] as string | null) ?? null,
        createdAt: r['created_at'] as string,
      };
    });
  }

  private async fetchClubReviews(statusFilter: string): Promise<ReviewQueueItem[]> {
    let q = this.supabase.service
      .from('club_review_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];

    const userIds = [
      ...new Set([
        ...rows.map((r) => r['requester_user_id'] as string),
        ...rows
          .map((r) => r['reviewed_by_user_id'] as string | null)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const orgIds = [...new Set(rows.map((r) => r['organization_id'] as string).filter(Boolean))];
    const clubIds = [...new Set(rows.map((r) => r['proposed_club_id'] as string).filter(Boolean))];

    const [userMap, orgMap, clubMap] = await Promise.all([
      this.userDirectory.resolveUsers(userIds),
      this.resolveOrgNames(orgIds),
      this.resolveClubNames(clubIds),
    ]);

    return rows.map((r) => {
      const orgId = r['organization_id'] as string | null;
      const clubId = r['proposed_club_id'] as string;
      const reqId = r['requester_user_id'] as string;
      const reqUser = userMap.get(reqId);
      const revId = (r['reviewed_by_user_id'] as string | null) ?? null;
      const revUser = revId ? userMap.get(revId) : null;
      return {
        type: 'club_review' as const,
        id: r['id'] as string,
        status: r['status'] as ReviewQueueItem['status'],
        targetLabel: clubMap.get(clubId) ?? clubId,
        targetHref: clubId ? `/admin/clubs/${clubId}` : null,
        requesterUserId: reqId,
        requesterName: reqUser?.name ?? null,
        requesterEmail: reqUser?.email ?? null,
        organizationId: orgId,
        organizationName: orgId ? (orgMap.get(orgId) ?? null) : null,
        reason: (r['review_notes'] as string | null) ?? null,
        rejectionReason: null,
        reviewedByUserId: revId,
        reviewedByName: revUser?.name ?? null,
        reviewedByEmail: revUser?.email ?? null,
        reviewedAt: null,
        createdAt: r['created_at'] as string,
      };
    });
  }

  private async fetchLeagueTournamentRequests(statusFilter: string): Promise<ReviewQueueItem[]> {
    // league_tournament_links uses 'requested' instead of 'pending' — translate
    // the queue-wide filter so super-admins toggling status filters see the
    // same rows under either name.
    const dbStatus = statusFilter === 'pending' ? 'requested' : statusFilter;

    let q = this.supabase.service
      .from('league_tournament_links')
      .select(
        '*, leagues:league_id(id, name, slug), tournaments:tournament_id(id, name, weapon, event_id, events:event_id(id, name, organization_id, organizations:organization_id(id, name)))',
      )
      .order('created_at', { ascending: false });
    if (dbStatus !== 'all') q = q.eq('status', dbStatus) as typeof q;
    // Exclude 'removed' — those are unlinked rows, not pending review.
    q = q.neq('status', 'removed') as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];

    const userIds = [
      ...new Set([
        ...rows
          .map((r) => r['requested_by_user_id'] as string | null)
          .filter((id): id is string => Boolean(id)),
        ...rows
          .map((r) => r['reviewed_by_user_id'] as string | null)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const userMap = await this.userDirectory.resolveUsers(userIds);

    return rows.map((r) => {
      const league = (r['leagues'] ?? {}) as Record<string, unknown>;
      const tournament = (r['tournaments'] ?? {}) as Record<string, unknown>;
      const events = (tournament['events'] ?? {}) as Record<string, unknown>;
      const orgs = (events['organizations'] ?? {}) as Record<string, unknown>;

      const leagueId = (league['id'] as string | null) ?? null;
      const leagueName = (league['name'] as string | null) ?? leagueId ?? 'Unknown league';
      const tournamentId = (tournament['id'] as string | null) ?? null;
      const tournamentName = (tournament['name'] as string | null) ?? tournamentId ?? 'Tournament';
      const eventName = (events['name'] as string | null) ?? null;
      const orgId = (orgs['id'] as string | null) ?? null;
      const orgName = (orgs['name'] as string | null) ?? null;

      const reqId = (r['requested_by_user_id'] as string | null) ?? '';
      const reqUser = reqId ? userMap.get(reqId) : null;
      const revId = (r['reviewed_by_user_id'] as string | null) ?? null;
      const revUser = revId ? userMap.get(revId) : null;

      const dbStat = r['status'] as string;
      const normalised: ReviewQueueItem['status'] =
        dbStat === 'requested'
          ? 'pending'
          : dbStat === 'approved'
            ? 'approved'
            : dbStat === 'rejected'
              ? 'rejected'
              : 'pending';

      return {
        type: 'league_tournament_request' as const,
        id: r['id'] as string,
        status: normalised,
        targetLabel: eventName
          ? `${tournamentName} (${eventName}) → ${leagueName}`
          : `${tournamentName} → ${leagueName}`,
        targetHref: leagueId ? `/admin/leagues/${leagueId}/edit` : null,
        requesterUserId: reqId,
        requesterName: reqUser?.name ?? null,
        requesterEmail: reqUser?.email ?? null,
        organizationId: orgId,
        organizationName: orgName,
        reason: (r['note'] as string | null) ?? null,
        rejectionReason: (r['rejection_reason'] as string | null) ?? null,
        reviewedByUserId: revId,
        reviewedByName: revUser?.name ?? null,
        reviewedByEmail: revUser?.email ?? null,
        reviewedAt: (r['reviewed_at'] as string | null) ?? null,
        createdAt: (r['created_at'] as string | null) ?? new Date(0).toISOString(),
      };
    });
  }

  private async fetchLeagueMembershipRequests(statusFilter: string): Promise<ReviewQueueItem[]> {
    const dbStatus = statusFilter === 'pending' ? 'requested' : statusFilter;

    let q = this.supabase.service
      .from('league_membership_requests')
      .select('*, leagues:league_id(id, name, slug), organizations:organization_id(id, name, slug)')
      .order('requested_at', { ascending: false });
    if (dbStatus !== 'all') q = q.eq('status', dbStatus) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];

    const userIds = [
      ...new Set([
        ...rows
          .map((r) => r['requested_by_user_id'] as string | null)
          .filter((id): id is string => Boolean(id)),
        ...rows
          .map((r) => r['reviewed_by_user_id'] as string | null)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const userMap = await this.userDirectory.resolveUsers(userIds);

    return rows.map((r) => {
      const league = (r['leagues'] ?? {}) as Record<string, unknown>;
      const org = (r['organizations'] ?? {}) as Record<string, unknown>;

      const leagueId = (league['id'] as string | null) ?? null;
      const leagueName = (league['name'] as string | null) ?? leagueId ?? 'Unknown league';
      const orgId = (org['id'] as string | null) ?? null;
      const orgName = (org['name'] as string | null) ?? null;

      const reqId = (r['requested_by_user_id'] as string | null) ?? '';
      const reqUser = reqId ? userMap.get(reqId) : null;
      const revId = (r['reviewed_by_user_id'] as string | null) ?? null;
      const revUser = revId ? userMap.get(revId) : null;

      const dbStat = r['status'] as string;
      const normalised: ReviewQueueItem['status'] =
        dbStat === 'requested'
          ? 'pending'
          : dbStat === 'approved'
            ? 'approved'
            : dbStat === 'rejected'
              ? 'rejected'
              : dbStat === 'withdrawn'
                ? 'cancelled'
                : 'pending';

      return {
        type: 'league_membership_request' as const,
        id: r['id'] as string,
        status: normalised,
        targetLabel: orgName ? `${orgName} → ${leagueName}` : `Organization → ${leagueName}`,
        targetHref: leagueId ? `/admin/leagues/${leagueId}/edit` : null,
        requesterUserId: reqId,
        requesterName: reqUser?.name ?? null,
        requesterEmail: reqUser?.email ?? null,
        organizationId: orgId,
        organizationName: orgName,
        reason: (r['message'] as string | null) ?? null,
        rejectionReason: (r['review_note'] as string | null) ?? null,
        reviewedByUserId: revId,
        reviewedByName: revUser?.name ?? null,
        reviewedByEmail: revUser?.email ?? null,
        reviewedAt: (r['reviewed_at'] as string | null) ?? null,
        createdAt:
          (r['requested_at'] as string | null) ??
          (r['created_at'] as string | null) ??
          new Date(0).toISOString(),
      };
    });
  }

  // ── Private: approve type handlers ───────────────────────────────────────────

  private async approveDeletion(
    id: string,
    actorUserId: string,
    confirmation?: { typedConfirmation?: string },
  ): Promise<void> {
    if (confirmation?.typedConfirmation !== 'DELETE') {
      throw new BadRequestException('Type DELETE to confirm deletion.');
    }

    const { data: row, error: fetchErr } = await this.supabase.service
      .from('deletion_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!row) throw new BadRequestException(`Deletion request ${id} not found`);

    const req = row as Record<string, unknown>;
    if (req['status'] !== 'pending') {
      throw new BadRequestException('Only pending deletion requests can be approved.');
    }

    const targetType = req['target_type'] as string;
    const targetId = req['target_id'] as string;

    // Cascade-delete via direct Supabase (bypasses status guards — super-admin approval IS the bypass)
    if (targetType === 'event') {
      const { error: delErr } = await this.supabase.service
        .from('events')
        .delete()
        .eq('id', targetId);
      if (delErr) throw new BadRequestException(`Failed to delete event: ${delErr.message}`);
    } else if (targetType === 'tournament') {
      const { error: delErr } = await this.supabase.service
        .from('tournaments')
        .delete()
        .eq('id', targetId);
      if (delErr) throw new BadRequestException(`Failed to delete tournament: ${delErr.message}`);
    } else {
      throw new BadRequestException(`Unknown target_type: ${targetType}`);
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await this.supabase.service
      .from('deletion_requests')
      .update({
        status: 'approved',
        reviewed_by_user_id: actorUserId,
        reviewed_at: now,
        approved_executed_at: now,
        updated_at: now,
      })
      .eq('id', id);
    if (updateErr) throw new BadRequestException(updateErr.message);

    await this.writeAuditLog(actorUserId, 'deletion.approve', targetType, targetId, {
      requestId: id,
      reason: req['reason'],
    });
  }

  private async approveClubReview(id: string, actorUserId: string): Promise<void> {
    const { data: row, error: fetchErr } = await this.supabase.service
      .from('club_review_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!row) throw new BadRequestException(`Club review request ${id} not found`);

    const req = row as Record<string, unknown>;
    if (req['status'] !== 'pending') {
      throw new BadRequestException('Only pending club review requests can be approved.');
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await this.supabase.service
      .from('club_review_requests')
      .update({
        status: 'approved',
        reviewed_by_user_id: actorUserId,
        updated_at: now,
      })
      .eq('id', id);
    if (updateErr) throw new BadRequestException(updateErr.message);

    await this.writeAuditLog(actorUserId, 'club_review.approve', 'club_review_request', id, {});
  }

  // ── Private: uniform reject ───────────────────────────────────────────────────

  private async rejectRow(
    table: string,
    id: string,
    actorUserId: string,
    rejectionReason: string,
    auditAction: string,
    auditEntityType: string,
  ): Promise<void> {
    const { data: row, error: fetchErr } = await this.supabase.service
      .from(table)
      .select('status')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!row) throw new BadRequestException(`${table} ${id} not found`);

    const req = row as Record<string, unknown>;
    if (req['status'] !== 'pending') {
      throw new BadRequestException('Only pending requests can be rejected.');
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await this.supabase.service
      .from(table)
      .update({
        status: 'rejected',
        rejection_reason: rejectionReason,
        reviewed_by_user_id: actorUserId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id);
    if (updateErr) throw new BadRequestException(updateErr.message);

    await this.writeAuditLog(actorUserId, auditAction, auditEntityType, id, {
      rejectionReason,
    });
  }

  // ── Private: batch resolution helpers ────────────────────────────────────────

  private async resolveOrgNames(orgIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (orgIds.length === 0) return map;

    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id, name')
      .in('id', orgIds);
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(row['id'] as string, row['name'] as string);
    }
    return map;
  }

  private async resolveEventNames(eventIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (eventIds.length === 0) return map;

    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, name')
      .in('id', eventIds);
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(row['id'] as string, row['name'] as string);
    }
    return map;
  }

  private async resolveTournamentNames(tournamentIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (tournamentIds.length === 0) return map;

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, name')
      .in('id', tournamentIds);
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(row['id'] as string, row['name'] as string);
    }
    return map;
  }

  private async resolveClubNames(clubIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (clubIds.length === 0) return map;

    const { data, error } = await this.supabase.service
      .from('clubs')
      .select('id, name')
      .in('id', clubIds);
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(row['id'] as string, row['name'] as string);
    }
    return map;
  }

  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(`Could not write audit log for ${action} on ${entityType}:${entityId}`);
    }
  }
}
