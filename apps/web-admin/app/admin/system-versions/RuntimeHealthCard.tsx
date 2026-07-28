'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

type MetricStatus = 'healthy' | 'warning' | 'critical' | 'unavailable';
type Translate = (key: string, params?: Record<string, string | number>) => string;

interface RuntimeHealth {
  checkedAt: string;
  overall: MetricStatus;
  database: {
    status: MetricStatus;
    connections?: { inUse: number; max: number; headroom: number };
    databaseSizeBytes?: number;
    longestQuerySeconds?: number;
    cacheHitRatio?: number;
    uptimeSeconds?: number;
    error?: string;
  };
  redis: {
    status: MetricStatus;
    usedMemoryBytes?: number;
    maxMemoryBytes?: number;
    keys?: number;
    connectedClients?: number;
    error?: string;
  };
  queues: { status: MetricStatus; totalWaiting?: number; totalFailed?: number; error?: string };
  disk: {
    status: MetricStatus;
    usePercent?: number;
    usedBytes?: number;
    availBytes?: number;
    error?: string;
  };
}

interface AlertSettings {
  enabled: boolean;
  recipientEmails: string[];
  emailLevel: 'warning' | 'critical';
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  connWarnPct: number;
  connCritPct: number;
  redisWarnPct: number;
  redisCritPct: number;
  diskWarnPct: number;
  diskCritPct: number;
  queueBacklogWarn: number;
  queueBacklogCrit: number;
  updatedAt: string | null;
}

function statusLabel(t: Translate, s: MetricStatus): string {
  switch (s) {
    case 'healthy':
      return t('admin.systemVersions.runtimeHealth.statuses.healthy');
    case 'warning':
      return t('admin.systemVersions.runtimeHealth.statuses.warning');
    case 'critical':
      return t('admin.systemVersions.runtimeHealth.statuses.critical');
    default:
      return t('admin.systemVersions.runtimeHealth.statuses.unavailable');
  }
}

function statusClasses(s: MetricStatus): string {
  switch (s) {
    case 'healthy':
      return 'bg-success/10 text-success';
    case 'critical':
      return 'bg-danger/10 text-danger';
    case 'unavailable':
      return 'bg-background text-muted';
    default:
      return 'bg-warning/10 text-warning';
  }
}

