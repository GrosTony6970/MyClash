import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
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

  async saveKey(orgId: string, provider: AIProvider, rawKey: string): Promise<void> {
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

  async getProviderConfig(
    orgId: string,
  ): Promise<{ provider: AIProvider; hasKey: true; updatedAt: string } | null> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('provider, updated_at')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!data) return null;
    const row = data as { provider: AIProvider; updated_at: string };
    return { provider: row.provider, hasKey: true, updatedAt: row.updated_at };
  }

  async generate(orgId: string, request: GenerationRequest): Promise<GenerationResult> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('provider, api_key_enc, api_key_iv')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!data) throw new NotFoundException('No AI provider configured for this organization');

    const row = data as { provider: AIProvider; api_key_enc: string; api_key_iv: string };
    const rawKey = this.decrypt(row.api_key_enc, row.api_key_iv);
    const adapter = this.adapters[row.provider];
    return adapter.generate(rawKey, request);
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
