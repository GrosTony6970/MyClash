import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  GenerationRequest,
  GenerationResult,
} from '../ai-providers/adapters/provider-adapter.interface';
import { BudgetExceededException } from './budget-exceeded.exception';
import { SpendCapExceededException } from './spend-cap.exception';

@Injectable()
export class AIUsageService {
  constructor(
    private readonly providers: AIProvidersService,
    private readonly supabase: SupabaseService,
    private readonly flags: AdminFeatureFlagsService,
  ) {}

  async generateWithCap(
    orgId: string,
    eventId: string,
    feature: string,
    request: GenerationRequest,
  ): Promise<GenerationResult> {
    // 0. Global AI kill-switch — gate the org BYOK path too (the super-admin
    // path is gated in PlatformAISettingsService; without this the org path
    // and the chatbot would keep running when the flag is flipped).
    if (await this.flags.isEnabled('disable_ai_features')) {
      throw new ServiceUnavailableException('AI features are temporarily disabled');
    }

    // 1. Monthly budgets (calendar-month UTC), checked platform → org → event.
    // Pre-call gates (may overshoot by one call, like the per-event cap).
    const monthStart = currentMonthStartIso();
    const platformBudget = await this.platformMonthlyBudget();
    if (platformBudget !== null) {
      const spent = await this.monthlySpend(monthStart, null);
      if (spent >= platformBudget) {
        throw new BudgetExceededException('platform', platformBudget, spent);
      }
    }
    const orgBudget = await this.orgMonthlyBudget(orgId);
    if (orgBudget !== null) {
      const spent = await this.monthlySpend(monthStart, orgId);
      if (spent >= orgBudget) {
        throw new BudgetExceededException('organization', orgBudget, spent);
      }
    }

    // 2. Per-event spend cap.
    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('ai_spend_cap_eur')
      .eq('id', eventId)
      .maybeSingle();

    const cap = (eventData as { ai_spend_cap_eur: number | null } | null)?.ai_spend_cap_eur ?? null;

    if (cap !== null) {
      const { data: sumData } = await this.supabase.service
        .from('ai_usage_log')
        .select('sum:cost_eur.sum()')
        .eq('event_id', eventId)
        .single();

      const spent = parseFloat((sumData as { sum: string | null } | null)?.sum ?? '0');
      if (spent >= cap) {
        throw new SpendCapExceededException(eventId, cap, spent);
      }
    }

    // 3. Generate
    const result = await this.providers.generate(orgId, request);

    // 4. Log usage (model + provider power the consumption dashboard breakdown)
    await this.supabase.service.from('ai_usage_log').insert({
      event_id: eventId,
      organization_id: orgId,
      feature,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_eur: result.costEur,
      model: result.model ?? null,
      provider: result.provider ?? null,
    });

    return result;
  }

  private async platformMonthlyBudget(): Promise<number | null> {
    const { data } = await this.supabase.service
      .from('platform_ai_settings')
      .select('monthly_budget_eur')
      .eq('setting_key', 'super_admin')
      .maybeSingle();
    return numOrNull((data as { monthly_budget_eur: unknown } | null)?.monthly_budget_eur);
  }

