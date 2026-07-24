import { describe, it, expect } from 'vitest';
import { updateAlertSettingsSchema, DEFAULT_ALERT_SETTINGS } from './runtime-health.dto';

describe('updateAlertSettingsSchema', () => {
  it('accepts a valid partial update', () => {
    const parsed = updateAlertSettingsSchema.parse({ connWarnPct: 60, connCritPct: 85 });
    expect(parsed.connWarnPct).toBe(60);
  });

  it('rejects warn >= crit for a metric', () => {
    expect(() => updateAlertSettingsSchema.parse({ connWarnPct: 95, connCritPct: 90 })).toThrow();
  });

  it('rejects a malformed recipient email', () => {
    expect(() => updateAlertSettingsSchema.parse({ recipientEmails: ['not-an-email'] })).toThrow();
  });

  it('rejects an out-of-range interval', () => {
    expect(() => updateAlertSettingsSchema.parse({ checkIntervalMinutes: 0 })).toThrow();
  });

  it('exposes sane defaults', () => {
    expect(DEFAULT_ALERT_SETTINGS.emailLevel).toBe('critical');
    expect(DEFAULT_ALERT_SETTINGS.checkIntervalMinutes).toBe(15);
  });
});
