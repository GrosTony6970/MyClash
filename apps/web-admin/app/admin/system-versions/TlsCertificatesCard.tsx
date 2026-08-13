'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

type TlsCertHealth = 'ok' | 'expiringSoon' | 'staging' | 'error';
type TlsCaType = 'prod' | 'staging' | 'unknown';

interface TlsCertStatus {
  host: string;
  reachable: boolean;
  issuerOrg?: string;
  issuerCn?: string;
  caType: TlsCaType;
  validFrom?: string;
  validTo?: string;
  daysUntilExpiry?: number;
  health: TlsCertHealth;
  error?: string;
}

interface TlsStatusResponse {
  checkedAt: string;
  minDays: number;
  certificates: TlsCertStatus[];
}

interface CertRenewalResult {
  ok: boolean;
  exitCode?: number;
  stderr?: string;
  timedOut?: boolean;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Formats an ISO date as a locale-aware medium date; returns "—" when absent. */
function formatCertDate(value: string | undefined, locale: AppLocale): string {
  if (!value) return '—';
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return '—';
  return new Intl.DateTimeFormat(localeToBcp47(locale), { dateStyle: 'medium' }).format(
    new Date(ts),
  );
}

// Explicit static t() calls (not template literals) so the i18n key-reference
// lint resolves every key in both EN and FR.
function healthLabel(t: Translate, health: TlsCertHealth): string {
  switch (health) {
    case 'ok':
      return t('admin.systemVersions.tls.statuses.ok');
    case 'expiringSoon':
      return t('admin.systemVersions.tls.statuses.expiringSoon');
    case 'staging':
      return t('admin.systemVersions.tls.statuses.staging');
    default:
      return t('admin.systemVersions.tls.statuses.error');
  }
}

function healthClasses(health: TlsCertHealth): string {
  switch (health) {
    case 'ok':
      return 'bg-success/10 text-success';
    case 'error':
      return 'bg-danger/10 text-danger';
    default:
      // expiringSoon + staging are both amber warnings.
      return 'bg-warning/10 text-warning';
  }
}

function caLabel(t: Translate, caType: TlsCaType): string {
  switch (caType) {
    case 'prod':
      return t('admin.systemVersions.tls.caTypes.prod');
    case 'staging':
      return t('admin.systemVersions.tls.caTypes.staging');
    default:
      return t('admin.systemVersions.tls.caTypes.unknown');
  }
}

export function TlsCertificatesCard() {
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const toast = useToast();

  const [status, setStatus] = useState<TlsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const loadStatus = useCallback(
    ({ signal, refresh = false }: { signal?: AbortSignal; refresh?: boolean } = {}) => {
      if (refresh) setRefreshing(true);

      fetch(`${apiUrl}/api/v1/admin/system/tls-status`, { credentials: 'include', signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(t('admin.systemVersions.tls.loadError'));
          const data = (await res.json()) as TlsStatusResponse;
          setStatus(data);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setError(err instanceof Error ? err.message : t('admin.systemVersions.tls.loadError'));
          }
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
    void Promise.resolve().then(() => loadStatus({ signal: controller.signal }));
    return () => {
      controller.abort();
    };
  }, [loadStatus]);

  async function confirmRenew() {
    setRenewing(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/system/tls-status/renew`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as CertRenewalResult;
      if (!result.ok) {
        throw new Error(
          result.stderr?.trim() ||
            (result.timedOut
              ? t('admin.common.dockerComposeTimedOut')
              : t('admin.common.componentActionFailed')),
        );
      }
      toast.success(t('admin.systemVersions.tls.actions.renewSuccess'));
      setConfirmOpen(false);
      // Traefik takes a moment to re-attempt ACME; re-probe shortly after.
      window.setTimeout(() => loadStatus({ refresh: true }), 4000);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin.common.unknownError');
      toast.error(t('admin.systemVersions.tls.actions.renewFailed', { message }));
    } finally {
      setRenewing(false);
    }
  }

  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-background flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('admin.systemVersions.tls.title')}
          </h2>
          <p className="text-muted text-xs mt-0.5">{t('admin.systemVersions.tls.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadStatus({ refresh: true })}
            disabled={loading || refreshing}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
          >
            {refreshing
              ? t('admin.systemVersions.tls.rechecking')
              : t('admin.systemVersions.tls.recheck')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={renewing}
            className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {t('admin.systemVersions.tls.forceRenew')}
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
      ) : status && status.certificates.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 px-4">{t('admin.systemVersions.tls.columns.host')}</th>
                <th className="py-2 px-4">{t('admin.systemVersions.tls.columns.ca')}</th>
                <th className="py-2 px-4">{t('admin.systemVersions.tls.columns.expiry')}</th>
                <th className="py-2 px-4">{t('admin.systemVersions.tls.columns.daysLeft')}</th>
                <th className="py-2 px-4">{t('admin.systemVersions.tls.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {status.certificates.map((cert) => (
                <tr key={cert.host} className="border-b border-border last:border-0">
                  <td className="py-2 px-4 font-mono text-xs text-foreground-secondary">
                    {cert.host}
                  </td>
                  <td className="py-2 px-4 text-foreground-secondary" title={cert.issuerCn ?? ''}>
                    {caLabel(t, cert.caType)}
                  </td>
                  <td className="py-2 px-4 text-xs text-foreground-secondary">
                    {formatCertDate(cert.validTo, locale)}
                  </td>
                  <td className="py-2 px-4 text-xs text-foreground-secondary">
                    {cert.daysUntilExpiry ?? '—'}
                  </td>
                  <td className="py-2 px-4">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${healthClasses(cert.health)}`}
                    >
                      {healthLabel(t, cert.health)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-muted border-t border-border">
            {t('admin.systemVersions.tls.checkedAt')} {formatCertDate(status.checkedAt, locale)}
          </div>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-muted">{t('admin.systemVersions.tls.none')}</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('admin.systemVersions.tls.actions.confirmForceRenewTitle')}
        description={t('admin.systemVersions.tls.actions.confirmForceRenewDescription')}
        confirmLabel={t('admin.systemVersions.tls.actions.forceRenew')}
        danger
        busy={renewing}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmRenew()}
      />
    </section>
  );
}
