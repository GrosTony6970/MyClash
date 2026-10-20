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
  type BlackCardEffect,
  type BucketStatus,
  type ExistingPenaltyForSanction,
  type PenaltyCard,
  type PenaltyRulesetEntry,
} from '@myclash/rulesets';
import type { ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { RULES_CHANGE_CODES } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveOrganizationNames } from '../../common/organization-names';
import { assertPlatformTier, hasPlatformTier } from '../../common/auth/platform-role';
import {
  buildRulesetExport,
  penaltyRulesetExportDefinitionSchema,
  type RulesetExportEnvelope,
} from '../../common/ruleset-export';
import { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import { restampUnstartedMatches } from '../phases/match-ruleset';
import { ScoringService } from '../matches/scoring.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { assertBoutTakes } from '../matches/bout-not-started';
import { BOUT_CARD_PIN, cardPinOf } from '../matches/bout-rules';
import { scoredAtServer } from '../matches/late-press';
import { scoringAwaitsRoundAdvance } from '../matches/round-awaits-advance';
import { MatchForfeitsService } from '../matches/match-forfeits.service';
import { matchLocked } from '../matches/match-locked';
import { tournamentClockOf } from '../events/tournament-clock';
import { OrganizationsService } from '../organizations/organizations.service';
import { dropSpentBlackCardReview, takeBackBlackCardForfeit } from './black-card-undo';
import {
  blackCardEffectOf,
  builtInPenaltyRulesetQuery,
  loadBuiltInPenaltyRulesetId,
  loadPenaltyRulesetRow,
  tournamentCardRulesetId,
} from './card-rules-pin';
import { cardAndForfeitRules } from './forfeit-rules-in-force';
import {
  answeredPayload,
  reviewChanged,
  syncSecondBlackCardReview,
} from './second-black-card-review';
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
  loadPinnablePenaltyRulesetVersion,
  penaltyRowOfVersion,
  type PenaltyVersionEntry,
} from './penalty-version.util';

type Row = Record<string, unknown>;

/** Who sends a card or its void, as "who may score" answered (`ScoringActor`). */
interface PenaltyActor {
  userId?: string;
  staffAccountId?: string;
  canOverrideLocked?: boolean;
  /** A super admin on an over Event: the club's role is not asked again (ruling 251). */
  correctsOverEvent?: boolean;
}

