import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  CompensationBreakdownLine,
  CompensationPhase,
  CompensationPlan,
  CompensationReport,
  RefereeRole,
} from '@myclash/types';
import type {
  CreatePlanDto,
  RoleRateEntryDto,
  TierEntryDto,
  UpdatePlanDto,
  UpsertEventSettingsDto,
} from './dto/compensation.dto';

const FINALS_LABEL_RE = /FINAL|^F$|GOLD|BRONZE|3RD/i;

/**
 * Clamp a resolved tier amount to the event's optional cap and floor. The floor
 * is applied last, so a referee who worked is guaranteed the minimum even when
 * it exceeds the cap.
 */
export function clampCompensationAmount(
  amount: number,
  cap: number | null,
  floor: number | null,
): number {
  let result = amount;
  if (cap !== null && result > cap) result = cap;
  if (floor !== null && result < floor) result = floor;
  return result;
}

@Injectable()
export class CompensationService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── Plans ──────────────────────────────────────────────────────────────────

  async listPlans(userId: string): Promise<CompensationPlan[]> {
    // Get org IDs the user belongs to for filtering
    const { data: memberships } = await this.supabase.service
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);

    const orgIds = (memberships ?? []).map((m: Record<string, string>) => m['organization_id']);

    const { data, error } = await this.supabase.service
      .from('referee_compensation_plans')
      .select(`*, referee_compensation_role_rates(*), referee_compensation_tiers(*)`)
      .or(
        orgIds.length > 0
          ? `built_in.eq.true,public_visibility.eq.true,organization_id.in.(${orgIds.join(',')})`
          : `built_in.eq.true,public_visibility.eq.true`,
      )
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.mapPlan(r as Record<string, unknown>));
  }

  async createPlan(
    dto: CreatePlanDto,
    userId: string,
    organizationId: string,
  ): Promise<CompensationPlan> {
    await this.requireOrgAdmin(userId, organizationId);

    const { data, error } = await this.supabase.service
      .from('referee_compensation_plans')
      .insert({
        organization_id: organizationId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        built_in: false,
        public_visibility: dto.publicVisibility ?? false,
      })
      .select('*, referee_compensation_role_rates(*), referee_compensation_tiers(*)')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapPlan(data as Record<string, unknown>);
  }

  async updatePlan(planId: string, dto: UpdatePlanDto, userId: string): Promise<CompensationPlan> {
    const plan = await this.getPlanOrThrow(planId);
    if (plan.builtIn) throw new ForbiddenException('Built-in plans cannot be modified');
    if (plan.organizationId) await this.requireOrgAdmin(userId, plan.organizationId);

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description?.trim() ?? null;
    if (dto.publicVisibility !== undefined) updates['public_visibility'] = dto.publicVisibility;

    const { data, error } = await this.supabase.service
      .from('referee_compensation_plans')
      .update(updates)
      .eq('id', planId)
      .select('*, referee_compensation_role_rates(*), referee_compensation_tiers(*)')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapPlan(data as Record<string, unknown>);
  }

  async deletePlan(planId: string, userId: string): Promise<void> {
    const plan = await this.getPlanOrThrow(planId);
    if (plan.builtIn) throw new ForbiddenException('Built-in plans cannot be deleted');
    if (plan.organizationId) await this.requireOrgAdmin(userId, plan.organizationId);

    const { error } = await this.supabase.service
      .from('referee_compensation_plans')
      .delete()
      .eq('id', planId);

    if (error) throw new BadRequestException(error.message);
  }

  async upsertRoleRates(
    planId: string,
    rates: RoleRateEntryDto[],
    userId: string,
  ): Promise<CompensationPlan> {
    const plan = await this.getPlanOrThrow(planId);
    if (plan.builtIn) throw new ForbiddenException('Built-in plans cannot be modified');
    if (plan.organizationId) await this.requireOrgAdmin(userId, plan.organizationId);

    await this.supabase.service
      .from('referee_compensation_role_rates')
      .delete()
      .eq('plan_id', planId);

    if (rates.length > 0) {
      const { error } = await this.supabase.service.from('referee_compensation_role_rates').insert(
        rates.map((r) => ({
          plan_id: planId,
          referee_role: r.refereeRole,
          compensation_phase: r.compensationPhase,
          tokens_per_match: r.tokensPerMatch,
        })),
      );
      if (error) throw new BadRequestException(error.message);
    }

    return this.getPlanWithDetails(planId);
  }

  async upsertTiers(
    planId: string,
    tiers: TierEntryDto[],
    userId: string,
  ): Promise<CompensationPlan> {
    const plan = await this.getPlanOrThrow(planId);
    if (plan.builtIn) throw new ForbiddenException('Built-in plans cannot be modified');
    if (plan.organizationId) await this.requireOrgAdmin(userId, plan.organizationId);

    await this.supabase.service.from('referee_compensation_tiers').delete().eq('plan_id', planId);

    if (tiers.length > 0) {
      const { error } = await this.supabase.service.from('referee_compensation_tiers').insert(
        tiers.map((t) => ({
          plan_id: planId,
          min_tokens: t.minTokens,
          max_tokens: t.maxTokens ?? null,
          amount: t.amount,
        })),
      );
      if (error) throw new BadRequestException(error.message);
    }

    return this.getPlanWithDetails(planId);
  }

  // ── Event settings ─────────────────────────────────────────────────────────

  async getEventSettings(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('referee_compensation_event_settings')
      .select('*, referee_compensation_plans(name)')
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) return null;

    const r = data as Record<string, unknown>;
    const planRecord = r['referee_compensation_plans'] as Record<string, string> | null;
    return {
      eventId: r['event_id'] as string,
      planId: r['plan_id'] as string,
      planName: planRecord?.['name'] ?? '',
      maxCompensationAmount: r['max_compensation_amount'] as number | null,
      minCompensationAmount: r['min_compensation_amount'] as number | null,
    };
  }

  async upsertEventSettings(eventId: string, dto: UpsertEventSettingsDto, userId: string) {
    await this.requireEventOrgAdmin(eventId, userId);

    const { data, error } = await this.supabase.service
      .from('referee_compensation_event_settings')
      .upsert({
        event_id: eventId,
        plan_id: dto.planId,
        max_compensation_amount: dto.maxCompensationAmount ?? null,
        min_compensation_amount: dto.minCompensationAmount ?? null,
        updated_at: new Date().toISOString(),
      })
      .select('*, referee_compensation_plans(name)')
      .single();

    if (error) throw new BadRequestException(error.message);
    const r = data as Record<string, unknown>;
    const planRecord = r['referee_compensation_plans'] as Record<string, string> | null;
    return {
      eventId: r['event_id'] as string,
      planId: r['plan_id'] as string,
      planName: planRecord?.['name'] ?? '',
      maxCompensationAmount: r['max_compensation_amount'] as number | null,
      minCompensationAmount: r['min_compensation_amount'] as number | null,
    };
  }

  // ── Compensation report ────────────────────────────────────────────────────

  async computeReport(eventId: string): Promise<CompensationReport> {
    const settings = await this.getEventSettings(eventId);
    if (!settings) throw new NotFoundException('No compensation plan configured for this event');

    const plan = await this.getPlanWithDetails(settings.planId);
    const cap = settings.maxCompensationAmount;
    const floor = settings.minCompensationAmount;

    // Build rate lookup: role → phase → tokensPerMatch
    const rateMap = new Map<string, number>();
    for (const rr of plan.roleRates) {
      rateMap.set(`${rr.refereeRole}:${rr.compensationPhase}`, Number(rr.tokensPerMatch));
    }

    // Tiers sorted ascending
    const tiers = [...plan.tiers].sort((a, b) => Number(a.minTokens) - Number(b.minTokens));

    // Load assignments with related data — post-0063 keyed on person_id.
    const { data: assignments, error: assignErr } = await this.supabase.service
      .from('referee_assignments')
      .select('id, person_id, scope_type, role, pool_id, lice_id, match_id')
      .eq('event_id', eventId);

    if (assignErr) throw new BadRequestException(assignErr.message);
    if (!assignments || assignments.length === 0) {
      return {
        planId: plan.id,
        planName: plan.name,
        maxCap: cap,
        minFloor: floor,
        referees: [],
        grandTotal: 0,
      };
    }

    // Accumulator: person_id → role → phase → { matchCount, tokensPerMatch }
    const acc = new Map<string, Map<string, Map<CompensationPhase, number>>>();

    const addMatches = (
      personId: string,
      role: string,
      phase: CompensationPhase,
      count: number,
    ) => {
      if (!acc.has(personId)) acc.set(personId, new Map());
      const byRole = acc.get(personId)!;
      if (!byRole.has(role)) byRole.set(role, new Map());
      const byPhase = byRole.get(role)!;
      byPhase.set(phase, (byPhase.get(phase) ?? 0) + count);
    };

    // Pool assignments → count completed matches in pool
    const poolIds = [
      ...new Set(
        (assignments as Array<Record<string, unknown>>)
          .filter((a) => a['scope_type'] === 'pool' && a['pool_id'])
          .map((a) => a['pool_id'] as string),
      ),
    ];

    const poolMatchCounts = new Map<string, number>();
    if (poolIds.length > 0) {
      const { data: poolMatches } = await this.supabase.service
        .from('matches')
        .select('pool_id')
        .in('pool_id', poolIds)
        .eq('status', 'completed');
      for (const m of poolMatches ?? []) {
        const pid = (m as Record<string, string>)['pool_id'] ?? '';
        if (pid) poolMatchCounts.set(pid, (poolMatchCounts.get(pid) ?? 0) + 1);
      }
    }

    // Lice assignments → count completed matches split by label
    const liceIds = [
      ...new Set(
        (assignments as Array<Record<string, unknown>>)
          .filter((a) => a['scope_type'] === 'lice' && a['lice_id'])
          .map((a) => a['lice_id'] as string),
      ),
    ];

    type LiceMatchRow = { lice_id: string; match_number_label: string | null };
    const liceMatchesByPhase = new Map<string, { bracket: number; finals: number }>();
    if (liceIds.length > 0) {
      const { data: liceMatches } = await this.supabase.service
        .from('matches')
        .select('lice_id, match_number_label')
        .in('lice_id', liceIds)
        .eq('status', 'completed');
      for (const m of (liceMatches ?? []) as LiceMatchRow[]) {
        const lid = m.lice_id;
        if (!liceMatchesByPhase.has(lid)) liceMatchesByPhase.set(lid, { bracket: 0, finals: 0 });
        const counts = liceMatchesByPhase.get(lid)!;
        if (m.match_number_label && FINALS_LABEL_RE.test(m.match_number_label)) {
          counts.finals++;
        } else {
          counts.bracket++;
        }
      }
    }

    // Match-level assignments → single match, determine phase by label
    const matchIds = [
      ...new Set(
        (assignments as Array<Record<string, unknown>>)
          .filter((a) => a['scope_type'] === 'match' && a['match_id'])
          .map((a) => a['match_id'] as string),
      ),
    ];

    type MatchRow = {
      id: string;
      match_number_label: string | null;
      status: string;
      lice_id: string | null;
    };
    const matchRows = new Map<string, MatchRow>();
    if (matchIds.length > 0) {
      const { data: matches } = await this.supabase.service
        .from('matches')
        .select('id, match_number_label, status, lice_id')
        .in('id', matchIds);
      for (const m of (matches ?? []) as MatchRow[]) {
        matchRows.set(m.id, m);
      }
    }

    // Process each assignment
    for (const a of assignments as Array<Record<string, unknown>>) {
      const personId = a['person_id'] as string;
      const role = (a['role'] as string) ?? 'arbitre_table';

      if (a['scope_type'] === 'pool' && a['pool_id']) {
        const count = poolMatchCounts.get(a['pool_id'] as string) ?? 0;
        if (count > 0) addMatches(personId, role, 'pool', count);
      } else if (a['scope_type'] === 'lice' && a['lice_id']) {
        const counts = liceMatchesByPhase.get(a['lice_id'] as string);
        if (counts) {
          if (counts.bracket > 0) addMatches(personId, role, 'bracket', counts.bracket);
          if (counts.finals > 0) addMatches(personId, role, 'finals', counts.finals);
        }
      } else if (a['scope_type'] === 'match' && a['match_id']) {
        const match = matchRows.get(a['match_id'] as string);
        if (match && match.status === 'completed') {
          const phase: CompensationPhase =
            match.lice_id &&
            match.match_number_label &&
            FINALS_LABEL_RE.test(match.match_number_label)
              ? 'finals'
              : match.lice_id
                ? 'bracket'
                : 'pool';
          addMatches(personId, role, phase, 1);
        }
      }
    }

    // Display name for each person we accumulated.
    const personIds = [...acc.keys()];
    const displayNames = new Map<string, string>();
    if (personIds.length > 0) {
      const { data: gpRows } = await this.supabase.service
        .from('global_persons')
        .select('id, given_name, family_name')
        .in('id', personIds);
      for (const gp of (gpRows ?? []) as Array<{
        id: string;
        given_name: string | null;
        family_name: string | null;
      }>) {
        displayNames.set(gp.id, `${gp.given_name ?? ''} ${gp.family_name ?? ''}`.trim());
      }
    }

    // Payments key on person_id (migration 0163). They used to key on the auth
    // uid, which meant an unclaimed referee — nearly every referee at a real
    // event — could never be marked paid: the write landed under an id this
    // lookup did not read.
    const paymentMap = new Map<string, { paid: boolean; paidAt: string | null }>();
    if (personIds.length > 0) {
      const { data: payments } = await this.supabase.service
        .from('referee_compensation_payments')
        .select('person_id, paid, paid_at')
        .eq('event_id', eventId)
        .in('person_id', personIds);
      for (const p of (payments ?? []) as Array<Record<string, unknown>>) {
        paymentMap.set(p['person_id'] as string, {
          paid: Boolean(p['paid']),
          paidAt: (p['paid_at'] as string | null) ?? null,
        });
      }
    }

    // Build report. Keyed on person_id; userId surfaces when claimed.
    const referees: ReturnType<typeof this.buildRefereeReport>[] = [];

    for (const [personId, byRole] of acc) {
      const breakdown: CompensationBreakdownLine[] = [];
      let totalTokens = 0;

      for (const [role, byPhase] of byRole) {
        for (const [phase, matchCount] of byPhase) {
          const tokensPerMatch = rateMap.get(`${role}:${phase}`) ?? 0;
          const subtotal = matchCount * tokensPerMatch;
          totalTokens += subtotal;
          breakdown.push({
            phase,
            // `role` may be a custom skill ID (e.g. "custom-abc123") introduced by Task 6's
            // DTO loosening. The rate lookup handles this safely: unknown roles get
            // tokensPerMatch = 0 via the `?? 0` fallback. Cast preserved for type compat.
            role: role as RefereeRole,
            matchCount,
            tokensPerMatch,
            subtotal,
          });
        }
      }

      // Tier amount clamped to the event's floor/cap. Floor last → the minimum
      // is guaranteed for anyone who refereed (every person in `acc` has ≥1
      // counted match); if floor > cap, the floor wins.
      const amountOwed = clampCompensationAmount(this.resolveTier(totalTokens, tiers), cap, floor);

      const payment = paymentMap.get(personId);
      referees.push({
        personId,
        displayName: displayNames.get(personId) ?? personId,
        totalTokens,
        amountOwed,
        paid: payment?.paid ?? false,
        paidAt: payment?.paidAt ?? null,
        breakdown,
      });
    }

    const grandTotal = referees.reduce((s, r) => s + r.amountOwed, 0);

    return {
      planId: plan.id,
      planName: plan.name,
      maxCap: cap,
      minFloor: floor,
      referees,
      grandTotal,
    };
  }

  /** `personId` is a global_persons.id — the id `computeReport` emits. */
  async togglePaid(eventId: string, personId: string, paid: boolean, actorId: string) {
    await this.requireEventOrgAdmin(eventId, actorId);

    const now = paid ? new Date().toISOString() : null;
    const { error } = await this.supabase.service.from('referee_compensation_payments').upsert({
      event_id: eventId,
      person_id: personId,
      tokens_earned: 0,
      amount_owed: 0,
      paid,
      paid_at: now,
    });

    if (error) throw new BadRequestException(error.message);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getPlanOrThrow(planId: string): Promise<CompensationPlan> {
    const { data, error } = await this.supabase.service
      .from('referee_compensation_plans')
      .select('*, referee_compensation_role_rates(*), referee_compensation_tiers(*)')
      .eq('id', planId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Compensation plan ${planId} not found`);
    return this.mapPlan(data as Record<string, unknown>);
  }

  private async getPlanWithDetails(planId: string): Promise<CompensationPlan> {
    return this.getPlanOrThrow(planId);
  }

  private mapPlan(r: Record<string, unknown>): CompensationPlan {
    const rates = (
      (r['referee_compensation_role_rates'] as Array<Record<string, unknown>>) ?? []
    ).map((rr) => ({
      id: rr['id'] as string,
      refereeRole: rr['referee_role'] as RefereeRole,
      compensationPhase: rr['compensation_phase'] as CompensationPhase,
      tokensPerMatch: Number(rr['tokens_per_match']),
    }));
    const tiers = ((r['referee_compensation_tiers'] as Array<Record<string, unknown>>) ?? []).map(
      (t) => ({
        id: t['id'] as string,
        minTokens: Number(t['min_tokens']),
        maxTokens: t['max_tokens'] != null ? Number(t['max_tokens']) : null,
        amount: Number(t['amount']),
      }),
    );
    return {
      id: r['id'] as string,
      organizationId: (r['organization_id'] as string | null) ?? null,
      name: r['name'] as string,
      description: (r['description'] as string | null) ?? null,
      builtIn: Boolean(r['built_in']),
      publicVisibility: Boolean(r['public_visibility']),
      createdAt: r['created_at'] as string,
      roleRates: rates,
      tiers,
    };
  }

  private resolveTier(
    totalTokens: number,
    tiers: Array<{ minTokens: number; maxTokens: number | null; amount: number }>,
  ): number {
    for (const tier of tiers) {
      const aboveMin = totalTokens >= Number(tier.minTokens);
      const belowMax = tier.maxTokens === null || totalTokens <= Number(tier.maxTokens);
      if (aboveMin && belowMax) return Number(tier.amount);
    }
    return 0;
  }

  private async requireOrgAdmin(userId: string, organizationId: string): Promise<void> {
    const { data } = await this.supabase.service
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!data || !['admin', 'owner'].includes((data as Record<string, string>)['role'] ?? '')) {
      throw new ForbiddenException('Admin access required');
    }
  }

  private async requireEventOrgAdmin(eventId: string, userId: string): Promise<void> {
    const { data: event } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();

    if (!event) throw new NotFoundException('Event not found');
    await this.requireOrgAdmin(userId, (event as Record<string, string>)['organization_id'] ?? '');
  }

  // Used in buildRefereeReport type inference
  private buildRefereeReport(
    personId: string,
    displayName: string,
    totalTokens: number,
    amountOwed: number,
    paid: boolean,
    paidAt: string | null,
    breakdown: CompensationBreakdownLine[],
  ) {
    return { personId, displayName, totalTokens, amountOwed, paid, paidAt, breakdown };
  }
}
