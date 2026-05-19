import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  FEATURE_FLAG_REGISTRY,
  isKnownFlagKey,
  type KnownFeatureFlagKey,
} from '@myclash/feature-flags';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpsertFeatureFlagDto } from './dto/admin-feature-flags.dto';

interface StoredFlag {
  key: string;
  description: string | null;
  enabled: boolean;
  updated_at: string;
  updated_by_user_id: string | null;
}

export interface RegistryFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  updated_at: string | null;
}

const FLAG_CACHE_TTL_MS = 5_000;

@Injectable()
export class AdminFeatureFlagsService {
  private readonly logger = new Logger(AdminFeatureFlagsService.name);
  private readonly cache = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(private readonly supabase: SupabaseService) {}

  async listFlagsWithRegistry(): Promise<RegistryFlag[]> {
    const { data, error } = await this.supabase.service
      .from('feature_flags')
      .select('key, description, enabled, updated_at, updated_by_user_id');
    if (error) throw new BadRequestException(error.message);

    const stored = new Map<string, StoredFlag>();
    for (const row of (data ?? []) as StoredFlag[]) stored.set(row.key, row);

    return FEATURE_FLAG_REGISTRY.map((def) => {
      const row = stored.get(def.key);
      return {
        key: def.key,
        enabled: row?.enabled ?? def.default,
        description: row?.description ?? null,
        updated_at: row?.updated_at ?? null,
      };
    });
  }

  async upsertFlag(key: string, dto: UpsertFeatureFlagDto, actorUserId: string): Promise<void> {
    if (!isKnownFlagKey(key)) {
      throw new BadRequestException(`Unknown feature flag: ${key}`);
    }

    const now = new Date().toISOString();
    const { error } = await this.supabase.service.from('feature_flags').upsert({
      key,
      description: dto.description ?? null,
      enabled: dto.enabled,
      payload_json: null,
      updated_by_user_id: actorUserId,
      updated_at: now,
    });
    if (error) throw new BadRequestException(error.message);

    this.cache.delete(key);

    await this.writeAuditLog(actorUserId, 'feature_flag.upsert', 'feature_flag', key, {
      enabled: dto.enabled,
    });
  }

  async isEnabled(key: KnownFeatureFlagKey): Promise<boolean> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const def = FEATURE_FLAG_REGISTRY.find((f) => f.key === key);
    const fallback = def?.default ?? false;

    try {
      const { data, error } = await this.supabase.service
        .from('feature_flags')
        .select('enabled')
        .eq('key', key)
        .maybeSingle();
      if (error) {
        this.cache.set(key, { value: fallback, expiresAt: now + FLAG_CACHE_TTL_MS });
        return fallback;
      }
      const value = (data as { enabled?: boolean } | null)?.enabled ?? fallback;
      this.cache.set(key, { value, expiresAt: now + FLAG_CACHE_TTL_MS });
      return value;
    } catch {
      this.cache.set(key, { value: fallback, expiresAt: now + FLAG_CACHE_TTL_MS });
      return fallback;
    }
  }

  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(`Could not write audit log for ${action} on ${entityType}:${entityId}`);
    }
  }
}
