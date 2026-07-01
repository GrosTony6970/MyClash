import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { MistralAdapter } from './adapters/mistral.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import type {
  AIProvider,
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
} from './adapters/provider-adapter.interface';
import { isValidModelForProvider, resolveModel } from './model-registry';
import { SupabaseService } from '../supabase/supabase.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class AIProvidersService implements OnModuleInit {
  private secretKey!: Buffer;
  private adapters!: Record<AIProvider, ProviderAdapter>;

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit() {
    const secret = process.env['AI_KEY_SECRET'];
    if (!secret) throw new Error('AI_KEY_SECRET env var is required');
    this.secretKey = Buffer.from(secret, 'hex');
    if (this.secretKey.length !== 32) {
      throw new Error('AI_KEY_SECRET must be a 64-character hex string (32 bytes)');
    }
    this.adapters = {
      anthropic: new AnthropicAdapter(),
      openai: new OpenAIAdapter(),
      mistral: new MistralAdapter(),
    };
  }

  async saveKey(
    orgId: string,
    provider: AIProvider,
    rawKey: string,
    model?: string | null,
  ): Promise<void> {
    if (model != null && !isValidModelForProvider(provider, model)) {
      throw new BadRequestException(`Unknown model "${model}" for provider "${provider}"`);
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, tag]).toString('base64');
    const ivBase64 = iv.toString('base64');

    const { error } = await this.supabase.service
      .from('organization_ai_settings')
      .upsert({
        organization_id: orgId,
        provider,
        api_key_enc: ciphertext,
        api_key_iv: ivBase64,
        model: model ?? null,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
  }

  async deleteKey(orgId: string): Promise<void> {
    await this.supabase.service
      .from('organization_ai_settings')
      .delete()
      .eq('organization_id', orgId);
  }

  async getProviderConfig(orgId: string): Promise<{
    provider: AIProvider;
    hasKey: true;
    model: string | null;
    monthlyBudgetEur: number | null;
    updatedAt: string;
  } | null> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('provider, model, monthly_budget_eur, updated_at')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!data) return null;
    const row = data as {
      provider: AIProvider;
      model: string | null;
      monthly_budget_eur: number | string | null;
      updated_at: string;
    };
    return {
      provider: row.provider,
      hasKey: true,
      model: row.model ?? null,
      monthlyBudgetEur: toNumberOrNull(row.monthly_budget_eur),
      updatedAt: row.updated_at,
    };
  }

  /** Update just the org's monthly AI budget (NULL = unlimited). Requires an existing key row. */
  async updateBudget(orgId: string, monthlyBudgetEur: number | null): Promise<void> {
    const { error } = await this.supabase.service
      .from('organization_ai_settings')
      .update({ monthly_budget_eur: monthlyBudgetEur })
      .eq('organization_id', orgId);
    if (error) throw new Error(error.message);
  }

  async generate(orgId: string, request: GenerationRequest): Promise<GenerationResult> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('provider, api_key_enc, api_key_iv, model')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!data) throw new NotFoundException('No AI provider configured for this organization');

    const row = data as {
      provider: AIProvider;
      api_key_enc: string;
      api_key_iv: string;
      model: string | null;
    };
    const rawKey = this.decrypt(row.api_key_enc, row.api_key_iv);
    const adapter = this.adapters[row.provider];
    // Resolve the model centrally: a concrete id in the request wins; otherwise
    // fall back to the org's stored model, then the provider's registry default.
    // This fixes callers that pass the `'default'` sentinel (organizer-ai-assistant,
    // tournament-query) — the SDK never sees an invalid model name.
    const requested = request.model && request.model !== 'default' ? request.model : row.model;
    const resolved = resolveModel(row.provider, requested);
    const result = await adapter.generate(rawKey, { ...request, model: resolved.id });
    // Surface the resolved model + provider so callers (AIUsageService) can log
    // them to ai_usage_log for the consumption dashboard.
    return { ...result, model: resolved.id, provider: row.provider };
  }

  private decrypt(ciphertext: string, ivBase64: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const encrypted = buf.subarray(0, buf.length - TAG_LENGTH);
    const tag = buf.subarray(buf.length - TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.secretKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
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
