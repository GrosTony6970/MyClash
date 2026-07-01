import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { GoogleAdapter } from './adapters/google.adapter';
import { MistralAdapter } from './adapters/mistral.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import type {
  AIProvider,
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
} from './adapters/provider-adapter.interface';
import { loadAiKeySecret } from './ai-key-crypto';
import {
  AiKeyStore,
  type AiKeyListItem,
  type AiKeyScopeConfig,
  type CreateKeyInput,
  type ResolvedActiveKey,
  type UpdateKeyInput,
} from './ai-key-store';
import { resolveModel } from './model-registry';
import { BudgetExceededException } from '../ai-usage/budget-exceeded.exception';
import { SupabaseService } from '../supabase/supabase.service';

const ORG_SCOPE: AiKeyScopeConfig = {
  keyTable: 'organization_ai_keys',
  ownerColumn: 'organization_id',
  usageTable: 'ai_usage_log',
  usageKeyColumn: 'organization_ai_key_id',
  usageTimeColumn: 'called_at',
  setActiveFn: 'set_active_org_ai_key',
};

const FIGHTER_SCOPE: AiKeyScopeConfig = {
  keyTable: 'fighter_ai_keys',
  ownerColumn: 'global_person_id',
  usageTable: 'fighter_ai_usage_log',
  usageKeyColumn: 'fighter_ai_key_id',
  usageTimeColumn: 'created_at',
  setActiveFn: 'set_active_fighter_ai_key',
};

/** Org AI config (global ceiling + kill-switch flags). Keys live in organization_ai_keys. */
export type OrgAIConfig = {
  hasKey: boolean;
  monthlyBudgetEur: number | null;
  aiFeaturesDisabled: boolean;
  organizerChatDisabled: boolean;
  updatedAt: string | null;
};

@Injectable()
export class AIProvidersService implements OnModuleInit {
  private secretKey!: Buffer;
  private adapters!: Record<AIProvider, ProviderAdapter>;
  private orgKeys!: AiKeyStore;
  private fighterKeys!: AiKeyStore;

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit() {
    this.secretKey = loadAiKeySecret();
    this.adapters = {
      anthropic: new AnthropicAdapter(),
      openai: new OpenAIAdapter(),
      mistral: new MistralAdapter(),
      google: new GoogleAdapter(),
    };
    this.orgKeys = new AiKeyStore(this.supabase, this.secretKey, ORG_SCOPE);
    this.fighterKeys = new AiKeyStore(this.supabase, this.secretKey, FIGHTER_SCOPE);
  }

  // ── Organization keys (multi-key CRUD) ─────────────────────────────────────

  listKeys(orgId: string): Promise<AiKeyListItem[]> {
    return this.orgKeys.list(orgId);
  }

  createKey(orgId: string, input: CreateKeyInput, actorUserId?: string): Promise<AiKeyListItem> {
    return this.orgKeys.create(orgId, input, actorUserId);
  }

  updateKey(orgId: string, id: string, input: UpdateKeyInput): Promise<AiKeyListItem> {
    return this.orgKeys.update(orgId, id, input);
  }

  deleteKey(orgId: string, id: string): Promise<void> {
    return this.orgKeys.delete(orgId, id);
  }

  activateKey(orgId: string, id: string): Promise<void> {
    return this.orgKeys.activate(orgId, id);
  }

  hasActiveKey(orgId: string): Promise<boolean> {
    return this.orgKeys.hasActiveKey(orgId);
  }

  // ── Organization config (budget ceiling + flags) ───────────────────────────

