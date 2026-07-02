'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';

type BackupLocation = 'local' | 's3' | 'upload';
type OperationStatus = 'queued' | 'running' | 'success' | 'failed';
type BackupFrequency = 'hourly' | 'every6h' | 'every12h' | 'daily' | 'weekly' | 'monthly';

const FREQUENCIES: BackupFrequency[] = [
  'hourly',
  'every6h',
  'every12h',
  'daily',
  'weekly',
  'monthly',
];

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const DELETE_ALL_TOKEN = 'DELETE ALL MYCLASH BACKUPS';

// Mirror of the API default (BACKUP_UPLOAD_MAX_BYTES). Client-side guard so an
// oversize file is rejected before a slow full-size upload the server rejects.
const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

// Warn below this many local backup sets — too few and one bad backup can
// leave no good copy to restore from.
const LOW_RETENTION_THRESHOLD = 3;

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
    finishedAt?: string | null;
    error?: string | null;
    localAvailable: boolean;
    cloudAvailable: boolean;
  } | null;
  runningOperation: BackupOperation | null;
}

interface BackupSchedule {
  enabled: boolean;
  frequency: BackupFrequency;
  hourUtc: number;
  minuteUtc: number;
  dayOfWeek: number;
  dayOfMonth: number;
  retentionCountLocal: number;
  retentionCountCloud: number;
  timezoneLabel: string;
  updatedAt: string | null;
  nextRunAt: string | null;
}

