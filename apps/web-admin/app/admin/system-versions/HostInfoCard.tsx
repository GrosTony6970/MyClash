'use client';

import { useCallback, useEffect, useState } from 'react';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { formatBytes } from '@/lib/format-bytes';

type HostInfoSource = 'docker' | 'runtime' | 'unknown';
type Translate = (key: string, params?: Record<string, string | number>) => string;

interface HostInfoResponse {
  checkedAt: string;
  source: HostInfoSource;
  hostname: string | null;
  os: string | null;
  osVersion: string | null;
  kernelVersion: string | null;
  architecture: string | null;
  dockerVersion: string | null;
  cpuCount: number | null;
  memoryTotalBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskAvailBytes: number | null;
  diskMountpoint: string | null;
  error?: string;
}

const EMPTY = '—';

/** Locale-aware "long date + short time"; returns the em dash when it won't parse. */
function formatCheckedAt(value: string, locale: AppLocale): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return EMPTY;
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(ts));
}

// Explicit static t() calls (not template literals) so the i18n key-reference
// lint resolves every key in both EN and FR — same reason as TlsCertificatesCard.
function sourceLabel(t: Translate, source: HostInfoSource): string {
  switch (source) {
    case 'docker':
      return t('admin.systemVersions.host.sources.docker');
    case 'runtime':
      return t('admin.systemVersions.host.sources.runtime');
    default:
      return t('admin.systemVersions.host.sources.unknown');
  }
}

/** "Debian GNU/Linux 12 (bookworm) 12" reads badly — fold the version in only when it adds something. */
function osLine(info: HostInfoResponse): string | null {
  if (!info.os) return null;
  if (!info.osVersion || info.os.includes(info.osVersion)) return info.os;
  return `${info.os} ${info.osVersion}`;
}

function kernelLine(info: HostInfoResponse): string | null {
  if (!info.kernelVersion) return info.architecture;
  if (!info.architecture) return info.kernelVersion;
  return `${info.kernelVersion} (${info.architecture})`;
}

export function HostInfoCard() {
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();

  const [info, setInfo] = useState<HostInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = useCallback(
    ({ signal, refresh = false }: { signal?: AbortSignal; refresh?: boolean } = {}) => {
      if (refresh) setRefreshing(true);

      void apiRequest<HostInfoResponse>(apiUrl, '/api/v1/admin/system/host-info', { signal })
        .then((r) => {
          if (r.ok) {
            setInfo(r.data);
            setError(null);
            return;
          }
          // No message is the unmount, or the refresh that replaced this read.
          const message = failureMessage(r, t, t('admin.systemVersions.host.loadError'));
          if (message) setError(message);
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [apiUrl, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadInfo({ signal: controller.signal }));
    return () => {
      controller.abort();
    };
  }, [loadInfo]);

  const rows: { key: string; label: string; value: string | null }[] = info
    ? [
        {
          key: 'hostname',
          label: t('admin.systemVersions.host.fields.hostname'),
          value: info.hostname,
        },
        { key: 'os', label: t('admin.systemVersions.host.fields.os'), value: osLine(info) },
        {
          key: 'kernel',
          label: t('admin.systemVersions.host.fields.kernel'),
          value: kernelLine(info),
        },
        {
          key: 'cpus',
          label: t('admin.systemVersions.host.fields.cpus'),
          value:
            info.cpuCount == null
              ? null
              : t('admin.systemVersions.host.cpuCount', { count: info.cpuCount }),
        },
        {
          key: 'memory',
          label: t('admin.systemVersions.host.fields.memory'),
          value: info.memoryTotalBytes == null ? null : formatBytes(info.memoryTotalBytes),
        },
        {
          key: 'disk',
          label: t('admin.systemVersions.host.fields.disk'),
          value:
            info.diskTotalBytes == null
              ? null
              : t('admin.systemVersions.host.diskTotal', {
                  total: formatBytes(info.diskTotalBytes),
                  free: formatBytes(info.diskAvailBytes),
                }),
        },
        {
          key: 'docker',
          label: t('admin.systemVersions.host.fields.docker'),
          value: info.dockerVersion,
        },
      ]
    : [];

  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-background flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('admin.systemVersions.host.title')}
          </h2>
          <p className="text-muted text-xs mt-0.5">{t('admin.systemVersions.host.description')}</p>
        </div>
        <button
          type="button"
          onClick={() => loadInfo({ refresh: true })}
          disabled={loading || refreshing}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
        >
          {refreshing
            ? t('admin.systemVersions.host.refreshing')
            : t('admin.systemVersions.host.refresh')}
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border-b border-danger/30 text-danger px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="px-4 py-4 text-sm text-muted">{t('admin.systemVersions.host.loading')}</p>
      ) : info ? (
        <>
          <dl className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <div key={row.key} className="min-w-0">
                <dt className="text-muted text-xs">{row.label}</dt>
                <dd
                  className="text-foreground-secondary text-sm truncate"
                  title={row.value ?? EMPTY}
                >
                  {row.value ?? EMPTY}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-border px-4 py-2.5 text-xs text-muted">
            <span>
              {t('admin.systemVersions.host.checkedAt', {
                time: formatCheckedAt(info.checkedAt, locale),
                source: sourceLabel(t, info.source),
              })}
            </span>
            {/* These are the machine's totals, not the API container's budget —
                it runs under a cpus/mem_limit cap well below them. Saying so on
                screen is cheaper than an operator sizing a job off this number. */}
            <p className="mt-1">{t('admin.systemVersions.host.hostValuesNote')}</p>
            {info.source !== 'docker' && (
              <p className="mt-1 text-warning">
                {t('admin.systemVersions.host.degraded', {
                  reason: info.error ?? t('admin.systemVersions.host.sources.unknown'),
                })}
              </p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
