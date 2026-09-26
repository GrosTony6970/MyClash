/**
 * settings.service.ts — T-902
 *
 * CRUD for pool_assignment_settings: one row per Event (`tournament_id` NULL), created with the
 * defaults on first read. The referee rules are set in one place, the Event's panel (ruling 142):
 * no per-Tournament row is ever written. The Impossible rules of ADR-016 have no setting at all.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface PoolAssignmentSettings {
  id: string;
  eventId: string;
  tournamentId: string | null;
  enforceSchoolSeparation: boolean;
  schoolSeparationStrictness: 'hard' | 'soft';
  enforceSkillBalance: boolean;
  /** ADR-019 rest: the switch, and how many day slots apart two duties must be (0–5). */
  enforceRefereeNoBackToBack: boolean;
  refereeRestMinSlots: number;
  /** ADR-019 cap: most bouts a person referees in one Event day; 0 = no cap. */
  maxBoutsPerDay: number;
  workshopConflictWarning: boolean;
  ratingBasedOrdering: boolean;
  workloadBalance: boolean;
  /** The Discouraged rules' switches (ADR-016) — all default true. */
  enableOwnPoolRule: boolean;
  /** Refereeing while a Pool one fights in is running, outside one's own bouts (ruling 5). */
  enableOwnPoolSpanRule: boolean;
  enableTwoRolesRule: boolean;
  /** The slate warning "not enough referees at this time" — never a verdict on a person. */
  enableCapacityRule: boolean;
}

const DEFAULTS: Omit<PoolAssignmentSettings, 'id' | 'eventId' | 'tournamentId'> = {
  enforceSchoolSeparation: true,
  schoolSeparationStrictness: 'soft',
  enforceSkillBalance: true,
  enforceRefereeNoBackToBack: true,
  refereeRestMinSlots: 1,
  maxBoutsPerDay: 0,
  workshopConflictWarning: true,
  ratingBasedOrdering: true,
  workloadBalance: true,
  enableOwnPoolRule: true,
  enableOwnPoolSpanRule: true,
  enableTwoRolesRule: true,
  enableCapacityRule: true,
};

