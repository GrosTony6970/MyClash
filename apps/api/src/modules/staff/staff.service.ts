import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { buildRoundCode, bracketCodeConfig } from '../matches/round-code.helper';
import { fetchRefereeAssignmentIndex } from '../matches/referee-assignment-index';
import { resolveMatchReferees } from '../matches/resolve-match-referees';
import type { ResolvedReferee } from '../matches/resolve-match-referees';
import {
  LICE_MATCH_SELECT,
  LICE_MATCH_STATUSES,
  compareLiceMatchOrder,
  mapLiceMatchRow,
  roundCodeFromMatchRow,
  type LiceMatchesPayload,
} from './lice-matches';
import { bracketToken, isWeakPin, parseStaffRole } from '@myclash/types';
import type { PhaseType, StaffRole } from '@myclash/types';
import { getEffectiveBestOf, normalizeMatchFormatConfig } from '@myclash/rulesets';
import type { Match as RulesetMatch } from '@myclash/rulesets';
import type { FastifyRequest } from 'fastify';
import { OrganizationsService } from '../organizations/organizations.service';
import { PhasesService } from '../phases/phases.service';
import { SupabaseService } from '../supabase/supabase.service';
import { StaffJwtService } from './staff-jwt.service';
import {
  assembleBoardRows,
  buildBoardAccounts,
  buildBoardTiming,
  resolveBoardReferees,
  type BoardAccountInput,
  type RawBoardLice,
  type RawBoardMatch,
  type RawCompletedMatch,
} from './live-board';
import type { LiveBoardPayload, LiveBoardProgress, LiveBoardTiming } from './live-board-payload';
import { dayIndexFor } from '../schedule/select-programme-block';
import { normalizeTournamentLockConfig } from '../events/tournament-config';
import type {
  CreateStaffAccountDto,
  ResetStaffPinDto,
  SetLiceScorerDto,
  SetStaffLicesDto,
  StaffHeartbeatDto,
  StaffLoginDto,
  UpdateStaffAccountDto,
} from './dto';

const scrypt = promisify(scryptCallback);
export const STAFF_COOKIE_NAME = 'mc_staff';

export interface ScoringActor {
  userId?: string;
  staffAccountId?: string;
  canOverrideLocked?: boolean;
  /**
   * May undo a result even though a later bout has already been fought, which
   * discards that bout's score and puts it back on the schedule.
   *
   * Deliberately NOT `canOverrideLocked`. That flag means "may edit past the
   * lock" and `authorizeMatchUnlock` hands it to a pad staff token whenever the
   * tournament's auto-lock is disabled — a reasonable rule for reopening your
   * own bout, and the wrong authority for throwing away someone else's result.
   * Granted only by `authorizeMatchOrganizer`: a logged-in user holding editor,
   * admin or owner on the match's organization.
   */
  canDiscardDependentResults?: boolean;
}

type EventRow = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  status: string;
  /** Day 0 of the programme — the basis for which block is running now. */
  start_date: string | null;
  end_date: string;
};

type StaffAccountRow = {
  id: string;
  event_id: string;
  display_name: string;
  username: string;
  pin_hash: string;
  status: string;
  role: string;
};

/**
 * Roles allowed to run a piste with the scoring pad.
 *
 * A one-element list rather than a bare equality check so that widening it —
 * the day a head referee role appears — is an edit here and nowhere else, and
 * so `grep SCORING_ROLES` finds every gate at once.
 */
const SCORING_ROLES: readonly StaffRole[] = ['scoring'];

/**
 * The ONLY fields the unauthenticated staff event picker exposes.
 *
 * This projection IS the security boundary. The endpoint has to be readable
 * before authentication — a volunteer cannot pick an event after signing in,
 * because staff usernames are unique per EVENT
 * (`idx_event_staff_accounts_event_username`), so there is nothing to
 * authenticate against until one is chosen. Everything the picker does not
 * strictly need is therefore left out rather than filtered later: no
 * organisation, no branding, no counts, no tournaments, no dates beyond the
 * start.
 *
 * `kind` and `status` are here on purpose, not by accident of copying the row:
 * a test or draft event must be VISIBLY marked, so a volunteer who signs into
 * the wrong one finds out on the login screen rather than after scanning ten
 * fighters into a dry run.
 */
export interface StaffPickerEvent {
  id: string;
  slug: string;
  name: string;
  startDate: string | null;
  status: string;
  kind: string;
}

/**
 * A hard cap on an unauthenticated list. Well above any real deployment's
 * count of simultaneously-staffed events, and low enough that the route can
 * never become a bulk export of the events table.
 */
const STAFF_PICKER_LIMIT = 50;