  private async orgMonthlyBudget(orgId: string): Promise<number | null> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('monthly_budget_eur')
      .eq('organization_id', orgId)
      .maybeSingle();
    return numOrNull((data as { monthly_budget_eur: unknown } | null)?.monthly_budget_eur);
  }

  private async monthlySpend(monthStartIso: string, orgId: string | null): Promise<number> {
    const base = this.supabase.service
      .from('ai_usage_log')
      .select('sum:cost_eur.sum()')
      .gte('called_at', monthStartIso);
    const query = orgId ? base.eq('organization_id', orgId) : base;
    const { data } = await query.single();
    return parseFloat((data as { sum: string | null } | null)?.sum ?? '0');
  }

  async getUsageSummary(eventId: string): Promise<{
    totalSpendEur: number;
    cap: number | null;
    remainingEur: number | null;
    callCount: number;
  }> {
    const [eventRes, usageRes] = await Promise.all([
      this.supabase.service
        .from('events')
        .select('ai_spend_cap_eur')
        .eq('id', eventId)
        .maybeSingle(),
      this.supabase.service
        .from('ai_usage_log')
        .select('total:cost_eur.sum(), calls:id.count()')
        .eq('event_id', eventId)
        .single(),
    ]);

    const cap =
      (eventRes.data as { ai_spend_cap_eur: number | null } | null)?.ai_spend_cap_eur ?? null;
    const usageRow = usageRes.data as { total: string | null; calls: number } | null;
    const totalSpendEur = parseFloat(usageRow?.total ?? '0');
    const callCount = usageRow?.calls ?? 0;
    const remainingEur = cap !== null ? Math.max(0, cap - totalSpendEur) : null;

    return { totalSpendEur, cap, remainingEur, callCount };
  }

  /** Consumption rollup for one org (dashboard Usage tab). */
  async getOrgUsageRollup(orgId: string, fromIso?: string, toIso?: string) {
    const rows = await this.fetchUsageRows({ orgId, fromIso, toIso });
    return {
      ...aggregate(rows),
      byEvent: groupCost(rows, (r) => r.event_id ?? 'unknown'),
    };
  }

  /** Global consumption rollup + per-org breakdown (super-admin dashboard). */
  async getPlatformUsageRollup(fromIso?: string, toIso?: string) {
    const rows = await this.fetchUsageRows({ fromIso, toIso });
    return {
      ...aggregate(rows),
      byOrg: groupCost(rows, (r) => r.organization_id ?? 'unknown'),
    };
  }

  private async fetchUsageRows(opts: {
    orgId?: string;
    fromIso?: string;
    toIso?: string;
  }): Promise<UsageRow[]> {
    let q = this.supabase.service
      .from('ai_usage_log')
      .select(
        'organization_id, event_id, feature, model, provider, input_tokens, output_tokens, cost_eur, called_at',
      )
      .order('called_at', { ascending: false })
      .limit(5000);
    if (opts.orgId) q = q.eq('organization_id', opts.orgId);
    if (opts.fromIso) q = q.gte('called_at', opts.fromIso);
    if (opts.toIso) q = q.lte('called_at', opts.toIso);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as UsageRow[];
  }
}

interface UsageRow {
  organization_id?: string | null;
  event_id?: string | null;
  feature?: string | null;
  model?: string | null;
  provider?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_eur?: number | string | null;
  called_at?: string | null;
}

export interface Bucket {
  key: string;
  costEur: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function groupCost(rows: UsageRow[], keyFn: (r: UsageRow) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const key = keyFn(r) || 'unknown';
    const b = map.get(key) ?? { key, costEur: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
    b.costEur += num(r.cost_eur);
    b.inputTokens += num(r.input_tokens);
    b.outputTokens += num(r.output_tokens);
    b.calls += 1;
    map.set(key, b);
  }
  return Array.from(map.values()).sort((a, b) => b.costEur - a.costEur);
}

function aggregate(rows: UsageRow[]) {
  const total = rows.reduce(
    (acc, r) => ({
      costEur: acc.costEur + num(r.cost_eur),
      inputTokens: acc.inputTokens + num(r.input_tokens),
      outputTokens: acc.outputTokens + num(r.output_tokens),
      calls: acc.calls + 1,
    }),
    { costEur: 0, inputTokens: 0, outputTokens: 0, calls: 0 },
  );
  return {
    total,
    byFeature: groupCost(rows, (r) => r.feature ?? 'unknown'),
    byModel: groupCost(rows, (r) => r.model ?? 'unknown'),
    byProvider: groupCost(rows, (r) => r.provider ?? 'unknown'),
    byDay: groupCost(rows, (r) => (r.called_at ?? '').slice(0, 10) || 'unknown').sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
  };
}

function currentMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
