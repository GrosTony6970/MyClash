import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { DEFAULT_ALERT_SETTINGS, type RuntimeHealthAlertSettings } from './dto/runtime-health.dto';

const SETTING_KEY = 'default';

interface SettingsRow {
  enabled: boolean | null;
  recipient_emails: string[] | null;
  email_level: 'warning' | 'critical' | null;
  check_interval_minutes: number | null;
  cooldown_minutes: number | null;
  conn_warn_pct: number | null;
  conn_crit_pct: number | null;
  redis_warn_pct: number | null;
  redis_crit_pct: number | null;
  disk_warn_pct: number | null;
  disk_crit_pct: number | null;
  queue_backlog_warn: number | null;
  queue_backlog_crit: number | null;
  updated_at: string | null;
}

@Injectable()
export class RuntimeHealthAlertSettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getSettings(): Promise<RuntimeHealthAlertSettings> {
    const { data } = await this.supabase.service
      .from('runtime_health_alert_settings')
      .select(
        'enabled, recipient_emails, email_level, check_interval_minutes, cooldown_minutes, ' +
          'conn_warn_pct, conn_crit_pct, redis_warn_pct, redis_crit_pct, disk_warn_pct, ' +
          'disk_crit_pct, queue_backlog_warn, queue_backlog_crit, updated_at',
      )
      .eq('setting_key', SETTING_KEY)
      .maybeSingle();
    return mergeRow(data as SettingsRow | null);
  }

  async updateSettings(
    patch: Partial<RuntimeHealthAlertSettings>,
    actorUserId: string | null,
  ): Promise<RuntimeHealthAlertSettings> {
    const current = await this.getSettings();
    const merged: RuntimeHealthAlertSettings = { ...current, ...patch };
    assertThresholdOrder(merged);

    const { error } = await this.supabase.service.from('runtime_health_alert_settings').upsert(
      {
        setting_key: SETTING_KEY,
        enabled: merged.enabled,
        recipient_emails: merged.recipientEmails,
        email_level: merged.emailLevel,
        check_interval_minutes: merged.checkIntervalMinutes,
        cooldown_minutes: merged.cooldownMinutes,
        conn_warn_pct: merged.connWarnPct,
        conn_crit_pct: merged.connCritPct,
        redis_warn_pct: merged.redisWarnPct,
        redis_crit_pct: merged.redisCritPct,
        disk_warn_pct: merged.diskWarnPct,
        disk_crit_pct: merged.diskCritPct,
        queue_backlog_warn: merged.queueBacklogWarn,
        queue_backlog_crit: merged.queueBacklogCrit,
        updated_at: new Date().toISOString(),
        updated_by: actorUserId,
      },
      { onConflict: 'setting_key' },
    );
    if (error) throw new Error(error.message);
    return this.getSettings();
  }
}

function mergeRow(row: SettingsRow | null): RuntimeHealthAlertSettings {
  if (!row) return { ...DEFAULT_ALERT_SETTINGS };
  const d = DEFAULT_ALERT_SETTINGS;
  return {
    enabled: row.enabled ?? d.enabled,
    recipientEmails: row.recipient_emails ?? d.recipientEmails,
    emailLevel: row.email_level ?? d.emailLevel,
    checkIntervalMinutes: row.check_interval_minutes ?? d.checkIntervalMinutes,
    cooldownMinutes: row.cooldown_minutes ?? d.cooldownMinutes,
    connWarnPct: row.conn_warn_pct ?? d.connWarnPct,
    connCritPct: row.conn_crit_pct ?? d.connCritPct,
    redisWarnPct: row.redis_warn_pct ?? d.redisWarnPct,
    redisCritPct: row.redis_crit_pct ?? d.redisCritPct,
    diskWarnPct: row.disk_warn_pct ?? d.diskWarnPct,
    diskCritPct: row.disk_crit_pct ?? d.diskCritPct,
    queueBacklogWarn: row.queue_backlog_warn ?? d.queueBacklogWarn,
    queueBacklogCrit: row.queue_backlog_crit ?? d.queueBacklogCrit,
    updatedAt: row.updated_at ?? d.updatedAt,
  };
}

function assertThresholdOrder(s: RuntimeHealthAlertSettings): void {
  const pairs: Array<[number, number, string]> = [
    [s.connWarnPct, s.connCritPct, 'connection'],
    [s.redisWarnPct, s.redisCritPct, 'redis'],
    [s.diskWarnPct, s.diskCritPct, 'disk'],
    [s.queueBacklogWarn, s.queueBacklogCrit, 'queue backlog'],
  ];
  for (const [warn, crit, label] of pairs) {
    if (warn >= crit) {
      throw new BadRequestException(
        `${label} warning threshold must be below the critical threshold`,
      );
    }
  }
}
