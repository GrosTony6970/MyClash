/**
 * settings.service.ts — T-902
 *
 * CRUD for pool_assignment_settings.
 *
 * AC:
 *   - Default settings created on event creation
 *   - Per-tournament override resolves correctly
 *   - enforce_fighter_referee_no_overlap cannot be set to false (hard constraint)
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
  /** HARD CONSTRAINT — always true, cannot be disabled */
  enforceFighterRefereeNoOverlap: true;
  enforceRefereeNoBackToBack: boolean;
  refereeRestMinSlots: number;
  enforceDedicatedRefereeRest: boolean;
  workshopConflictWarning: boolean;
  ratingBasedOrdering: boolean;
  workloadBalance: boolean;
  /** Per-rule toggles for the Assignment Health rules — all default true.
   *  Disabling one stops it being flagged in the health panel AND
   *  enforced (engine, candidate blocking, manual-assign rejects). */
  enableOwnPoolRule: boolean;
  enableOfficiateVsFightRule: boolean;
  enableDoubleBookedRule: boolean;
  enableTwoRolesRule: boolean;
  enableAvailabilityRule: boolean;
  enableCapacityRule: boolean;
}

const DEFAULTS: Omit<PoolAssignmentSettings, 'id' | 'eventId' | 'tournamentId'> = {
  enforceSchoolSeparation: true,
  schoolSeparationStrictness: 'soft',
  enforceSkillBalance: true,
  enforceFighterRefereeNoOverlap: true, // HARD — always true
  enforceRefereeNoBackToBack: true,
  refereeRestMinSlots: 1,
  enforceDedicatedRefereeRest: false,
  workshopConflictWarning: true,
  ratingBasedOrdering: true,
  workloadBalance: true,
  enableOwnPoolRule: true,
  enableOfficiateVsFightRule: true,
  enableDoubleBookedRule: true,
  enableTwoRolesRule: true,
  enableAvailabilityRule: true,
  enableCapacityRule: true,
};

