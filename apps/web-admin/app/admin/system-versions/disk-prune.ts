import { failureMessage, type ApiResult } from '@myclash/api-client';
import { formatBytes } from '@/lib/format-bytes';
import { systemActionRefusal } from './action-refusal';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** What `POST /api/v1/admin/system/host-info/prune` answers: the runner always sends each field. */
export interface DiskPruneResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  freedBytes: number;
  availBytes: number;
  stderr: string;
}

export interface DiskPruneOutcome {
  tone: 'success' | 'error';
  message: string;
}

/**
 * The toast after a "Free disk space" (ruling 897): how much space came back, or why it did not.
 * Null only for a request the page cancelled, which says nothing.
 */
export function diskPruneOutcome(
  r: ApiResult<DiskPruneResult>,
  t: Translate,
): DiskPruneOutcome | null {
  const failed = (message: string): DiskPruneOutcome => ({
    tone: 'error',
    message: t('admin.systemVersions.host.prune.failed', { message }),
  });
  if (!r.ok) {
    const reason =
      systemActionRefusal(r, t) ?? failureMessage(r, t, t('admin.common.componentActionFailed'));
    return reason === null ? null : failed(reason);
  }
  const result = r.data;
  if (result.ok) {
    return {
      tone: 'success',
      message: t('admin.systemVersions.host.prune.success', {
        size: formatBytes(result.freedBytes),
      }),
    };
  }
  const stderr = result.stderr.trim();
  if (stderr) return failed(stderr);
  return failed(
    result.timedOut
      ? t('admin.common.dockerComposeTimedOut')
      : t('admin.common.componentActionFailed'),
  );
}
