'use client';

import { useCallback, useEffect, useState } from 'react';
import { FEATURE_FLAG_REGISTRY } from '@myclash/feature-flags';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface FlagRow {
  key: string;
  enabled: boolean;
  description: string | null;
  updated_at: string | null;
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

  async function toggle(row: FlagRow) {
    setBusyKey(row.key);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/feature-flags/${encodeURIComponent(row.key)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !row.enabled }),
        },
      );
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

  return (
    <main className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('admin.featureFlags.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('admin.featureFlags.description')}</p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">{t('admin.featureFlags.loading')}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-100">
            {FEATURE_FLAG_REGISTRY.map((def) => {
              const row =
                rows.find((r) => r.key === def.key) ??
                ({
                  key: def.key,
                  enabled: def.default,
                  description: null,
                  updated_at: null,
                } as FlagRow);
              const busy = busyKey === def.key;
              return (
                <li
                  key={def.key}
                  className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900">{t(def.labelKey)}</p>
                    <p className="mt-1 text-sm text-slate-500">{t(def.descriptionKey)}</p>
                    {row.updated_at && (
                      <p className="mt-1 text-xs text-slate-400">
                        {t('admin.featureFlags.lastUpdated', {
                          date: new Date(row.updated_at).toLocaleString('fr-FR'),
                        })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggle(row)}
                    disabled={busy}
                    className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                      row.enabled ? 'bg-green-600' : 'bg-slate-300'
                    }`}
                    aria-pressed={row.enabled}
                    aria-label={
                      row.enabled ? t('admin.featureFlags.disable') : t('admin.featureFlags.enable')
                    }
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        row.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
