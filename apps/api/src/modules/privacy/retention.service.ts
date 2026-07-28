/**
 * retention.service.ts — scheduled ageing-out of personal telemetry.
 *
 * Storage limitation (GDPR Art. 5(1)(e)): personal data must not be kept longer
 * than necessary. Device telemetry, expired credentials and AI call logs have a
 * useful life measured in months; competition results do not age out at all and
 * are absent from this file entirely.
 *
 * Horizons are operator-editable and 0 always means "keep forever".
 */

import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface RetentionSettings {
  enabled: boolean;
  guestSessionDays: number;
  aiUsageLogDays: number;
  broadcastRecipientDays: number;
  auditLogDays: number;
  lastRunAt: string | null;
  lastRunRemoved: Record<string, number>;
}

type HorizonKey = keyof Pick<
  RetentionSettings,
  'guestSessionDays' | 'aiUsageLogDays' | 'broadcastRecipientDays' | 'auditLogDays'
>;

interface SweepSpec {
  table: string;
  /**
   * Timestamp driving the cutoff. NOT uniform across the schema — `ai_usage_log`
   * uses `called_at` while its siblings use `created_at`, and a wrong column name
   * makes PostgREST 400 the whole query, which reads as "nothing to delete".
   */
  column: string;
  horizon: HorizonKey;
}

const SWEEPS: readonly SweepSpec[] = [
  // Device telemetry: ip_first_seen + user_agent live here.
  { table: 'guest_sessions', column: 'expires_at', horizon: 'guestSessionDays' },
  { table: 'ai_usage_log', column: 'called_at', horizon: 'aiUsageLogDays' },
  { table: 'platform_ai_usage_log', column: 'created_at', horizon: 'aiUsageLogDays' },
  { table: 'fighter_ai_usage_log', column: 'created_at', horizon: 'aiUsageLogDays' },
  {
    table: 'event_broadcast_recipients',
    column: 'created_at',
    horizon: 'broadcastRecipientDays',
  },
  // Defaults to 0 (keep forever). The audit log is a governance record as much
  // as personal data; PII inside it is handled by redaction-on-erasure rather
  // than by deleting rows about people who never asked for erasure.
  { table: 'audit_log', column: 'created_at', horizon: 'auditLogDays' },
];

const DEFAULTS: RetentionSettings = {
  enabled: true,
  guestSessionDays: 90,
  aiUsageLogDays: 365,
  broadcastRecipientDays: 365,
  auditLogDays: 0,
  lastRunAt: null,
  lastRunRemoved: {},
};

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getSettings(): Promise<RetentionSettings> {
    const { data, error } = await this.supabase.service
      .from('data_retention_settings')
      .select('*')
      .eq('setting_key', 'default')
      .maybeSingle();
    if (error) throw new Error(`retention settings: ${error.message}`);
    if (!data) return DEFAULTS;
    const row = data as Record<string, unknown>;
    return {
      enabled: Boolean(row['enabled']),
      guestSessionDays: Number(row['guest_session_days'] ?? DEFAULTS.guestSessionDays),
      aiUsageLogDays: Number(row['ai_usage_log_days'] ?? DEFAULTS.aiUsageLogDays),
      broadcastRecipientDays: Number(
        row['broadcast_recipient_days'] ?? DEFAULTS.broadcastRecipientDays,
      ),
      auditLogDays: Number(row['audit_log_days'] ?? DEFAULTS.auditLogDays),
      lastRunAt: (row['last_run_at'] as string | null) ?? null,
      lastRunRemoved: (row['last_run_removed'] as Record<string, number>) ?? {},
    };
  }

  async updateSettings(
    patch: Partial<Omit<RetentionSettings, 'lastRunAt' | 'lastRunRemoved'>>,
    actorUserId: string,
  ): Promise<RetentionSettings> {
    const row: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: actorUserId,
    };
    if (patch.enabled !== undefined) row['enabled'] = patch.enabled;
    if (patch.guestSessionDays !== undefined) row['guest_session_days'] = patch.guestSessionDays;
    if (patch.aiUsageLogDays !== undefined) row['ai_usage_log_days'] = patch.aiUsageLogDays;
    if (patch.broadcastRecipientDays !== undefined) {
      row['broadcast_recipient_days'] = patch.broadcastRecipientDays;
    }
    if (patch.auditLogDays !== undefined) row['audit_log_days'] = patch.auditLogDays;

    const { error } = await this.supabase.service
      .from('data_retention_settings')
      .update(row)
      .eq('setting_key', 'default');
    if (error) throw new Error(`retention settings update: ${error.message}`);
    return this.getSettings();
  }

  /**
   * Delete everything past its horizon. Returns per-table removal counts.
   *
   * Expired claim tokens are swept unconditionally: they are single-use
   * credentials with no value once expired, so they have no configurable
   * horizon to get wrong.
   */
  async runSweep(): Promise<Record<string, number>> {
    const settings = await this.getSettings();
    const removed: Record<string, number> = {};
    if (!settings.enabled) {
      this.logger.log('retention sweep disabled by settings');
      return removed;
    }

    for (const sweep of SWEEPS) {
      const days = settings[sweep.horizon];
      if (days <= 0) continue; // 0 = keep forever
      removed[sweep.table] = await this.deleteOlderThan(sweep.table, sweep.column, days);
    }

    removed['global_person_claim_tokens'] = await this.deleteOlderThan(
      'global_person_claim_tokens',
      'expires_at',
      0,
    );

    await this.supabase.service
      .from('data_retention_settings')
      .update({ last_run_at: new Date().toISOString(), last_run_removed: removed })
      .eq('setting_key', 'default');

    this.logger.log(`retention sweep removed ${JSON.stringify(removed)}`);
    return removed;
  }

  private async deleteOlderThan(table: string, column: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase.service
      .from(table)
      .delete()
      .lt(column, cutoff)
      .select('id');
    if (error) {
      // Surfaced, never swallowed: an unknown column 400s the query and would
      // otherwise look exactly like "nothing was old enough to delete".
      this.logger.error(`retention sweep ${table}.${column}: ${error.message}`);
      return 0;
    }
    return (data ?? []).length;
  }
}

export const __testing = { SWEEPS, DEFAULTS };