  async getProviderConfig(orgId: string): Promise<OrgAIConfig | null> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('monthly_budget_eur, ai_features_disabled, organizer_chat_disabled, updated_at')
      .eq('organization_id', orgId)
      .maybeSingle();
    const hasKey = await this.orgKeys.hasActiveKey(orgId);
    if (!data && !hasKey) return null;
    const row = data as {
      monthly_budget_eur?: number | string | null;
      ai_features_disabled?: boolean | null;
      organizer_chat_disabled?: boolean | null;
      updated_at?: string | null;
    } | null;
    return {
      hasKey,
      monthlyBudgetEur: toNumberOrNull(row?.monthly_budget_eur),
      aiFeaturesDisabled: Boolean(row?.ai_features_disabled),
      organizerChatDisabled: Boolean(row?.organizer_chat_disabled),
      updatedAt: row?.updated_at ?? null,
    };
  }

  /** Update the org monthly AI ceiling (NULL = unlimited). Upserts the config row. */
  async updateBudget(orgId: string, monthlyBudgetEur: number | null): Promise<void> {
    const { error } = await this.supabase.service.from('organization_ai_settings').upsert(
      {
        organization_id: orgId,
        monthly_budget_eur: monthlyBudgetEur,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    );
    if (error) throw new Error(error.message);
  }

  /**
   * Per-org AI availability overrides. An org can disable AI or just the chatbot
   * for itself; it can never re-enable what the platform kill-switch turned off
   * (enforced at the call sites). Upserts the config row.
   */
  async updateFlags(
    orgId: string,
    flags: { aiFeaturesDisabled?: boolean; organizerChatDisabled?: boolean },
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      organization_id: orgId,
      updated_at: new Date().toISOString(),
    };
    if (flags.aiFeaturesDisabled !== undefined)
      updates['ai_features_disabled'] = flags.aiFeaturesDisabled;
    if (flags.organizerChatDisabled !== undefined)
      updates['organizer_chat_disabled'] = flags.organizerChatDisabled;
    const { error } = await this.supabase.service
      .from('organization_ai_settings')
      .upsert(updates, { onConflict: 'organization_id' });
    if (error) throw new Error(error.message);
  }

  // ── Organization generate (active key + per-key budget) ────────────────────

  async generate(orgId: string, request: GenerationRequest): Promise<GenerationResult> {
    const active = await this.orgKeys.resolveActiveKey(orgId);
    if (!active) throw new NotFoundException('No AI provider configured for this organization');
    await this.assertKeyBudget(this.orgKeys, active, 'organization-key');
    return this.runAdapter(active, request);
  }

  // ── Per-fighter BYOK (fighter_ai_keys) ─────────────────────────────────────

  listFighterKeys(globalPersonId: string): Promise<AiKeyListItem[]> {
    return this.fighterKeys.list(globalPersonId);
  }

  createFighterKey(globalPersonId: string, input: CreateKeyInput): Promise<AiKeyListItem> {
    return this.fighterKeys.create(globalPersonId, input);
  }

  updateFighterKey(
    globalPersonId: string,
    id: string,
    input: UpdateKeyInput,
  ): Promise<AiKeyListItem> {
    return this.fighterKeys.update(globalPersonId, id, input);
  }

  deleteFighterKey(globalPersonId: string, id: string): Promise<void> {
    return this.fighterKeys.delete(globalPersonId, id);
  }

  activateFighterKey(globalPersonId: string, id: string): Promise<void> {
    return this.fighterKeys.activate(globalPersonId, id);
  }

  hasActiveFighterKey(globalPersonId: string): Promise<boolean> {
    return this.fighterKeys.hasActiveKey(globalPersonId);
  }

  /**
   * Generate using the fighter's active key, enforcing its per-key budget and
   * metering the call to fighter_ai_usage_log (fighters have no org/event
   * budget — their key, their cost — but usage is still tracked per key).
   */
  async generateForFighter(
    globalPersonId: string,
    request: GenerationRequest,
    feature = 'fighter_insight',
  ): Promise<GenerationResult> {
    const active = await this.fighterKeys.resolveActiveKey(globalPersonId);
    if (!active) throw new NotFoundException('No AI provider configured for this fighter');
    await this.assertKeyBudget(this.fighterKeys, active, 'fighter-key');
    const result = await this.runAdapter(active, request);
    await this.supabase.service.from('fighter_ai_usage_log').insert({
      fighter_ai_key_id: active.id,
      global_person_id: globalPersonId,
      feature,
      provider: result.provider ?? active.provider,
      model: result.model ?? null,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_eur: result.costEur,
      created_at: new Date().toISOString(),
    });
    return result;
  }

  // ── Shared internals ───────────────────────────────────────────────────────

  private async assertKeyBudget(
    store: AiKeyStore,
    active: ResolvedActiveKey,
    scope: 'organization-key' | 'fighter-key',
  ): Promise<void> {
    if (active.monthlyBudgetEur === null) return;
    const spent = await store.keyMonthlySpend(active.id);
    if (spent >= active.monthlyBudgetEur) {
      throw new BudgetExceededException(scope, active.monthlyBudgetEur, spent);
    }
  }

  private async runAdapter(
    active: ResolvedActiveKey,
    request: GenerationRequest,
  ): Promise<GenerationResult> {
    const adapter = this.adapters[active.provider];
    // Resolve the model centrally: a concrete id in the request wins; otherwise
    // fall back to the key's stored model, then the provider's registry default.
    const requested = request.model && request.model !== 'default' ? request.model : active.model;
    const resolved = resolveModel(active.provider, requested);
    const result = await adapter.generate(active.apiKey, { ...request, model: resolved.id });
    // Surface the resolved model + provider + key id so callers can meter usage.
    return { ...result, model: resolved.id, provider: active.provider, keyId: active.id };
  }
}

/** NUMERIC columns can arrive as string or number from PostgREST. */
function toNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
