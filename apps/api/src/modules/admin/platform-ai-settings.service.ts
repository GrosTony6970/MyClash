import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AnthropicAdapter } from '../ai-providers/adapters/anthropic.adapter';
import { MistralAdapter } from '../ai-providers/adapters/mistral.adapter';
import { OpenAIAdapter } from '../ai-providers/adapters/openai.adapter';
import type {
  AIProvider,
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
} from '../ai-providers/adapters/provider-adapter.interface';
import { SupabaseService } from '../supabase/supabase.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SETTING_KEY = 'super_admin';

export type PlatformAIProviderConfig = {
  provider: AIProvider;
  hasKey: true;
  updatedAt: string;
};

@Injectable()
export class PlatformAISettingsService implements OnModuleInit {
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
    provider: AIProvider,
    rawKey: string,
    actorUserId: string,
  ): Promise<PlatformAIProviderConfig> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const now = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('platform_ai_settings')
      .upsert(
        {
          setting_key: SETTING_KEY,
          provider,
          api_key_enc: Buffer.concat([encrypted, tag]).toString('base64'),
          api_key_iv: iv.toString('base64'),
          updated_at: now,
          updated_by_user_id: actorUserId,
        },
        { onConflict: 'setting_key' },
      )
      .select('provider, updated_at, updated_by_user_id')
      .single();

    if (error) throw new Error(error.message);
    const row = data as PlatformAISettingsRow;
    return this.toConfig(row);
  }

  async deleteKey(): Promise<void> {
    await this.supabase.service
      .from('platform_ai_settings')
      .delete()
      .eq('setting_key', SETTING_KEY);
  }

  async getProviderConfig(): Promise<PlatformAIProviderConfig | null> {
    const { data } = await this.supabase.service
      .from('platform_ai_settings')
      .select('provider, updated_at, updated_by_user_id')
      .eq('setting_key', SETTING_KEY)
      .maybeSingle();

    if (!data) return null;
    return this.toConfig(data as PlatformAISettingsRow);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const { data } = await this.supabase.service
      .from('platform_ai_settings')
      .select('provider, api_key_enc, api_key_iv')
      .eq('setting_key', SETTING_KEY)
      .maybeSingle();

    if (!data) throw new NotFoundException('No super admin AI provider configured');
    const row = data as PlatformAISecretRow;
    const adapter = this.adapters[row.provider];
    return adapter.generate(this.decrypt(row.api_key_enc, row.api_key_iv), request);
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

  private toConfig(row: PlatformAISettingsRow): PlatformAIProviderConfig {
    return {
      provider: row.provider,
      hasKey: true,
      updatedAt: row.updated_at,
    };
  }
}

type PlatformAISettingsRow = {
  provider: AIProvider;
  updated_at: string;
  updated_by_user_id?: string | null;
};

type PlatformAISecretRow = {
  provider: AIProvider;
  api_key_enc: string;
  api_key_iv: string;
};