@Injectable()
export class SettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── Get settings (the Event's row) ────────────────────────────────────────────

  async getSettings(eventId: string): Promise<PoolAssignmentSettings> {
    const { data: eventSettings } = await this.supabase.service
      .from('pool_assignment_settings')
      .select('*')
      .eq('event_id', eventId)
      .is('tournament_id', null)
      .maybeSingle();

    if (eventSettings) return this.map(eventSettings as Record<string, unknown>);

    // Auto-create defaults
    return this.createDefaults(eventId);
  }

  // ── Create or update settings ─────────────────────────────────────────────────

  async upsertSettings(
    eventId: string,
    patch: Partial<Omit<PoolAssignmentSettings, 'id' | 'eventId' | 'tournamentId'>>,
  ): Promise<PoolAssignmentSettings> {
    const existing = await this.getSettings(eventId);

    const updates: Record<string, unknown> = {};
    if (patch.enforceSchoolSeparation !== undefined)
      updates['enforce_school_separation'] = patch.enforceSchoolSeparation;
    if (patch.schoolSeparationStrictness !== undefined)
      updates['school_separation_strictness'] = patch.schoolSeparationStrictness;
    if (patch.enforceSkillBalance !== undefined)
      updates['enforce_skill_balance'] = patch.enforceSkillBalance;
    if (patch.enforceRefereeNoBackToBack !== undefined)
      updates['enforce_referee_no_back_to_back'] = patch.enforceRefereeNoBackToBack;
    if (patch.refereeRestMinSlots !== undefined)
      updates['referee_rest_min_slots'] = patch.refereeRestMinSlots;
    if (patch.maxBoutsPerDay !== undefined) updates['max_bouts_per_day'] = patch.maxBoutsPerDay;
    if (patch.workshopConflictWarning !== undefined)
      updates['workshop_conflict_warning'] = patch.workshopConflictWarning;
    if (patch.ratingBasedOrdering !== undefined)
      updates['rating_based_ordering'] = patch.ratingBasedOrdering;
    if (patch.workloadBalance !== undefined) updates['workload_balance'] = patch.workloadBalance;
    if (patch.enableOwnPoolRule !== undefined)
      updates['enable_own_pool_rule'] = patch.enableOwnPoolRule;
    if (patch.enableOwnPoolSpanRule !== undefined)
      updates['enable_own_pool_span_rule'] = patch.enableOwnPoolSpanRule;
    if (patch.enableTwoRolesRule !== undefined)
      updates['enable_two_roles_rule'] = patch.enableTwoRolesRule;
    if (patch.enableCapacityRule !== undefined)
      updates['enable_capacity_rule'] = patch.enableCapacityRule;
    // Nothing to write: an UPDATE with no column returns no row, and `.single()` would 400.
    if (Object.keys(updates).length === 0) return existing;

    const { data, error } = await this.supabase.service
      .from('pool_assignment_settings')
      .update(updates)
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.map(data as Record<string, unknown>);
  }

  // ── Create defaults (called on event creation) ────────────────────────────────

  async createDefaults(eventId: string): Promise<PoolAssignmentSettings> {
    const { data, error } = await this.supabase.service
      .from('pool_assignment_settings')
      .insert({
        event_id: eventId,
        tournament_id: null,
        enforce_school_separation: DEFAULTS.enforceSchoolSeparation,
        school_separation_strictness: DEFAULTS.schoolSeparationStrictness,
        enforce_skill_balance: DEFAULTS.enforceSkillBalance,
        enforce_referee_no_back_to_back: DEFAULTS.enforceRefereeNoBackToBack,
        referee_rest_min_slots: DEFAULTS.refereeRestMinSlots,
        max_bouts_per_day: DEFAULTS.maxBoutsPerDay,
        workshop_conflict_warning: DEFAULTS.workshopConflictWarning,
        rating_based_ordering: DEFAULTS.ratingBasedOrdering,
        workload_balance: DEFAULTS.workloadBalance,
        enable_own_pool_rule: DEFAULTS.enableOwnPoolRule,
        enable_own_pool_span_rule: DEFAULTS.enableOwnPoolSpanRule,
        enable_two_roles_rule: DEFAULTS.enableTwoRolesRule,
        enable_capacity_rule: DEFAULTS.enableCapacityRule,
      })
      .select('*')
      .single();

    if (error) {
      // May already exist (race condition) — return existing
      return this.getSettings(eventId);
    }

    return this.map(data as Record<string, unknown>);
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private map(r: Record<string, unknown>): PoolAssignmentSettings {
    return {
      id: r['id'] as string,
      eventId: r['event_id'] as string,
      tournamentId: (r['tournament_id'] as string | null) ?? null,
      enforceSchoolSeparation: Boolean(r['enforce_school_separation'] ?? true),
      schoolSeparationStrictness: (r['school_separation_strictness'] as 'hard' | 'soft') ?? 'soft',
      enforceSkillBalance: Boolean(r['enforce_skill_balance'] ?? true),
      enforceRefereeNoBackToBack: Boolean(r['enforce_referee_no_back_to_back'] ?? true),
      refereeRestMinSlots: (r['referee_rest_min_slots'] as number) ?? 1,
      maxBoutsPerDay: (r['max_bouts_per_day'] as number) ?? 0,
      workshopConflictWarning: Boolean(r['workshop_conflict_warning'] ?? true),
      ratingBasedOrdering: Boolean(r['rating_based_ordering'] ?? true),
      workloadBalance: Boolean(r['workload_balance'] ?? true),
      enableOwnPoolRule: Boolean(r['enable_own_pool_rule'] ?? true),
      enableOwnPoolSpanRule: Boolean(r['enable_own_pool_span_rule'] ?? true),
      enableTwoRolesRule: Boolean(r['enable_two_roles_rule'] ?? true),
      enableCapacityRule: Boolean(r['enable_capacity_rule'] ?? true),
    };
  }
}
