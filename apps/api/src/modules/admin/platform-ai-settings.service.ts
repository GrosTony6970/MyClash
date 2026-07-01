import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AnthropicAdapter } from '../ai-providers/adapters/anthropic.adapter';
import { GoogleAdapter } from '../ai-providers/adapters/google.adapter';
import { MistralAdapter } from '../ai-providers/adapters/mistral.adapter';
import { OpenAIAdapter } from '../ai-providers/adapters/openai.adapter';
import type {
  AIProvider,
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
} from '../ai-providers/adapters/provider-adapter.interface';
import { loadAiKeySecret } from '../ai-providers/ai-key-crypto';
import {
  AiKeyStore,
  type AiKeyListItem,
  type AiKeyScopeConfig,
  type CreateKeyInput,
  type UpdateKeyInput,
} from '../ai-providers/ai-key-store';
import { resolveModel } from '../ai-providers/model-registry';
import { BudgetExceededException } from '../ai-usage/budget-exceeded.exception';
import { SupabaseService } from '../supabase/supabase.service';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';

const SETTING_KEY = 'super_admin';

const PLATFORM_SCOPE: AiKeyScopeConfig = {
  keyTable: 'platform_ai_keys',
  ownerColumn: null,
  usageTable: 'platform_ai_usage_log',
  usageKeyColumn: 'platform_ai_key_id',
  usageTimeColumn: 'created_at',
  setActiveFn: 'set_active_platform_ai_key',
};

/** Platform-wide global ceiling config (keys live in `platform_ai_keys`). */
export type PlatformAIConfig = {
  monthlyBudgetEur: number | null;
  updatedAt: string | null;
};

@Injectable()
export class PlatformAISettingsService implements OnModuleInit {
  private secretKey!: Buffer;
  private adapters!: Record<AIProvider, ProviderAdapter>;
  private keys!: AiKeyStore;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly flags: AdminFeatureFlagsService,
  ) {}

  onModuleInit() {
    this.secretKey = loadAiKeySecret();
    this.adapters = {
      anthropic: new AnthropicAdapter(),
      openai: new OpenAIAdapter(),
      mistral: new MistralAdapter(),
      google: new GoogleAdapter(),
    };
    this.keys = new AiKeyStore(this.supabase, this.secretKey, PLATFORM_SCOPE);
  }

  // ── Keys (multi-key CRUD) ──────────────────────────────────────────────────

  listKeys(): Promise<AiKeyListItem[]> {
    return this.keys.list(null);
  }

  createKey(input: CreateKeyInput, actorUserId: string): Promise<AiKeyListItem> {
    return this.keys.create(null, input, actorUserId);
  }

  updateKey(id: string, input: UpdateKeyInput): Promise<AiKeyListItem> {
    return this.keys.update(null, id, input);
  }

  deleteKey(id: string): Promise<void> {
    return this.keys.delete(null, id);
  }

  activateKey(id: string): Promise<void> {
    return this.keys.activate(null, id);
  }

  /** Active key's id + provider (no decrypt) — for callers that pick a model. */
  async getActiveKeyInfo(): Promise<{ id: string; provider: AIProvider } | null> {
    const { data } = await this.supabase.service
      .from('platform_ai_keys')
      .select('id, provider')
      .eq('is_active', true)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: string; provider: AIProvider };
    return { id: row.id, provider: row.provider };
  }

  // ── Global monthly ceiling (config-only row) ───────────────────────────────

  async getConfig(): Promise<PlatformAIConfig> {
    const { data } = await this.supabase.service
      .from('platform_ai_settings')
      .select('monthly_budget_eur, updated_at')
      .eq('setting_key', SETTING_KEY)
      .maybeSingle();
    const row = data as { monthly_budget_eur: number | string | null; updated_at: string } | null;
    return {
      monthlyBudgetEur: numOrNull(row?.monthly_budget_eur),
      updatedAt: row?.updated_at ?? null,
    };
  }

  /** Update the platform monthly AI ceiling (NULL = unlimited). Upserts the row. */
  async updateBudget(monthlyBudgetEur: number | null): Promise<void> {
    const { error } = await this.supabase.service.from('platform_ai_settings').upsert(
      {
        setting_key: SETTING_KEY,
        monthly_budget_eur: monthlyBudgetEur,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'setting_key' },
    );
    if (error) throw new Error(error.message);
  }

  // ── Model-sync support (registry ↔ live drift) ─────────────────────────────

  /**
   * Resolve a provider + live model list for the model-sync drift report:
   * `apiKeyOverride` probes an ad-hoc key; `keyId` probes a specific stored key;
   * otherwise the active platform key is used. Read-only.
   */
  async listLiveModels(opts: {
    keyId?: string | null;
    providerOverride?: AIProvider | null;
    apiKeyOverride?: string | null;
  }): Promise<{ provider: AIProvider; live: string[] }> {
    let provider: AIProvider;
    let apiKey: string;
    if (opts.apiKeyOverride) {
      if (!opts.providerOverride) {
        throw new BadRequestException('provider is required when an apiKey is supplied');
      }
      provider = opts.providerOverride;
      apiKey = opts.apiKeyOverride;
    } else {
      const resolved = opts.keyId
        ? await this.keys.resolveKeyById(null, opts.keyId)
        : await this.keys.resolveActiveKey(null);
      if (!resolved) throw new NotFoundException('No super admin AI provider configured');
      provider = resolved.provider;
      apiKey = resolved.apiKey;
    }
    const live = await this.adapters[provider].listModels(apiKey);
    return { provider, live };
  }

  // ── Generate (uses the active platform key) ────────────────────────────────

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (await this.flags.isEnabled('disable_ai_features')) {
      throw new ServiceUnavailableException('AI features are temporarily disabled');
    }
    const active = await this.keys.resolveActiveKey(null);
    if (!active) throw new NotFoundException('No super admin AI provider configured');

    // Per-key monthly budget (calendar-month UTC). Pre-call gate (may overshoot
    // by one call, like the other budget gates).
    if (active.monthlyBudgetEur !== null) {
      const spent = await this.keys.keyMonthlySpend(active.id);
      if (spent >= active.monthlyBudgetEur) {
        throw new BudgetExceededException('platform-key', active.monthlyBudgetEur, spent);
      }
    }

    const adapter = this.adapters[active.provider];
    const requested = request.model && request.model !== 'default' ? request.model : active.model;
    const resolved = resolveModel(active.provider, requested);
    const result = await adapter.generate(active.apiKey, { ...request, model: resolved.id });
    return { ...result, model: resolved.id, provider: active.provider, keyId: active.id };
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
