import { describe, it, expect, vi } from 'vitest';
import { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';

function mockSupabase(row: Record<string, unknown> | null) {
  const upsert = vi.fn(async () => ({ error: null }));
  const supabase = {
    service: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
        upsert,
      }),
    },
  } as never;
  return { supabase, upsert };
}

describe('RuntimeHealthAlertSettingsService', () => {
  it('returns defaults merged with the stored row', async () => {
    const { supabase } = mockSupabase({
      enabled: true,
      recipient_emails: ['ops@myclash.fr'],
      email_level: 'critical',
      check_interval_minutes: 30,
      cooldown_minutes: 360,
      conn_warn_pct: 70,
      conn_crit_pct: 90,
      redis_warn_pct: 75,
      redis_crit_pct: 90,
      disk_warn_pct: 80,
      disk_crit_pct: 90,
      queue_backlog_warn: 500,
      queue_backlog_crit: 2000,
      updated_at: '2026-07-24T00:00:00Z',
    });
    const svc = new RuntimeHealthAlertSettingsService(supabase);
    const settings = await svc.getSettings();
    expect(settings.recipientEmails).toEqual(['ops@myclash.fr']);
    expect(settings.checkIntervalMinutes).toBe(30);
  });

  it('rejects an update that inverts a threshold pair', async () => {
    const { supabase } = mockSupabase({ conn_warn_pct: 70, conn_crit_pct: 90 });
    const svc = new RuntimeHealthAlertSettingsService(supabase);
    await expect(svc.updateSettings({ connWarnPct: 95 }, null)).rejects.toThrow();
  });

  it('upserts merged settings', async () => {
    const { supabase, upsert } = mockSupabase({ conn_warn_pct: 70, conn_crit_pct: 90 });
    const svc = new RuntimeHealthAlertSettingsService(supabase);
    await svc.updateSettings({ checkIntervalMinutes: 5 }, null);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ setting_key: 'default', check_interval_minutes: 5 }),
      { onConflict: 'setting_key' },
    );
  });
});