/** A prev/next match summary for the scoring pad's header tiles. */
export interface NeighborTile {
  id: string;
  matchNumberLabel: string | null;
  roundCode: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redClub: string | null;
  blueClub: string | null;
}

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly jwt: StaffJwtService,
    // Value import, not `import type` — a type-only import erases the DI
    // metadata Nest needs to resolve this.
    private readonly phases: PhasesService,
  ) {}

  async listAccounts(eventId: string, userId: string) {
    await this.assertCanManageEventStaff(eventId, userId);
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select(
        'id,event_id,display_name,username,status,role,disabled_at,last_login_at,created_at,updated_at',
      )
      .eq('event_id', eventId)
      .order('display_name', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const assignments = await this.listAssignmentsForEvent(eventId);
    return (data ?? []).map((account) => ({
      ...account,
      liceIds: assignments
        .filter((assignment) => assignment.staff_account_id === account.id)
        .map((assignment) => assignment.lice_id),
    }));
  }

  async createAccount(eventId: string, dto: CreateStaffAccountDto, userId: string) {
    await this.assertCanManageEventStaff(eventId, userId);
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .insert({
        event_id: eventId,
        display_name: dto.displayName.trim(),
        username: this.normalizeUsername(dto.username),
        pin_hash: await this.hashPin(dto.pin),
        status: 'active',
        // Omitted rather than defaulted here: the column's own DEFAULT 'scoring'
        // is the one owner of what a role-less staff account means, and writing
        // a second fallback in TypeScript is how the two drift apart.
        ...(dto.role === undefined ? {} : { role: dto.role }),
        created_by_user_id: userId,
      })
      .select('id,event_id,display_name,username,status,role,created_at,updated_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return { ...data, liceIds: [] };
  }

  async updateAccount(
    eventId: string,
    accountId: string,
    dto: UpdateStaffAccountDto,
    userId: string,
  ) {
    await this.assertCanManageEventStaff(eventId, userId);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.displayName !== undefined) updates['display_name'] = dto.displayName.trim();
    if (dto.username !== undefined) updates['username'] = this.normalizeUsername(dto.username);
    if (dto.status !== undefined) {
      updates['status'] = dto.status;
      updates['disabled_at'] = dto.status === 'disabled' ? new Date().toISOString() : null;
      updates['disabled_by_user_id'] = dto.status === 'disabled' ? userId : null;
    }
    // Re-roling does NOT clear the account's Lice assignments. They are inert
    // for a desk or gear account — nothing reads them off the scoring path once
    // the role gate refuses it — and keeping them means moving an account back
    // to Scoring restores the pistes it had, instead of silently losing them.
    if (dto.role !== undefined) updates['role'] = dto.role;

    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .update(updates)
      .eq('event_id', eventId)
      .eq('id', accountId)
      .select(
        'id,event_id,display_name,username,status,role,disabled_at,last_login_at,created_at,updated_at',
      )
      .single();
    if (error) throw this.staffAccountWriteError(error);
    if (!data) throw new NotFoundException('Staff account not found');
    return data;
  }

  async resetPin(eventId: string, accountId: string, dto: ResetStaffPinDto, userId: string) {
    await this.assertCanManageEventStaff(eventId, userId);
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .update({ pin_hash: await this.hashPin(dto.pin), updated_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .eq('id', accountId)
      .select('id,event_id,display_name,username,status,updated_at')
      .single();
    if (error) throw this.staffAccountWriteError(error);
    if (!data) throw new NotFoundException('Staff account not found');
    return data;
  }

  /**
   * The right exception for a scoped write that read nothing back.
   *
   * `updateAccount` and `resetPin` both end `.eq(event_id).eq(id).select().single()`,
   * and `.single()` raises PGRST116 when the update matched no row. On these two
   * paths that means this event does not own that account — a 404. Reporting it
   * as a 400 carrying a PostgREST sentence tells the organiser their request was
   * malformed when it was simply about someone else's staff.
   *
   * The guard refused either way; only the status and the message were wrong.
   */
  private staffAccountWriteError(error: { message: string; code?: string }): Error {
    if (error.code === 'PGRST116') return new NotFoundException('Staff account not found');
    return new BadRequestException(error.message);
  }

  async setLices(eventId: string, accountId: string, dto: SetStaffLicesDto, userId: string) {
    await this.assertCanManageEventStaff(eventId, userId);
    const account = await this.getAccountForEvent(eventId, accountId);
    await this.assertLicesBelongToEvent(eventId, dto.liceIds);

    const { error: deleteError } = await this.supabase.service
      .from('event_staff_lice_assignments')
      .delete()
      .eq('staff_account_id', account.id);
    if (deleteError) throw new BadRequestException(deleteError.message);

    if (dto.liceIds.length > 0) {
      const { error } = await this.supabase.service.from('event_staff_lice_assignments').insert(
        dto.liceIds.map((liceId) => ({
          event_id: eventId,
          staff_account_id: account.id,
          lice_id: liceId,
        })),
      );
      if (error) throw new BadRequestException(error.message);
    }

    return { staffAccountId: account.id, liceIds: dto.liceIds };
  }

  /**
   * Put one scorer on one piste, from the Live board.
   *
   * The lice-centric counterpart to {@link setLices}, which is account-centric
   * and cannot express this: setting "piste 3's scorer is Marie" through it
   * means reading Marie's list, appending 3 and PUTting the union — a
   * read-modify-write with a lost-update race between two organizers — and it
   * still cannot remove the PREVIOUS scorer from piste 3 without a second call
   * against a different account.
   *
   * REPLACES every assignment on the lice. The board renders exactly one scorer
   * per piste (the most-recently-seen of those assigned), so leaving a second
   * assignment in place lets the displayed primary flip back on the next
   * heartbeat — display and DB have to agree. Co-scorers deliberately set from
   * the staff page are therefore dropped, so the removed ids come back in the
   * response for the caller to surface rather than swallow.
   *
   * The account is NOT removed from its other pistes: one scorer covering two
   * adjacent strips is normal at a small event, and reaching across to unassign
   * them elsewhere from a per-piste control is action at a distance.
   *
   * Gated on `scorekeeper`, matching getLiveBoard and acknowledgeAttention, NOT
   * on `editor` like setLices. Deliberate: someone who can already clear a
   * needs-attention flag and read every tablet's health is the person running
   * the pistes, and requiring `editor` would make the control useless to the
   * role the board exists for.
   */
  async setLiceScorer(
    req: FastifyRequest,
    eventId: string,
    liceId: string,
    dto: SetLiceScorerDto,
  ): Promise<{ liceId: string; staffAccountId: string | null; removedAccountIds: string[] }> {
    const userId = await this.getSupabaseUserId(req);
    if (!userId) throw new UnauthorizedException('Organizer session required');
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');
    await this.assertLicesBelongToEvent(eventId, [liceId]);

    const accountId = dto.staffAccountId;
    if (accountId) {
      const account = await this.getAccountForEvent(eventId, accountId);
      if (account.status !== 'active') {
        throw new BadRequestException('Staff account is disabled');
      }
    }

    const { data: existing, error: readError } = await this.supabase.service
      .from('event_staff_lice_assignments')
      .select('staff_account_id')
      .eq('event_id', eventId)
      .eq('lice_id', liceId);
    if (readError) throw new BadRequestException(readError.message);
    const removedAccountIds = (existing ?? [])
      .map((r) => (r as { staff_account_id: string }).staff_account_id)
      .filter((id) => id !== accountId);

    const { error: deleteError } = await this.supabase.service
      .from('event_staff_lice_assignments')
      .delete()
      .eq('event_id', eventId)
      .eq('lice_id', liceId);
    if (deleteError) throw new BadRequestException(deleteError.message);

    if (accountId) {
      const { error } = await this.supabase.service
        .from('event_staff_lice_assignments')
        .insert({ event_id: eventId, staff_account_id: accountId, lice_id: liceId });
      if (error) throw new BadRequestException(error.message);
    }

    return { liceId, staffAccountId: accountId, removedAccountIds };
  }

  async login(dto: StaffLoginDto): Promise<{ token: string; expiresAt: Date; me: unknown }> {
    // The id wins when the caller has one (the picker always does): slugs are
    // unique per organisation, not globally, so resolving by slug is ambiguous
    // across orgs in a way that surfaces as a bare "Event not found". See the
    // eventId field's note in dto.ts.
    const event = dto.eventId
      ? await this.getEventById(dto.eventId)
      : await this.findEventBySlug(dto.eventSlugOrCode);
    this.assertEventScorable(event);

    const { data: account, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select('id,event_id,display_name,username,pin_hash,status,role')
      .eq('event_id', event.id)
      .ilike('username', this.normalizeUsername(dto.username))
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!account) throw new UnauthorizedException('Invalid staff credentials');

    const staff = account as StaffAccountRow;
    if (staff.status !== 'active') throw new ForbiddenException('Staff account is disabled');
    const valid = await this.verifyPin(dto.pin, staff.pin_hash);
    if (!valid) throw new UnauthorizedException('Invalid staff credentials');

    await this.supabase.service
      .from('event_staff_accounts')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', staff.id);

    const expiresAt = this.getStaffSessionExpiry(event);
    const token = this.jwt.sign({ sub: staff.id, event_id: event.id, type: 'staff' }, expiresAt);
    return { token, expiresAt, me: await this.getMeForStaff(staff.id) };
  }

  async getMe(req: FastifyRequest) {
    const staff = await this.requireStaffFromRequest(req);
    return this.getMeForStaff(staff.id);
  }

  /**
   * The staff session behind this request, gated on role — for other modules.
   *
   * The desk and the gear table live in their own modules but must resolve a
   * staff session exactly as the scoring routes do: same cookie, same JWT
   * verification, same disabled-account and event-scorable checks, and the same
   * per-request read of `role` from the row. Exporting this rather than letting
   * each module re-derive it keeps one owner of what an mc_staff session means.
   *
   * Event-scoped by construction: the returned row carries `event_id`, and a
   * desk or gear account has no Lice assignment to scope it any further.
   */
  async requireStaffWithRole(
    req: FastifyRequest,
    allowedRoles: readonly StaffRole[],
  ): Promise<{ id: string; event_id: string; role: StaffRole }> {
    const staff = await this.requireStaffFromRequest(req, allowedRoles);
    return { id: staff.id, event_id: staff.event_id, role: parseStaffRole(staff.role) };
  }

  /**
   * Events a volunteer could actually sign into, for the login page's picker.
   *
   * Deliberately NOT `GET /events`. That route hard-excludes test events
   * (`events.service.ts`, "Test events never appear on public surfaces") and
   * defaults to published/running/completed, so drafts are invisible too — both
   * correct for a spectator surface and both wrong here, where a dry run and a
   * club night are exactly the events a volunteer needs to reach. Adding an
   * `includeTest` flag to that public route would have exposed test events to
   * everyone; a separate route with a narrower projection does not.
   *
   * Two filters carry the whole boundary:
   *
   *   1. `event_staff_accounts!inner` with `status = 'active'` — an event with
   *      nobody configured to sign in never appears, so an unstaffed draft
   *      stays invisible. The inner embed is a lateral join returning a nested
   *      array, NOT a row-multiplying join, so an event with six staff accounts
   *      is still one row (same shape as the weapon filter in listEvents).
   *   2. Status limited to the three an mc_staff session can exist for.
   *      `assertEventScorable` refuses completed and archived, so listing them
   *      would offer a door that cannot open.
   *
   * The embedded accounts are dropped in the mapping below. Nothing about a
   * staff account — not its count, not its usernames — reaches the response.
   */
  async listPickerEvents(): Promise<StaffPickerEvent[]> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id,slug,name,start_date,status,event_kind,event_staff_accounts!inner(id)')
      .eq('event_staff_accounts.status', 'active')
      .in('status', ['draft', 'published', 'running'])
      .order('start_date', { ascending: true, nullsFirst: false })
      .limit(STAFF_PICKER_LIMIT);
    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row['id'] as string,
      slug: row['slug'] as string,
      name: row['name'] as string,
      startDate: (row['start_date'] as string | null) ?? null,
      status: row['status'] as string,
      kind: row['event_kind'] as string,
    }));
  }

  async listAssignedLices(req: FastifyRequest) {
    const staff = await this.requireStaffFromRequest(req, SCORING_ROLES);
    return this.getAssignedLices(staff.id);
  }

  /**
   * Stamps the scoring tablet's sync-health metrics + last_seen_at onto the
   * caller's own staff account. Consumed by the organizer Live board
   * (getLiveBoard) to surface offline/backlogged scorers.
   */
  async recordHeartbeat(req: FastifyRequest, dto: StaffHeartbeatDto): Promise<{ ok: true }> {
    const staff = await this.requireStaffFromRequest(req);
    const receivedAt = new Date();
    // Signed, tablet-minus-server: positive = the tablet is running ahead.
    // Omitted when the tablet did not send its clock, so the column keeps
    // meaning "never measured" instead of being overwritten with a false 0.
    const skew =
      dto.clientNowMs === undefined
        ? {}
        : { clock_skew_ms: Math.trunc(dto.clientNowMs - receivedAt.getTime()) };
    const { error } = await this.supabase.service
      .from('event_staff_accounts')
      .update({
        last_seen_at: receivedAt.toISOString(),
        outbox_depth: dto.outboxDepth,
        oldest_pending_age_seconds: dto.oldestPendingAgeSec,
        rejected_count: dto.rejectedCount,
        ...skew,
      })
      .eq('event_id', staff.event_id)
      .eq('id', staff.id);
    if (error) throw new BadRequestException(error.message);
    await this.recordDeviceSyncReport(String(staff.event_id), dto);
    return { ok: true };
  }

  /**
   * The durable half of the heartbeat.
   *
   * `event_staff_accounts.rejected_count` above is a live gauge: overwritten
   * every 20s, carrying no reason, on a row that dies with the staff account.
   * This keeps a per-DEVICE high-water record instead, so a tablet that was
   * stuck at 14:00 and drained by 17:00 still shows that exchanges a referee
   * scored were refused — the fact a post-event report needs and the gauge has
   * already forgotten.
   *
   * Best-effort by design: telemetry must never fail a scoring request, so a
   * write error is logged rather than thrown. The event comes from the staff
   * SESSION, never the client.
   */
  private async recordDeviceSyncReport(eventId: string, dto: StaffHeartbeatDto): Promise<void> {
    if (!dto.deviceId) return;
    const { error } = await this.supabase.service.rpc('record_device_sync_report', {
      p_event_id: eventId,
      p_device_id: dto.deviceId,
      p_device_label: dto.deviceLabel ?? null,
      p_quarantined_count: dto.quarantinedCount ?? 0,
      p_reason_codes: dto.reasonCodes ?? [],
      p_oldest_quarantined_at: dto.oldestQuarantinedAt ?? null,
    });
    if (error) {
      this.logger.warn(`device sync report failed for event ${eventId}: ${error.message}`);
    }
  }

  async getAssignedLiceCurrent(req: FastifyRequest, liceId: string) {
    const staff = await this.requireStaffFromRequest(req, SCORING_ROLES);
    const assigned = await this.isLiceAssigned(staff.id, liceId);
    if (!assigned) throw new ForbiddenException('Staff account is not assigned to this Lice');
    return this.getCurrentForLiceId(liceId);
  }

  /**
   * Live control-room board: one row per lice, carrying the current match's
   * server-derived score, the assigned scorer, tablet sync health, and the
   * scorer's needs-attention flag. Event-scoped (not match-scoped): resolve the
   * event's organization and require an org role, mirroring the scoring helpers.
   */
  async getLiveBoard(req: FastifyRequest, eventId: string): Promise<LiveBoardPayload> {
    const userId = await this.getSupabaseUserId(req);
    if (!userId) throw new UnauthorizedException('Organizer session required');
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

    const now = new Date();
    const { data: lices, error: liceErr } = await this.supabase.service
      .from('lices')
      // Inline literal, not a constant: the db-schema-conformance sweep only
      // reads select strings it can see at the call site, so hoisting one into
      // a named constant quietly drops every column in it from the gate. It is
      // `color_hex` — there is no `lices.color` column.
      .select('id,name,sort_order,location_label,color_hex,venues(id,name),venue_areas(id,name)')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    if (liceErr) throw new BadRequestException(liceErr.message);
    const liceRows = (lices ?? []) as unknown as RawBoardLice[];
    const liceIds = liceRows.map((l) => l.id);

    const input = await this.loadLiveBoardInputs(eventId, event.start_date ?? null, liceIds, now);

    const rows = assembleBoardRows({
      lices: liceRows,
      matches: input.matches,
      recentCompleted: input.recentCompleted,
      accounts: input.accounts,
      assignments: input.assignments,
      refereesByMatchId: input.refereesByMatchId,
    });

    return {
      rows,
      timing: input.timing,
      progress: input.progress,
      accounts: buildBoardAccounts(input.accounts, input.assignments),
      eventSlug: event.slug,
    };
  }

  /**
   * Everything the board needs beyond the lices, in ONE round of parallel
   * queries.
   *
   * The lices have to be awaited first (their ids scope five of these), but
   * nothing below depends on anything else below. That turns the old four
   * serial hops into two — more queries, less wall clock.
   */
  private async loadLiveBoardInputs(
    eventId: string,
    startDate: string | null,
    liceIds: string[],
    now: Date,
  ): Promise<{
    matches: RawBoardMatch[];
    recentCompleted: RawCompletedMatch[];
    accounts: BoardAccountInput[];
    assignments: Array<{ staff_account_id: string; lice_id: string }>;
    refereesByMatchId: Map<string, ResolvedReferee[]>;
    timing: LiveBoardTiming;
    progress: LiveBoardProgress;
  }> {
    const db = this.supabase.service;

    const [matchesRes, completedRes, accountsRes, assignments, refereeRows, blocksRes, progress] =
      await Promise.all([
        this.queryBoardMatches(liceIds),
        this.queryCompletedTail(liceIds),
        this.queryBoardAccounts(eventId),
        this.listAssignmentsForEvent(eventId),
        fetchRefereeAssignmentIndex(db, eventId),
        this.queryProgrammeBlocks(eventId, dayIndexFor(startDate, now.getTime())),
        this.countBoutProgress(eventId),
      ]);

    if (matchesRes?.error) throw new BadRequestException(matchesRes.error.message);
    if (completedRes?.error) throw new BadRequestException(completedRes.error.message);
    if (accountsRes.error) throw new BadRequestException(accountsRes.error.message);

    const matches = (matchesRes?.data ?? []) as unknown as RawBoardMatch[];

    return {
      matches,
      recentCompleted: (completedRes?.data ?? []) as unknown as RawCompletedMatch[],
      accounts: (accountsRes.data ?? []) as unknown as BoardAccountInput[],
      assignments: assignments.map((a) => ({
        staff_account_id: a.staff_account_id,
        lice_id: a.lice_id,
      })),
      refereesByMatchId: resolveBoardReferees(matches, liceIds, refereeRows),
      timing: buildBoardTiming(blocksRes.data as Array<Record<string, unknown>> | null, now),
      progress,
    };
  }

  /** Every staff account on the event, with its tablet health metrics. */
  private queryBoardAccounts(eventId: string) {
    return this.supabase.service
      .from('event_staff_accounts')
      .select(
        'id,display_name,username,status,last_seen_at,outbox_depth,oldest_pending_age_seconds,rejected_count,clock_skew_ms,needs_attention,needs_attention_reason',
      )
      .eq('event_id', eventId);
  }

  /** The programme for the day now running, in sort order. */
  private queryProgrammeBlocks(eventId: string, dayIndex: number) {
    return this.supabase.service
      .from('event_programme_blocks')
      .select('id,label,start_time,end_time,match_duration_minutes,sort_order')
      .eq('event_id', eventId)
      .eq('day_index', dayIndex)
      .order('sort_order', { ascending: true });
  }

  /** The bouts occupying or queued on each piste. */
  private queryBoardMatches(liceIds: string[]) {
    if (liceIds.length === 0) return null;
    return (
      this.supabase.service
        .from('matches')
        // `pools(name)` hangs off matches.pool_id — `pools` has no event_id, so
        // the embed is the only route to a pool name here.
        // `phases(type,tournaments(name))` mirrors live-state.service.ts.
        .select(
          'id,lice_id,status,red_score,blue_score,match_number_label,scheduled_at,started_at,ended_at,pool_id,bracket_slots(round),swiss_rounds(round_number),pools(name),phases(type,tournaments(name)),red:registrations!matches_red_registration_id_fkey(persons(given_name,family_name)),blue:registrations!matches_blue_registration_id_fkey(persons(given_name,family_name))',
        )
        .in('lice_id', liceIds)
        .in('status', ['running', 'paused', 'scheduled'])
        // Single ORDER BY on purpose. The old query also ordered by `status`,
        // which sorts ALPHABETICALLY — 'completed' before 'paused' before
        // 'running' — so it was never the precedence it looked like. All status
        // precedence now lives in the pure, unit-tested assembleBoardRows.
        .order('scheduled_at', { ascending: true, nullsFirst: false })
    );
  }

  /**
   * The finished tail, bounded regardless of event size.
   *
   * Two per piste is ample to guarantee a `lastCompleted` for each, where
   * widening the main filter to `completed` would ship the whole day's card
   * every 7 seconds to every open tab.
   */
  private queryCompletedTail(liceIds: string[]) {
    if (liceIds.length === 0) return null;
    return (
      this.supabase.service
        .from('matches')
        // Only pickLastCompleted reads these, so the tail stays narrow — no
        // fighter embeds or round joins for bouts nobody is watching.
        .select('id,lice_id,match_number_label,scheduled_at,ended_at')
        .in('lice_id', liceIds)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false, nullsFirst: false })
        .limit(liceIds.length * 2)
    );
  }

  /**
   * Bouts done vs bouts that count, event-wide.
   *
   * Two head-only counts: no rows cross the wire, and the answer stays exact on
   * an 800-bout event. Voided bouts are excluded from both sides — a cancelled
   * bout is not work remaining, so counting it would leave the board stuck
   * short of 100% all day.
   *
   * `matches` has NO event_id column. The only route from a match to its event
   * is phase_id → phases.tournament_id → tournaments.event_id, so the filter
   * goes through `!inner` embeds; a direct .eq('event_id') 400s on the unknown
   * column and takes the whole query with it. Same constraint, same shape as
   * deletion-requests.service.ts.
   */
  private async countBoutProgress(eventId: string): Promise<LiveBoardProgress> {
    const db = this.supabase.service;
    const scoped = 'id, phases!inner(tournaments!inner(event_id))';
    const [done, total] = await Promise.all([
      db
        .from('matches')
        .select(scoped, { count: 'exact', head: true })
        .eq('phases.tournaments.event_id', eventId)
        .eq('status', 'completed'),
      db
        .from('matches')
        .select(scoped, { count: 'exact', head: true })
        .eq('phases.tournaments.event_id', eventId)
        .neq('status', 'voided'),
    ]);
    return { completed: done.count ?? 0, total: total.count ?? 0 };
  }

  /**
   * Clear a scorer's needs-attention flag from the Live board. The only
   * in-board write; same event-scoped org-role gate as {@link getLiveBoard}.
   */
  async acknowledgeAttention(
    req: FastifyRequest,
    eventId: string,
    staffAccountId: string,
  ): Promise<{ ok: true }> {
    const userId = await this.getSupabaseUserId(req);
    if (!userId) throw new UnauthorizedException('Organizer session required');
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

    const { error } = await this.supabase.service
      .from('event_staff_accounts')
      .update({ needs_attention: false, needs_attention_reason: null })
      .eq('event_id', eventId)
      .eq('id', staffAccountId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async authorizeMatchScoring(req: FastifyRequest, matchId: string): Promise<ScoringActor> {
    const userId = await this.getSupabaseUserId(req);
    if (userId) {
      const match = await this.getMatchContext(matchId);
      await this.orgs.assertOrgRole(match.organizationId, userId, 'scorekeeper');
      return {
        userId,
        canOverrideLocked: await this.canOverrideLockedMatch(match.organizationId, userId),
      };
    }

    // The single choke point for every staff-token write to a bout — exchanges,
    // penalties, the clock and the match itself all resolve their actor through
    // here. Gating the role at this one call covers all of them; a desk or gear
    // account is refused before the piste-assignment check it could never pass
    // anyway, with a reason that names the real cause.
    const staff = await this.requireStaffFromRequest(req, SCORING_ROLES);
    const match = await this.getMatchContext(matchId);
    if (match.eventId !== staff.event_id) throw new ForbiddenException('Wrong staff event');
    if (!match.liceId) throw new ForbiddenException('Match has no assigned Lice');
    const assigned = await this.isLiceAssigned(staff.id, match.liceId);
    if (!assigned) throw new ForbiddenException('Staff account is not assigned to this Lice');
    return { staffAccountId: staff.id, canOverrideLocked: false };
  }

  /**
   * Scoring for ACCESS, organizer PROBED for the discard capability.
   *
   * The un-completion paths — reset, the clock, the pre-flight — all have to be
   * reachable by whoever is running the piste, because that is who un-does a
   * bout. But only an organiser may un-do one that a LATER bout has already been
   * fought, and `authorizeMatchScoring` cannot say who that is: it grants
   * `canOverrideLocked` and nothing else.
   *
   * Authorising with the organiser check instead would lock the pad out of
   * resetting anything. Asking both is what lets the same route serve both, and
   * it asks the question the write path itself will ask, so the pre-flight can
   * never promise an override the reset then refuses.
   *
   * The probe's refusal is a `false`, never a 403 — being unable to discard is
   * not being unable to act.
   */
  async authorizeMatchScoringWithDiscard(
    req: FastifyRequest,
    matchId: string,
  ): Promise<ScoringActor> {
    const actor = await this.authorizeMatchScoring(req, matchId);
    const canDiscardDependentResults = await this.authorizeMatchOrganizer(req, matchId).then(
      () => true,
      () => false,
    );
    return { ...actor, canDiscardDependentResults };
  }

  async authorizeMatchOrganizer(req: FastifyRequest, matchId: string): Promise<ScoringActor> {
    const userId = await this.getSupabaseUserId(req);
    if (!userId) throw new UnauthorizedException('Organizer session required');
    const match = await this.getMatchContext(matchId);
    await this.orgs.assertOrgRole(match.organizationId, userId, 'editor');
    return { userId, canOverrideLocked: true, canDiscardDependentResults: true };
  }

  /**
   * Reopen (unlock) a locked match. The required role depends on the
   * tournament's auto-lock setting: a tournament organiser (editor+) may
   * always reopen, but when auto-lock is DISABLED the event staff running
   * the piste (scorekeeper user or assigned staff account) may reopen too.
   */
  async authorizeMatchUnlock(req: FastifyRequest, matchId: string): Promise<ScoringActor> {
    const match = await this.getMatchContext(matchId);
    const lockConfig = normalizeTournamentLockConfig(match.lockConfigJson);
    if (!lockConfig.autoLockEnabled) {
      const actor = await this.authorizeMatchScoring(req, matchId);
      return { ...actor, canOverrideLocked: true };
    }
    return this.authorizeMatchOrganizer(req, matchId);
  }

  async authorizeExchangeScoring(req: FastifyRequest, exchangeId: string): Promise<ScoringActor> {
    const { data, error } = await this.supabase.service
      .from('exchanges')
      .select('match_id')
      .eq('id', exchangeId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Exchange not found');
    return this.authorizeMatchScoring(req, (data as { match_id: string }).match_id);
  }

  async authorizePenaltyScoring(req: FastifyRequest, penaltyId: string): Promise<ScoringActor> {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('match_id')
      .eq('id', penaltyId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Penalty not found');
    return this.authorizeMatchScoring(req, (data as { match_id: string }).match_id);
  }

  async authorizeForfeitOrganizer(req: FastifyRequest, forfeitId: string): Promise<ScoringActor> {
    const { data, error } = await this.supabase.service
      .from('match_forfeits')
      .select('match_id')
      .eq('id', forfeitId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Forfeit not found');
    return this.authorizeMatchOrganizer(req, (data as { match_id: string }).match_id);
  }

  async getPublicLiceCurrent(eventSlug: string, liceName: string) {
    const event = await this.findEventBySlug(eventSlug);
    const { data: lice, error } = await this.supabase.service
      .from('lices')
      .select('id,name')
      .eq('event_id', event.id)
      .ilike('name', liceName)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!lice) throw new NotFoundException('Lice not found');
    return this.getCurrentForLiceId((lice as { id: string }).id);
  }

  async getPublicMatchDisplay(matchId: string) {
    return this.getMatchDisplayPayload(matchId);
  }

  /**
   * Previous + next match on the same lice, in schedule order. Public —
   * the scoring pad's prev/next header tiles read this instead of the
   * staff lice-queue endpoint (which 401s for an organizer session).
   * "previous" is an already-played match, so unlike resolveNextMatchOnLice
   * we order the full non-voided list by scheduled_at and pick the
   * immediate neighbours by index.
   */
  async getMatchNeighbors(
    matchId: string,
  ): Promise<{ previous: NeighborTile | null; next: NeighborTile | null }> {
    const { data: current, error: curErr } = await this.supabase.service
      .from('matches')
      .select('id,lice_id')
      .eq('id', matchId)
      .maybeSingle();
    if (curErr) throw new BadRequestException(curErr.message);
    if (!current) throw new NotFoundException('Match not found');
    const liceId = (current as { lice_id: string | null }).lice_id;
    if (!liceId) return { previous: null, next: null };

    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id,status,scheduled_at,match_number_label,red:registrations!matches_red_registration_id_fkey(persons(given_name,family_name,clubs(name))),blue:registrations!matches_blue_registration_id_fkey(persons(given_name,family_name,clubs(name))),phases(config_json,tournaments(weapon)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
      )
      .eq('lice_id', liceId)
      .in('status', ['scheduled', 'running', 'paused', 'completed'])
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('match_number_label', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const idx = rows.findIndex((r) => (r['id'] as string) === matchId);
    if (idx === -1) return { previous: null, next: null };
    return {
      previous: idx > 0 ? this.mapNeighborRow(rows[idx - 1]!) : null,
      next: idx < rows.length - 1 ? this.mapNeighborRow(rows[idx + 1]!) : null,
    };
  }

  private mapNeighborRow(row: Record<string, unknown>): NeighborTile {
    const red = row['red'] as {
      persons?: { given_name?: string; family_name?: string; clubs?: { name?: string } | null };
    } | null;
    const blue = row['blue'] as {
      persons?: { given_name?: string; family_name?: string; clubs?: { name?: string } | null };
    } | null;
    return {
      id: row['id'] as string,
      matchNumberLabel: (row['match_number_label'] as string | null) ?? null,
      roundCode: roundCodeFromMatchRow(row),
      redFighterName: this.formatPersonName(red?.persons),
      blueFighterName: this.formatPersonName(blue?.persons),
      redClub: red?.persons?.clubs?.name ?? null,
      blueClub: blue?.persons?.clubs?.name ?? null,
    };
  }

  /**
   * The staff session payload — returned by both `/staff-auth/me` and login.
   *
   * Carries `account.role` because the staff app has no other way to learn it:
   * the token has none, so the landing route after sign-in and every
   * role-specific nav item read it from here.
   *
   * `lices` stays on the payload for all three roles and is simply empty for a
   * desk or gear account, which never has an assignment.
   */
  private async getMeForStaff(staffAccountId: string) {
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select('id,event_id,display_name,username,status,role,events(id,slug,name,status)')
      .eq('id', staffAccountId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new UnauthorizedException('Staff account not found');
    return { type: 'staff', account: data, lices: await this.getAssignedLices(staffAccountId) };
  }

  private async getAssignedLices(staffAccountId: string) {
    const { data, error } = await this.supabase.service
      .from('event_staff_lice_assignments')
      .select('lices(id,name,location_label,color_hex,sort_order)')
      .eq('staff_account_id', staffAccountId);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as Array<{
      lices: {
        id: string;
        name: string;
        location_label?: string | null;
        color_hex?: string | null;
        sort_order?: number;
      };
    }>;
    return Promise.all(
      rows.map(async (row: { lices: { id: string; name: string } }) => {
        const current = await this.getCurrentForLiceId(row.lices.id);
        return { ...row.lices, currentMatch: current.current, event: current.event };
      }),
    );
  }

  private async getCurrentForLiceId(liceId: string) {
    const { data: lice, error: liceError } = await this.supabase.service
      .from('lices')
      .select('id,name,event_id,events(id,slug,name,status)')
      .eq('id', liceId)
      .maybeSingle();
    if (liceError) throw new BadRequestException(liceError.message);
    if (!lice) throw new NotFoundException('Lice not found');

    const { data: matches, error } = await this.supabase.service
      .from('matches')
      .select(LICE_MATCH_SELECT)
      .eq('lice_id', liceId)
      .in('status', ['running', 'paused', 'scheduled'])
      .order('status', { ascending: true })
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .limit(8);
    if (error) throw new BadRequestException(error.message);

    // `LICE_MATCH_SELECT` is a concatenated const, so supabase-js cannot infer
    // a row type from it the way it does from an inline literal.
    const mapped = ((matches ?? []) as unknown as Array<Record<string, unknown>>).map((match) =>
      this.mapCurrentMatch(match),
    );
    const current =
      mapped.find((match) => match.status === 'running' || match.status === 'paused') ??
      mapped[0] ??
      null;
    return {
      liceId: (lice as { id: string }).id,
      liceName: (lice as { name: string }).name,
      event: (lice as { events: unknown }).events,
      /**
       * Falls back to the next SCHEDULED bout when nothing is running — the
       * /lices picker and the public lice display both need something to
       * point at, and the TV would flip to its waiting screen without it.
       *
       * So `current != null` does NOT mean "a bout is in progress". Read
       * `current.status` before showing any liveness cue; inferring liveness
       * from presence is what made three surfaces render a scheduled match
       * under a "LIVE" banner.
       */
      current,
      queue: mapped.filter((match) => match.id !== current?.id).slice(0, 5),
    };
  }

  /**
   * Every match on a lice, in schedule order, COMPLETED ONES INCLUDED.
   *
   * Separate from `getCurrentForLiceId` on purpose. That method's
   * `{current, queue}` shape is read once per assigned lice by the /lices
   * picker (an N+1 we do not want to make heavier) and by the PUBLIC lice
   * display, so it stays capped and status-filtered. This is the piste
   * operator's whole day: unbounded, played bouts included, and carrying the
   * referee line.
   */
  async getAssignedLiceMatches(req: FastifyRequest, liceId: string) {
    const staff = await this.requireStaffFromRequest(req, SCORING_ROLES);
    const assigned = await this.isLiceAssigned(staff.id, liceId);
    if (!assigned) throw new ForbiddenException('Staff account is not assigned to this Lice');
    return this.getMatchesForLiceId(liceId);
  }

  /**
   * Pools + matches for a tournament, for the piste screen.
   *
   * Exists rather than pointing the tablet at `/tournaments/:id/pools-with-matches`
   * because that route takes only an id — it asserts nothing about WHICH event
   * the caller belongs to, so any identity can read any tournament. This one
   * pins the tournament to the staff session's own event first.
   */
  async getAssignedLiceTournamentPools(req: FastifyRequest, liceId: string, tournamentId: string) {
    await this.requireTournamentInStaffEvent(req, liceId, tournamentId);
    return this.phases.listPoolsWithMatches(tournamentId);
  }

  /** Bracket for a tournament on this lice. Same event-pinning as the pools route. */
  async getAssignedLiceTournamentBracket(
    req: FastifyRequest,
    liceId: string,
    tournamentId: string,
  ) {
    await this.requireTournamentInStaffEvent(req, liceId, tournamentId);
    return this.phases.getTournamentBracket(tournamentId);
  }

  /** Staff session that is actually assigned to this lice, or 403. */
  private async requireLiceAccess(req: FastifyRequest, liceId: string): Promise<StaffAccountRow> {
    const staff = await this.requireStaffFromRequest(req, SCORING_ROLES);
    const assigned = await this.isLiceAssigned(staff.id, liceId);
    if (!assigned) throw new ForbiddenException('Staff account is not assigned to this Lice');
    return staff;
  }

  /**
   * …and the tournament belongs to that staff account's event.
   *
   * Without this, a PIN issued for one event would read another event's draw.
   */
  private async requireTournamentInStaffEvent(
    req: FastifyRequest,
    liceId: string,
    tournamentId: string,
  ): Promise<void> {
    const staff = await this.requireLiceAccess(req, liceId);
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id,event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Tournament not found');
    if ((data as { event_id: string }).event_id !== staff.event_id) {
      throw new ForbiddenException('Tournament belongs to another event');
    }
  }

  private async getMatchesForLiceId(liceId: string): Promise<LiceMatchesPayload> {
    const { data: lice, error: liceError } = await this.supabase.service
      .from('lices')
      .select('id,name,event_id,events(id,slug,name,status)')
      .eq('id', liceId)
      .maybeSingle();
    if (liceError) throw new BadRequestException(liceError.message);
    if (!lice) throw new NotFoundException('Lice not found');
    const row = lice as { id: string; name: string; event_id: string; events: unknown };

    const { data, error } = await this.supabase.service
      .from('matches')
      .select(LICE_MATCH_SELECT)
      .eq('lice_id', liceId)
      .in('status', [...LICE_MATCH_STATUSES])
      // No .limit(): the operator asked for the whole lice, and the three
      // truncations on the old endpoint are exactly why a played bout was
      // unreachable from this screen.
      .order('scheduled_at', { ascending: true, nullsFirst: false });
    if (error) throw new BadRequestException(error.message);

    // One query for the event's assignments; precedence is then resolved in
    // memory per match, so this stays a fixed 3 round trips however many bouts
    // the lice holds.
    const assignments = await fetchRefereeAssignmentIndex(this.supabase.service, row.event_id);
    const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).sort(
      compareLiceMatchOrder,
    );

    return {
      liceId: row.id,
      liceName: row.name,
      event: row.events as LiceMatchesPayload['event'],
      matches: rows.map((match) =>
        mapLiceMatchRow(
          match,
          resolveMatchReferees(assignments, {
            matchId: match['id'] as string,
            poolId: (match['pool_id'] as string | null) ?? null,
            liceId,
          }),
        ),
      ),
    };
  }

  private async getMatchDisplayPayload(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        // Extended for the external-display redesign:
        //   - pools(id,name) so the title can show "Pool A" without
        //     a separate fetch.
        //   - persons embeds carry club_id + clubs(name, logo_url).
        //     0081 simplified the schema so the global_persons club
        //     fallback is no longer needed — persons.club_id is
        //     populated eagerly at insert/link time.
        '*,lices(id,name,events(id,slug,name,status)),red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name,club_id,clubs(name,logo_url),global_persons(photo_url))),blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name,club_id,clubs(name,logo_url),global_persons(photo_url))),phases(type,config_json,tournaments(id,name,weapon,scoring_config_json,ruleset_config)),pools(id,name,sort_order),bracket_slots(round),swiss_rounds(round_number)',
      )
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Match not found');

    // Sibling matches in the same pool drive Fight X / Y. Skipped
    // for bracket matches (pool_id is null).
    let fightIndex: number | null = null;
    let totalFightsInPool: number | null = null;
    const poolId = (data as { pool_id?: string | null }).pool_id ?? null;
    if (poolId) {
      const { data: siblings, error: siblingsErr } = await this.supabase.service
        .from('matches')
        .select('id, match_number_label')
        .eq('pool_id', poolId)
        .order('match_number_label', { ascending: true });
      if (siblingsErr) throw new BadRequestException(siblingsErr.message);
      const ordered = (siblings ?? []) as Array<{ id: string; match_number_label: string | null }>;
      totalFightsInPool = ordered.length;
      const idx = ordered.findIndex((m) => m.id === matchId);
      fightIndex = idx >= 0 ? idx + 1 : null;
    }

    // Next match on the same lice — used by the TV display's auto-
    // rollover (5s after MATCH ENDED, navigate to this id's display
    // route) and the corner NEXT tile. Same query shape the staff
    // current-match endpoint uses; mirroring it keeps the two
    // surfaces consistent. Public — no auth, lives alongside the
    // already-public display payload.
    const nextMatch = await this.resolveNextMatchOnLice(
      matchId,
      (data as { lice_id?: string | null }).lice_id ?? null,
    );

    const base = this.mapDisplayMatch(data, { fightIndex, totalFightsInPool });
    return {
      ...base,
      nextMatchId: nextMatch?.id ?? null,
      nextMatch,
    };
  }

  private async resolveNextMatchOnLice(
    currentMatchId: string,
    liceId: string | null,
  ): Promise<{
    id: string;
    matchNumberLabel: string | null;
    roundCode: string | null;
    redFighterName: string | null;
    blueFighterName: string | null;
  } | null> {
    if (!liceId) return null;
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id,status,scheduled_at,match_number_label,red:registrations!matches_red_registration_id_fkey(persons(given_name,family_name)),blue:registrations!matches_blue_registration_id_fkey(persons(given_name,family_name)),phases(config_json,tournaments(weapon)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
      )
      .eq('lice_id', liceId)
      .in('status', ['running', 'paused', 'scheduled'])
      .order('status', { ascending: true })
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .limit(8);
    if (error) throw new BadRequestException(error.message);
    const next = (data ?? []).find((row) => (row as { id?: string }).id !== currentMatchId);
    if (!next) return null;
    const row = next as Record<string, unknown>;
    const red = row['red'] as { persons?: { given_name?: string; family_name?: string } } | null;
    const blue = row['blue'] as { persons?: { given_name?: string; family_name?: string } } | null;
    return {
      id: row['id'] as string,
      matchNumberLabel: (row['match_number_label'] as string | null) ?? null,
      roundCode: roundCodeFromMatchRow(row),
      redFighterName: this.formatPersonName(red?.persons),
      blueFighterName: this.formatPersonName(blue?.persons),
    };
  }

  private async getMatchContext(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id,lice_id,phases!inner(tournaments!inner(id,event_id,lock_config_json,events!inner(organization_id,status)))',
      )
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Match not found');
    const row = data as unknown as {
      lice_id: string | null;
      phases:
        | {
            tournaments: {
              id: string;
              event_id: string;
              lock_config_json: unknown;
              events: { organization_id: string; status: string };
            };
          }
        | Array<{
            tournaments:
              | {
                  id: string;
                  event_id: string;
                  lock_config_json: unknown;
                  events: { organization_id: string; status: string };
                }
              | Array<{
                  id: string;
                  event_id: string;
                  lock_config_json: unknown;
                  events: { organization_id: string; status: string };
                }>;
          }>;
    };
    const phase = Array.isArray(row.phases) ? row.phases[0] : row.phases;
    const tournament = Array.isArray(phase?.tournaments)
      ? phase.tournaments[0]
      : phase?.tournaments;
    if (!tournament) throw new NotFoundException('Match tournament not found');
    if (['completed', 'archived'].includes(tournament.events.status)) {
      throw new ForbiddenException('Event is not open for staff scoring');
    }
    return {
      liceId: row.lice_id,
      eventId: tournament.event_id,
      organizationId: tournament.events.organization_id,
      tournamentId: tournament.id,
      lockConfigJson: tournament.lock_config_json,
    };
  }

  /**
   * The staff session behind this request, or 401/403.
   *
   * `allowedRoles` gates EVENT-scoped on `event_staff_accounts.role`, read from
   * the row on every call. The mc_staff token carries no role on purpose (see
   * 0173): an organiser who re-roles a volunteer mid-event must take effect on
   * that volunteer's next tap, and a staff session lasts the whole event day.
   *
   * Omit it for the surfaces every role shares — `/staff-auth/me` and the
   * heartbeat, which a desk tablet sends exactly like a scoring tablet.
   */
  private async requireStaffFromRequest(
    req: FastifyRequest,
    allowedRoles?: readonly StaffRole[],
  ): Promise<StaffAccountRow> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token = cookies?.[STAFF_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('Staff session required');
    const payload = this.jwt.verify(token);
    const account = await this.getAccountForEvent(payload.event_id, payload.sub);
    if (account.status !== 'active') throw new ForbiddenException('Staff account is disabled');
    if (allowedRoles && !allowedRoles.includes(parseStaffRole(account.role))) {
      throw new ForbiddenException('Staff account role cannot use this surface');
    }
    const event = await this.getEventById(account.event_id);
    this.assertEventScorable(event);
    return account;
  }

  private async getSupabaseUserId(req: FastifyRequest): Promise<string | undefined> {
    const authHeader = req.headers['authorization'];
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookies?.['sb-access-token'];
    if (!token) return undefined;
    const {
      data: { user },
    } = await this.supabase.anon.auth.getUser(token);
    return user?.id;
  }

  private async assertCanManageEventStaff(eventId: string, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(event.organization_id, userId, 'editor');
  }

  private async canOverrideLockedMatch(organizationId: string, userId: string): Promise<boolean> {
    try {
      await this.orgs.assertOrgRole(organizationId, userId, 'editor');
      return true;
    } catch {
      return false;
    }
  }

  private async getEventById(eventId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id,organization_id,slug,name,status,start_date,end_date')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Event not found');
    return data as EventRow;
  }

  private async findEventBySlug(slug: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id,organization_id,slug,name,status,start_date,end_date')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Event not found');
    return data as EventRow;
  }

  private assertEventScorable(event: EventRow) {
    if (event.status === 'completed' || event.status === 'archived') {
      throw new ForbiddenException('Event is not open for staff scoring');
    }
  }

  private getStaffSessionExpiry(event: EventRow) {
    const end = new Date(`${event.end_date}T23:59:59.000Z`);
    const fallback = new Date(Date.now() + 12 * 60 * 60 * 1000);
    return Number.isNaN(end.getTime()) || end.getTime() < Date.now() ? fallback : end;
  }

  private async getAccountForEvent(eventId: string, accountId: string): Promise<StaffAccountRow> {
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select('id,event_id,display_name,username,pin_hash,status,role')
      .eq('event_id', eventId)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Staff account not found');
    return data as StaffAccountRow;
  }

  private async assertLicesBelongToEvent(eventId: string, liceIds: string[]) {
    if (liceIds.length === 0) return;
    const { data, error } = await this.supabase.service
      .from('lices')
      .select('id')
      .eq('event_id', eventId)
      .in('id', liceIds);
    if (error) throw new BadRequestException(error.message);
    if ((data ?? []).length !== liceIds.length) {
      throw new BadRequestException('All Lices must belong to the event');
    }
  }

  private async listAssignmentsForEvent(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('event_staff_lice_assignments')
      .select('staff_account_id,lice_id')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private async isLiceAssigned(staffAccountId: string, liceId: string) {
    const { data, error } = await this.supabase.service
      .from('event_staff_lice_assignments')
      .select('id')
      .eq('staff_account_id', staffAccountId)
      .eq('lice_id', liceId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return Boolean(data);
  }

  private normalizeUsername(username: string) {
    return username.trim().toLowerCase();
  }

  /**
   * The one place a PIN becomes stored state — createAccount and resetPin both
   * come through here, and login goes through `verifyPin` instead. So the
   * strength check lives here rather than at the two call sites: a third write
   * path added later is covered without anyone remembering to, and the login
   * path cannot accidentally inherit a rule that would turn a wrong credential
   * into a 400 (see the note on `pin` in staffLoginSchema).
   */
  private async hashPin(pin: string) {
    const weakness = isWeakPin(pin);
    if (weakness) {
      throw new BadRequestException({ code: 'weak_pin', reason: weakness });
    }
    const salt = randomBytes(16);
    const key = (await scrypt(pin, salt, 32)) as Buffer;
    return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
  }

  private async verifyPin(pin: string, hash: string) {
    const [algorithm, salt, stored] = hash.split(':');
    if (algorithm !== 'scrypt' || !salt || !stored) return false;
    const key = (await scrypt(pin, Buffer.from(salt, 'base64'), 32)) as Buffer;
    const storedKey = Buffer.from(stored, 'base64');
    return key.length === storedKey.length && timingSafeEqual(key, storedKey);
  }

  /**
   * `persons` table has `given_name` + `family_name` but no
   * `display_name` (that lives on `global_persons`). Mappers below
   * compose names locally — embed strings above must request
   * given+family, not display_name.
   */
  private formatPersonName(
    p: { given_name?: string | null; family_name?: string | null } | null | undefined,
  ): string | null {
    if (!p) return null;
    const composed = `${p.given_name ?? ''} ${p.family_name ?? ''}`.trim();
    return composed || null;
  }

  private mapCurrentMatch(match: Record<string, unknown>) {
    const red = match['red'] as {
      persons?: { given_name?: string | null; family_name?: string | null };
    } | null;
    const blue = match['blue'] as {
      persons?: { given_name?: string | null; family_name?: string | null };
    } | null;
    const phase = match['phases'] as {
      type?: string;
      config_json?: Record<string, unknown> | null;
      tournaments?: {
        id?: string;
        name?: string;
        weapon?: string;
        scoring_config_json?: unknown;
        ruleset_config?: { matchFormat?: unknown };
      };
    } | null;
    const tournament = phase?.tournaments ?? null;
    const roundCode = roundCodeFromMatchRow(match);

    return {
      id: match['id'],
      status: match['status'],
      phaseType: phase?.type ?? null,
      scheduledAt: match['scheduled_at'],
      matchNumberLabel: match['match_number_label'],
      roundCode,
      redRegistrationId: match['red_registration_id'],
      blueRegistrationId: match['blue_registration_id'],
      redScore: match['red_score'],
      blueScore: match['blue_score'],
      sideOrder: match['side_order'] ?? 'red_left',
      lockedAt: match['locked_at'] ?? null,
      rulesetCode: match['ruleset_code'],
      rulesetVersion: match['ruleset_version'],
      redFighterName: this.formatPersonName(red?.persons),
      blueFighterName: this.formatPersonName(blue?.persons),
      tournamentId: tournament?.id ?? null,
      tournamentName: tournament?.name ?? null,
      weapon: tournament?.weapon ?? null,
      scoringConfig: tournament?.scoring_config_json ?? null,
      matchFormat: tournament?.ruleset_config?.matchFormat ?? null,
    };
  }

  private mapDisplayMatch(
    match: Record<string, unknown>,
    extras: { fightIndex: number | null; totalFightsInPool: number | null } = {
      fightIndex: null,
      totalFightsInPool: null,
    },
  ) {
    type ClubsEmbed = { name?: string | null; logo_url?: string | null } | null;
    type PersonEmbed = {
      given_name?: string | null;
      family_name?: string | null;
      club_id?: string | null;
      clubs?: ClubsEmbed;
      // The fighter photo lives on the global identity, not the local
      // persons row — reached via persons.global_person_id. Null when the
      // local person isn't linked to a global_persons record yet.
      global_persons?: { photo_url?: string | null } | null;
    };
    const red = match['red'] as { persons?: PersonEmbed } | null;
    const blue = match['blue'] as { persons?: PersonEmbed } | null;
    const lices = match['lices'] as { id?: string; name?: string; events?: unknown } | null;
    const phases = match['phases'] as {
      type?: PhaseType;
      config_json?: Record<string, unknown> | null;
      tournaments?: {
        id?: string;
        name?: string;
        weapon?: string;
        scoring_config_json?: unknown;
        ruleset_config?: { matchFormat?: unknown };
      };
    } | null;
    const pool = match['pools'] as {
      id?: string;
      name?: string | null;
      sort_order?: number;
    } | null;
    const bracketSlot = match['bracket_slots'] as { round?: number } | null;
    const poolName = pool?.name ?? null;

    // Read club from persons.club_id. createPerson() now eagerly
    // copies global_persons.club_id into the local row at insert
    // time (and applyGlobalPersonDecision does the same on link),
    // so the global_persons fallback is no longer needed here —
    // matches 0081's view simplification.
    function resolveClub(
      side: { persons?: PersonEmbed } | null,
    ): { name: string; logoUrl: string | null } | null {
      const person = side?.persons;
      const local = person?.clubs;
      if (local && (local.name || local.logo_url)) {
        return { name: local.name ?? '', logoUrl: local.logo_url ?? null };
      }
      return null;
    }
    const redClub = resolveClub(red);
    const blueClub = resolveClub(blue);

    const weapon = phases?.tournaments?.weapon ?? null;
    const phaseCfg = phases?.config_json ?? null;
    const sizeRaw = (phaseCfg?.['bracketSize'] ?? phaseCfg?.['mainBracketSize']) as
      number | undefined;
    const bracketSize: number | null = typeof sizeRaw === 'number' ? sizeRaw : null;
    const { wbRounds, lbRounds } = bracketCodeConfig(phaseCfg);
    const poolNumber = typeof pool?.sort_order === 'number' ? pool.sort_order + 1 : null;
    const bracketRound = typeof bracketSlot?.round === 'number' ? bracketSlot.round : null;
    const swissRoundEmbed = match['swiss_rounds'] as { round_number?: number } | null;
    const swissRound =
      typeof swissRoundEmbed?.round_number === 'number' ? swissRoundEmbed.round_number : null;
    const matchNumberLabel = (match['match_number_label'] as string | null | undefined) ?? null;

    // Round token for the TV display's "tournament · phase · lice" line and the
    // scoring pad header, expanded to a human name client-side by
    // roundTokenLabel(). Null for pool matches, which show poolName instead.
    //
    // Swiss is included because it otherwise named NO phase at all: a Swiss
    // bout has neither a pool nor a bracket slot, so the line collapsed to
    // "Tournament · Lice 4". And the bracket side goes through bracketToken,
    // which is the same function that builds the code below — previously this
    // called bracketRoundLabel() directly WITHOUT wbRounds/lbRounds (already in
    // scope, and passed on the very next line), so a double-elim winners final,
    // grand final and grand final reset all displayed as "F".
    const roundToken =
      swissRound !== null
        ? `S${swissRound}`
        : bracketToken({ bracketRound, bracketSize, wbRounds, lbRounds });

    const roundCode = buildRoundCode({
      weapon,
      poolNumber,
      bracketRound,
      swissRound,
      bracketSize,
      wbRounds,
      lbRounds,
      matchNumberLabel,
      roundNumber: null,
    });

    // Effective best-of for this match's phase (1 = single round → TV hides the
    // round counter); medal matches resolve to finals via matchNumberLabel
    // inside getEffectiveBestOf.
    //
    // phaseType is read from phases.type, not inferred as `pool ? 'pool' :
    // undefined` — that guess is right for pools and bracket but silently bills
    // a Swiss bout (which has no pool) as BRACKET. It travels in the payload
    // too, so the scoreboards can count against the right time limit.
    const phaseType = phases?.type ?? null;
    const displayMatchFormat = normalizeMatchFormatConfig(
      phases?.tournaments?.ruleset_config?.matchFormat ?? {},
    );
    const effectiveBestOf = getEffectiveBestOf(
      {
        id: String(match['id'] ?? ''),
        redRegistrationId: '',
        blueRegistrationId: '',
        rulesetCode: 'TF_v1',
        rulesetVersion: '1.0.0',
        status: 'running',
        phaseType: phaseType ?? undefined,
        matchNumberLabel,
      } satisfies RulesetMatch,
      displayMatchFormat,
    );

    return {
      id: match['id'],
      status: match['status'],
      phaseType,
      scheduledAt: match['scheduled_at'],
      startedAt: match['started_at'],
      endedAt: match['ended_at'],
      matchNumberLabel: match['match_number_label'],
      roundCode,
      redRegistrationId: match['red_registration_id'],
      blueRegistrationId: match['blue_registration_id'],
      redScore: match['red_score'],
      blueScore: match['blue_score'],
      // Why the match ended ('first_to_points' | 'time_limit' |
      // 'max_doubles') + the winner — lets the TV show a 0-0 'max_doubles'
      // DOUBLE LOSS distinctly from a tie. Null on manual end / legacy rows.
      endReason: match['end_reason'] ?? null,
      winnerRegistrationId: match['winner_registration_id'] ?? null,
      sideOrder: match['side_order'] ?? 'red_left',
      lockedAt: match['locked_at'] ?? null,
      rulesetCode: match['ruleset_code'],
      rulesetVersion: match['ruleset_version'],
      redFighterName: this.formatPersonName(red?.persons),
      blueFighterName: this.formatPersonName(blue?.persons),
      redFighterPhotoUrl: red?.persons?.global_persons?.photo_url ?? null,
      blueFighterPhotoUrl: blue?.persons?.global_persons?.photo_url ?? null,
      lice: lices,
      event: lices?.events ?? null,
      tournament: phases?.tournaments ?? null,
      scoringConfig: phases?.tournaments?.scoring_config_json ?? null,
      matchFormat: phases?.tournaments?.ruleset_config?.matchFormat ?? null,
      // Best-of-N round state for the TV/projector scoreboard.
      bestOf: effectiveBestOf,
      currentRound: (match['current_round'] as number | null) ?? 1,
      redRoundWins: (match['red_round_wins'] as number | null) ?? 0,
      blueRoundWins: (match['blue_round_wins'] as number | null) ?? 0,
      awaitingRoundAdvance: (match['awaiting_round_advance'] as boolean | null) ?? false,
      poolName,
      roundToken,
      fightIndex: extras.fightIndex,
      totalFightsInPool: extras.totalFightsInPool,
      redClub,
      blueClub,
    };
  }
}
