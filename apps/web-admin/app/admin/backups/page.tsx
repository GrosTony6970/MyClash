'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AdminBackLink } from '../../../src/components/AdminBackLink';
import { useI18n } from '../../../src/i18n/I18nProvider';

type BackupLocation = 'local' | 's3' | 'upload';
type OperationStatus = 'queued' | 'running' | 'success' | 'failed';

interface BackupArtifact {
  kind: 'db' | 'storage';
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
  encrypted: boolean;
}

interface BackupSet {
  id: string;
  timestamp: string;
  displayName: string;
  local: { available: boolean; artifacts: BackupArtifact[] };
  cloud: { available: boolean; artifacts: BackupArtifact[] };
  upload?: { available: boolean; artifacts: BackupArtifact[] };
}

interface BackupOperation {
  id: string;
  kind: 'backup' | 'restore';
  status: OperationStatus;
  startedAt: string;
  finishedAt?: string;
  source?: BackupLocation;
  backupId?: string;
  logTail: string[];
  error?: string;
}

interface BackupStatus {
  generatedAt: string;
  cloudConfigured: boolean;
  lastBackup: {
    timestamp: string;
    status: 'success' | 'failed' | 'unknown';
    localAvailable: boolean;
    cloudAvailable: boolean;
  } | null;
  runningOperation: BackupOperation | null;
}

interface BackupListResponse {
  generatedAt: string;
  backups: BackupSet[];
}

export default function AdminBackupsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [backups, setBackups] = useState<BackupSet[]>([]);
  const [operation, setOperation] = useState<BackupOperation | null>(null);
  const [confirmationByBackup, setConfirmationByBackup] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/admin/backups/status`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/admin/backups`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([statusRes, backupsRes]) => {
        if (statusRes.status === 401 || statusRes.status === 403) {
          throw new Error(t('admin.backups.accessDenied'));
        }
        if (!statusRes.ok || !backupsRes.ok) throw new Error(t('admin.backups.loadError'));
        const nextStatus = (await statusRes.json()) as BackupStatus;
        const nextBackups = (await backupsRes.json()) as BackupListResponse;
        setStatus(nextStatus);
        setBackups(nextBackups.backups);
        setOperation(nextStatus.runningOperation);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.backups.loadError'));
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [apiUrl, t]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!operation || !['queued', 'running'].includes(operation.status)) return;
    const timer = window.setInterval(() => {
      fetch(`${apiUrl}/api/v1/admin/backups/operations/${operation.id}`, {
        credentials: 'include',
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(t('admin.backups.operationLoadError'));
          const next = (await res.json()) as BackupOperation;
          setOperation(next);
          if (next.status === 'success' || next.status === 'failed') load();
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [apiUrl, load, operation, t]);

  const runBackup = () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    fetch(`${apiUrl}/api/v1/admin/backups/run`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.backups.runError'));
        const data = (await res.json()) as { operation: BackupOperation };
        setOperation(data.operation);
        setNotice(t('admin.backups.runStarted'));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.runError')),
      )
      .finally(() => setBusy(false));
  };

  const uploadBackup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t('admin.backups.uploadMissing'));
      return;
    }
    const formData = new FormData();
    formData.set('file', file);
    setBusy(true);
    setError(null);
    setNotice(null);
    fetch(`${apiUrl}/api/v1/admin/backups/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.backups.uploadError'));
        const data = (await res.json()) as { backup: BackupSet };
        setBackups((current) => [data.backup, ...current]);
        setNotice(t('admin.backups.uploadStaged'));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.uploadError')),
      )
      .finally(() => setBusy(false));
  };

  const restoreBackup = (backup: BackupSet, location: BackupLocation) => {
    const confirmation = confirmationByBackup[`${location}:${backup.id}`] ?? '';
    setBusy(true);
    setError(null);
    setNotice(null);
    fetch(`${apiUrl}/api/v1/admin/backups/restore`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location,
        backupId: backup.id,
        includeStorage: true,
        confirmation,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.backups.restoreError'));
        const data = (await res.json()) as { operation: BackupOperation };
        setOperation(data.operation);
        setNotice(t('admin.backups.restoreStarted'));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.restoreError')),
      )
      .finally(() => setBusy(false));
  };

  return (
    <main id="main-content" className="p-8">
      <div className="mb-2">
        <AdminBackLink>{t('admin.backups.backToAdmin')}</AdminBackLink>
      </div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.backups.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('admin.backups.description')}</p>
        </div>
        <button
          type="button"
          onClick={runBackup}
          disabled={busy || Boolean(operation && ['queued', 'running'].includes(operation.status))}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t('admin.backups.runBackup')}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <StatusCard label={t('admin.backups.lastBackup')} value={statusLabel(status, t)} />
        <StatusCard
          label={t('admin.backups.cloud')}
          value={
            status?.cloudConfigured
              ? t('admin.backups.configured')
              : t('admin.backups.notConfigured')
          }
        />
        <StatusCard
          label={t('admin.backups.operation')}
          value={
            operation ? t(`admin.backups.operationStatuses.${operation.status}`) : t('common.none')
          }
        />
      </section>

      {operation && (
        <section className="mb-6 rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-950">
              {t('admin.backups.currentOperation')}
            </h2>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
              {t(`admin.backups.operationStatuses.${operation.status}`)}
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            {operation.kind === 'backup'
              ? t('admin.backups.operationBackup')
              : t('admin.backups.operationRestore')}
          </p>
          {operation.error && <p className="mt-2 text-sm text-red-700">{operation.error}</p>}
          {operation.logTail.length > 0 && (
            <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
              {operation.logTail.join('\n')}
            </pre>
          )}
        </section>
      )}

      <form onSubmit={uploadBackup} className="mb-6 rounded-lg border border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-950">{t('admin.backups.uploadTitle')}</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            ref={fileRef}
            type="file"
            name="file"
            aria-label={t('admin.backups.uploadFile')}
            accept=".gz,.gpg"
            className="block w-full text-sm text-gray-700"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50"
          >
            {t('admin.backups.stageUpload')}
          </button>
        </div>
      </form>

      <section className="rounded-lg border border-gray-200">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-950">{t('admin.backups.available')}</h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-gray-400">{t('admin.backups.loading')}</p>
        ) : backups.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">{t('admin.backups.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-4 py-2">{t('admin.backups.timestamp')}</th>
                  <th className="px-4 py-2">{t('admin.backups.locations')}</th>
                  <th className="px-4 py-2">{t('admin.backups.artifacts')}</th>
                  <th className="px-4 py-2">{t('admin.backups.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id} className="border-b border-gray-50 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800">
                      {backup.displayName}
                    </td>
                    <td className="px-4 py-3">
                      <LocationBadges backup={backup} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {[
                        ...backup.local.artifacts,
                        ...backup.cloud.artifacts,
                        ...(backup.upload?.artifacts ?? []),
                      ]
                        .map((artifact) => artifactLabel(artifact, t))
                        .join(', ')}
                    </td>
                    <td className="px-4 py-3">
                      <BackupActions
                        backup={backup}
                        apiUrl={apiUrl}
                        busy={busy}
                        confirmationByBackup={confirmationByBackup}
                        setConfirmationByBackup={setConfirmationByBackup}
                        restoreBackup={restoreBackup}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Alert({ tone, children }: { tone: 'error' | 'success'; children: string }) {
  return (
    <div
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-green-200 bg-green-50 text-green-700'
      }`}
    >
      {children}
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-gray-950">{value}</p>
    </div>
  );
}

