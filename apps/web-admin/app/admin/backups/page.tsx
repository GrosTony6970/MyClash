'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
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

interface BackupSchedule {
  enabled: boolean;
  hourUtc: number;
  minuteUtc: number;
  timezoneLabel: string;
  updatedAt: string | null;
  nextRunAt: string | null;
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
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    enabled: true,
    hourUtc: 3,
    minuteUtc: 0,
  });
  const [backups, setBackups] = useState<BackupSet[]>([]);
  const [operation, setOperation] = useState<BackupOperation | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    backup: BackupSet;
    location: BackupLocation;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    backup: BackupSet;
    location: Extract<BackupLocation, 'local' | 's3'>;
  } | null>(null);
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
      fetch(`${apiUrl}/api/v1/admin/backups/schedule`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/admin/backups`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([statusRes, scheduleRes, backupsRes]) => {
        if (statusRes.status === 401 || statusRes.status === 403) {
          throw new Error(t('admin.backups.accessDenied'));
        }
        if (!statusRes.ok || !scheduleRes.ok || !backupsRes.ok) {
          throw new Error(t('admin.backups.loadError'));
        }
        const nextStatus = (await statusRes.json()) as BackupStatus;
        const nextSchedule = (await scheduleRes.json()) as BackupSchedule;
        const nextBackups = (await backupsRes.json()) as BackupListResponse;
        setStatus(nextStatus);
        setSchedule(nextSchedule);
        setScheduleForm({
          enabled: nextSchedule.enabled,
          hourUtc: nextSchedule.hourUtc,
          minuteUtc: nextSchedule.minuteUtc,
        });
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
        setSelectedFilename(null);
        if (fileRef.current) fileRef.current.value = '';
        setNotice(t('admin.backups.uploadStaged'));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.uploadError')),
      )
      .finally(() => setBusy(false));
  };

  const restoreBackup = (backup: BackupSet, location: BackupLocation) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setPendingRestore(null);
    fetch(`${apiUrl}/api/v1/admin/backups/restore`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location,
        backupId: backup.id,
        includeStorage: true,
        confirmed: true,
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

  const deleteBackup = (backup: BackupSet, location: Extract<BackupLocation, 'local' | 's3'>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setPendingDelete(null);
    fetch(`${apiUrl}/api/v1/admin/backups/${backup.id}?location=${location}`, {
      method: 'DELETE',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.backups.deleteError'));
        await res.json();
        setNotice(
          t('admin.backups.deleteSuccess', {
            location: t(`admin.backups.locationsMap.${location}`),
          }),
        );
        load();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.deleteError')),
      )
      .finally(() => setBusy(false));
  };

  const saveSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    fetch(`${apiUrl}/api/v1/admin/backups/schedule`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scheduleForm),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.backups.scheduleSaveError'));
        const nextSchedule = (await res.json()) as BackupSchedule;
        setSchedule(nextSchedule);
        setScheduleForm({
          enabled: nextSchedule.enabled,
          hourUtc: nextSchedule.hourUtc,
          minuteUtc: nextSchedule.minuteUtc,
        });
        setNotice(t('admin.backups.scheduleSaved'));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.scheduleSaveError')),
      )
      .finally(() => setBusy(false));
  };

  return (
    <main id="main-content" className="p-8">
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

      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <StatusCard label={t('admin.backups.lastBackup')} value={statusLabel(status, t)} />
        <StatusCard label={t('admin.backups.schedule')} value={scheduleLabel(schedule, t)} />
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

      <form onSubmit={saveSchedule} className="mb-6 rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-950">
              {t('admin.backups.scheduleTitle')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {schedule?.nextRunAt
                ? t('admin.backups.scheduleNextRun', {
                    nextRun: formatTimestamp(schedule.nextRunAt),
                  })
                : t('admin.backups.scheduleDisabled')}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[auto_7rem_7rem_auto] sm:items-end">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={scheduleForm.enabled}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, enabled: event.target.checked }))
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              {t('admin.backups.scheduleEnabled')}
            </label>
            <label className="grid gap-1 text-sm font-semibold text-gray-700">
              {t('admin.backups.scheduleHourUtc')}
              <input
                type="number"
                min={0}
                max={23}
                value={scheduleForm.hourUtc}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    hourUtc: Number(event.target.value),
                  }))
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-gray-700">
              {t('admin.backups.scheduleMinuteUtc')}
              <input
                type="number"
                min={0}
                max={59}
                value={scheduleForm.minuteUtc}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    minuteUtc: Number(event.target.value),
                  }))
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t('admin.backups.scheduleSave')}
            </button>
          </div>
        </div>
      </form>

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
            onChange={(event) => setSelectedFilename(event.target.files?.[0]?.name ?? null)}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-600/30"
          >
            {t('admin.backups.browse')}
          </button>
          <p className="min-w-0 flex-1 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {selectedFilename
              ? t('admin.backups.selectedFile', { file: selectedFilename })
              : t('admin.backups.noFileSelected')}
          </p>
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
                  <th className="px-4 py-2">{t('admin.backups.totalSize')}</th>
                  <th className="px-4 py-2">{t('admin.backups.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id} className="border-b border-gray-50 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800">
                      {formatTimestamp(backup.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <LocationBadges backup={backup} />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {formatBytes(totalBackupSize(backup))}
                    </td>
                    <td className="px-4 py-3">
                      <BackupActions
                        backup={backup}
                        apiUrl={apiUrl}
                        busy={busy}
                        onRestore={(location) => setPendingRestore({ backup, location })}
                        onDelete={(location) => setPendingDelete({ backup, location })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pendingRestore && (
        <ConfirmDialog
          title={t('admin.backups.restoreDialogTitle')}
          body={t('admin.backups.restoreDialogBody', {
            location: t(`admin.backups.locationsMap.${pendingRestore.location}`),
            timestamp: formatTimestamp(pendingRestore.backup.timestamp),
          })}
          dangerLabel={t('admin.backups.continueRestore')}
          cancelLabel={t('actions.cancel')}
          busy={busy}
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => restoreBackup(pendingRestore.backup, pendingRestore.location)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('admin.backups.deleteDialogTitle')}
          body={t('admin.backups.deleteDialogBody', {
            location: t(`admin.backups.locationsMap.${pendingDelete.location}`),
            timestamp: formatTimestamp(pendingDelete.backup.timestamp),
          })}
          dangerLabel={t('admin.backups.continueDelete')}
          cancelLabel={t('actions.cancel')}
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteBackup(pendingDelete.backup, pendingDelete.location)}
        />
      )}
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
  onRestore: (location: BackupLocation) => void;
  onDelete: (location: Extract<BackupLocation, 'local' | 's3'>) => void;
}) {
  const { t } = useI18n();
  const locations: Array<[Extract<BackupLocation, 'local' | 's3'>, boolean]> = [
    ['local', props.backup.local.available],
    ['s3', props.backup.cloud.available],
  ];
  return (
    <div className="grid min-w-[28rem] gap-3 md:grid-cols-2">
      {locations.map(([location, available]) => (
        <div
          key={location}
          className={`rounded-md border p-3 ${
            available ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-70'
          }`}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t(`admin.backups.locationsMap.${location}`)}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`${props.apiUrl}/api/v1/admin/backups/${props.backup.id}/download?location=${location}&artifact=db`}
              aria-disabled={!available}
              className={`rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold ${
                available ? 'text-gray-900 hover:bg-gray-50' : 'pointer-events-none text-gray-400'
              }`}
            >
              {t('admin.backups.downloadDb')}
            </a>
            <button
              type="button"
              onClick={() => props.onRestore(location)}
              disabled={props.busy || !available}
              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-200 disabled:text-gray-400"
            >
              {t('admin.backups.restoreFrom', {
                location: t(`admin.backups.locationsMap.${location}`),
              })}
            </button>
            <button
              type="button"
              onClick={() => props.onDelete(location)}
              disabled={props.busy || !available}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
            >
              {t('admin.backups.deleteFrom', {
                location: t(`admin.backups.locationsMap.${location}`),
              })}
            </button>
          </div>
          {!available && (
            <p className="mt-2 text-xs text-gray-400">{t('admin.backups.locationUnavailable')}</p>
          )}
        </div>
      ))}
      {props.backup.upload?.available && (
        <div className="rounded-md border border-blue-100 bg-blue-50 p-3 md:col-span-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
            {t('admin.backups.locationsMap.upload')}
          </p>
          <button
            type="button"
            onClick={() => props.onRestore('upload')}
            disabled={props.busy}
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-200 disabled:text-gray-400"
          >
            {t('admin.backups.restoreFrom', {
              location: t('admin.backups.locationsMap.upload'),
            })}
          </button>
        </div>
      )}
    </div>
  );
}

function statusLabel(status: BackupStatus | null, t: (key: string) => string): string {
  if (!status?.lastBackup) return t('common.none');
  return `${formatTimestamp(status.lastBackup.timestamp)} - ${t(`admin.backups.statuses.${status.lastBackup.status}`)}`;
}

function scheduleLabel(
  schedule: BackupSchedule | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!schedule) return t('common.none');
  if (!schedule.enabled) return t('admin.backups.scheduleDisabled');
  return t('admin.backups.scheduleAtUtc', {
    time: `${String(schedule.hourUtc).padStart(2, '0')}:${String(schedule.minuteUtc).padStart(
      2,
      '0',
    )}`,
  });
}

function totalBackupSize(backup: BackupSet): number {
  return [
    ...backup.local.artifacts,
    ...backup.cloud.artifacts,
    ...(backup.upload?.artifacts ?? []),
  ].reduce((total, artifact) => total + artifact.sizeBytes, 0);
}

function formatTimestamp(value: string): string {
  const match =
    /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})T(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})Z$/u.exec(
      value,
    );
  const date = match?.groups
    ? new Date(
        `${match.groups['year']}-${match.groups['month']}-${match.groups['day']}T${match.groups['hour']}:${match.groups['minute']}:${match.groups['second']}Z`,
      )
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} - ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function ConfirmDialog({
  title,
  body,
  dangerLabel,
  cancelLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  dangerLabel: string;
  cancelLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-confirm-title"
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 id="backup-confirm-title" className="text-lg font-semibold text-slate-950">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {dangerLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
