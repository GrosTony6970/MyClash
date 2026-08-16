import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  computeDirectPenaltySanction,
  computePenaltySanction,
  diffPenaltyBucket,
  parsePenaltyRulesetCsv,
  projectPenaltyBucketFromLive,
  type BucketStatus,
  type ExistingPenaltyForSanction,
  type PenaltyCard,
  type PenaltyRulesetEntry,
} from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveOrganizationNames } from '../../common/organization-names';
import { hasPlatformTier } from '../../common/auth/platform-role';
import {
  buildRulesetExport,
  penaltyRulesetExportDefinitionSchema,
  type RulesetExportEnvelope,
} from '../../common/ruleset-export';
import { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import { ScoringService } from '../matches/scoring.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchForfeitsService } from '../matches/match-forfeits.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type {
  AssignPenaltyRulesetDto,
  CreatePenaltyDto,
  CreatePenaltyRulesetDto,
  ImportPenaltyRulesetCsvDto,
  ReviewPenaltyDto,
  UpdatePenaltyRulesetDto,
  VoidPenaltyDto,
} from './dto/penalties.dto';
import {
  buildPenaltyVersionRow,
  freezePenaltyRulesetVersion,
  loadPenaltyRulesetVersion,
  type PenaltyVersionEntry,
} from './penalty-version.util';

type Row = Record<string, unknown>;

export type BlackCardForfeitScope = 'match' | 'tournament' | 'none';

/**
 * A computed penalty lineage lamp: the baseline's display name plus whether
 * this ruleset materially diverges from it. Never self-declared — always the
 * result of diffing canonical forms.
 */
export interface PenaltyLineage {
  base: string;
  status: BucketStatus;
}

/** The columns `projectPenaltyBucketFromLive` needs off a penalty ruleset row.
 *  One constant so every lineage-bearing read selects the same set — a missing
 *  column here reads as a DEFAULT, i.e. a silently wrong lamp. */
const PENALTY_LINEAGE_COLUMNS =
  'name, accumulation_scope, yellow_card_points, red_card_points, black_card_points, ' +
  'first_black_card_forfeit, second_black_card_forfeit, ' +
  'penalty_ruleset_entries(group_number, ref_number, sanctions)';

/**
 * A lean, org-facing projection of an *adoptable* penalty ruleset for the
 * Discover catalog: the platform built-in plus other orgs' approved-public
 * rows. The org's own rows are excluded (they live in the Manage tab). Carries
 * the owning-org name so a shared ruleset is attributed by name, never a UUID.
 */
export interface CatalogPenaltyRulesetSummary {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  built_in: boolean;
  owner_organization_name: string | null;
  accumulation_scope: 'match' | 'phase' | 'tournament';
  /** Computed divergence from the built-in default; null for the built-in
   *  itself. Drives the card's single lineage lamp. */
  lineage: PenaltyLineage | null;
}

/** The raw catalog row as selected: the summary's own fields plus the card /
 *  forfeit / entries columns the lineage projection reads. */
type CatalogPenaltyRow = Omit<CatalogPenaltyRulesetSummary, 'owner_organization_name' | 'lineage'> &
  Row & { owner_organization_id: string | null };

@Injectable()
export class PenaltiesService {
  private readonly logger = new Logger(PenaltiesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly scoring?: ScoringService,
    @Optional() private readonly frozenResults?: FrozenResultsGuard,
    @Optional() private readonly orgs?: OrganizationsService,
    @Optional() private readonly forfeits?: MatchForfeitsService,
    // Optional (provided via RulesetHashModule) so direct-construction unit tests
    // keep working. Restamps the tournament content hash after a penalty re-pin.
    @Optional() private readonly rulesetHash?: RulesetHashService,
  ) {}

  async listRulesets() {
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('*')
      .order('built_in', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getRuleset(rulesetId: string) {
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('*, penalty_ruleset_entries(*)')
      .eq('id', rulesetId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Penalty ruleset ${rulesetId} not found`);
    return data;
  }

  /**
   * How a custom penalty ruleset diverges from the platform built-in default,
   * computed by diffing their canonical forms (never self-declared). Returns
   * null for the built-in itself (no parent) and when no built-in exists. The
   * built-in is read LIVE (it is never frozen), so this is advisory — a later
   * super-admin edit to the built-in moves the baseline. Powers the
   * authoring-surface penalty lineage lamp. Resolved by the built_in flag, not
   * the stale BUILTIN_VERSION constant.
   */
  async describeRulesetLineage(rulesetId: string): Promise<PenaltyLineage | null> {
    const ruleset = (await this.getRuleset(rulesetId)) as Row;
    if (ruleset['built_in']) return null;
    const builtin = await this.loadBuiltInPenaltyBaseline();
    if (!builtin) return null;
    return this.lineageAgainst(builtin, ruleset);
  }

  /**
   * The built-in penalty definition every custom ruleset's lamp is measured
   * against. Resolved by the `built_in` flag rather than the stale
   * BUILTIN_VERSION constant, and read LIVE (the built-in is never frozen), so
   * a super-admin edit to it moves the baseline — an accepted advisory limit.
   *
   * One loader so the single-ruleset endpoint and the list reads share it: a
   * list must fetch this ONCE, not once per row.
   */
  private async loadBuiltInPenaltyBaseline(): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('penalty_rulesets')
      .select(PENALTY_LINEAGE_COLUMNS)
      .eq('built_in', true)
      .is('owner_organization_id', null)
      .limit(1)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  /** Diff one live penalty row against the built-in baseline. Both sides go
   *  through the same projector the content hash uses, so the lamp and the
   *  fingerprint cannot disagree about what a change is. */
  private lineageAgainst(builtin: Row, ruleset: Row): PenaltyLineage {
    return {
      base: (builtin['name'] as string) ?? '',
      status: diffPenaltyBucket(
        projectPenaltyBucketFromLive(builtin),
        projectPenaltyBucketFromLive(ruleset),
      ),
    };
  }

  /**
   * Lineage for a whole list of penalty rulesets, keyed by row id — the batched
   * form of {@link describeRulesetLineage}. Built-in rows map to null: they are
   * the baseline, so they reuse nothing.
   */
  private async describeRulesetLineages(
    rows: readonly Row[],
  ): Promise<Map<string, PenaltyLineage | null>> {
    const out = new Map<string, PenaltyLineage | null>();
    for (const row of rows) out.set(row['id'] as string, null);
    if (rows.every((row) => row['built_in'])) return out;
    const builtin = await this.loadBuiltInPenaltyBaseline();
    if (!builtin) return out;
    for (const row of rows) {
      if (row['built_in']) continue;
      out.set(row['id'] as string, this.lineageAgainst(builtin, row));
    }
    return out;
  }

  async getEffectiveRulesetForMatch(matchId: string) {
    const match = await this.getMatchContext(matchId);
    if (match.penaltyRulesetId) return this.getRuleset(match.penaltyRulesetId);
    return this.loadBuiltInPenaltyRuleset();
  }

  /**
   * The platform default every match and tournament falls back to, entries
   * included — the set of sanctions a referee can actually reach on the pad.
   *
   * Resolved by the `built_in` flag, NOT by a hard-coded (code, version) pair.
   * The old lookup asked for version '2026' while migration 0054 seeds the row
   * as '1.0.0', so it matched nothing and returned null: every match without an
   * explicitly pinned ruleset — the default state — served the pad an empty
   * penalty picker, and no referee could card anyone. A version is data, and the
   * built-in is edited in place (it is never frozen), so the flag is the only
   * stable handle. `loadBuiltInPenaltyBaseline` had already reached that
   * conclusion for the lineage lamp; this is the same rule for the same row.
   */
  private async loadBuiltInPenaltyRuleset(): Promise<Row | null> {
    const { data, error } = await this.builtInPenaltyRulesetQuery('*, penalty_ruleset_entries(*)');
    if (error) throw new BadRequestException(error.message);
    return (data as Row | null) ?? null;
  }

  /**
   * The one predicate that identifies the built-in row, shared by every caller
   * so they cannot drift apart — which is the fault this replaced: the picker
   * and the recorder each decided for themselves what the default was.
   *
   * `.limit(1)` before `.maybeSingle()`: a second built-in row would otherwise
   * null the whole result and silently empty the picker again.
   */
  private builtInPenaltyRulesetQuery(columns: string) {
    return this.supabase.service
      .from('penalty_rulesets')
      .select(columns)
      .eq('built_in', true)
      .is('owner_organization_id', null)
      .limit(1)
      .maybeSingle();
  }

  /**
   * Effective penalty ruleset for a tournament, resolving tournament →
   * event default → built-in (mirrors {@link getEffectiveRulesetForMatch}
   * minus the match-level override). Powers the admin "quick-pick penalties"
   * picker so organizers can pin common entries to the scoreboard.
   */
  async getEffectiveRulesetForTournament(tournamentId: string) {
    const { data: t, error } = await this.supabase.service
      .from('tournaments')
      .select('penalty_ruleset_id, event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const tour = t as { penalty_ruleset_id?: string | null; event_id?: string | null } | null;
    if (tour?.penalty_ruleset_id) return this.getRuleset(tour.penalty_ruleset_id);
    if (tour?.event_id) {
      const { data: ev } = await this.supabase.service
        .from('events')
        .select('penalty_ruleset_id')
        .eq('id', tour.event_id)
        .maybeSingle();
      const evRulesetId =
        (ev as { penalty_ruleset_id?: string | null } | null)?.penalty_ruleset_id ?? null;
      if (evRulesetId) return this.getRuleset(evRulesetId);
    }

    return this.loadBuiltInPenaltyRuleset();
  }

  async createRuleset(dto: CreatePenaltyRulesetDto, userId?: string) {
    await this.assertUserCanManageOrg(dto.ownerOrganizationId, userId);
    const insertRow: Record<string, unknown> = {
      owner_organization_id: dto.ownerOrganizationId,
      code: dto.code,
      version: dto.version,
      name: dto.name.trim(),
      description: dto.description ?? null,
      accumulation_scope: dto.accumulationScope,
      public_visibility: dto.publicVisibility,
      built_in: false,
      created_by_user_id: userId ?? null,
    };
    // Card costs + forfeit scopes: only forward when the caller provided
    // them so the column defaults (yellow=0, red=-1, black=0; first=match,
    // second=tournament) apply for callers that don't care.
    if (dto.yellowCardPoints !== undefined) insertRow['yellow_card_points'] = dto.yellowCardPoints;
    if (dto.redCardPoints !== undefined) insertRow['red_card_points'] = dto.redCardPoints;
    if (dto.blackCardPoints !== undefined) insertRow['black_card_points'] = dto.blackCardPoints;
    if (dto.firstBlackCardForfeit !== undefined)
      insertRow['first_black_card_forfeit'] = dto.firstBlackCardForfeit;
    if (dto.secondBlackCardForfeit !== undefined)
      insertRow['second_black_card_forfeit'] = dto.secondBlackCardForfeit;

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .insert(insertRow)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    const ruleset = data as Row;
    await this.replaceEntries(ruleset['id'] as string, dto.entries);
    return this.getRuleset(ruleset['id'] as string);
  }

  async importRulesetCsv(dto: ImportPenaltyRulesetCsvDto, userId?: string) {
    const ownerOrganizationId =
      dto.ownerOrganizationId ??
      (dto.eventId ? await this.getEventOrganizationId(dto.eventId) : null);
    if (!ownerOrganizationId) {
      throw new BadRequestException('ownerOrganizationId or eventId is required');
    }
    const parsed = parsePenaltyRulesetCsv(dto.csv, {
      code: dto.code,
      name: dto.name,
      version: dto.version,
      accumulationScope: dto.accumulationScope,
      builtIn: false,
    });
    return this.createRuleset(
      {
        ownerOrganizationId,
        code: parsed.code,
        version: parsed.version,
        name: parsed.name,
        accumulationScope: parsed.accumulationScope,
        publicVisibility: false,
        entries: parsed.entries.map((entry) => ({
          groupNumber: entry.groupNumber,
          refNumber: entry.refNumber,
          shortName: entry.shortName,
          description: entry.description,
          sanctions: [...entry.sanctions],
        })),
      },
      userId,
    );
  }

  /**
   * Serialise an org-owned penalty ruleset to a portable, self-contained
   * envelope (see common/ruleset-export.ts). Entries are sorted by (group, ref)
   * so the same ruleset always exports to the same integrity hash. Built-in
   * rulesets are engine data, not authored, so they are export-blocked.
   */
  async exportRulesetJson(id: string, userId?: string): Promise<RulesetExportEnvelope> {
    const row = (await this.getRuleset(id)) as Row;
    await this.assertUserCanManageOrg(row['owner_organization_id'] as string, userId);
    if (row['built_in']) {
      throw new BadRequestException('Built-in penalty rulesets cannot be exported.');
    }
    const entries = ((row['penalty_ruleset_entries'] as Array<Record<string, unknown>>) ?? [])
      .map((e) => ({
        groupNumber: e['group_number'] as number,
        refNumber: String(e['ref_number'] ?? ''),
        shortName: (e['short_name'] as string) ?? '',
        description: (e['description'] as string) ?? '',
        sanctions: (e['sanctions'] as Array<'yellow' | 'red' | 'black'>) ?? [],
      }))
      .sort((a, b) => a.groupNumber - b.groupNumber || a.refNumber.localeCompare(b.refNumber));
    return buildRulesetExport('penalty', {
      name: row['name'],
      version: row['version'],
      description: (row['description'] as string | null) ?? null,
      accumulationScope: row['accumulation_scope'],
      yellowCardPoints: row['yellow_card_points'],
      redCardPoints: row['red_card_points'],
      blackCardPoints: row['black_card_points'],
      firstBlackCardForfeit: row['first_black_card_forfeit'],
      secondBlackCardForfeit: row['second_black_card_forfeit'],
      entries,
    });
  }

  /**
   * Create a new org-owned penalty ruleset from a portable envelope. Mirrors
   * importRulesetCsv: re-validate the definition, generate a FRESH code, and
   * insert through createRuleset (owner = this org, unshared). The file's
   * identity and integrity hash are never trusted.
   */
  async importRulesetJson(
    orgId: string,
    envelope: RulesetExportEnvelope,
    userId?: string,
  ): Promise<Row> {
    if (envelope.type !== 'penalty') {
      throw new BadRequestException(
        `This file is a ${envelope.type} ruleset, not a penalty ruleset.`,
      );
    }
    const parsed = penaltyRulesetExportDefinitionSchema.safeParse(envelope.definition);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid penalty ruleset definition: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const def = parsed.data;
    const slug =
      def.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'ruleset';
    return this.createRuleset(
      {
        ownerOrganizationId: orgId,
        code: `imported-${slug}-${Date.now().toString(36)}`,
        version: def.version,
        name: def.name,
        description: def.description ?? undefined,
        accumulationScope: def.accumulationScope,
        publicVisibility: false,
        entries: def.entries,
        yellowCardPoints: def.yellowCardPoints,
        redCardPoints: def.redCardPoints,
        blackCardPoints: def.blackCardPoints,
        firstBlackCardForfeit: def.firstBlackCardForfeit,
        secondBlackCardForfeit: def.secondBlackCardForfeit,
      },
      userId,
    );
  }

  /**
   * Patch a penalty ruleset's metadata and optionally its full entries list.
   *
   * Auth model:
   *   - built_in rows are editable only by super-admin (mirrors the TF v1
   *     scoring-ruleset pattern). The RLS update policy blocks built_in
   *     edits at the row level, but we write via service-role so the gate
   *     is the in-service `isSuperAdmin` check below. Note this is the EXACT
   *     tier, not `isPlatformStaffAdmin` — a platform admin moderates, it does
   *     not rewrite the rules every running event scores by.
   *   - Custom rows: org-admin of the owning org (or platform staff).
   *
   * Entries are replaced wholesale when `dto.entries` is provided: delete
   * existing rows, then bulk-insert the new set. Skip when omitted.
   */
  async updateRuleset(id: string, dto: UpdatePenaltyRulesetDto, userId?: string) {
    const { data: existing, error: readErr } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id, owner_organization_id, built_in')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw new BadRequestException(readErr.message);
    if (!existing) throw new NotFoundException(`Penalty ruleset ${id} not found`);

    const row = existing as Row;
    if (row['built_in']) {
      if (!userId) throw new UnauthorizedException('Authentication required');
      const superAdmin = await this.isSuperAdmin(userId);
      if (!superAdmin) {
        throw new ForbiddenException('Only super-admin can edit the built-in penalty ruleset');
      }
    } else {
      await this.assertUserCanManageOrg(row['owner_organization_id'] as string, userId);
    }

    // Immutability guard: once a tournament or event pins a custom penalty
    // ruleset, its definition is frozen — editing it in place would silently
    // change how future cards escalate/cost under a running tournament. The
    // built-in is exempt (super-admin authors it, mirroring the scoring
    // is_system carve-out). To evolve a pinned ruleset, duplicate + re-pin.
    if (!row['built_in'] && (await this.isPenaltyRulesetReferenced(id))) {
      throw new ConflictException(
        'This penalty ruleset is in use by a tournament or event and cannot be edited. Duplicate it to make changes, then re-pin.',
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description ?? null;
    if (dto.accumulationScope !== undefined) updates['accumulation_scope'] = dto.accumulationScope;
    if (dto.publicVisibility !== undefined) updates['public_visibility'] = dto.publicVisibility;
    if (dto.yellowCardPoints !== undefined) updates['yellow_card_points'] = dto.yellowCardPoints;
    if (dto.redCardPoints !== undefined) updates['red_card_points'] = dto.redCardPoints;
    if (dto.blackCardPoints !== undefined) updates['black_card_points'] = dto.blackCardPoints;
    if (dto.firstBlackCardForfeit !== undefined)
      updates['first_black_card_forfeit'] = dto.firstBlackCardForfeit;
    if (dto.secondBlackCardForfeit !== undefined)
      updates['second_black_card_forfeit'] = dto.secondBlackCardForfeit;

    const { error: updateErr } = await this.supabase.service
      .from('penalty_rulesets')
      .update(updates)
      .eq('id', id);
    if (updateErr) throw new BadRequestException(updateErr.message);

    if (dto.entries !== undefined) {
      const { error: delErr } = await this.supabase.service
        .from('penalty_ruleset_entries')
        .delete()
        .eq('ruleset_id', id);
      if (delErr) throw new BadRequestException(delErr.message);
      if (dto.entries.length > 0) {
        await this.replaceEntries(id, dto.entries);
      }
    }

    return this.getRuleset(id);
  }

  /**
   * Delete a custom (non-built-in) penalty ruleset. The built-in row is
   * never deletable — it's the implicit fallback for tournaments with
   * `penalty_ruleset_id = NULL`. Custom rows are removable by their
   * owning org's admins (or super-admin). `match_penalties.ruleset_id`
   * is ON DELETE SET NULL, so historic penalty records survive.
   */
  async deleteRuleset(id: string, userId?: string): Promise<{ archived: boolean }> {
    const { data: existing, error: readErr } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id, owner_organization_id, built_in')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw new BadRequestException(readErr.message);
    if (!existing) throw new NotFoundException(`Penalty ruleset ${id} not found`);

    const row = existing as Row;
    if (row['built_in']) {
      throw new ForbiddenException('The built-in penalty ruleset cannot be deleted');
    }
    await this.assertUserCanManageOrg(row['owner_organization_id'] as string, userId);

    // Delist ≠ delete: a penalty ruleset a tournament or event still pins must
    // resolve forever. getEffectiveRuleset* reads the live row by id and the pin
    // FK is ON DELETE SET NULL, so a hard delete would silently fall those
    // tournaments back to the built-in — a sanction change under recorded
    // results. Soft-archive instead: the row leaves every Manage list, catalog
    // and pin dropdown but stays resolvable by id. Only an unreferenced ruleset
    // is truly deleted. Mirrors the scoring custom_rulesets delist behaviour.
    if (await this.isPenaltyRulesetReferenced(id)) {
      const now = new Date().toISOString();
      const { error: archErr } = await this.supabase.service
        .from('penalty_rulesets')
        .update({ archived_at: now, updated_at: now })
        .eq('id', id);
      if (archErr) throw new BadRequestException(archErr.message);
      return { archived: true };
    }

    const { error: delErr } = await this.supabase.service
      .from('penalty_rulesets')
      .delete()
      .eq('id', id);
    if (delErr) throw new BadRequestException(delErr.message);
    return { archived: false };
  }

  // ── R3: "Submit for sharing" promotion workflow ──────────────────────────

  /**
   * Org-admin action — flip the ruleset's request status to 'pending' so
   * a super-admin can review it and approve for platform-wide sharing.
   * Built-in and already-public rows can't be submitted (they're already
   * visible to everyone). Validates ownership via assertUserCanManageOrg
   * on the row's owner.
   */
  async submitRulesetForSharing(id: string, userId?: string) {
    const existing = await this.loadRulesetForSharing(id);
    if (existing.built_in) {
      throw new BadRequestException('Built-in rulesets do not need to be submitted for sharing');
    }
    if (existing.public_visibility) {
      throw new BadRequestException('This ruleset is already shared platform-wide');
    }
    await this.assertUserCanManageOrg(existing.owner_organization_id ?? '', userId);

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .update({
        public_visibility_request_status: 'pending',
        public_visibility_request_reason: null,
        public_visibility_requested_at: new Date().toISOString(),
        public_visibility_reviewed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Submit failed');
    return data;
  }

  /**
   * Platform-staff action — approve a pending sharing request. Flips
   * public_visibility=true so the row appears in every org's
   * listRulesetsForOrg result + every tournament's penalty-ruleset
   * dropdown.
   *
   * A review queue, so platform admins may work it; only editing the built-in
   * ruleset itself stays reserved.
   */
  async approveRulesetSharing(id: string, userId?: string) {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (!(await this.isPlatformStaffAdmin(userId))) {
      throw new ForbiddenException('Platform admin access required to approve sharing');
    }
    const existing = await this.loadRulesetForSharing(id);
    if (existing.public_visibility_request_status !== 'pending') {
      throw new BadRequestException('No pending sharing request to approve');
    }

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .update({
        public_visibility: true,
        public_visibility_request_status: 'approved',
        public_visibility_request_reason: null,
        public_visibility_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Approve failed');
    return data;
  }

  /**
   * Platform-staff action — reject the sharing request with a reason. The
   * row remains org-private; the org can fix the issue and resubmit.
   */
  async rejectRulesetSharing(id: string, reason: string, userId?: string) {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (!(await this.isPlatformStaffAdmin(userId))) {
      throw new ForbiddenException('Platform admin access required to reject sharing');
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('A rejection reason is required');
    const existing = await this.loadRulesetForSharing(id);
    if (existing.public_visibility_request_status !== 'pending') {
      throw new BadRequestException('No pending sharing request to reject');
    }

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .update({
        public_visibility_request_status: 'rejected',
        public_visibility_request_reason: trimmed,
        public_visibility_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Reject failed');
    return data;
  }

  /**
   * Tight read for sharing-flow validation. Returns just the columns each
   * approve/reject/submit path needs to inspect.
   */
  private async loadRulesetForSharing(id: string): Promise<{
    id: string;
    built_in: boolean;
    owner_organization_id: string | null;
    public_visibility: boolean;
    public_visibility_request_status: 'pending' | 'approved' | 'rejected' | null;
  }> {
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select(
        'id, built_in, owner_organization_id, public_visibility, public_visibility_request_status',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Penalty ruleset ${id} not found`);
    return data as {
      id: string;
      built_in: boolean;
      owner_organization_id: string | null;
      public_visibility: boolean;
      public_visibility_request_status: 'pending' | 'approved' | 'rejected' | null;
    };
  }

  /**
   * List penalty rulesets relevant to an organization: the built-in (always
   * visible) + any rulesets owned by `orgId`. Used by the organizer-facing
   * /org/[slug]/penalty-rulesets page and the tournament settings dropdown
   * to avoid showing other orgs' public rulesets.
   */
  async listRulesetsForOrg(orgId: string, userId?: string) {
    await this.assertUserCanManageOrg(orgId, userId);
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      // The entries embed rides along for the computed lineage lamp; `*` alone
      // carries the parent card/forfeit columns it also needs.
      .select(`*, penalty_ruleset_entries(group_number, ref_number, sanctions)`)
      .or(`built_in.eq.true,owner_organization_id.eq.${orgId}`)
      // Archived rulesets stay resolvable for tournaments that pin them but must
      // not reappear in the Manage list or the tournament pin dropdown this feeds
      // (delist ≠ delete).
      .is('archived_at', null)
      .order('built_in', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Row[];
    const lineage = await this.describeRulesetLineages(rows);
    return rows.map((row) => ({ ...row, lineage: lineage.get(row['id'] as string) ?? null }));
  }

  /**
   * Discover catalog for an org: penalty rulesets it can *adopt* but does not
   * own — the platform built-in plus other orgs' approved-public rows. Unlike
   * listRulesetsForOrg (which deliberately hides other orgs' public rows so the
   * tournament dropdown stays scoped), this is the browse-and-adopt surface, so
   * it surfaces them. Owning-org names are batch-resolved for attribution.
   */
  async listRulesetCatalogForOrg(
    orgId: string,
    userId?: string,
  ): Promise<CatalogPenaltyRulesetSummary[]> {
    await this.assertUserCanManageOrg(orgId, userId);
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      // PENALTY_LINEAGE_COLUMNS feeds the computed lamp and also supplies the
      // `name` + `accumulation_scope` the summary itself exposes — hence no
      // separate mention of them here. The rest stays internal to the computation.
      .select(
        'id, code, version, description, built_in, owner_organization_id, public_visibility, ' +
          PENALTY_LINEAGE_COLUMNS,
      )
      // Built-in (any org can adopt) OR another org's approved-public row. The
      // and(...) branch excludes this org's own public rows — Manage shows those.
      .or(`built_in.eq.true,and(public_visibility.eq.true,owner_organization_id.neq.${orgId})`)
      // An archived shared ruleset leaves the Discover catalog too — it can no
      // longer be adopted, only resolved for tournaments already pinned to it.
      .is('archived_at', null)
      .order('built_in', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    // `unknown` hop: the select is assembled from PENALTY_LINEAGE_COLUMNS, and
    // the typed client can only infer columns from a string literal.
    const rows = (data ?? []) as unknown as CatalogPenaltyRow[];
    const [names, lineage] = await Promise.all([
      resolveOrganizationNames(
        this.supabase,
        rows.map((r) => r.owner_organization_id),
      ),
      this.describeRulesetLineages(rows as unknown as Row[]),
    ]);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      version: r.version,
      name: r.name,
      description: r.description,
      built_in: r.built_in,
      owner_organization_name: r.owner_organization_id
        ? (names.get(r.owner_organization_id) ?? null)
        : null,
      accumulation_scope: r.accumulation_scope,
      lineage: lineage.get(r.id) ?? null,
    }));
  }

  async assignEventRuleset(eventId: string, dto: AssignPenaltyRulesetDto, userId?: string) {
    await this.assertUserCanManageOrg(await this.getEventOrganizationId(eventId), userId);
    const nextId = dto.penaltyRulesetId ?? null;
    const currentId = await this.getEventPenaltyRulesetId(eventId);
    // Re-pin guard: tournaments under this event that INHERIT the default (their
    // own penalty_ruleset_id is NULL) resolve the event ruleset LIVE at record
    // time (getMatchContext), so swapping it once any such tournament has scored
    // matches would apply a different sanction ladder/cost to later cards.
    // Mirrors the tournament-path guard (assignTournamentRuleset).
    if (nextId !== currentId && (await this.eventHasInheritingStartedMatches(eventId))) {
      throw new ForbiddenException(
        'A tournament in this event inherits the event default penalty ruleset and has scored matches, so it is locked. Change it before scoring starts.',
      );
    }
    // Pin the ruleset's current version so the content-hash reads the frozen
    // snapshot for exactly what was pinned (null when clearing the default).
    const nextVersion = nextId ? await loadPenaltyRulesetVersion(this.supabase, nextId) : null;
    const { data, error } = await this.supabase.service
      .from('events')
      .update({
        penalty_ruleset_id: nextId,
        penalty_ruleset_version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    // Pin-time freeze: capture the pinned definition immutably (best-effort).
    if (nextId) await freezePenaltyRulesetVersion(this.supabase, nextId, userId);
    // The event default changed, so every tournament that inherits it needs its
    // content hash restamped (best-effort; @Optional in unit tests).
    await this.rulesetHash?.stampEventInheritingTournaments(eventId);
    return data;
  }

  async assignTournamentRuleset(
    tournamentId: string,
    dto: AssignPenaltyRulesetDto,
    userId?: string,
  ) {
    await this.assertUserCanManageOrg(await this.getTournamentOrganizationId(tournamentId), userId);
    const nextId = dto.penaltyRulesetId ?? null;
    const currentId = await this.getTournamentPenaltyRulesetId(tournamentId);
    // Re-pin guard: once matches are scored, the penalty ruleset is locked to
    // ordinary edits — swapping it mid-event would apply a different sanction
    // ladder/cost to later cards than the ones already recorded. Mirrors the
    // scoring assertNoRecordedResults guard (events.updateTournament).
    if (nextId !== currentId && (await this.tournamentHasStartedMatches(tournamentId))) {
      throw new ForbiddenException(
        'This tournament has scored matches, so its penalty ruleset is locked. Change it before scoring starts.',
      );
    }
    const nextVersion = nextId ? await loadPenaltyRulesetVersion(this.supabase, nextId) : null;
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update({
        penalty_ruleset_id: nextId,
        penalty_ruleset_version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    if (nextId) await freezePenaltyRulesetVersion(this.supabase, nextId, userId);
    // The penalty pin changed — restamp the tournament's content hash so the
    // fingerprint + match stamps track the new penalty (best-effort).
    await this.rulesetHash?.stampTournamentContentHash(tournamentId);
    return data;
  }

  async listMatchPenalties(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('match_id', matchId)
      .order('sequence', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createPenalty(
    matchId: string,
    dto: CreatePenaltyDto,
    context?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ) {
    const match = await this.getMatchContext(matchId);
    this.assertMatchNotLocked(match, context);
    if (!context?.staffAccountId) {
      await this.assertUserCanScoreOrg(match.organizationId, context?.userId);
    }
    await this.frozenResults?.assertExchangeCreationAllowed(matchId, context?.userId);
    if (!dto.rulesetEntryId && !dto.directCard) {
      throw new BadRequestException('Either rulesetEntryId or directCard is required');
    }
    if (dto.directCard && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required for direct card penalties');
    }

    const { data: existing } = await this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('client_uuid', dto.clientUuid)
      .maybeSingle();
    if (existing) return existing;

    if (![match.redRegistrationId, match.blueRegistrationId].includes(dto.registrationId)) {
      throw new BadRequestException('Penalty registration must belong to the current match');
    }

    const sanction =
      dto.directCard !== undefined
        ? computeDirectPenaltySanction(dto.directCard)
        : await this.computeRulesetPenalty(match, dto);

    // Load the active penalty ruleset row once so we can read its card-cost
    // columns and forfeit-scope settings. computePenaltySanction returns a
    // hardcoded `scoreDelta` based on card colour; the row's per-card
    // columns override that so operators can tune values per ruleset.
    //
    // THIS TERNARY LOOKS LIKE A BUG AND IS NOT. It reads as "only price from the
    // row when a ruleset was pinned", which would leave an unpinned tournament
    // reading the built-in for WHICH card and ignoring its columns for the
    // price. `match.penaltyRulesetId` is already the EFFECTIVE id — see
    // `getMatchContext`, which falls back to the built-in precisely so read and
    // write resolve the same way. The null branch is reachable only when no
    // built-in row exists at all, which is a broken install. Do not "fix" it
    // into a second lookup; there is a test below pinning the behaviour.
    const activePenaltyRuleset = match.penaltyRulesetId
      ? await this.loadPenaltyRulesetRow(match.penaltyRulesetId)
      : null;
    const scoreDelta = activePenaltyRuleset
      ? this.cardScoreDelta(activePenaltyRuleset, sanction.card)
      : sanction.scoreDelta;

    // For non-black cards `causes_match_forfeit` stays as the sanction said
    // (false). For black cards we'll override based on the resolved scope
    // below — but at this point we just record the card.
    const opponentRegistrationId =
      dto.registrationId === match.redRegistrationId
        ? match.blueRegistrationId
        : match.redRegistrationId;

    const insertPayload: Record<string, unknown> = {
      client_uuid: dto.clientUuid,
      match_id: match.id,
      tournament_id: match.tournamentId,
      registration_id: dto.registrationId,
      ruleset_id: dto.directCard ? null : match.penaltyRulesetId,
      ruleset_entry_id: dto.rulesetEntryId ?? null,
      sequence: dto.sequence,
      source: dto.directCard ? 'direct' : 'ruleset',
      card: sanction.card,
      group_number: 'entry' in sanction ? null : null,
      ref_number: null,
      short_name: null,
      reason: dto.reason ?? null,
      score_delta: scoreDelta,
      causes_match_forfeit: sanction.causesMatchForfeit,
      by_user_id: context?.userId ?? null,
      staff_account_id: context?.staffAccountId ?? null,
      occurred_at: dto.occurredAt,
      clock_time_ms: dto.clockTimeMs ?? null,
      voided: false,
    };

    if (!dto.directCard && dto.rulesetEntryId) {
      const entry = await this.getRulesetEntry(dto.rulesetEntryId);
      insertPayload.group_number = entry.groupNumber;
      insertPayload.ref_number = entry.refNumber;
      insertPayload.short_name = entry.shortName;
    }

    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .insert(insertPayload)
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        const { data: raceExisting } = await this.supabase.service
          .from('match_penalties')
          .select('*')
          .eq('client_uuid', dto.clientUuid)
          .maybeSingle();
        if (raceExisting) return raceExisting;
      }
      throw new BadRequestException(error.message);
    }

    await this.scoring?.recomputeMatchScore(matchId);

    if (sanction.causesMatchForfeit) {
      // Determine the ordinal: count this registration's non-voided black
      // cards in the tournament (including the row we just inserted).
      const blackCount = await this.countBlackCardsForRegistration(
        match.tournamentId,
        dto.registrationId,
      );
      const scoringConfig = await this.loadTournamentRulesetConfig(match.tournamentId);
      const scope: BlackCardForfeitScope = activePenaltyRuleset
        ? this.resolveBlackCardForfeitScope(activePenaltyRuleset, scoringConfig, blackCount)
        : blackCount >= 2
          ? 'tournament'
          : 'match';

      if (scope !== 'none') {
        if (this.forfeits) {
          await this.forfeits.createForfeit(
            matchId,
            {
              forfeitingRegistrationId: dto.registrationId,
              reason: blackCount >= 2 ? 'black_card_2' : 'black_card_1',
              canContinue: true,
              note: dto.reason ?? 'Black card',
            },
            context,
          );
        } else {
          await this.supabase.service
            .from('matches')
            .update({
              status: 'completed',
              ended_at: new Date().toISOString(),
              winner_registration_id: opponentRegistrationId,
              end_reason: 'black_card',
              updated_at: new Date().toISOString(),
            })
            .eq('id', matchId);
        }
      }

      // Tournament-wide scope short-circuits the manual review path: mark
      // the registration disqualified immediately. The standard 2nd-black
      // review still gets created for audit/visibility.
      if (scope === 'tournament') {
        await this.supabase.service
          .from('registrations')
          .update({ status: 'disqualified' })
          .eq('id', dto.registrationId);
      }
      await this.createSecondBlackCardReviewIfNeeded(match.tournamentId, dto.registrationId);
    }

    return data;
  }

  /**
   * Per-card point cost from the EFFECTIVE penalty ruleset row — pinned or
   * built-in. The row's yellow_/red_/black_card_points columns override the
   * hardcoded penaltyScoreDelta() values that computePenaltySanction returns.
   *
   * "Effective" is load-bearing. The caller used to consult these columns only
   * for a PINNED ruleset, so the built-in's own values were read for the card
   * and ignored for its price. One rule now: card points always come from the
   * ruleset the match actually uses.
   */
  private cardScoreDelta(rulesetRow: Row, card: PenaltyCard): number {
    const key =
      card === 'yellow'
        ? 'yellow_card_points'
        : card === 'red'
          ? 'red_card_points'
          : 'black_card_points';
    const value = rulesetRow[key];
    return typeof value === 'number' ? value : 0;
  }

  private async loadPenaltyRulesetRow(rulesetId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('penalty_rulesets')
      .select(
        'id, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit',
      )
      .eq('id', rulesetId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private async loadTournamentRulesetConfig(
    tournamentId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('ruleset_config')
      .eq('id', tournamentId)
      .maybeSingle();
    return (data as { ruleset_config?: Record<string, unknown> } | null)?.ruleset_config ?? null;
  }

  private async countBlackCardsForRegistration(
    tournamentId: string,
    registrationId: string,
  ): Promise<number> {
    const { count } = await this.supabase.service
      .from('match_penalties')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .eq('registration_id', registrationId)
      .eq('card', 'black')
      .eq('voided', false);
    return count ?? 0;
  }

  async voidPenalty(
    penaltyId: string,
    dto: VoidPenaltyDto,
    context?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ) {
    const { data: penalty, error: fetchError } = await this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('id', penaltyId)
      .maybeSingle();
    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!penalty) throw new NotFoundException(`Penalty ${penaltyId} not found`);
    const row = penalty as Row;
    const match = await this.getMatchContext(row['match_id'] as string);
    this.assertMatchNotLocked(match, context);
    if (!context?.staffAccountId) {
      await this.assertUserCanScoreOrg(match.organizationId, context?.userId);
    }
    if (row['voided']) throw new BadRequestException('Penalty is already voided');

    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .update({ voided: true, voided_reason: dto.reason ?? null })
      .eq('id', penaltyId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.scoring?.recomputeMatchScore(row['match_id'] as string);
    return data;
  }

  async listTournamentReviews(tournamentId: string) {
    const { data, error } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async reviewTournamentPenalty(reviewId: string, dto: ReviewPenaltyDto, userId?: string) {
    const { data: existing, error: fetchError } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .select('*')
      .eq('id', reviewId)
      .maybeSingle();
    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!existing) throw new NotFoundException(`Penalty review ${reviewId} not found`);
    const review = existing as Row;
    await this.assertUserCanManageOrg(
      await this.getTournamentOrganizationId(review['tournament_id'] as string),
      userId,
    );

    if (dto.status === 'confirmed') {
      await this.supabase.service
        .from('registrations')
        .update({ status: 'disqualified' })
        .eq('id', review['registration_id'] as string);
    }

    const { data, error } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .update({
        status: dto.status,
        reviewed_by_user_id: userId ?? null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', reviewId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async computeRulesetPenalty(match: MatchContext, dto: CreatePenaltyDto) {
    if (!match.penaltyRulesetId) {
      throw new BadRequestException('No penalty ruleset is attached to this tournament or event');
    }
    const entry = await this.getRulesetEntry(dto.rulesetEntryId!);
    const previous = await this.getExistingPenaltiesForScope(match, dto.registrationId);
    return computePenaltySanction(entry, previous, dto.registrationId);
  }

  /**
   * The prior penalties this match's two fighters are accumulating against.
   *
   * EXISTS SO THE PAD CAN COMPUTE A CARD THE SAME WAY THE SERVER DOES. Which
   * card a repeated offence earns is `sanctions[occurrence - 1]`, and the
   * occurrence is a count of prior non-voided ruleset cards in the same group.
   * WHERE that count is taken from is `accumulation_scope`: at 'match' it is
   * this match, otherwise it is the whole tournament — and at tournament scope
   * the priors sit in OTHER matches, which the pad has never seen. Without this
   * the pad could only ever be right for one of the two scopes.
   *
   * Returns exactly the array `computePenaltySanction` consumes, so the pad
   * feeds the server's own input into the server's own function. Divergence is
   * then only possible through staleness, not through logic.
   */
  async getPenaltyScopeForMatch(matchId: string): Promise<{
    accumulationScope: string;
    priors: Record<string, ExistingPenaltyForSanction[]>;
  }> {
    const match = await this.getMatchContext(matchId);
    const ruleset = match.penaltyRulesetId ? await this.getRuleset(match.penaltyRulesetId) : null;
    const accumulationScope =
      ((ruleset as Row | null)?.['accumulation_scope'] as string | undefined) ?? 'match';

    const registrationIds = [match.redRegistrationId, match.blueRegistrationId].filter(
      (id): id is string => Boolean(id),
    );
    const priors: Record<string, ExistingPenaltyForSanction[]> = {};
    for (const registrationId of registrationIds) {
      priors[registrationId] = match.penaltyRulesetId
        ? await this.getExistingPenaltiesForScope(match, registrationId)
        : [];
    }
    return { accumulationScope, priors };
  }

  private async getExistingPenaltiesForScope(
    match: MatchContext,
    registrationId: string,
  ): Promise<ExistingPenaltyForSanction[]> {
    const ruleset = await this.getRuleset(match.penaltyRulesetId!);
    const accumulationScope = (ruleset as Row)['accumulation_scope'] as string;
    let q = this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('registration_id', registrationId)
      .eq('source', 'ruleset')
      .eq('voided', false);

    if (accumulationScope === 'match') {
      q = q.eq('match_id', match.id) as typeof q;
    } else {
      q = q.eq('tournament_id', match.tournamentId) as typeof q;
    }

    const { data, error } = await q.order('sequence', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((row) => {
      const penalty = row as Row;
      return {
        registrationId: penalty['registration_id'] as string,
        groupNumber: penalty['group_number'] as number | undefined,
        card: penalty['card'] as PenaltyCard,
        source: penalty['source'] as 'ruleset' | 'direct',
        voided: Boolean(penalty['voided']),
      };
    });
  }

  private async getRulesetEntry(entryId: string): Promise<PenaltyRulesetEntry> {
    const { data, error } = await this.supabase.service
      .from('penalty_ruleset_entries')
      .select('*')
      .eq('id', entryId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Penalty ruleset entry ${entryId} not found`);
    const row = data as Row;
    return {
      groupNumber: row['group_number'] as number,
      refNumber: row['ref_number'] as string,
      shortName: row['short_name'] as string,
      description: row['description'] as string,
      sanctions: row['sanctions'] as PenaltyCard[],
    };
  }

  private async getMatchContext(matchId: string): Promise<MatchContext> {
    const { data: matchData, error: matchError } = await this.supabase.service
      .from('matches')
      .select('id, red_registration_id, blue_registration_id, phase_id, locked_at')
      .eq('id', matchId)
      .maybeSingle();
    if (matchError) throw new BadRequestException(matchError.message);
    if (!matchData) throw new NotFoundException(`Match ${matchId} not found`);
    const match = matchData as Row;

    const { data: phaseData, error: phaseError } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .eq('id', match['phase_id'] as string)
      .maybeSingle();
    if (phaseError) throw new BadRequestException(phaseError.message);
    if (!phaseData) throw new NotFoundException(`Phase ${String(match['phase_id'])} not found`);
    const phase = phaseData as Row;

    const { data: tournamentData, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id, penalty_ruleset_id')
      .eq('id', phase['tournament_id'] as string)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournamentData)
      throw new NotFoundException(`Tournament ${String(phase['tournament_id'])} not found`);
    const tournament = tournamentData as Row;

    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('id, organization_id, penalty_ruleset_id')
      .eq('id', tournament['event_id'] as string)
      .maybeSingle();
    const event = (eventData ?? {}) as Row;

    return {
      id: match['id'] as string,
      lockedAt: (match['locked_at'] as string | null) ?? null,
      redRegistrationId: match['red_registration_id'] as string,
      blueRegistrationId: match['blue_registration_id'] as string,
      tournamentId: tournament['id'] as string,
      eventId: tournament['event_id'] as string,
      organizationId: event['organization_id'] as string,
      // The EFFECTIVE ruleset: tournament → event → the platform built-in. The
      // last step is not optional decoration — it is what almost every match
      // resolves through, because almost nobody pins a ruleset explicitly.
      //
      // Without it this field was null on those matches, and every consumer
      // read that as "there is no ruleset": `computeRulesetPenalty` refused the
      // card outright ("No penalty ruleset is attached…"), the per-card cost
      // columns were skipped in favour of a hardcoded delta, and the stored
      // `ruleset_id` lost the provenance of a card that plainly came from one.
      // Meanwhile the pad's picker DID fall back, so it offered 28 entries that
      // could not be recorded. Read and write now resolve the same way.
      penaltyRulesetId:
        (tournament['penalty_ruleset_id'] as string | null) ??
        (event['penalty_ruleset_id'] as string | null) ??
        (await this.loadBuiltInPenaltyRulesetId()),
    };
  }

  /** Id of the built-in default, without dragging its entries along. */
  private async loadBuiltInPenaltyRulesetId(): Promise<string | null> {
    const { data } = await this.builtInPenaltyRulesetQuery('id');
    return ((data as Row | null)?.['id'] as string | undefined) ?? null;
  }

  private assertMatchNotLocked(
    match: { lockedAt?: string | null },
    context?: { canOverrideLocked?: boolean },
  ) {
    if (match.lockedAt && !context?.canOverrideLocked) {
      throw new BadRequestException('Match is locked');
    }
  }

  private async getEventOrganizationId(eventId: string): Promise<string> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return (data as Row)['organization_id'] as string;
  }

  private async getTournamentOrganizationId(tournamentId: string): Promise<string> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    return this.getEventOrganizationId((data as Row)['event_id'] as string);
  }

  private async assertUserCanManageOrg(orgId: string, userId?: string): Promise<void> {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (await this.isPlatformStaffAdmin(userId)) return;
    if (this.orgs) await this.orgs.assertOrgRole(orgId, userId, 'admin');
  }

  /**
   * Platform admins and above. Gates acting ON BEHALF of an organisation —
   * moderation work, which is squarely the platform-admin domain.
   */
  private async isPlatformStaffAdmin(userId: string): Promise<boolean> {
    return hasPlatformTier(this.supabase, userId, 'platform_admin');
  }

  /**
   * `super_admin`-EXACT, and deliberately NOT the same predicate as
   * {@link isPlatformStaffAdmin}. Editing the built-in ruleset changes how
   * cards escalate and cost for every event on the platform, including ones
   * already running — that is not moderation, it is changing the rules of the
   * game, and it stays in the reserve.
   */
  private async isSuperAdmin(userId: string): Promise<boolean> {
    return hasPlatformTier(this.supabase, userId, 'super_admin');
  }

  private async assertUserCanScoreOrg(orgId: string, userId?: string): Promise<void> {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (this.orgs) await this.orgs.assertOrgRole(orgId, userId, 'scorekeeper');
  }

  private async createSecondBlackCardReviewIfNeeded(tournamentId: string, registrationId: string) {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('registration_id', registrationId)
      .eq('card', 'black')
      .eq('voided', false)
      .order('occurred_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const count = (data ?? []).length;
    if (count < 2) return;

    await this.supabase.service.from('tournament_penalty_reviews').upsert({
      tournament_id: tournamentId,
      registration_id: registrationId,
      review_type: 'second_black_card',
      status: 'pending',
      black_card_count: count,
      payload_json: { penaltyIds: (data ?? []).map((row) => (row as Row)['id']) },
      updated_at: new Date().toISOString(),
    });
  }

  private async replaceEntries(
    rulesetId: string,
    entries: CreatePenaltyRulesetDto['entries'],
  ): Promise<void> {
    // Validate refNumber shape at the API boundary. The DB column is plain
    // TEXT (migration 0071) so without this guard a caller could push
    // anything in. Keep the constraint loose enough for real rulebook
    // codes (R7a, B-12) but tight enough to prevent free-form text.
    const REF_RE = /^[\w-]{1,20}$/;
    for (const entry of entries) {
      const ref = String(entry.refNumber ?? '').trim();
      if (!REF_RE.test(ref)) {
        throw new BadRequestException(
          `Invalid penalty REF "${entry.refNumber}" — must be 1–20 chars, letters/digits/underscore/hyphen only.`,
        );
      }
    }
    const rows = entries.map((entry, index) => ({
      ruleset_id: rulesetId,
      group_number: entry.groupNumber,
      ref_number: String(entry.refNumber).trim(),
      short_name: entry.shortName,
      description: entry.description,
      sanctions: entry.sanctions,
      sort_order: index + 1,
    }));
    const { error } = await this.supabase.service.from('penalty_ruleset_entries').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Resolve where a black-card forfeit should land:
   * - 'match'      → end this match (current default behaviour).
   * - 'tournament' → end the match AND mark the registration as disqualified
   *                  for the rest of the tournament.
   * - 'none'       → record the card but don't end the match.
   *
   * Source-of-truth precedence:
   *   1. Tournament's scoring ruleset (TF v1 forfeitPolicy.black_card_{1,2}.
   *      tournamentState) — if it's a concrete value ('match_only',
   *      'withdrawn', 'disqualified'), it wins.
   *   2. Else fall back to penalty ruleset's first_/second_black_card_forfeit
   *      columns (defaults: 'match', 'tournament').
   *
   * `ordinal` is 1 for the registration's first non-voided black card in
   * the tournament, 2 for the second, etc.
   */
  private resolveBlackCardForfeitScope(
    penaltyRuleset: Row,
    scoringRulesetConfig: Record<string, unknown> | null,
    ordinal: number,
  ): BlackCardForfeitScope {
    const policyKey = ordinal >= 2 ? 'black_card_2' : 'black_card_1';
    const policy = (
      (scoringRulesetConfig?.['forfeitPolicy'] as Record<string, unknown> | undefined)?.[
        'reasons'
      ] as Record<string, { tournamentState?: string } | undefined> | undefined
    )?.[policyKey];
    const overrideState = policy?.tournamentState;
    if (overrideState === 'match_only') return 'match';
    if (overrideState === 'withdrawn' || overrideState === 'disqualified') return 'tournament';
    // 'ask' or undefined → penalty ruleset default wins.
    const column = ordinal >= 2 ? 'second_black_card_forfeit' : 'first_black_card_forfeit';
    const value = penaltyRuleset[column] as BlackCardForfeitScope | undefined;
    return value ?? (ordinal >= 2 ? 'tournament' : 'match');
  }

  // ── Versioning: publish / snapshot / validate ────────────────────────────

  /**
   * Publish the current definition as an immutable version: validate it, snapshot
   * the parent row + its entries into penalty_ruleset_versions, then patch-bump
   * the parent's version so subsequent edits target a fresh slot. Mirrors the
   * scoring custom-rulesets publish() gate. Built-in is always-published (a
   * super-admin edits it in place); org rows are gated to their owning org.
   */
  async publishRuleset(id: string, userId?: string, nextVersion?: string) {
    const existing = await this.loadRulesetForVersioning(id);
    if (existing.built_in) {
      throw new ForbiddenException('The built-in penalty ruleset is always published');
    }
    await this.assertUserCanManageOrg(existing.owner_organization_id ?? '', userId);
    await this.assertPenaltyRulesetValid(id);

    // The current version slot may already hold a DIFFERENT snapshot (freeze-at-pin
    // snapshots the current version WITHOUT bumping). Snapshotting the live
    // definition there would collide on UNIQUE(penalty_ruleset_id, version) and be
    // silently dropped — losing the definition being published. Move the live
    // definition to a free slot FIRST so it is captured under its own version.
    const publishedVersion = await this.nextFreePenaltyVersion(id, existing.version);
    if (publishedVersion !== existing.version) {
      await this.setPenaltyRulesetVersion(id, publishedVersion);
    }
    await this.snapshotPenaltyVersion(id, userId);

    const bumped = (nextVersion && nextVersion.trim()) || bumpPenaltyVersion(publishedVersion);
    await this.setPenaltyRulesetVersion(id, bumped);
    return this.getRuleset(id);
  }

  /**
   * Insert a snapshot row capturing the ruleset's current definition — the parent
   * columns plus its N entries serialised into one ordered JSONB array. Called
   * from publishRuleset() (which guarantees a free version slot first) and the
   * pin-time freeze. A unique (ruleset, version) hit means this exact version was
   * already snapshotted (the idempotent freeze path re-pins the same definition) —
   * harmless, skipped. publishRuleset never collides here because it bumps to a
   * free slot before calling this.
   */
  private async snapshotPenaltyVersion(id: string, userId?: string): Promise<void> {
    const ruleset = (await this.getRuleset(id)) as Row;
    const { error } = await this.supabase.service
      .from('penalty_ruleset_versions')
      .insert(buildPenaltyVersionRow(ruleset, userId));
    if (error && !/unique|duplicate/i.test(error.message)) {
      throw new BadRequestException(error.message);
    }
  }

  /** True if a snapshot already exists for this (ruleset, version). */
  private async penaltyVersionSnapshotExists(id: string, version: string): Promise<boolean> {
    const { count } = await this.supabase.service
      .from('penalty_ruleset_versions')
      .select('id', { count: 'exact', head: true })
      .eq('penalty_ruleset_id', id)
      .eq('version', version);
    return (count ?? 0) > 0;
  }

  /** Patch-bump `version` until it names a free (un-snapshotted) slot. */
  private async nextFreePenaltyVersion(id: string, version: string): Promise<string> {
    let candidate = version;
    let guard = 0;
    while (guard < 1000 && (await this.penaltyVersionSnapshotExists(id, candidate))) {
      candidate = bumpPenaltyVersion(candidate);
      guard += 1;
    }
    return candidate;
  }

  /** Set the parent ruleset's version string. */
  private async setPenaltyRulesetVersion(id: string, version: string): Promise<void> {
    const { error } = await this.supabase.service
      .from('penalty_rulesets')
      .update({ version, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }

  /** Throw a 400 listing every reason the ruleset can't be published. */
  private async assertPenaltyRulesetValid(id: string): Promise<void> {
    const errors = await this.collectPenaltyRulesetErrors(id);
    if (errors.length > 0) {
      throw new BadRequestException(`Invalid penalty ruleset: ${errors.join('; ')}`);
    }
  }

  /**
   * Collect (never throw) the reasons a penalty ruleset is not publishable: no
   * entries, a malformed/duplicate REF, a non-positive group, or an empty/invalid
   * sanctions ladder. The penalty analogue of scoring's dryRunRuleset gate.
   */
  private async collectPenaltyRulesetErrors(id: string): Promise<string[]> {
    const ruleset = (await this.getRuleset(id)) as Row;
    const entries = (ruleset['penalty_ruleset_entries'] as Row[] | undefined) ?? [];
    const errors: string[] = [];
    if (entries.length === 0) {
      errors.push('a penalty ruleset must have at least one entry');
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      const ref = String(entry['ref_number'] ?? '').trim();
      const label = ref || '(blank)';
      if (!/^[\w-]{1,20}$/.test(ref)) errors.push(`REF "${label}" is invalid`);
      if (seen.has(ref)) errors.push(`REF "${label}" is duplicated`);
      seen.add(ref);
      if (typeof entry['group_number'] !== 'number' || (entry['group_number'] as number) <= 0) {
        errors.push(`entry ${label}: group number must be a positive integer`);
      }
      const sanctions = entry['sanctions'];
      if (!Array.isArray(sanctions) || sanctions.length === 0) {
        errors.push(`entry ${label}: needs at least one sanction card`);
      } else if (
        !sanctions.every((card) => card === 'yellow' || card === 'red' || card === 'black')
      ) {
        errors.push(`entry ${label}: has an invalid sanction card`);
      }
    }
    return errors;
  }

  /** Tight read for the versioning flows: identity + owner + current version. */
  private async loadRulesetForVersioning(id: string): Promise<{
    id: string;
    built_in: boolean;
    owner_organization_id: string | null;
    version: string;
  }> {
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id, built_in, owner_organization_id, version')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Penalty ruleset ${id} not found`);
    return data as {
      id: string;
      built_in: boolean;
      owner_organization_id: string | null;
      version: string;
    };
  }

  /**
   * True if any tournament or event pins this penalty ruleset by id. Powers the
   * edit/delete immutability guards — the penalty analogue of scoring's
   * isCurrentVersionFrozen (which queries tournaments by (code, version); here
   * the pin is a UUID FK on tournaments/events.penalty_ruleset_id).
   */
  private async isPenaltyRulesetReferenced(id: string): Promise<boolean> {
    const { count: tournamentCount } = await this.supabase.service
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('penalty_ruleset_id', id);
    if ((tournamentCount ?? 0) > 0) return true;
    const { count: eventCount } = await this.supabase.service
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('penalty_ruleset_id', id);
    return (eventCount ?? 0) > 0;
  }

  /** The tournament's currently-pinned penalty ruleset id (null if none). */
  private async getTournamentPenaltyRulesetId(tournamentId: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('penalty_ruleset_id')
      .eq('id', tournamentId)
      .maybeSingle();
    return (data as { penalty_ruleset_id?: string | null } | null)?.penalty_ruleset_id ?? null;
  }

  /** True if any match under the tournament has left the 'scheduled' state. */
  private async tournamentHasStartedMatches(tournamentId: string): Promise<boolean> {
    const { data: phases } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId);
    const phaseIds = ((phases ?? []) as Array<{ id: string }>).map((phase) => phase.id);
    if (phaseIds.length === 0) return false;
    const { count } = await this.supabase.service
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .in('phase_id', phaseIds)
      .neq('status', 'scheduled');
    return (count ?? 0) > 0;
  }

  /** The event's currently-pinned default penalty ruleset id (null if none). */
  private async getEventPenaltyRulesetId(eventId: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('events')
      .select('penalty_ruleset_id')
      .eq('id', eventId)
      .maybeSingle();
    return (data as { penalty_ruleset_id?: string | null } | null)?.penalty_ruleset_id ?? null;
  }

  /**
   * True if any tournament under the event that INHERITS the event default (its
   * own penalty_ruleset_id is NULL) has a match past 'scheduled'. Those
   * tournaments resolve the event ruleset live, so an event-default swap would
   * change their in-force scoring mid-event.
   */
  private async eventHasInheritingStartedMatches(eventId: string): Promise<boolean> {
    const { data: tournaments } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId)
      .is('penalty_ruleset_id', null);
    const tournamentIds = ((tournaments ?? []) as Array<{ id: string }>).map((tour) => tour.id);
    if (tournamentIds.length === 0) return false;
    const { data: phases } = await this.supabase.service
      .from('phases')
      .select('id')
      .in('tournament_id', tournamentIds);
    const phaseIds = ((phases ?? []) as Array<{ id: string }>).map((phase) => phase.id);
    if (phaseIds.length === 0) return false;
    const { count } = await this.supabase.service
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .in('phase_id', phaseIds)
      .neq('status', 'scheduled');
    return (count ?? 0) > 0;
  }

  /** Published version history for a penalty ruleset, most recent first. */
  async listVersions(id: string, userId?: string): Promise<PenaltyRulesetVersionRow[]> {
    const existing = await this.loadRulesetForVersioning(id);
    await this.assertCanManagePenaltyRuleset(existing, userId);
    const { data, error } = await this.supabase.service
      .from('penalty_ruleset_versions')
      .select('*')
      .eq('penalty_ruleset_id', id)
      .order('published_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as PenaltyRulesetVersionRow[];
  }

  /**
   * Restore a prior snapshot onto the parent row — its definition columns plus
   * a delete+reinsert of its entries. The parent's `version` is left unchanged;
   * the operator assigns the next version at the next publish (mirrors scoring's
   * rollback). Built-in cannot be rolled back, and a pinned ruleset is frozen —
   * rolling it back would change the definition under a running tournament.
   */
  async rollbackRuleset(id: string, versionId: string, userId?: string) {
    const existing = await this.loadRulesetForVersioning(id);
    if (existing.built_in) {
      throw new ForbiddenException('The built-in penalty ruleset cannot be rolled back');
    }
    await this.assertUserCanManageOrg(existing.owner_organization_id ?? '', userId);
    if (await this.isPenaltyRulesetReferenced(id)) {
      throw new ConflictException(
        'This penalty ruleset is in use by a tournament or event and cannot be rolled back. Duplicate it instead.',
      );
    }

    const snapshot = await this.loadPenaltyVersion(id, versionId);
    const { error: updErr } = await this.supabase.service
      .from('penalty_rulesets')
      .update({
        name: snapshot.name,
        description: snapshot.description,
        accumulation_scope: snapshot.accumulation_scope,
        yellow_card_points: snapshot.yellow_card_points,
        red_card_points: snapshot.red_card_points,
        black_card_points: snapshot.black_card_points,
        first_black_card_forfeit: snapshot.first_black_card_forfeit,
        second_black_card_forfeit: snapshot.second_black_card_forfeit,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (updErr) throw new BadRequestException(updErr.message);

    // Replace entries from the snapshot (delete + reinsert, as updateRuleset does).
    const { error: delErr } = await this.supabase.service
      .from('penalty_ruleset_entries')
      .delete()
      .eq('ruleset_id', id);
    if (delErr) throw new BadRequestException(delErr.message);
    if (snapshot.entries.length > 0) {
      await this.replaceEntries(
        id,
        snapshot.entries.map((entry) => ({
          groupNumber: entry.groupNumber,
          refNumber: entry.refNumber,
          shortName: entry.shortName,
          description: entry.description,
          sanctions: entry.sanctions,
        })),
      );
    }

    return this.getRuleset(id);
  }

  /** Load one snapshot row, scoped to its parent ruleset. */
  private async loadPenaltyVersion(
    id: string,
    versionId: string,
  ): Promise<PenaltyRulesetVersionRow> {
    const { data, error } = await this.supabase.service
      .from('penalty_ruleset_versions')
      .select('*')
      .eq('id', versionId)
      .eq('penalty_ruleset_id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) {
      throw new NotFoundException(
        `Penalty ruleset version ${versionId} not found for ruleset ${id}`,
      );
    }
    return data as PenaltyRulesetVersionRow;
  }

  /** Built-in → super-admin only; custom → org-admin of the owning org. */
  private async assertCanManagePenaltyRuleset(
    existing: { built_in: boolean; owner_organization_id: string | null },
    userId?: string,
  ): Promise<void> {
    if (existing.built_in) {
      if (!userId) throw new UnauthorizedException('Authentication required');
      if (!(await this.isSuperAdmin(userId))) {
        throw new ForbiddenException('Only super-admin can manage the built-in penalty ruleset');
      }
      return;
    }
    await this.assertUserCanManageOrg(existing.owner_organization_id ?? '', userId);
  }
}

export interface PenaltyRulesetVersionRow {
  id: string;
  penalty_ruleset_id: string;
  version: string;
  name: string;
  description: string | null;
  accumulation_scope: string;
  yellow_card_points: number;
  red_card_points: number;
  black_card_points: number;
  first_black_card_forfeit: string;
  second_black_card_forfeit: string;
  entries: PenaltyVersionEntry[];
  published_at: string;
  published_by_user_id: string | null;
  is_frozen: boolean;
}

/**
 * Patch-bump a semver-ish version string ('1.0.0' -> '1.0.1', '2' -> '2.1').
 * Mirrors bumpPatchVersion in custom-rulesets.service.ts — penalties keep their
 * own copy so the two ruleset subsystems can diverge on versioning policy.
 */
export function bumpPenaltyVersion(version: string): string {
  const trimmed = (version ?? '').trim();
  if (!trimmed) return '1.0.1';
  const parts = trimmed.split('.');
  const tail = parts[parts.length - 1] ?? '';
  if (/^\d+$/.test(tail)) {
    parts[parts.length - 1] = String(Number.parseInt(tail, 10) + 1);
    return parts.join('.');
  }
  return `${trimmed}.1`;
}

interface MatchContext {
  id: string;
  lockedAt: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentId: string;
  eventId: string;
  organizationId: string;
  penaltyRulesetId: string | null;
}