function LocationBadges({ backup }: { backup: BackupSet }) {
  const { t } = useI18n();
  const locations = [
    ['local', backup.local.available],
    ['s3', backup.cloud.available],
    ['upload', backup.upload?.available ?? false],
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {locations
        .filter(([, available]) => available)
        .map(([label]) => (
          <span
            key={label}
            className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700"
          >
            {t(`admin.backups.locationsMap.${label}`)}
          </span>
        ))}
    </div>
  );
}

function BackupActions(props: {
  backup: BackupSet;
  apiUrl: string;
  busy: boolean;
  confirmationByBackup: Record<string, string>;
  setConfirmationByBackup: (value: Record<string, string>) => void;
  restoreBackup: (backup: BackupSet, location: BackupLocation) => void;
}) {
  const { t } = useI18n();
  const locations: Array<[BackupLocation, boolean]> = [
    ['local', props.backup.local.available],
    ['s3', props.backup.cloud.available],
    ['upload', props.backup.upload?.available ?? false],
  ];
  return (
    <div className="flex min-w-72 flex-col gap-3">
      {locations
        .filter(([, available]) => available)
        .map(([location]) => {
          const key = `${location}:${props.backup.id}`;
          const expected = `RESTORE MYCLASH ${props.backup.id}`;
          const confirmation = props.confirmationByBackup[key] ?? '';
          return (
            <div key={key} className="rounded-md border border-gray-100 p-2">
              <div className="flex flex-wrap gap-2">
                <a
                  href={`${props.apiUrl}/api/v1/admin/backups/${props.backup.id}/download?location=${location}&artifact=db`}
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-900"
                >
                  {t('admin.backups.downloadDb')}
                </a>
                <button
                  type="button"
                  onClick={() => props.restoreBackup(props.backup, location)}
                  disabled={props.busy || confirmation !== expected}
                  className="rounded-md bg-red-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {t('admin.backups.restoreFrom', {
                    location: t(`admin.backups.locationsMap.${location}`),
                  })}
                </button>
              </div>
              <input
                value={confirmation}
                aria-label={t('admin.backups.restoreConfirmation')}
                onChange={(event) =>
                  props.setConfirmationByBackup({
                    ...props.confirmationByBackup,
                    [key]: event.target.value,
                  })
                }
                placeholder={expected}
                className="mt-2 w-full rounded-md border border-gray-200 px-2 py-1 text-xs"
              />
            </div>
          );
        })}
    </div>
  );
}

function statusLabel(status: BackupStatus | null, t: (key: string) => string): string {
  if (!status?.lastBackup) return t('common.none');
  return `${status.lastBackup.timestamp} - ${t(`admin.backups.statuses.${status.lastBackup.status}`)}`;
}

function artifactLabel(artifact: BackupArtifact, t: (key: string) => string): string {
  const encrypted = artifact.encrypted ? ` ${t('admin.backups.encrypted')}` : '';
  return `${t(`admin.backups.artifactKinds.${artifact.kind}`)} ${formatBytes(artifact.sizeBytes)}${encrypted}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value / 1024 / 1024)} MB`;
}