/** What says how far a black card reaches (ruling 54): the Tournament's rules in force of now. */
interface BlackCardReach {
  /**
   * Its rules in force, the Tournament's changes laid over its ruleset's (ruling 65): what each
   * black card does, what its forfeit then scores (ruling 69) and how it escalates.
   */
  forfeitRules: ForfeitRulesInForce;
}

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
  'first_black_card_forfeit, second_black_card_forfeit, forfeit_rules, ' +
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

  /**
   * Every penalty ruleset on the platform, private ones included — for the
   * platform catalogue only (operator ruling 62), so any platform tier, as every
   * other platform read (ruling 65). An organiser lists through
   * {@link listRulesetsForOrg}.
   */
  async listRulesets(userId: string) {
    await assertPlatformTier(
      this.supabase,
      userId,
      'platform_viewer',
      'Platform staff access required',
    );
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
   * One ruleset, for a caller (operator ruling 61, the RLS
   * `penalty_rulesets_select` rule): the built-in and shared ones for anyone
   * signed in, a private one for an admin of its organisation or a platform
   * admin. `getRuleset` itself stays unchecked for the service's own callers.
   */
  async getRulesetFor(rulesetId: string, userId: string): Promise<Row> {
    const ruleset = (await this.getRuleset(rulesetId)) as Row;
    if (!ruleset['built_in'] && !ruleset['public_visibility']) {
      await this.assertUserCanManageOrg(
        (ruleset['owner_organization_id'] as string | null) ?? '',
        userId,
      );
    }
    return ruleset;
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
  async describeRulesetLineage(rulesetId: string, userId: string): Promise<PenaltyLineage | null> {
    const ruleset = await this.getRulesetFor(rulesetId, userId);
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
    const { data, error } = await builtInPenaltyRulesetQuery(
      this.supabase.service,
      '*, penalty_ruleset_entries(*)',
    );
    if (error) throw new BadRequestException(error.message);
    return (data as Row | null) ?? null;
  }

  /**
   * Effective penalty ruleset for a tournament, resolving tournament →
   * event default → built-in (mirrors {@link getEffectiveRulesetForMatch}
   * minus the match-level override). Powers the admin "quick-pick penalties"
   * picker so organizers can pin common entries to the scoreboard.
   */
  async getEffectiveRulesetForTournament(tournamentId: string) {
    const id = await tournamentCardRulesetId(this.supabase.service, tournamentId);
    return id ? this.getRuleset(id) : null;
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
    // Card costs, forfeit scopes and forfeit rules: only forward when the caller
    // provided them so the column defaults (yellow=0, red=-1, black=0; first=match,
    // second=tournament; a new club ruleset's forfeit rules) apply for callers
    // that don't care.
    if (dto.yellowCardPoints !== undefined) insertRow['yellow_card_points'] = dto.yellowCardPoints;
    if (dto.redCardPoints !== undefined) insertRow['red_card_points'] = dto.redCardPoints;
    if (dto.blackCardPoints !== undefined) insertRow['black_card_points'] = dto.blackCardPoints;
    if (dto.firstBlackCardForfeit !== undefined)
      insertRow['first_black_card_forfeit'] = dto.firstBlackCardForfeit;
    if (dto.secondBlackCardForfeit !== undefined)
      insertRow['second_black_card_forfeit'] = dto.secondBlackCardForfeit;
    if (dto.forfeitRules !== undefined) insertRow['forfeit_rules'] = dto.forfeitRules;

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
      forfeitRules: row['forfeit_rules'],
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
        forfeitRules: def.forfeitRules,
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
        'This penalty ruleset is in use by a tournament, an event or a bout and cannot be edited. Duplicate it to make changes, then re-pin.',
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
    if (dto.forfeitRules !== undefined) updates['forfeit_rules'] = dto.forfeitRules;

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
    const orgId = await this.getEventOrganizationId(eventId);
    await this.assertUserCanManageOrg(orgId, userId);
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
    const nextVersion = nextId
      ? await loadPinnablePenaltyRulesetVersion(this.supabase, nextId, orgId)
      : null;
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
    // content hash restamped (each stamp best-effort; @Optional in unit tests).
    // A failed read of the list throws after the write: a resend heals it (the
    // pin is then unchanged, so the guard lets it through to the stamp). Their
    // bouts not yet started follow, as after a Tournament's own pin: without
    // it a bout kept the hash of the default the Event no longer has.
    const inheriting = (await this.rulesetHash?.stampEventInheritingTournaments(eventId)) ?? [];
    for (const tournamentId of inheriting) {
      await restampUnstartedMatches(this.supabase.service, tournamentId);
    }
    return data;
  }

  async assignTournamentRuleset(
    tournamentId: string,
    dto: AssignPenaltyRulesetDto,
    userId?: string,
  ) {
    const orgId = await this.getTournamentOrganizationId(tournamentId);
    await this.assertUserCanManageOrg(orgId, userId);
    const nextId = dto.penaltyRulesetId ?? null;
    const currentId = await this.getTournamentPenaltyRulesetId(tournamentId);
    // Re-pin guard: once matches are scored, the penalty ruleset is locked to
    // ordinary edits — swapping it mid-event would apply a different sanction
    // ladder/cost to later cards than the ones already recorded. The one clock
    // of a Tournament's rules (`tournamentClockOf`), as the settings save asks it.
    if (nextId !== currentId && (await this.tournamentHasStartedMatches(tournamentId))) {
      throw new ForbiddenException({
        code: RULES_CHANGE_CODES.cardLocked,
        message:
          'This tournament has scored matches, so its penalty ruleset is locked. Change it before scoring starts.',
      });
    }
    const nextVersion = nextId
      ? await loadPinnablePenaltyRulesetVersion(this.supabase, nextId, orgId)
      : null;
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
    // The penalty pin changed — restamp the tournament's content hash (best
    // effort), then the bouts not yet started, so their stamp tracks the new
    // penalty. The comment here said the match stamps followed; nothing did it.
    await this.rulesetHash?.stampTournamentContentHash(tournamentId);
    await restampUnstartedMatches(this.supabase.service, tournamentId);
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

  async createPenalty(matchId: string, dto: CreatePenaltyDto, context?: PenaltyActor) {
    const match = await this.getMatchContext(matchId);
    if (!context?.staffAccountId && !context?.correctsOverEvent) {
      await this.assertUserCanScoreOrg(match.organizationId, context?.userId);
    }
    if (!dto.rulesetEntryId && !dto.directCard) {
      throw new BadRequestException('Either rulesetEntryId or directCard is required');
    }
    if (dto.directCard && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required for direct card penalties');
    }

    const existing = await this.savedCardOf(matchId, dto.clientUuid);
    if (existing) return this.replayAnswer(existing);
    // Every refusal AFTER the replay answer, in a hit's order: a card the server holds is not
    // a result change, and the pad reads a refusal as "never taken" and holds the card.
    await this.frozenResults?.assertExchangeCreationAllowed(matchId, context?.userId);
    this.assertMatchNotLocked(match, context);
    await assertBoutTakes(this.supabase.service, match, dto);

    // Refused between rounds, exactly as `createExchange` refuses an exchange.
    // A card is stamped with the open round; while a round is closed and waiting
    // to be advanced, `current_round` names a round whose RESULT is already
    // banked in `rounds_json` — so the card could move that round's score and
    // never who won it (ruling 247), where the referee meant it to count. The
    // probe above still answers a card the server holds after the round closed.
    if (match.awaitingRoundAdvance) throw scoringAwaitsRoundAdvance();

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
      ? await loadPenaltyRulesetRow(this.supabase.service, match.penaltyRulesetId)
      : null;
    const scoreDelta = activePenaltyRuleset
      ? this.cardScoreDelta(activePenaltyRuleset, sanction.card)
      : sanction.scoreDelta;
    const reach = sanction.causesMatchForfeit ? await this.blackCardReach(match) : null;

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
      // Stamped from the match, never sent by the client — the same rule
      // `createExchange` follows: the round open on the server when the card
      // ARRIVES. A pad with no network can move past a round ("Start round N"
      // is a row of its queue). Its queue sends a bout's rows in the order
      // they were tapped, so a card of round 1 arrives before the "Start round
      // 2" behind it, and still lands in the round it was recorded in.
      round_number: match.currentRound,
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
        const raceExisting = await this.savedCardOf(matchId, dto.clientUuid);
        if (raceExisting) return this.replayAnswer(raceExisting);
      }
      throw new BadRequestException(error.message);
    }

    // A card of a tablet's queue says its age. If it decides the bout, by its
    // points or by its forfeit, the clock is stopped at the time of the card.
    const causedAt = scoredAtServer(dto);
    await this.scoring?.recomputeMatchScore(matchId, causedAt);

    // `reach` is read exactly when the card forfeits.
    if (reach) {
      const { blackCount, scope } = await this.blackCardScope(match, dto.registrationId, reach);

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
            causedAt,
            { rules: reach.forfeitRules, cardEffect: scope },
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

      // A card that reaches the Tournament disqualifies at once. A 2nd card that does opens no
      // "second black card" review: there is nothing left to ask (ruling 86).
      if (scope === 'tournament') await this.disqualify(dto.registrationId);
      await this.syncReviewUnlessDisqualifying(
        match.tournamentId,
        dto.registrationId,
        String((data as Row)['id']),
        reach,
      );
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

  private async countBlackCardsForRegistration(
    tournamentId: string,
    registrationId: string,
  ): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('match_penalties')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .eq('registration_id', registrationId)
      .eq('card', 'black')
      .eq('voided', false);
    // Read as none, a second black card counted as a first.
    if (error) {
      throw new Error(`The black cards of ${registrationId} were not counted: ${error.message}`);
    }
    return count ?? 0;
  }

  async voidPenalty(penaltyId: string, dto: VoidPenaltyDto, context?: PenaltyActor) {
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
    if (!context?.staffAccountId && !context?.correctsOverEvent) {
      await this.assertUserCanScoreOrg(match.organizationId, context?.userId);
    }
    if (row['voided']) throw new BadRequestException('Penalty is already voided');
    // Ruling 231: a card's void asks no review, so on an over Event it is a
    // super admin's, as a new card already is there.
    await this.frozenResults?.assertResultMutationAllowed(match.id, context?.userId);
    // BEFORE the write: a refusal must leave nothing behind (ruling 226).
    await this.scoring?.assertCorrectionLands(match.id, { dropPenaltyIds: [penaltyId] });
    // Ruling 319: a black card's forfeit goes first, or the card stays.
    const { forfeits, frozenResults } = this;
    if (forfeits) {
      const deps = { db: this.supabase.service, forfeits, frozenResults };
      await takeBackBlackCardForfeit(deps, row, context ?? {});
    }

    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .update({ voided: true, voided_reason: dto.reason ?? null })
      .eq('id', penaltyId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.scoring?.recomputeMatchScore(row['match_id'] as string);
    await dropSpentBlackCardReview(this.supabase.service, row);
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

    // The answer is to the review the organiser saw. A black card that landed since changed it
    // (its count, or a dismissal it reopened), and so does one landing between this read and
    // this write: either way she is told, and her page reads it again.
    if (review['updated_at'] !== dto.seenUpdatedAt) throw reviewChanged();
    const { data, error } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .update({
        status: dto.status,
        reviewed_by_user_id: userId ?? null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        payload_json: answeredPayload(review['payload_json']),
      })
      .eq('id', reviewId)
      .eq('updated_at', review['updated_at'] as string)
      .select('*')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw reviewChanged();

    // After the answer is written: a refused answer disqualifies nobody. A confirmed answer
    // stands only with its disqualification: if that write fails, the review is put back as the
    // organiser saw it, so she is told and can answer again.
    if (dto.status === 'confirmed') {
      await this.disqualifyOrPutBack(review, (data as Row)['updated_at'] as string);
    }
    return data;
  }

  /** The disqualification a confirmed review stands on; on a failure, the review goes back. */
  private async disqualifyOrPutBack(review: Row, answeredAt: string): Promise<void> {
    try {
      await this.disqualify(review['registration_id'] as string);
    } catch (failure) {
      if (await this.putReviewBack(review, answeredAt)) throw failure;
      // A black card landed between the answer and the put-back (it keeps a confirmed review
      // confirmed), or the put-back failed: the review stays answered, with nobody out.
      throw new Error(
        `Review ${String(review['id'])} left confirmed, registration not disqualified: ${String(failure)}`,
        { cause: failure },
      );
    }
  }

  /**
   * A review as it was read, written back over the answer that was written at `answeredAt`.
   * True when it was. The organiser's page then reads it again before she answers again.
   */
  private async putReviewBack(review: Row, answeredAt: string): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .update({
        status: review['status'],
        reviewed_by_user_id: review['reviewed_by_user_id'] ?? null,
        reviewed_at: review['reviewed_at'] ?? null,
        updated_at: new Date().toISOString(),
        payload_json: review['payload_json'],
      })
      .eq('id', review['id'] as string)
      .eq('updated_at', answeredAt)
      .select('id')
      .maybeSingle();
    return !error && data !== null;
  }

  /**
   * How far a black card reaches: the bout, the whole Tournament, or nothing. The ordinal counts
   * this Registration's non-voided black cards in the Tournament, the card just written included.
   *
   * The Tournament's card rules of now decide, its 1st or its 2nd black card setting (rulings A and
   * G, 2026-10-17, and 54): the bout's copy prices the card, and how far a forfeit reaches is the
   * Tournament's, so the scope and the forfeit record it creates answer alike.
   */
  private async blackCardScope(
    match: MatchContext,
    registrationId: string,
    reach: BlackCardReach,
  ): Promise<{ blackCount: number; scope: BlackCardEffect }> {
    const blackCount = await this.countBlackCardsForRegistration(
      match.tournamentId,
      registrationId,
    );
    const reason = blackCount >= 2 ? 'black_card_2' : 'black_card_1';
    return { blackCount, scope: blackCardEffectOf(reach.forfeitRules, reason) };
  }

  /**
   * What decides how far a black card reaches, but its count: the Tournament's card rules of now,
   * and the forfeit rules they hold. Read before the card is written: a read that fails, or rules
   * that do not parse, then leave no card saved with no forfeit, which the tablet's resend would
   * not repair (it sends the card again on a server error).
   */
  private async blackCardReach(match: MatchContext): Promise<BlackCardReach> {
    return cardAndForfeitRules(this.supabase.service, match.tournamentId);
  }

  /**
   * The "second black card" review asks "two black cards: disqualify?". A 2nd card whose rule
   * already disqualifies leaves nothing to ask, so it opens none, and a review already pending
   * stays as it is (ruling 86). Both callers pass here: the first send and the answer to a card
   * sent again, which the tablet's resend and the insert race both reach.
   */
  private async syncReviewUnlessDisqualifying(
    tournamentId: string,
    registrationId: string,
    cardId: string,
    reach: BlackCardReach,
  ): Promise<void> {
    if (blackCardEffectOf(reach.forfeitRules, 'black_card_2') === 'tournament') return;
    await syncSecondBlackCardReview(this.supabase.service, tournamentId, registrationId, cardId);
  }

  /** Mark a Registration disqualified. A failed write is thrown, as a server error. */
  private async disqualify(registrationId: string): Promise<void> {
    const { error } = await this.supabase.service
      .from('registrations')
      .update({ status: 'disqualified' })
      .eq('id', registrationId);
    if (error) throw new Error(`Registration ${registrationId} not disqualified: ${error.message}`);
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
      .select(
        'id, status, red_registration_id, blue_registration_id, phase_id, locked_at, current_round, awaiting_round_advance, ' +
          BOUT_CARD_PIN,
      )
      .eq('id', matchId)
      .maybeSingle();
    if (matchError) throw new BadRequestException(matchError.message);
    if (!matchData) throw new NotFoundException(`Match ${matchId} not found`);
    const match = matchData as unknown as Row;

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
      .select('id, event_id')
      .eq('id', phase['tournament_id'] as string)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournamentData)
      throw new NotFoundException(`Tournament ${String(phase['tournament_id'])} not found`);
    const tournament = tournamentData as Row;

    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
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
      // The EFFECTIVE ruleset of the bout: the one its copy of its rules pins
      // (resolved tournament → event → built-in when the copy was made; a bout
      // keeps the card rules it started under), else the platform built-in. The
      // last step is not optional decoration — it is what almost every match
      // resolves through, because almost nobody pins a ruleset explicitly.
      // Without it this field was null on those matches, and every consumer
      // read that as "there is no ruleset": `computeRulesetPenalty` refused the
      // card outright ("No penalty ruleset is attached…"), the per-card cost
      // columns were skipped in favour of a hardcoded delta, and the stored
      // `ruleset_id` lost the provenance of a card that plainly came from one.
      // Meanwhile the pad's picker DID fall back, so it offered 28 entries that
      // could not be recorded. Read and write now resolve the same way.
      penaltyRulesetId:
        cardPinOf(match) ?? (await loadBuiltInPenaltyRulesetId(this.supabase.service)),
      status: (match['status'] as string | null) ?? null,
      currentRound: (match['current_round'] as number | null) ?? 1,
      awaitingRoundAdvance: (match['awaiting_round_advance'] as boolean | null) ?? false,
    };
  }

  private assertMatchNotLocked(
    match: { lockedAt?: string | null },
    context?: { canOverrideLocked?: boolean },
  ) {
    if (match.lockedAt && !context?.canOverrideLocked) {
      throw matchLocked();
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

  /**
   * The saved card this id names, or null. A `client_uuid` is unique across every bout, so the
   * row may be another bout's: that is no replay of this bout's card, and it is refused, as a
   * hit is (`MatchesService.savedHitOf`). Answered "saved", it handed back the other bout's card
   * and repeated its disqualification.
   *
   * A failed read is an error, never "not saved": read as "not saved", a card the server holds
   * met the refusals after it (an Event over), and the pad filed a saved card as refused.
   */
  private async savedCardOf(matchId: string, clientUuid: string): Promise<Row | null> {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('client_uuid', clientUuid)
      .maybeSingle();
    if (error) throw new Error(`Could not read a saved card: ${error.message}`);
    const stored = data as Row | null;
    if (stored && stored['match_id'] !== matchId) {
      throw new BadRequestException('This id is the id of another card');
    }
    return stored;
  }

  /**
   * A card the server already holds is answered as it is. If it is a live black card, its
   * review is brought up to date first: the first send may have written the card and then
   * failed on the review, and the tablet's retry is the only send left to repair it. So is the
   * disqualification of a black card that reaches the whole Tournament: the first send wrote the
   * card, then failed there with a 500, and the tablet sends it again by itself. The write is
   * safe to repeat.
   */
  private async replayAnswer(stored: Row): Promise<Row> {
    if (stored['card'] === 'black' && stored['voided'] !== true) {
      const registrationId = String(stored['registration_id']);
      const match = await this.getMatchContext(String(stored['match_id']));
      const reach = await this.blackCardReach(match);
      if (stored['causes_match_forfeit'] === true) {
        const { scope } = await this.blackCardScope(match, registrationId, reach);
        if (scope === 'tournament') await this.disqualify(registrationId);
      }
      await this.syncReviewUnlessDisqualifying(
        String(stored['tournament_id']),
        registrationId,
        String(stored['id']),
        reach,
      );
    }
    return stored;
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
   * True if any tournament or event pins this penalty ruleset by id, or a bout holds a copy of
   * its rules that pins it (migration 0230: a card is priced from the live row, and a bout keeps
   * the card rules it started under). Powers the edit/delete immutability guards — the penalty
   * analogue of scoring's isCurrentVersionFrozen (which counts the tournaments pinning a (code,
   * version) and asks whether a bout holds a copy naming it, migration 0232; here the pin is a
   * UUID FK on tournaments/events.penalty_ruleset_id). A count that fails is
   * an error: read as none, it unlocked the edit of a ruleset in use.
   */
  private async isPenaltyRulesetReferenced(id: string): Promise<boolean> {
    for (const table of ['tournaments', 'events'] as const) {
      const { count, error } = await this.supabase.service
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('penalty_ruleset_id', id);
      if (error) {
        throw new Error(`The ${table} pinning ruleset ${id} were not counted: ${error.message}`);
      }
      if ((count ?? 0) > 0) return true;
    }
    const { data: held, error } = await this.supabase.service.rpc('card_ruleset_held_by_a_bout', {
      p_ruleset_id: id,
    });
    if (error)
      throw new Error(`The bouts holding ruleset ${id} were not counted: ${error.message}`);
    return held === true;
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

  /** True if a bout of the tournament has started: its rules' one clock (`tournamentClockOf`). */
  private async tournamentHasStartedMatches(tournamentId: string): Promise<boolean> {
    return (await tournamentClockOf(this.supabase.service, tournamentId)).locked;
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
   * own penalty_ruleset_id is NULL) has a bout started (`tournamentClockOf`). Those
   * tournaments resolve the event ruleset live, so an event-default swap would
   * change their in-force scoring mid-event.
   */
  private async eventHasInheritingStartedMatches(eventId: string): Promise<boolean> {
    const { data: tournaments, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId)
      .is('penalty_ruleset_id', null);
    // A failed read is not "no Tournament inherits it": read as none, the default changed mid-event.
    if (error)
      throw new Error(`The Tournaments of Event ${eventId} were not read: ${error.message}`);
    for (const { id } of (tournaments ?? []) as Array<{ id: string }>) {
      if ((await tournamentClockOf(this.supabase.service, id)).locked) return true;
    }
    return false;
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
        'This penalty ruleset is in use by a tournament, an event or a bout and cannot be rolled back. Duplicate it instead.',
      );
    }

    const snapshot = await this.loadPenaltyVersion(id, versionId);
    const { error: updErr } = await this.supabase.service
      .from('penalty_rulesets')
      .update({ ...penaltyRowOfVersion(snapshot), updated_at: new Date().toISOString() })
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
  forfeit_rules: unknown;
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
  /** Null on a row read with no status: `assertBoutTakes` judges `scheduled` only. */
  status: string | null;
  lockedAt: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentId: string;
  eventId: string;
  organizationId: string;
  penaltyRulesetId: string | null;
  /** The round open for scoring — what a new card is stamped with. */
  currentRound: number;
  /** A round auto-ended and the operator has not advanced yet. */
  awaitingRoundAdvance: boolean;
}