interface ScheduleForm {
  enabled: boolean;
  frequency: BackupFrequency;
  hourUtc: number;
  minuteUtc: number;
  dayOfWeek: number;
  dayOfMonth: number;
  retentionCountLocal: number;
  retentionCountCloud: number;
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
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>({
    enabled: true,
    frequency: 'daily',
    hourUtc: 3,
    minuteUtc: 0,
    dayOfWeek: 1,
    dayOfMonth: 1,
    retentionCountLocal: 14,
    retentionCountCloud: 60,
  });
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);
  const [deleteAllToken, setDeleteAllToken] = useState('');
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
  const [pollFailed, setPollFailed] = useState(false);
  // Outcome of the just-finished operation. Kept separate from `error`/
  // `operation` because load() resets those async — so a failed restore would
  // otherwise lose its only error surface once the refresh lands.
  const [finishedOp, setFinishedOp] = useState<BackupOperation | null>(null);

  // Reset the "polling failed" banner whenever we begin tracking a NEW
  // operation. Each poll swaps `operation` for a fresh object of the same id,
  // so compare ids (not references). Done during render per React's
  // derived-state guidance — a synchronous setState inside the polling effect
  // trips react-hooks/set-state-in-effect (cascading renders).
  const activeOpId =
    operation && ['queued', 'running'].includes(operation.status) ? operation.id : null;
  const [polledOpId, setPolledOpId] = useState<string | null>(activeOpId);
  if (activeOpId !== polledOpId) {
    setPolledOpId(activeOpId);
    setPollFailed(false);
  }

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
        setScheduleForm(scheduleToForm(nextSchedule));
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
          setPollFailed(false);
          setOperation(next);
          if (next.status === 'success' || next.status === 'failed') {
            // Persist the outcome in state that load() won't clobber, so a
            // failed restore keeps its error banner after the refresh lands.
            setFinishedOp(next);
            load();
          }
        })
        // Surface the outage instead of silently freezing on a stale
        // "running" — the interval keeps auto-retrying underneath.
        .catch(() => setPollFailed(true));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [apiUrl, load, operation, t]);

  const runBackup = () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    setFinishedOp(null);
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
    // Mirror the server's required filename shape so a wrong-named file is
    // rejected here with a precise message instead of after a full-size upload.
    if (!/^(db-\d{8}T\d{6}Z\.sql\.gz|storage-\d{8}T\d{6}Z\.tar\.gz)(\.gpg)?$/.test(file.name)) {
      setError(t('admin.backups.uploadInvalidType'));
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setError(t('admin.backups.uploadTooLarge', { max: formatBytes(UPLOAD_MAX_BYTES) }));
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
    setFinishedOp(null);
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
        setScheduleForm(scheduleToForm(nextSchedule));
        setNotice(t('admin.backups.scheduleSaved'));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.scheduleSaveError')),
      )
      .finally(() => setBusy(false));
  };

  const deleteAllBackups = () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    fetch(`${apiUrl}/api/v1/admin/backups`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: DELETE_ALL_TOKEN }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.backups.deleteAllError'));
        const result = (await res.json()) as {
          deletedLocalSets: number;
          deletedCloudSets: number;
        };
        setNotice(
          t('admin.backups.deleteAllSuccess', {
            local: result.deletedLocalSets,
            cloud: result.deletedCloudSets,
          }),
        );
        setPendingDeleteAll(false);
        setDeleteAllToken('');
        load();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.backups.deleteAllError')),
      )
      .finally(() => setBusy(false));
  };

  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('admin.backups.title')}
          </h1>
          <p className="text-muted text-sm mt-1">{t('admin.backups.description')}</p>
        </div>
        <button
          type="button"
          onClick={runBackup}
          disabled={busy || Boolean(operation && ['queued', 'running'].includes(operation.status))}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t('admin.backups.runBackup')}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {finishedOp?.status === 'failed' && (
        <Alert tone="error">
          {`${
            finishedOp.kind === 'restore'
              ? t('admin.backups.operationRestore')
              : t('admin.backups.operationBackup')
          }: ${t('admin.backups.operationStatuses.failed')}${
            finishedOp.error ? ` — ${finishedOp.error}` : ''
          }`}
        </Alert>
      )}
      {finishedOp?.status === 'success' && finishedOp.kind === 'restore' && (
        <Alert tone="success">{t('admin.backups.restoreComplete')}</Alert>
      )}

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

      {status?.lastBackup?.status === 'failed' && (
        <Alert tone="error">
          {`${t('admin.backups.lastBackup')}: ${t('admin.backups.statuses.failed')}${
            status.lastBackup.error ? ` — ${status.lastBackup.error}` : ''
          }`}
        </Alert>
      )}

      <form onSubmit={saveSchedule} className="mb-6 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('admin.backups.scheduleTitle')}
          </h2>
          <p className="text-sm text-muted">
            {schedule?.nextRunAt
              ? t('admin.backups.scheduleNextRun', {
                  nextRun: formatTimestamp(schedule.nextRunAt),
                })
              : t('admin.backups.scheduleDisabled')}
          </p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary">
            <input
              type="checkbox"
              checked={scheduleForm.enabled}
              onChange={(event) =>
                setScheduleForm((current) => ({ ...current, enabled: event.target.checked }))
              }
              className="h-4 w-4 rounded border-border"
            />
            {t('admin.backups.scheduleEnabled')}
          </label>

          <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
            {t('admin.backups.frequencyLabel')}
            <select
              value={scheduleForm.frequency}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  frequency: event.target.value as BackupFrequency,
                }))
              }
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              {FREQUENCIES.map((freq) => (
                <option key={freq} value={freq}>
                  {t(`admin.backups.frequencies.${freq}`)}
                </option>
              ))}
            </select>
          </label>

          {/* Hour input hidden for hourly — every hourly slot uses :minuteUtc only. */}
          {scheduleForm.frequency !== 'hourly' && (
            <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
              {t('admin.backups.scheduleHourUtc')}
              <input
                type="number"
                min={0}
                max={23}
                value={scheduleForm.hourUtc}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    hourUtc: clamp(Number(event.target.value), 0, 23),
                  }))
                }
                className="rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
            {t('admin.backups.scheduleMinuteUtc')}
            <input
              type="number"
              min={0}
              max={59}
              value={scheduleForm.minuteUtc}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  minuteUtc: clamp(Number(event.target.value), 0, 59),
                }))
              }
              className="rounded-md border border-border px-3 py-2 text-sm"
            />
          </label>

          {scheduleForm.frequency === 'weekly' && (
            <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
              {t('admin.backups.dayOfWeek')}
              <select
                value={scheduleForm.dayOfWeek}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    dayOfWeek: Number(event.target.value),
                  }))
                }
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                {WEEKDAY_KEYS.map((day, index) => (
                  <option key={day} value={index}>
                    {t(`admin.backups.weekdays.${day}`)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {scheduleForm.frequency === 'monthly' && (
            <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
              {t('admin.backups.dayOfMonth')}
              <input
                type="number"
                min={1}
                max={28}
                value={scheduleForm.dayOfMonth}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    dayOfMonth: clamp(Number(event.target.value), 1, 28),
                  }))
                }
                className="rounded-md border border-border px-3 py-2 text-sm"
              />
              <span className="text-xs font-normal text-muted">
                {t('admin.backups.dayOfMonthHint')}
              </span>
            </label>
          )}

          <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
            {t('admin.backups.retentionLocal')}
            <input
              type="number"
              min={1}
              max={365}
              value={scheduleForm.retentionCountLocal}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  retentionCountLocal: clamp(Number(event.target.value), 1, 365),
                }))
              }
              className="rounded-md border border-border px-3 py-2 text-sm"
            />
            <span className="text-xs font-normal text-muted">
              {t('admin.backups.retentionLocalHint')}
            </span>
            {scheduleForm.retentionCountLocal < LOW_RETENTION_THRESHOLD && (
              <span className="text-xs font-normal text-danger">
                {t('admin.backups.retentionLowWarning')}
              </span>
            )}
          </label>

          {status?.cloudConfigured && (
            <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
              {t('admin.backups.retentionCloud')}
              <input
                type="number"
                min={1}
                max={3650}
                value={scheduleForm.retentionCountCloud}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    retentionCountCloud: clamp(Number(event.target.value), 1, 3650),
                  }))
                }
                className="rounded-md border border-border px-3 py-2 text-sm"
              />
              <span className="text-xs font-normal text-muted">
                {t('admin.backups.retentionCloudHint')}
              </span>
            </label>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-strong px-4 py-2 text-sm font-semibold text-strong-foreground hover:opacity-90 disabled:opacity-50"
          >
            {t('admin.backups.scheduleSave')}
          </button>
        </div>
      </form>

      <section className="mb-6 rounded-lg border border-danger/30 bg-danger/10 p-4">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-danger">
          {t('admin.backups.dangerZoneTitle')}
        </h2>
        <p className="mt-1 text-sm text-danger">{t('admin.backups.dangerZoneDescription')}</p>
        <button
          type="button"
          onClick={() => {
            setDeleteAllToken('');
            setPendingDeleteAll(true);
          }}
          disabled={busy}
          className="mt-3 rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger-hover disabled:opacity-50"
        >
          {t('admin.backups.deleteAllButton')}
        </button>
      </section>

      {operation && (
        <section className="mb-6 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('admin.backups.currentOperation')}
            </h2>
            <span className="rounded-full bg-background px-2 py-1 text-xs font-medium text-foreground-secondary">
              {t(`admin.backups.operationStatuses.${operation.status}`)}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            {operation.kind === 'backup'
              ? t('admin.backups.operationBackup')
              : t('admin.backups.operationRestore')}
          </p>
          {pollFailed && ['queued', 'running'].includes(operation.status) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-sm text-danger">{t('admin.backups.pollError')}</p>
              <button
                type="button"
                onClick={() => load()}
                className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-background"
              >
                {t('admin.backups.retry')}
              </button>
            </div>
          )}
          {operation.error && <p className="mt-2 text-sm text-danger">{operation.error}</p>}
          {operation.logTail.length > 0 && (
            <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-strong p-3 text-xs text-strong-foreground">
              {operation.logTail.join('\n')}
            </pre>
          )}
        </section>
      )}

      <form onSubmit={uploadBackup} className="mb-6 rounded-lg border border-border p-4">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('admin.backups.uploadTitle')}
        </h2>
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
            className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground-secondary shadow-sm hover:bg-background focus:outline-none focus:ring-2 focus:ring-accent/30/30"
          >
            {t('admin.backups.browse')}
          </button>
          <p className="min-w-0 flex-1 rounded-md border border-dashed border-border bg-background px-3 py-2 text-sm text-foreground-secondary">
            {selectedFilename
              ? t('admin.backups.selectedFile', { file: selectedFilename })
              : t('admin.backups.noFileSelected')}
          </p>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            {t('admin.backups.stageUpload')}
          </button>
        </div>
      </form>

      <section className="rounded-lg border border-border">
        <div className="border-b border-border bg-background px-4 py-3">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('admin.backups.available')}
          </h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-muted">{t('admin.backups.loading')}</p>
        ) : backups.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('admin.backups.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-4 py-2">{t('admin.backups.timestamp')}</th>
                  <th className="px-4 py-2">{t('admin.backups.locations')}</th>
                  <th className="px-4 py-2">{t('admin.backups.totalSize')}</th>
                  <th className="px-4 py-2">{t('admin.backups.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => {
                  const sizes = backupSizes(backup);
                  return (
                    <tr key={backup.id} className="border-b border-border align-top">
                      <td className="px-4 py-3 font-mono text-xs text-foreground-secondary">
                        {formatTimestamp(backup.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <LocationBadges backup={backup} />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground-secondary">
                          {formatBytes(sizes.total)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {t('admin.backups.dbSize', { size: formatBytes(sizes.db) })}
                          {' · '}
                          {t('admin.backups.storageSize', { size: formatBytes(sizes.storage) })}
                        </p>
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
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-background text-sm font-medium text-foreground-secondary">
                  <td colSpan={3} className="px-4 py-3 text-right">
                    {t('admin.backups.grandTotal', {
                      count: backups.length,
                      size: formatBytes(grandTotalSize(backups)),
                    })}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
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
          bulletsTitle={t('admin.backups.restoreScopeTitle')}
          bullets={[
            t('admin.backups.restoreScopeDb', {
              timestamp: formatTimestamp(pendingRestore.backup.timestamp),
            }),
            t('admin.backups.restoreScopeStorage'),
            t('admin.backups.restoreScopeServices'),
          ]}
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

      {pendingDeleteAll && (
        <DeleteAllDialog
          token={deleteAllToken}
          onTokenChange={setDeleteAllToken}
          busy={busy}
          onCancel={() => {
            setPendingDeleteAll(false);
            setDeleteAllToken('');
          }}
          onConfirm={deleteAllBackups}
        />
      )}
    </main>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

function scheduleToForm(schedule: BackupSchedule): ScheduleForm {
  return {
    enabled: schedule.enabled,
    frequency: schedule.frequency,
    hourUtc: schedule.hourUtc,
    minuteUtc: schedule.minuteUtc,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    retentionCountLocal: schedule.retentionCountLocal,
    retentionCountCloud: schedule.retentionCountCloud,
  };
}

function DeleteAllDialog({
  token,
  onTokenChange,
  busy,
  onCancel,
  onConfirm,
}: {
  token: string;
  onTokenChange: (value: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const tokenMatches = token === DELETE_ALL_TOKEN;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-all-title"
        className="w-full max-w-lg rounded-lg bg-surface p-5 shadow-xl"
      >
        <h2
          id="delete-all-title"
          className="font-display font-semibold text-lg sm:text-xl text-danger"
        >
          {t('admin.backups.deleteAllConfirmTitle')}
        </h2>
        <p className="mt-3 text-sm leading-6 text-foreground-secondary">
          {t('admin.backups.deleteAllConfirmBody')}
        </p>
        <label className="mt-4 grid gap-1 text-sm font-semibold text-foreground-secondary">
          {t('admin.backups.deleteAllConfirmTokenLabel')}
          <input
            type="text"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder={t('admin.backups.deleteAllConfirmTokenPlaceholder')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on the destructive-confirm token input in modal
            autoFocus
            className="rounded-md border border-border px-3 py-2 font-mono text-sm"
          />
        </label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !tokenMatches}
            className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger-hover disabled:opacity-40"
          >
            {t('admin.backups.deleteAllButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Alert({ tone, children }: { tone: 'error' | 'success'; children: string }) {
  return (
    <div
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${
        tone === 'error'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-success/30 bg-success/10 text-success'
      }`}
    >
      {children}
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium uppercase text-muted">{label}</p>
      <p className="mt-2 text-sm font-semibold text-foreground">{value}</p>
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
            className="rounded-full bg-background px-2 py-1 text-xs font-medium text-foreground-secondary"
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
            available ? 'border-border bg-surface' : 'border-border bg-background opacity-70'
          }`}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t(`admin.backups.locationsMap.${location}`)}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`${props.apiUrl}/api/v1/admin/backups/${props.backup.id}/download?location=${location}&artifact=db`}
              aria-disabled={!available}
              className={`rounded-md border border-border px-3 py-1.5 text-xs font-semibold ${
                available ? 'text-foreground hover:bg-background' : 'pointer-events-none text-muted'
              }`}
            >
              {t('admin.backups.downloadDb')}
            </a>
            <button
              type="button"
              onClick={() => props.onRestore(location)}
              disabled={props.busy || !available}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:bg-border disabled:text-muted"
            >
              {t('admin.backups.restoreFrom', {
                location: t(`admin.backups.locationsMap.${location}`),
              })}
            </button>
            <button
              type="button"
              onClick={() => props.onDelete(location)}
              disabled={props.busy || !available}
              className="rounded-md border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:border-border disabled:text-muted disabled:hover:bg-transparent"
            >
              {t('admin.backups.deleteFrom', {
                location: t(`admin.backups.locationsMap.${location}`),
              })}
            </button>
          </div>
          {!available && (
            <p className="mt-2 text-xs text-muted">{t('admin.backups.locationUnavailable')}</p>
          )}
        </div>
      ))}
      {props.backup.upload?.available && (
        <div className="rounded-md border border-info/30 bg-info/10 p-3 md:col-span-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-info">
            {t('admin.backups.locationsMap.upload')}
          </p>
          <button
            type="button"
            onClick={() => props.onRestore('upload')}
            disabled={props.busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:bg-border disabled:text-muted"
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
  const time = `${String(schedule.hourUtc).padStart(2, '0')}:${String(schedule.minuteUtc).padStart(2, '0')}`;
  const minute = String(schedule.minuteUtc).padStart(2, '0');
  const weekday = t(`admin.backups.weekdaysShort.${WEEKDAY_KEYS[schedule.dayOfWeek] ?? 'mon'}`);
  switch (schedule.frequency) {
    case 'hourly':
      return t('admin.backups.scheduleSummary.hourly', { minute });
    case 'every6h':
      return t('admin.backups.scheduleSummary.every6h', { time });
    case 'every12h':
      return t('admin.backups.scheduleSummary.every12h', { time });
    case 'weekly':
      return t('admin.backups.scheduleSummary.weekly', { weekday, time });
    case 'monthly':
      return t('admin.backups.scheduleSummary.monthly', { day: schedule.dayOfMonth, time });
    case 'daily':
    default:
      return t('admin.backups.scheduleSummary.daily', { time });
  }
}

/**
 * Returns the size breakdown for a single backup set.
 *
 * Per-kind, take the max across locations: a backup that's mirrored locally
 * AND in S3 stores the same artifact twice, but we report the disk footprint
 * of the backup itself — not bytes-spent-across-every-location.
 */
function backupSizes(backup: BackupSet): { db: number; storage: number; total: number } {
  const byKind: Record<'db' | 'storage', number> = { db: 0, storage: 0 };
  const allArtifacts = [
    ...backup.local.artifacts,
    ...backup.cloud.artifacts,
    ...(backup.upload?.artifacts ?? []),
  ];
  for (const artifact of allArtifacts) {
    byKind[artifact.kind] = Math.max(byKind[artifact.kind], artifact.sizeBytes);
  }
  return { db: byKind.db, storage: byKind.storage, total: byKind.db + byKind.storage };
}

function grandTotalSize(backups: BackupSet[]): number {
  return backups.reduce((acc, backup) => acc + backupSizes(backup).total, 0);
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
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ConfirmDialog({
  title,
  body,
  bulletsTitle,
  bullets,
  dangerLabel,
  cancelLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  bulletsTitle?: string;
  bullets?: string[];
  dangerLabel: string;
  cancelLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-confirm-title"
        className="w-full max-w-lg rounded-lg bg-surface p-5 shadow-xl"
      >
        <h2
          id="backup-confirm-title"
          className="font-display font-semibold text-lg sm:text-xl text-foreground"
        >
          {title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-foreground-secondary">{body}</p>
        {bullets && bullets.length > 0 && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-3">
            {bulletsTitle && <p className="text-sm font-semibold text-danger">{bulletsTitle}</p>}
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground-secondary">
              {bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {dangerLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
