import { Injectable } from '@nestjs/common';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  GenerationRequest,
  GenerationResult,
} from '../ai-providers/adapters/provider-adapter.interface';
import { SpendCapExceededException } from './spend-cap.exception';

@Injectable()
export class AIUsageService {
  constructor(
    private readonly providers: AIProvidersService,
    private readonly supabase: SupabaseService,
  ) {}

  async generateWithCap(
    orgId: string,
    eventId: string,
    feature: string,
    request: GenerationRequest,
  ): Promise<GenerationResult> {
    // 1. Load spend cap
    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('ai_spend_cap_eur')
      .eq('id', eventId)
      .maybeSingle();

    const cap = (eventData as { ai_spend_cap_eur: number | null } | null)?.ai_spend_cap_eur ?? null;

    // 2. Check cap
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

    // 4. Log usage
    await this.supabase.service.from('ai_usage_log').insert({
      event_id: eventId,
      organization_id: orgId,
      feature,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_eur: result.costEur,
    });

    return result;
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
}