function StatusPill({ t, status }: { t: Translate; status: MetricStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(status)}`}
    >
      {statusLabel(t, status)}
    </span>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Formats a duration in seconds as a compact human string, e.g. "12d 4h" / "3h 20m" / "45m". */
function formatUptime(seconds: number | undefined): string {
  if (seconds == null) return '—';
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Formats an ISO timestamp as a locale-aware "medium date + short time" string. */
function formatCheckedAt(value: string, locale: AppLocale): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ts));
}

const API = getPublicApiUrl();

export function RuntimeHealthCard() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(
    ({ signal, refresh = false }: { signal?: AbortSignal; refresh?: boolean } = {}) => {
      if (refresh) setRefreshing(true);
      fetch(`${API}/api/v1/admin/system/runtime-health`, { credentials: 'include', signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(t('admin.systemVersions.runtimeHealth.loadError'));
          setHealth((await res.json()) as RuntimeHealth);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setError(
              err instanceof Error
                ? err.message
                : t('admin.systemVersions.runtimeHealth.loadError'),
            );
          }
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load({ signal: controller.signal }));
    fetch(`${API}/api/v1/admin/system/runtime-health/alert-settings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setSettings((await res.json()) as AlertSettings);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [load]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      // UpdateAlertSettingsDto is a .strict() Zod schema — the ZodValidationPipe
      // rejects unknown keys, so the read-only `updatedAt` must never be sent.
      const { updatedAt: _omit, ...body } = settings;
      const res = await fetch(`${API}/api/v1/admin/system/runtime-health/alert-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resBody = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(resBody?.message ?? `HTTP ${res.status}`);
      }
      setSettings((await res.json()) as AlertSettings);
      toast.success(t('admin.systemVersions.runtimeHealth.settings.saved'));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('admin.systemVersions.runtimeHealth.settings.saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-background flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('admin.systemVersions.runtimeHealth.title')}
            </h2>
            {health && <StatusPill t={t} status={health.overall} />}
          </div>
          <p className="text-muted text-xs mt-0.5">
            {t('admin.systemVersions.runtimeHealth.description')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
          >
            {t('admin.systemVersions.runtimeHealth.settings.title')}
          </button>
          <button
            type="button"
            onClick={() => load({ refresh: true })}
            disabled={loading || refreshing}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
          >
            {refreshing
              ? t('admin.systemVersions.runtimeHealth.rechecking')
              : t('admin.systemVersions.runtimeHealth.recheck')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border-b border-danger/30 text-danger px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="px-4 py-4 text-sm text-muted">{t('admin.systemVersions.loading')}</p>
      ) : health ? (
        <>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            <MetricTile
              t={t}
              status={health.database.status}
              title={t('admin.systemVersions.runtimeHealth.db.title')}
              rows={
                health.database.status === 'unavailable'
                  ? [
                      [
                        t('admin.systemVersions.runtimeHealth.unavailable'),
                        health.database.error ?? '—',
                      ],
                    ]
                  : [
                      [
                        t('admin.systemVersions.runtimeHealth.db.connections'),
                        `${health.database.connections?.inUse} / ${health.database.connections?.max}`,
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.db.size'),
                        formatBytes(health.database.databaseSizeBytes),
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.db.longestQuery'),
                        `${health.database.longestQuerySeconds ?? 0} s`,
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.db.cacheHit'),
                        `${((health.database.cacheHitRatio ?? 0) * 100).toFixed(1)} %`,
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.db.uptime'),
                        formatUptime(health.database.uptimeSeconds),
                      ],
                    ]
              }
            />
            <MetricTile
              t={t}
              status={health.redis.status}
              title={t('admin.systemVersions.runtimeHealth.redis.title')}
              rows={
                health.redis.status === 'unavailable'
                  ? [
                      [
                        t('admin.systemVersions.runtimeHealth.unavailable'),
                        health.redis.error ?? '—',
                      ],
                    ]
                  : [
                      [
                        t('admin.systemVersions.runtimeHealth.redis.memory'),
                        `${formatBytes(health.redis.usedMemoryBytes)} / ${formatBytes(health.redis.maxMemoryBytes)}`,
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.redis.keys'),
                        String(health.redis.keys ?? 0),
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.redis.clients'),
                        String(health.redis.connectedClients ?? 0),
                      ],
                    ]
              }
            />
            <MetricTile
              t={t}
              status={health.queues.status}
              title={t('admin.systemVersions.runtimeHealth.queues.title')}
              rows={
                health.queues.status === 'unavailable'
                  ? [
                      [
                        t('admin.systemVersions.runtimeHealth.unavailable'),
                        health.queues.error ?? '—',
                      ],
                    ]
                  : [
                      [
                        t('admin.systemVersions.runtimeHealth.queues.waiting'),
                        String(health.queues.totalWaiting ?? 0),
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.queues.failed'),
                        String(health.queues.totalFailed ?? 0),
                      ],
                    ]
              }
            />
            <MetricTile
              t={t}
              status={health.disk.status}
              title={t('admin.systemVersions.runtimeHealth.disk.title')}
              rows={
                health.disk.status === 'unavailable'
                  ? [
                      [
                        t('admin.systemVersions.runtimeHealth.unavailable'),
                        health.disk.error ?? '—',
                      ],
                    ]
                  : [
                      [
                        t('admin.systemVersions.runtimeHealth.disk.used'),
                        `${health.disk.usePercent ?? 0} %`,
                      ],
                      [
                        t('admin.systemVersions.runtimeHealth.disk.free'),
                        formatBytes(health.disk.availBytes),
                      ],
                    ]
              }
            />
          </div>
          <div className="px-4 py-2 text-xs text-muted border-t border-border">
            {t('admin.systemVersions.runtimeHealth.checkedAt')}:{' '}
            {formatCheckedAt(health.checkedAt, locale)}
          </div>
        </>
      ) : null}

      {showSettings && settings && (
        <SettingsForm
          t={t}
          settings={settings}
          setSettings={setSettings}
          saving={saving}
          onSave={() => void saveSettings()}
        />
      )}
    </section>
  );
}

function MetricTile({
  t,
  title,
  status,
  rows,
}: {
  t: Translate;
  title: string;
  status: MetricStatus;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <StatusPill t={t} status={status} />
      </div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between text-xs">
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono text-foreground-secondary">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SettingsForm({
  t,
  settings,
  setSettings,
  saving,
  onSave,
}: {
  t: Translate;
  settings: AlertSettings;
  setSettings: (s: AlertSettings) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const inputClass =
    'rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground w-full';
  const num = (key: keyof AlertSettings) => (
    <input
      type="number"
      className={inputClass}
      value={settings[key] as number}
      onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
    />
  );
  return (
    <div className="border-t border-border p-4 space-y-3 bg-background">
      <label className="flex items-center gap-2 text-sm text-foreground-secondary">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
        />
        {t('admin.systemVersions.runtimeHealth.settings.enabled')}
      </label>

      <div>
        <span className="block text-xs text-muted mb-1">
          {t('admin.systemVersions.runtimeHealth.settings.recipients')}
        </span>
        <input
          type="text"
          className={inputClass}
          value={settings.recipientEmails.join(', ')}
          onChange={(e) =>
            setSettings({
              ...settings,
              recipientEmails: e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <div>
        <span className="block text-xs text-muted mb-1">
          {t('admin.systemVersions.runtimeHealth.settings.emailLevel')}
        </span>
        <select
          className={inputClass}
          value={settings.emailLevel}
          onChange={(e) =>
            setSettings({ ...settings, emailLevel: e.target.value as 'warning' | 'critical' })
          }
        >
          <option value="warning">
            {t('admin.systemVersions.runtimeHealth.settings.levelWarning')}
          </option>
          <option value="critical">
            {t('admin.systemVersions.runtimeHealth.settings.levelCritical')}
          </option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted">
          {t('admin.systemVersions.runtimeHealth.settings.checkInterval')}
          {num('checkIntervalMinutes')}
        </label>
        <label className="text-xs text-muted">
          {t('admin.systemVersions.runtimeHealth.settings.cooldown')}
          {num('cooldownMinutes')}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.connThresholds')}
          </span>
          <div className="flex gap-2">
            {num('connWarnPct')}
            {num('connCritPct')}
          </div>
        </div>
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.redisThresholds')}
          </span>
          <div className="flex gap-2">
            {num('redisWarnPct')}
            {num('redisCritPct')}
          </div>
        </div>
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.diskThresholds')}
          </span>
          <div className="flex gap-2">
            {num('diskWarnPct')}
            {num('diskCritPct')}
          </div>
        </div>
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.queueThresholds')}
          </span>
          <div className="flex gap-2">
            {num('queueBacklogWarn')}
            {num('queueBacklogCrit')}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t('admin.systemVersions.runtimeHealth.settings.save')}
      </button>
    </div>
  );
}
