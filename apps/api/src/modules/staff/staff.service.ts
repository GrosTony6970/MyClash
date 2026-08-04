import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { buildRoundCode, bracketCodeConfig } from '../matches/round-code.helper';
import { fetchRefereeAssignmentIndex } from '../matches/referee-assignment-index';
import { resolveMatchReferees } from '../matches/resolve-match-referees';
import {
  LICE_MATCH_SELECT,
  LICE_MATCH_STATUSES,
  compareLiceMatchOrder,
  mapLiceMatchRow,
  roundCodeFromMatchRow,
  type LiceMatchesPayload,
} from './lice-matches';
import { bracketToken } from '@myclash/types';
import { getEffectiveBestOf, normalizeMatchFormatConfig } from '@myclash/rulesets';
import type { Match as RulesetMatch } from '@myclash/rulesets';
import type { FastifyRequest } from 'fastify';
import { OrganizationsService } from '../organizations/organizations.service';
import { PhasesService } from '../phases/phases.service';
import { SupabaseService } from '../supabase/supabase.service';
import { StaffJwtService } from './staff-jwt.service';
import {
  assembleBoardRows,
  type BoardAccountInput,
  type BoardRow,
  type RawBoardMatch,
} from './live-board';
import { normalizeTournamentLockConfig } from '../events/tournament-config';
import type {
  CreateStaffAccountDto,
  ResetStaffPinDto,
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
}

type EventRow = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  status: string;
  end_date: string;
};

