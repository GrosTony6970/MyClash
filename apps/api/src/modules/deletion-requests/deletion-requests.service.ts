/**
 * deletion-requests.service.ts — Event Lifecycle Protection
 *
 * Organizer-facing CRUD for deletion_requests table.
 * Supports event and tournament targets. Super-admin review is out of scope here.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeletionRequestRow {
  id: string;
  targetType: 'event' | 'tournament';
  targetId: string;
  organizationId: string;
  requesterUserId: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  approvedExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeletionRequestDto {
  targetType: 'event' | 'tournament';
  targetId: string;
  reason: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class DeletionRequestsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  // ── create ────────────────────────────────────────────────────────────────────

  async create(
    dto: CreateDeletionRequestDto,
    requesterUserId: string,
  ): Promise<DeletionRequestRow> {
    const { targetType, targetId, reason } = dto;

    // 1. Resolve organization_id + validate target state
    let organizationId: string;

    if (targetType === 'event') {
      const { data: eventRow, error: eventErr } = await this.supabase.service
        .from('events')
        .select('id, organization_id, status')
        .eq('id', targetId)
        .maybeSingle();

      if (eventErr) throw new BadRequestException(eventErr.message);
      if (!eventRow) throw new NotFoundException(`Event ${targetId} not found`);

      const ev = eventRow as { id: string; organization_id: string; status: string };

      // 2. Validate state: event must be archived
      if (ev.status !== 'archived') {
        throw new BadRequestException(
          'Only archived events can have a deletion request submitted.',
        );
      }

      organizationId = ev.organization_id;
    } else {
      // tournament — 2-step: fetch tournament, then fetch its event
      const { data: tournRow, error: tournErr } = await this.supabase.service
        .from('tournaments')
        .select('id, event_id, status')
        .eq('id', targetId)
        .maybeSingle();

      if (tournErr) throw new BadRequestException(tournErr.message);
      if (!tournRow) throw new NotFoundException(`Tournament ${targetId} not found`);

      const tourn = tournRow as { id: string; event_id: string; status: string };

      // 2. Validate state: running, completed, archived OR has scored matches
      const inEligibleStatus = ['running', 'completed', 'archived'].includes(tourn.status);

      if (!inEligibleStatus) {
        // Check for scored matches (status != 'scheduled')
        const { count, error: matchErr } = await this.supabase.service
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', targetId)
          .neq('status', 'scheduled');

        if (matchErr) throw new BadRequestException(matchErr.message);

        if ((count ?? 0) === 0) {
          throw new BadRequestException(
            'Tournament is not in an eligible state for deletion request.',
          );
        }
      }

      // Fetch event for organization_id
      const { data: evRow, error: evErr } = await this.supabase.service
        .from('events')
        .select('organization_id')
        .eq('id', tourn.event_id)
        .maybeSingle();

      if (evErr) throw new BadRequestException(evErr.message);
      if (!evRow) throw new NotFoundException(`Event for tournament ${targetId} not found`);

      organizationId = (evRow as { organization_id: string }).organization_id;
    }

    // 3. Authorize: requester must be org admin
    await this.organizations.assertOrgRole(organizationId, requesterUserId, 'admin');

    // 4. Insert
    const { data: inserted, error: insertErr } = await this.supabase.service
      .from('deletion_requests')
      .insert({
        target_type: targetType,
        target_id: targetId,
        organization_id: organizationId,
        requester_user_id: requesterUserId,
        reason,
        status: 'pending',
      })
      .select('*')
      .single();

    // 5. Catch unique violation (one pending per target)
    if (insertErr) {
      if ((insertErr as unknown as { code?: string }).code === '23505') {
        throw new ConflictException('A pending deletion request already exists for this target.');
      }
      throw new BadRequestException(insertErr.message);
    }

    return this.map(inserted as Record<string, unknown>);
  }

  // ── cancel ────────────────────────────────────────────────────────────────────

  async cancel(requestId: string, actorUserId: string): Promise<void> {
    // 1. Fetch the request row
    const { data: row, error: fetchErr } = await this.supabase.service
      .from('deletion_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!row) throw new NotFoundException(`Deletion request ${requestId} not found`);

    const req = row as Record<string, unknown>;

    // 2. Status guard
    if (req['status'] !== 'pending') {
      throw new BadRequestException('Only pending requests can be cancelled.');
    }

    // 3. Authorize: actor must be org admin
    await this.organizations.assertOrgRole(req['organization_id'] as string, actorUserId, 'admin');

    // 4. Update
    const { error: updateErr } = await this.supabase.service
      .from('deletion_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', requestId);

    if (updateErr) throw new BadRequestException(updateErr.message);
  }

  // ── listForOrganization ───────────────────────────────────────────────────────

  async listForOrganization(
    orgId: string,
    status: string | null,
    userId: string,
  ): Promise<DeletionRequestRow[]> {
    await this.organizations.assertOrgRole(orgId, userId, 'read_only');

    let q = this.supabase.service
      .from('deletion_requests')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (status) q = q.eq('status', status) as typeof q;

    const { data, error } = await q;

    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.map(r as Record<string, unknown>));
  }

  // ── getActivePendingForTarget ─────────────────────────────────────────────────

  async getActivePendingForTarget(
    targetType: 'event' | 'tournament',
    targetId: string,
    userId: string,
  ): Promise<DeletionRequestRow | null> {
    // Resolve organization_id from target (prevents unauthorized probing)
    let organizationId: string;

    if (targetType === 'event') {
      const { data: evRow, error } = await this.supabase.service
        .from('events')
        .select('organization_id')
        .eq('id', targetId)
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (!evRow) throw new NotFoundException(`Event ${targetId} not found`);
      organizationId = (evRow as { organization_id: string }).organization_id;
    } else {
      const { data: tournRow, error: tournErr } = await this.supabase.service
        .from('tournaments')
        .select('event_id')
        .eq('id', targetId)
        .maybeSingle();

      if (tournErr) throw new BadRequestException(tournErr.message);
      if (!tournRow) throw new NotFoundException(`Tournament ${targetId} not found`);

      const { data: evRow, error: evErr } = await this.supabase.service
        .from('events')
        .select('organization_id')
        .eq('id', (tournRow as { event_id: string }).event_id)
        .maybeSingle();

      if (evErr) throw new BadRequestException(evErr.message);
      if (!evRow) throw new NotFoundException(`Event for tournament ${targetId} not found`);
      organizationId = (evRow as { organization_id: string }).organization_id;
    }

    await this.organizations.assertOrgRole(organizationId, userId, 'read_only');

    const { data, error } = await this.supabase.service
      .from('deletion_requests')
      .select('*')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) return null;
    return this.map(data as Record<string, unknown>);
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private map(r: Record<string, unknown>): DeletionRequestRow {
    return {
      id: r['id'] as string,
      targetType: r['target_type'] as 'event' | 'tournament',
      targetId: r['target_id'] as string,
      organizationId: r['organization_id'] as string,
      requesterUserId: r['requester_user_id'] as string,
      reason: r['reason'] as string,
      status: r['status'] as 'pending' | 'approved' | 'rejected' | 'cancelled',
      reviewedByUserId: (r['reviewed_by_user_id'] as string | null) ?? null,
      reviewedAt: (r['reviewed_at'] as string | null) ?? null,
      rejectionReason: (r['rejection_reason'] as string | null) ?? null,
      approvedExecutedAt: (r['approved_executed_at'] as string | null) ?? null,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }
}
