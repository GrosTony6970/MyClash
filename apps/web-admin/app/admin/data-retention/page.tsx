'use client';

/**
 * Data retention — super-admin control over how long personal telemetry is kept.
 *
 * Storage limitation (GDPR Art. 5(1)(e)). Every horizon is in days and 0 always
 * means "keep forever", which is why the audit log ships at 0: it is a
 * governance record as much as personal data, and sweeping it would destroy
 * history about people who never asked for erasure.
 *
 * Competition results have no horizon here at all — they are a public record and
 * the worker has no code path that touches them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPageHeader, Button } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

interface RetentionSettings {
  enabled: boolean;
  guestSessionDays: number;
  aiUsageLogDays: number;
  broadcastRecipientDays: number;
  auditLogDays: number;
  lastRunAt: string | null;
  lastRunRemoved: Record<string, number>;
}

type HorizonKey = 'guestSessionDays' | 'aiUsageLogDays' | 'broadcastRecipientDays' | 'auditLogDays';

const HORIZONS: { key: HorizonKey; labelKey: string; hintKey: string }[] = [
  {
    key: 'guestSessionDays',
    labelKey: 'admin.dataRetention.guestSessions',
    hintKey: 'admin.dataRetention.guestSessionsHint',
  },
  {
    key: 'aiUsageLogDays',
    labelKey: 'admin.dataRetention.aiUsage',
    hintKey: 'admin.dataRetention.aiUsageHint',
  },
  {
    key: 'broadcastRecipientDays',
    labelKey: 'admin.dataRetention.broadcasts',
    hintKey: 'admin.dataRetention.broadcastsHint',
  },
  {
    key: 'auditLogDays',
    labelKey: 'admin.dataRetention.auditLog',
    hintKey: 'admin.dataRetention.auditLogHint',
  },
];

export default function DataRetentionPage() {
  const { t } = useI18n();
  const { settings, error, busy, sweeping, save, runNow } = useRetentionSettings(t);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t('admin.dataRetention.title')}
        subtitle={t('admin.dataRetention.subtitle')}
      />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {settings && (
        <>
          <EnabledSection settings={settings} busy={busy} t={t} onSave={save} />
          <HorizonsSection settings={settings} busy={busy} t={t} onSave={save} />
          <LastRunSection settings={settings} sweeping={sweeping} t={t} onRun={runNow} />
        </>
      )}
    </div>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;
type SaveFn = (patch: Partial<RetentionSettings>) => Promise<void>;

/** Load, patch and re-run the policy. Split out to keep the page a layout. */
function useRetentionSettings(t: Translate) {
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const endpoint = `${apiUrl}/api/v1/admin/data-retention`;

  useEffect(() => {
    const controller = new AbortController();
    // setState stays inside the promise callbacks rather than the effect body —
    // satisfies react-hooks/set-state-in-effect.
    loadSettings(endpoint, controller.signal)
      .then(setSettings)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(t('admin.dataRetention.loadError'));
      });
    return () => controller.abort();
  }, [endpoint, t]);

  const save = useCallback<SaveFn>(
    async (patch) => {
      setBusy(true);
      setError(null);
      try {
        setSettings(await patchSettings(endpoint, patch));
      } catch {
        setError(t('admin.dataRetention.saveError'));
      } finally {
        setBusy(false);
      }
    },
    [endpoint, t],
  );

  const runNow = useCallback(async () => {
    setSweeping(true);
    setError(null);
    try {
      setSettings(await runSweep(endpoint));
    } catch {
      setError(t('admin.dataRetention.runError'));
    } finally {
      setSweeping(false);
    }
  }, [endpoint, t]);

  return { settings, error, busy, sweeping, save, runNow };
}

async function loadSettings(endpoint: string, signal: AbortSignal): Promise<RetentionSettings> {
  const res = await fetch(endpoint, { credentials: 'include', signal });
  if (!res.ok) throw new Error('load');
  return (await res.json()) as RetentionSettings;
}

async function patchSettings(
  endpoint: string,
  patch: Partial<RetentionSettings>,
): Promise<RetentionSettings> {
  const res = await fetch(endpoint, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('save');
  return (await res.json()) as RetentionSettings;
}

async function runSweep(endpoint: string): Promise<RetentionSettings> {
  const res = await fetch(`${endpoint}/run`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error('run');
  // Re-read rather than trusting the run response: the settings row also
  // carries lastRunAt / lastRunRemoved, which the sweep just wrote.
  const reload = await fetch(endpoint, { credentials: 'include' });
  if (!reload.ok) throw new Error('reload');
  return (await reload.json()) as RetentionSettings;
}

function EnabledSection({
  settings,
  busy,
  t,
  onSave,
}: {
  settings: RetentionSettings;
  busy: boolean;
  t: Translate;
  onSave: SaveFn;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(e) => void onSave({ enabled: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm font-semibold text-foreground">
          {t('admin.dataRetention.enabled')}
        </span>
      </label>
      <p className="mt-2 text-sm text-muted">{t('admin.dataRetention.enabledHint')}</p>
    </section>
  );
}

function HorizonsSection({
  settings,
  busy,
  t,
  onSave,
}: {
  settings: RetentionSettings;
  busy: boolean;
  t: Translate;
  onSave: SaveFn;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg text-foreground">
        {t('admin.dataRetention.horizonsTitle')}
      </h2>
      <p className="mt-2 text-sm text-muted">{t('admin.dataRetention.horizonsHint')}</p>

      <div className="mt-4 flex flex-col gap-4">
        {HORIZONS.map((horizon) => (
          <HorizonField
            key={horizon.key}
            label={t(horizon.labelKey)}
            hint={t(horizon.hintKey)}
            value={settings[horizon.key]}
            disabled={busy}
            keepForeverLabel={t('admin.dataRetention.keepForever')}
            onCommit={(value) => void onSave({ [horizon.key]: value })}
          />
        ))}
      </div>
    </section>
  );
}

function LastRunSection({
  settings,
  sweeping,
  t,
  onRun,
}: {
  settings: RetentionSettings;
  sweeping: boolean;
  t: Translate;
  onRun: () => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg text-foreground">
        {t('admin.dataRetention.lastRunTitle')}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {settings.lastRunAt
          ? t('admin.dataRetention.lastRunAt', { at: settings.lastRunAt })
          : t('admin.dataRetention.lastRunNever')}
      </p>

      {Object.keys(settings.lastRunRemoved).length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {Object.entries(settings.lastRunRemoved).map(([table, count]) => (
            <li key={table} className="text-sm text-muted">
              <span className="font-mono text-foreground">{table}</span>
              {': '}
              {count}
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        onClick={() => void onRun()}
        disabled={sweeping || !settings.enabled}
        className="mt-4"
      >
        {sweeping ? t('admin.dataRetention.running') : t('admin.dataRetention.runNow')}
      </Button>
    </section>
  );
}

/**
 * A horizon is committed on blur rather than on every keystroke: typing "90"
 * passes through "9", and saving that would sweep three months of data.
 */
function HorizonField({
  label,
  hint,
  value,
  disabled,
  keepForeverLabel,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  keepForeverLabel: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={0}
          max={10000}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const parsed = Number.parseInt(draft, 10);
            const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : value;
            setDraft(String(next));
            if (next !== value) onCommit(next);
          }}
          className="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        {value === 0 && (
          <span className="text-sm font-semibold text-muted">{keepForeverLabel}</span>
        )}
      </div>
      <span className="text-sm text-muted">{hint}</span>
    </label>
  );
}