@Injectable()
export class SettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── Get settings (tournament override → event default) ────────────────────────

  async getSettings(eventId: string, tournamentId?: string): Promise<PoolAssignmentSettings> {
    // Try tournament-specific override first
    if (tournamentId) {
      const { data: tournamentSettings } = await this.supabase.service
        .from('pool_assignment_settings')
        .select('*')
        .eq('event_id', eventId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();

      if (tournamentSettings) return this.map(tournamentSettings as Record<string, unknown>);
    }

    // Fall back to event-level settings
    const { data: eventSettings } = await this.supabase.service
      .from('pool_assignment_settings')
      .select('*')
      .eq('event_id', eventId)
      .is('tournament_id', null)
      .maybeSingle();

    if (eventSettings) return this.map(eventSettings as Record<string, unknown>);

    // Auto-create defaults
    return this.createDefaults(eventId, null);
  }

  // ── Create or update settings ─────────────────────────────────────────────────

  async upsertSettings(
    eventId: string,
    tournamentId: string | null,
    patch: Partial<
      Omit<
        PoolAssignmentSettings,
        'id' | 'eventId' | 'tournamentId' | 'enforceFighterRefereeNoOverlap'
      >
    >,
  ): Promise<PoolAssignmentSettings> {
    // Hard constraint: enforce_fighter_referee_no_overlap cannot be disabled
    // (enforced by type — the field is always `true` in the interface)

    const existing = await this.getSettings(eventId, tournamentId ?? undefined);

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
    if (patch.enforceDedicatedRefereeRest !== undefined)
      updates['enforce_dedicated_referee_rest'] = patch.enforceDedicatedRefereeRest;
    if (patch.workshopConflictWarning !== undefined)
      updates['workshop_conflict_warning'] = patch.workshopConflictWarning;
    if (patch.ratingBasedOrdering !== undefined)
      updates['rating_based_ordering'] = patch.ratingBasedOrdering;
    if (patch.workloadBalance !== undefined) updates['workload_balance'] = patch.workloadBalance;
    if (patch.enableOwnPoolRule !== undefined)
      updates['enable_own_pool_rule'] = patch.enableOwnPoolRule;
    if (patch.enableOfficiateVsFightRule !== undefined)
      updates['enable_officiate_vs_fight_rule'] = patch.enableOfficiateVsFightRule;
    if (patch.enableDoubleBookedRule !== undefined)
      updates['enable_double_booked_rule'] = patch.enableDoubleBookedRule;
    if (patch.enableTwoRolesRule !== undefined)
      updates['enable_two_roles_rule'] = patch.enableTwoRolesRule;
    if (patch.enableAvailabilityRule !== undefined)
      updates['enable_availability_rule'] = patch.enableAvailabilityRule;
    if (patch.enableCapacityRule !== undefined)
      updates['enable_capacity_rule'] = patch.enableCapacityRule;

    // Always keep hard constraint true
    updates['enforce_fighter_referee_no_overlap'] = true;

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

  async createDefaults(
    eventId: string,
    tournamentId: string | null,
  ): Promise<PoolAssignmentSettings> {
    const { data, error } = await this.supabase.service
      .from('pool_assignment_settings')
      .insert({
        event_id: eventId,
        tournament_id: tournamentId,
        enforce_school_separation: DEFAULTS.enforceSchoolSeparation,
        school_separation_strictness: DEFAULTS.schoolSeparationStrictness,
        enforce_skill_balance: DEFAULTS.enforceSkillBalance,
        enforce_fighter_referee_no_overlap: true, // HARD — always true
        enforce_referee_no_back_to_back: DEFAULTS.enforceRefereeNoBackToBack,
        referee_rest_min_slots: DEFAULTS.refereeRestMinSlots,
        enforce_dedicated_referee_rest: DEFAULTS.enforceDedicatedRefereeRest,
        workshop_conflict_warning: DEFAULTS.workshopConflictWarning,
        rating_based_ordering: DEFAULTS.ratingBasedOrdering,
        workload_balance: DEFAULTS.workloadBalance,
        enable_own_pool_rule: DEFAULTS.enableOwnPoolRule,
        enable_officiate_vs_fight_rule: DEFAULTS.enableOfficiateVsFightRule,
        enable_double_booked_rule: DEFAULTS.enableDoubleBookedRule,
        enable_two_roles_rule: DEFAULTS.enableTwoRolesRule,
        enable_availability_rule: DEFAULTS.enableAvailabilityRule,
        enable_capacity_rule: DEFAULTS.enableCapacityRule,
      })
      .select('*')
      .single();

    if (error) {
      // May already exist (race condition) — return existing
      return this.getSettings(eventId, tournamentId ?? undefined);
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
      enforceFighterRefereeNoOverlap: true, // HARD — always true regardless of DB value
      enforceRefereeNoBackToBack: Boolean(r['enforce_referee_no_back_to_back'] ?? true),
      refereeRestMinSlots: (r['referee_rest_min_slots'] as number) ?? 1,
      enforceDedicatedRefereeRest: Boolean(r['enforce_dedicated_referee_rest'] ?? false),
      workshopConflictWarning: Boolean(r['workshop_conflict_warning'] ?? true),
      ratingBasedOrdering: Boolean(r['rating_based_ordering'] ?? true),
      workloadBalance: Boolean(r['workload_balance'] ?? true),
      enableOwnPoolRule: Boolean(r['enable_own_pool_rule'] ?? true),
      enableOfficiateVsFightRule: Boolean(r['enable_officiate_vs_fight_rule'] ?? true),
      enableDoubleBookedRule: Boolean(r['enable_double_booked_rule'] ?? true),
      enableTwoRolesRule: Boolean(r['enable_two_roles_rule'] ?? true),
      enableAvailabilityRule: Boolean(r['enable_availability_rule'] ?? true),
      enableCapacityRule: Boolean(r['enable_capacity_rule'] ?? true),
    };
  }
}
