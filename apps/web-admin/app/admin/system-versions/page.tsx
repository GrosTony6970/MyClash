'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { HostInfoCard } from './HostInfoCard';
import { TlsCertificatesCard } from './TlsCertificatesCard';
import { RuntimeHealthCard } from './RuntimeHealthCard';
import { CiHealthCard } from './CiHealthCard';
import { getPublicApiUrl } from '@/lib/api-url';

/**
 * Formats an ISO timestamp as a locale-aware "long date + short time" string
 * (e.g. "19 May 2026, 14:23"). Returns the input untouched when it doesn't
 * parse as a date — e.g. when `deployedAt` is "unknown" because the deploy
 * manifest never ran.
 */
function formatDeployDate(value: string, locale: AppLocale): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(ts));
}

type VersionSource = 'manifest' | 'package.json' | 'compose' | 'runtime' | 'deploy';
type VersionStatus = 'ok' | 'unknown';
type ComponentAction = 'start' | 'stop' | 'restart';

interface VersionComponent {
  key: string;
  label: string;
  version: string;
  source: VersionSource;
  status?: VersionStatus;
  restartable?: boolean;
}

interface VersionGroup {
  key: string;
  label: string;
  components: VersionComponent[];
}

interface SystemVersionsResponse {
  generatedAt: string;
  deploy: {
    kind: 'deploy' | 'redeploy' | 'rollback' | 'unknown';
    previousCommit: string;
    deployedCommit: string;
    deployedAt: string;
    deployedBy: string;
    backupFile: string;
  };
  groups: VersionGroup[];
}

interface ComponentActionResult {
  ok: boolean;
  exitCode?: number;
  stderr?: string;
  timedOut?: boolean;
}

interface PendingAction {
  componentKey: string;
  componentLabel: string;
  action: ComponentAction;
}