type StaffAccountRow = {
  id: string;
  event_id: string;
  display_name: string;
  username: string;
  pin_hash: string;
  role: string;
  status: string;
};

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
        'id,event_id,display_name,username,role,status,disabled_at,last_login_at,created_at,updated_at',
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
        role: dto.role ?? 'arbitre_table',
        status: 'active',
        created_by_user_id: userId,
      })
      .select('id,event_id,display_name,username,role,status,created_at,updated_at')
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
    if (dto.role !== undefined) updates['role'] = dto.role;
    if (dto.status !== undefined) {
      updates['status'] = dto.status;
      updates['disabled_at'] = dto.status === 'disabled' ? new Date().toISOString() : null;
      updates['disabled_by_user_id'] = dto.status === 'disabled' ? userId : null;
    }

    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .update(updates)
      .eq('event_id', eventId)
      .eq('id', accountId)
      .select(
        'id,event_id,display_name,username,role,status,disabled_at,last_login_at,created_at,updated_at',
      )
      .single();
    if (error) throw new BadRequestException(error.message);
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
      .select('id,event_id,display_name,username,role,status,updated_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Staff account not found');
    return data;
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

  async login(dto: StaffLoginDto): Promise<{ token: string; expiresAt: Date; me: unknown }> {
    const event = await this.findEventBySlug(dto.eventSlugOrCode);
    this.assertEventScorable(event);

    const { data: account, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select('id,event_id,display_name,username,pin_hash,role,status')
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

  async listAssignedLices(req: FastifyRequest) {
    const staff = await this.requireStaffFromRequest(req);
    return this.getAssignedLices(staff.id);
  }

  /**
   * Stamps the scoring tablet's sync-health metrics + last_seen_at onto the
   * caller's own staff account. Consumed by the organizer Live board
   * (getLiveBoard) to surface offline/backlogged scorers.
   */
  async recordHeartbeat(req: FastifyRequest, dto: StaffHeartbeatDto): Promise<{ ok: true }> {
    const staff = await this.requireStaffFromRequest(req);
    const { error } = await this.supabase.service
      .from('event_staff_accounts')
      .update({
        last_seen_at: new Date().toISOString(),
        outbox_depth: dto.outboxDepth,
        oldest_pending_age_seconds: dto.oldestPendingAgeSec,
        rejected_count: dto.rejectedCount,
      })
      .eq('event_id', staff.event_id)
      .eq('id', staff.id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async getAssignedLiceCurrent(req: FastifyRequest, liceId: string) {
    const staff = await this.requireStaffFromRequest(req);
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
  async getLiveBoard(req: FastifyRequest, eventId: string): Promise<{ rows: BoardRow[] }> {
    const userId = await this.getSupabaseUserId(req);
    if (!userId) throw new UnauthorizedException('Organizer session required');
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

    const { data: lices, error: liceErr } = await this.supabase.service
      .from('lices')
      .select('id,name,sort_order')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    if (liceErr) throw new BadRequestException(liceErr.message);
    const liceRows = (lices ?? []) as Array<{ id: string; name: string; sort_order: number }>;
    const liceIds = liceRows.map((l) => l.id);

    let matches: RawBoardMatch[] = [];
    if (liceIds.length > 0) {
      const { data, error } = await this.supabase.service
        .from('matches')
        .select(
          'id,lice_id,status,red_score,blue_score,match_number_label,bracket_slots(round),swiss_rounds(round_number),red:registrations!matches_red_registration_id_fkey(persons(given_name,family_name)),blue:registrations!matches_blue_registration_id_fkey(persons(given_name,family_name))',
        )
        .in('lice_id', liceIds)
        .in('status', ['running', 'paused', 'scheduled'])
        .order('status', { ascending: true })
        .order('scheduled_at', { ascending: true, nullsFirst: false });
      if (error) throw new BadRequestException(error.message);
      matches = (data ?? []) as unknown as RawBoardMatch[];
    }

    const { data: accounts, error: accErr } = await this.supabase.service
      .from('event_staff_accounts')
      .select(
        'id,display_name,last_seen_at,outbox_depth,oldest_pending_age_seconds,rejected_count,needs_attention,needs_attention_reason',
      )
      .eq('event_id', eventId);
    if (accErr) throw new BadRequestException(accErr.message);

    const assignments = await this.listAssignmentsForEvent(eventId);

    const rows = assembleBoardRows({
      lices: liceRows,
      matches,
      accounts: (accounts ?? []) as unknown as BoardAccountInput[],
      assignments: assignments.map((a) => ({
        staff_account_id: a.staff_account_id,
        lice_id: a.lice_id,
      })),
    });
    return { rows };
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

    const staff = await this.requireStaffFromRequest(req);
    const match = await this.getMatchContext(matchId);
    if (match.eventId !== staff.event_id) throw new ForbiddenException('Wrong staff event');
    if (!match.liceId) throw new ForbiddenException('Match has no assigned Lice');
    const assigned = await this.isLiceAssigned(staff.id, match.liceId);
    if (!assigned) throw new ForbiddenException('Staff account is not assigned to this Lice');
    return { staffAccountId: staff.id, canOverrideLocked: false };
  }

  async authorizeMatchOrganizer(req: FastifyRequest, matchId: string): Promise<ScoringActor> {
    const userId = await this.getSupabaseUserId(req);
    if (!userId) throw new UnauthorizedException('Organizer session required');
    const match = await this.getMatchContext(matchId);
    await this.orgs.assertOrgRole(match.organizationId, userId, 'editor');
    return { userId, canOverrideLocked: true };
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

  private async getMeForStaff(staffAccountId: string) {
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select('id,event_id,display_name,username,role,status,events(id,slug,name,status)')
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
    const staff = await this.requireStaffFromRequest(req);
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
    const staff = await this.requireStaffFromRequest(req);
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
        '*,lices(id,name,events(id,slug,name,status)),red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name,club_id,clubs(name,logo_url),global_persons(photo_url))),blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name,club_id,clubs(name,logo_url),global_persons(photo_url))),phases(config_json,tournaments(id,name,weapon,scoring_config_json,ruleset_config)),pools(id,name,sort_order),bracket_slots(round),swiss_rounds(round_number)',
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

  private async requireStaffFromRequest(req: FastifyRequest): Promise<StaffAccountRow> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token = cookies?.[STAFF_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('Staff session required');
    const payload = this.jwt.verify(token);
    const account = await this.getAccountForEvent(payload.event_id, payload.sub);
    if (account.status !== 'active') throw new ForbiddenException('Staff account is disabled');
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
      .select('id,organization_id,slug,name,status,end_date')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Event not found');
    return data as EventRow;
  }

  private async findEventBySlug(slug: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id,organization_id,slug,name,status,end_date')
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
      .select('id,event_id,display_name,username,pin_hash,role,status')
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

  private async hashPin(pin: string) {
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
      | number
      | undefined;
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
    // round counter). phaseType is derived from pool membership; medal matches
    // resolve to finals via matchNumberLabel inside getEffectiveBestOf.
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
        phaseType: pool ? 'pool' : undefined,
        matchNumberLabel,
      } satisfies RulesetMatch,
      displayMatchFormat,
    );

    return {
      id: match['id'],
      status: match['status'],
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
