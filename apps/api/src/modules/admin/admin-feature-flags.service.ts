import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  FEATURE_FLAG_REGISTRY,
  isKnownFlagKey,
  type KnownFeatureFlagKey,
  type MaintenanceBannerPayload,
  type MaintenanceBannerSeverity,
  type PublicFeatureFlagsSnapshot,
  type TimeSimulationPayload,
} from '@myclash/feature-flags';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpsertFeatureFlagDto } from './dto/admin-feature-flags.dto';

interface StoredFlag {
  key: string;
  description: string | null;
  enabled: boolean;
  payload_json: Record<string, unknown> | null;
  updated_at: string;
  updated_by_user_id: string | null;
}

export interface RegistryFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  payloadJson: Record<string, unknown> | null;
  updated_at: string | null;
}

const VALID_SEVERITIES: readonly MaintenanceBannerSeverity[] = ['info', 'warning', 'critical'];

function parseMaintenanceBannerPayload(
  raw: Record<string, unknown> | null | undefined,
): MaintenanceBannerPayload | null {
  if (!raw) return null;
  const message = typeof raw['message'] === 'string' ? (raw['message'] as string) : null;
  const severity = raw['severity'];
  if (!message || typeof severity !== 'string') return null;
  if (!VALID_SEVERITIES.includes(severity as MaintenanceBannerSeverity)) return null;
  return { message, severity: severity as MaintenanceBannerSeverity };
}

function parseTimeSimulationPayload(
  raw: Record<string, unknown> | null | undefined,
): TimeSimulationPayload | null {
  if (!raw) return null;
  const simulatedNowIso =
    typeof raw['simulatedNowIso'] === 'string' ? (raw['simulatedNowIso'] as string) : null;
  const anchorRealIso =
    typeof raw['anchorRealIso'] === 'string' ? (raw['anchorRealIso'] as string) : null;
  if (!simulatedNowIso || !anchorRealIso) return null;
  if (Number.isNaN(Date.parse(simulatedNowIso)) || Number.isNaN(Date.parse(anchorRealIso))) {
    return null;
  }
  return { simulatedNowIso, anchorRealIso };
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
      .select('key, description, enabled, payload_json, updated_at, updated_by_user_id');
    if (error) throw new BadRequestException(error.message);

    const stored = new Map<string, StoredFlag>();
    for (const row of (data ?? []) as StoredFlag[]) stored.set(row.key, row);

    return FEATURE_FLAG_REGISTRY.map((def) => {
      const row = stored.get(def.key);
      return {
        key: def.key,
        enabled: row?.enabled ?? def.default,
        description: row?.description ?? null,
        payloadJson: def.payload ? (row?.payload_json ?? null) : null,
        updated_at: row?.updated_at ?? null,
      };
    });
  }

  async upsertFlag(key: string, dto: UpsertFeatureFlagDto, actorUserId: string): Promise<void> {
    if (!isKnownFlagKey(key)) {
      throw new BadRequestException(`Unknown feature flag: ${key}`);
    }

    // Only flags with `payload` declared accept a payload_json. For any
    // other key we silently drop the payload so a bad client can't
    // smuggle structured data into a boolean flag row.
    const def = FEATURE_FLAG_REGISTRY.find((f) => f.key === key);
    let payload: Record<string, unknown> | null = null;
    if (def?.payload === 'maintenance_banner' && dto.payloadJson) {
      const parsed = parseMaintenanceBannerPayload(dto.payloadJson);
      if (!parsed) {
        throw new BadRequestException(
          'maintenance_banner payload must be { message: string, severity: info|warning|critical }',
        );
      }
      payload = { ...parsed };
    }
    if (def?.payload === 'time_simulation' && dto.payloadJson) {
      const parsed = parseTimeSimulationPayload(dto.payloadJson);
      if (!parsed) {
        throw new BadRequestException(
          'time_simulation payload must be { simulatedNowIso: ISO string, anchorRealIso: ISO string }',
        );
      }
      payload = { ...parsed };
    }

    const now = new Date().toISOString();
    const { error } = await this.supabase.service.from('feature_flags').upsert({
      key,
      description: dto.description ?? null,
      enabled: dto.enabled,
      payload_json: payload,
      updated_by_user_id: actorUserId,
      updated_at: now,
    });
    if (error) throw new BadRequestException(error.message);

    this.cache.delete(key);

    await this.writeAuditLog(actorUserId, 'feature_flag.upsert', 'feature_flag', key, {
      enabled: dto.enabled,
    });
  }

  /**
   * Shape returned by `GET /api/v1/public/feature-flags`. Reads only
   * the two FE-relevant flag rows in one query and never leaks other
   * keys (e.g. `read_only_mode`, `admin_lockdown`). Defaults to
   * "everything off" if the rows don't exist yet.
   */
  async getPublicFlagsSnapshot(): Promise<PublicFeatureFlagsSnapshot> {
    const empty: PublicFeatureFlagsSnapshot = {
      maintenanceBanner: { enabled: false, message: null, severity: null },
      realtimeDisabled: false,
      timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null },
    };

    try {
      const { data, error } = await this.supabase.service
        .from('feature_flags')
        .select('key, enabled, payload_json')
        .in('key', ['maintenance_banner', 'disable_realtime', 'time_simulation']);
      if (error) return empty;

      const rows = (data ?? []) as Array<{
        key: string;
        enabled: boolean;
        payload_json: Record<string, unknown> | null;
      }>;
      const banner = rows.find((r) => r.key === 'maintenance_banner');
      const realtime = rows.find((r) => r.key === 'disable_realtime');
      const timeSim = rows.find((r) => r.key === 'time_simulation');
      const payload = banner?.enabled ? parseMaintenanceBannerPayload(banner.payload_json) : null;
      const simPayload = timeSim?.enabled ? parseTimeSimulationPayload(timeSim.payload_json) : null;

      return {
        maintenanceBanner: {
          enabled: !!banner?.enabled,
          message: payload?.message ?? null,
          severity: payload?.severity ?? null,
        },
        realtimeDisabled: !!realtime?.enabled,
        timeSimulation: {
          enabled: !!timeSim?.enabled,
          simulatedNowIso: simPayload?.simulatedNowIso ?? null,
          anchorRealIso: simPayload?.anchorRealIso ?? null,
        },
      };
    } catch {
      return empty;
    }
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