export default function AdminSystemVersionsPage() {
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const toast = useToast();

  const [versions, setVersions] = useState<SystemVersionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadVersions = useCallback(
    ({ signal, refresh = false }: { signal?: AbortSignal; refresh?: boolean } = {}) => {
      if (refresh) setRefreshing(true);

      fetch(`${apiUrl}/api/v1/admin/system-versions`, {
        credentials: 'include',
        signal,
      })
        .then(async (res) => {
          if (res.status === 401 || res.status === 403) {
            setError(t('admin.systemVersions.accessDenied'));
            return;
          }
          if (!res.ok) throw new Error(t('admin.systemVersions.loadError'));
          const data = (await res.json()) as SystemVersionsResponse;
          setVersions(data);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setError(err instanceof Error ? err.message : t('admin.systemVersions.loadError'));
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

    void Promise.resolve().then(() => loadVersions({ signal: controller.signal }));

    return () => {
      controller.abort();
    };
  }, [loadVersions]);

  async function confirmPendingAction() {
    if (!pending) return;
    const { componentKey, componentLabel, action } = pending;
    setBusyKey(componentKey);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/system-versions/components/${encodeURIComponent(componentKey)}/${action}`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as ComponentActionResult;
      if (!result.ok) {
        throw new Error(
          result.stderr?.trim() ||
            (result.timedOut
              ? t('admin.common.dockerComposeTimedOut')
              : t('admin.common.componentActionFailed')),
        );
      }
      const successKey =
        action === 'start'
          ? 'admin.systemVersions.actions.successStart'
          : action === 'stop'
            ? 'admin.systemVersions.actions.successStop'
            : 'admin.systemVersions.actions.successRestart';
      toast.success(t(successKey, { component: componentLabel }));
      setPending(null);
      loadVersions({ refresh: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin.common.unknownError');
      toast.error(t('admin.systemVersions.actions.failed', { message }));
    } finally {
      setBusyKey(null);
    }
  }

  const confirmTitleKey =
    pending?.action === 'start'
      ? 'admin.systemVersions.actions.confirmStartTitle'
      : pending?.action === 'stop'
        ? 'admin.systemVersions.actions.confirmStopTitle'
        : 'admin.systemVersions.actions.confirmRestartTitle';
  const confirmDescriptionKey =
    pending?.action === 'start'
      ? 'admin.systemVersions.actions.confirmStartDescription'
      : pending?.action === 'stop'
        ? 'admin.systemVersions.actions.confirmStopDescription'
        : 'admin.systemVersions.actions.confirmRestartDescription';
  const confirmLabelKey =
    pending?.action === 'start'
      ? 'admin.systemVersions.actions.start'
      : pending?.action === 'stop'
        ? 'admin.systemVersions.actions.stop'
        : 'admin.systemVersions.actions.restart';

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('admin.systemVersions.title')}
          </h1>
          <p className="text-muted text-sm mt-1">{t('admin.systemVersions.description')}</p>
        </div>
        <button
          type="button"
          onClick={() => loadVersions({ refresh: true })}
          disabled={loading || refreshing}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {refreshing ? t('admin.systemVersions.refreshing') : t('admin.systemVersions.refresh')}
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-muted text-sm">{t('admin.systemVersions.loading')}</p>
      ) : versions ? (
        <>
          <div className="mb-5 text-sm text-muted">
            <span className="font-medium text-foreground-secondary">
              {t('admin.systemVersions.generatedAt')}
            </span>{' '}
            {formatValue(versions.generatedAt, t('admin.systemVersions.unknown'))}
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {versions.groups.map((group) => {
              // The "deploy" group is metadata (commit hash, date, backup file),
              // not health signals — the status pill is always "ok" and adds noise,
              // so we hide the column entirely on that group.
              const showStatus = group.key !== 'deploy';
              const showActions = group.components.some((c) => c.restartable);
              return (
                <section
                  key={group.key}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-border bg-background">
                    <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                      {translateWithFallback(
                        t,
                        `admin.systemVersions.groups.${group.key}`,
                        group.label,
                      )}
                    </h2>
                  </div>
                  {group.components.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">
                      {t('admin.systemVersions.noComponents')}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-border text-left text-muted">
                            <th className="py-2 px-4">{t('admin.systemVersions.component')}</th>
                            <th className="py-2 px-4">{t('admin.systemVersions.version')}</th>
                            <th className="py-2 px-4">{t('admin.systemVersions.source')}</th>
                            {showStatus && (
                              <th className="py-2 px-4">{t('admin.systemVersions.status')}</th>
                            )}
                            {showActions && (
                              <th className="py-2 px-4">
                                {t('admin.systemVersions.actions.columnLabel')}
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {group.components.map((component) => {
                            // In the deploy group, render `deployedAt` as a locale-aware
                            // date instead of the raw ISO string from the manifest.
                            const isDeployDate =
                              group.key === 'deploy' && component.key === 'deployedAt';
                            // `deployKind` carries an enum value, not a version — the
                            // server sends `rollback`, the operator reads a sentence.
                            const isDeployKind =
                              group.key === 'deploy' && component.key === 'deployKind';
                            const displayValue = isDeployDate
                              ? formatDeployDate(component.version, locale)
                              : isDeployKind
                                ? translateWithFallback(
                                    t,
                                    `admin.systemVersions.deployKinds.${component.version}`,
                                    component.version,
                                  )
                                : formatValue(component.version, t('admin.systemVersions.unknown'));
                            const componentLabel = translateWithFallback(
                              t,
                              `admin.systemVersions.components.${component.key}`,
                              component.label,
                            );
                            const isBusy = busyKey === component.key;
                            return (
                              <tr
                                key={`${group.key}-${component.key}`}
                                className="border-b border-border last:border-0"
                              >
                                <td className="py-2 px-4 text-foreground-secondary">
                                  {componentLabel}
                                </td>
                                <td
                                  className={
                                    isDeployDate || isDeployKind
                                      ? 'py-2 px-4 text-xs text-foreground-secondary'
                                      : 'py-2 px-4 font-mono text-xs text-foreground-secondary'
                                  }
                                >
                                  {displayValue}
                                </td>
                                <td className="py-2 px-4">
                                  <span className="inline-flex rounded-full bg-background px-2 py-0.5 text-xs font-medium text-foreground-secondary">
                                    {component.source}
                                  </span>
                                </td>
                                {showStatus && (
                                  <td className="py-2 px-4">
                                    <span
                                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                        component.status === 'unknown'
                                          ? 'bg-warning/10 text-warning'
                                          : 'bg-success/10 text-success'
                                      }`}
                                    >
                                      {t(
                                        `admin.systemVersions.statuses.${component.status ?? 'ok'}`,
                                      )}
                                    </span>
                                  </td>
                                )}
                                {showActions && (
                                  <td className="py-2 px-4">
                                    {component.restartable ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        <ActionButton
                                          label={t('admin.systemVersions.actions.start')}
                                          busy={isBusy}
                                          variant="neutral"
                                          onClick={() =>
                                            setPending({
                                              componentKey: component.key,
                                              componentLabel,
                                              action: 'start',
                                            })
                                          }
                                        />
                                        <ActionButton
                                          label={t('admin.systemVersions.actions.stop')}
                                          busy={isBusy}
                                          variant="danger"
                                          onClick={() =>
                                            setPending({
                                              componentKey: component.key,
                                              componentLabel,
                                              action: 'stop',
                                            })
                                          }
                                        />
                                        <ActionButton
                                          label={t('admin.systemVersions.actions.restart')}
                                          busy={isBusy}
                                          variant="primary"
                                          onClick={() =>
                                            setPending({
                                              componentKey: component.key,
                                              componentLabel,
                                              action: 'restart',
                                            })
                                          }
                                        />
                                      </div>
                                    ) : null}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          {/* First of the three cards: which machine this all runs on frames
              everything below it, and unlike them it never fails outright. */}
          <div className="mt-5">
            <HostInfoCard />
          </div>
          <div className="mt-5">
            <TlsCertificatesCard />
          </div>
          <div className="mt-5">
            <RuntimeHealthCard />
          </div>
          {/* Last, because it reports on the build pipeline rather than on this
              running stack — everything above is what the box is doing now. */}
          <div className="mt-5">
            <CiHealthCard />
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? t(confirmTitleKey, { component: pending.componentLabel }) : ''}
        description={pending ? t(confirmDescriptionKey, { component: pending.componentLabel }) : ''}
        confirmLabel={pending ? t(confirmLabelKey) : ''}
        danger={pending?.action === 'stop'}
        busy={busyKey !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmPendingAction()}
      />
    </main>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  variant,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  variant: 'primary' | 'danger' | 'neutral';
}) {
  const variantClasses =
    variant === 'primary'
      ? 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
      : variant === 'danger'
        ? 'border-border bg-surface text-foreground-secondary hover:bg-background'
        : 'border-border bg-surface text-foreground-secondary hover:bg-background';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${variantClasses}`}
    >
      {label}
    </button>
  );
}

function translateWithFallback(t: (key: string) => string, key: string, fallback: string): string {
  const translated = t(key);
  return translated === `[${key}]` ? fallback : translated;
}

function formatValue(value: string, unknownLabel: string): string {
  return value === 'unknown' ? unknownLabel : value;
}
