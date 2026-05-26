'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FEATURE_FLAG_REGISTRY,
  type FeatureFlagDefinition,
  type FeatureFlagGroup,
  type MaintenanceBannerSeverity,
} from '@myclash/feature-flags';
import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface FlagRow {
  key: string;
  enabled: boolean;
  description: string | null;
  payloadJson: Record<string, unknown> | null;
  updated_at: string | null;
}

const GROUP_ORDER: FeatureFlagGroup[] = ['incident', 'delivery', 'reliability'];

function bannerPayload(raw: Record<string, unknown> | null | undefined): {
  message: string;
  severity: MaintenanceBannerSeverity;
} {
  if (!raw) return { message: '', severity: 'info' };
  const message = typeof raw['message'] === 'string' ? (raw['message'] as string) : '';
  const severity = raw['severity'];
  const safeSeverity: MaintenanceBannerSeverity =
    severity === 'warning' || severity === 'critical' ? severity : 'info';
  return { message, severity: safeSeverity };
}

export default function AdminFeatureFlagsPage() {
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [rows, setRows] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/admin/feature-flags`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.featureFlags.loadError'));
        return (await res.json()) as FlagRow[];
      })
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('admin.featureFlags.loadError'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiUrl, refreshKey, t]);

  async function saveFlag(
    key: string,
    body: { enabled: boolean; payloadJson?: Record<string, unknown> | null },
  ) {
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/feature-flags/${encodeURIComponent(key)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(t('admin.featureFlags.toggleFailed'));
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.featureFlags.toggleFailed'));
    } finally {
      setBusyKey(null);
    }
  }

  const grouped = useMemo(() => {
    const out: Record<FeatureFlagGroup | 'ungrouped', FeatureFlagDefinition[]> = {
      incident: [],
      delivery: [],
      reliability: [],
      ungrouped: [],
    };
    for (const def of FEATURE_FLAG_REGISTRY) {
      const bucket = def.group ?? 'ungrouped';
      out[bucket].push(def);
    }
    return out;
  }, []);

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Flags"
        title={t('admin.featureFlags.title')}
        subtitle={t('admin.featureFlags.description')}
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">{t('admin.featureFlags.loading')}</p>
      ) : (
        <div className="space-y-6">
          {GROUP_ORDER.map((group) => {
            const defs = grouped[group];
            if (!defs.length) return null;
            return (
              <section key={group}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t(`admin.featureFlags.groups.${group}`)}
                </h2>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <ul className="divide-y divide-slate-100">
                    {defs.map((def) => (
                      <FlagItem
                        key={def.key}
                        def={def}
                        row={rows.find((r) => r.key === def.key) ?? null}
                        busy={busyKey === def.key}
                        onSave={saveFlag}
                        t={t}
                      />
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
          {grouped.ungrouped.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <ul className="divide-y divide-slate-100">
                {grouped.ungrouped.map((def) => (
                  <FlagItem
                    key={def.key}
                    def={def}
                    row={rows.find((r) => r.key === def.key) ?? null}
                    busy={busyKey === def.key}
                    onSave={saveFlag}
                    t={t}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

interface FlagItemProps {
  def: FeatureFlagDefinition;
  row: FlagRow | null;
  busy: boolean;
  onSave: (
    key: string,
    body: { enabled: boolean; payloadJson?: Record<string, unknown> | null },
  ) => void | Promise<void>;
  t: (key: string, vars?: Record<string, string>) => string;
}

function FlagItem({ def, row, busy, onSave, t }: FlagItemProps) {
  const enabled = row?.enabled ?? def.default;
  const hasBannerPayload = def.payload === 'maintenance_banner';
  const initialPayload = bannerPayload(row?.payloadJson ?? null);
  const [message, setMessage] = useState(initialPayload.message);
  const [severity, setSeverity] = useState<MaintenanceBannerSeverity>(initialPayload.severity);

  // Resync local payload state when the row refreshes from the server
  // (e.g. another admin edited it). Without this, the local edits
  // could mask a server-side change after we refetch.
  useEffect(() => {
    const next = bannerPayload(row?.payloadJson ?? null);
    setMessage(next.message);
    setSeverity(next.severity);
  }, [row?.payloadJson]);

  const dirty =
    hasBannerPayload &&
    (message !== initialPayload.message || severity !== initialPayload.severity);

  return (
    <li className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">{t(def.labelKey)}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{t(def.descriptionKey)}</p>
          {row?.updated_at && (
            <p className="mt-1 text-xs text-slate-400">
              {t('admin.featureFlags.lastUpdated', {
                date: new Date(row.updated_at).toLocaleString('fr-FR'),
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            void onSave(def.key, {
              enabled: !enabled,
              payloadJson: hasBannerPayload ? { message, severity } : undefined,
            })
          }
          disabled={busy}
          className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? 'bg-green-600' : 'bg-slate-300'
          }`}
          aria-pressed={enabled}
          aria-label={enabled ? t('admin.featureFlags.disable') : t('admin.featureFlags.enable')}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {hasBannerPayload && (
        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t('admin.featureFlags.maintenanceBanner.messageLabel')}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder={t('admin.featureFlags.maintenanceBanner.messagePlaceholder')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t('admin.featureFlags.maintenanceBanner.severityLabel')}
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as MaintenanceBannerSeverity)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
            >
              <option value="info">{t('admin.featureFlags.maintenanceBanner.severityInfo')}</option>
              <option value="warning">
                {t('admin.featureFlags.maintenanceBanner.severityWarning')}
              </option>
              <option value="critical">
                {t('admin.featureFlags.maintenanceBanner.severityCritical')}
              </option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => void onSave(def.key, { enabled, payloadJson: { message, severity } })}
            className="h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {t('admin.featureFlags.maintenanceBanner.saveButton')}
          </button>
        </div>
      )}
    </li>
  );
}
