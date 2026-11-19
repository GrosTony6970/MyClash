import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@myclash/api-client';
import { diskPruneOutcome, type DiskPruneResult } from './disk-prune';

/** Echoes the key and its values, so each test names exactly what the toast says. */
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}|${JSON.stringify(values)}` : key;

const PRUNED: DiskPruneResult = {
  ok: true,
  exitCode: 0,
  timedOut: false,
  freedBytes: 3 * 1024 ** 3,
  availBytes: 20 * 1024 ** 3,
  stderr: '',
};
const answered = (data: Partial<DiskPruneResult>): ApiResult<DiskPruneResult> => ({
  ok: true,
  data: { ...PRUNED, ...data },
});
const refused = (code: string | null, status = 409): ApiResult<DiskPruneResult> => ({
  ok: false,
  kind: 'http',
  status,
  detail: 'Another backup operation is already running.',
  validationErrors: null,
  code,
  details: null,
});
const failed = (message: string) =>
  `admin.systemVersions.host.prune.failed|${JSON.stringify({ message })}`;

describe('diskPruneOutcome', () => {
  it('says how much space the prune freed', () => {
    expect(diskPruneOutcome(answered({}), t)).toEqual({
      tone: 'success',
      message: 'admin.systemVersions.host.prune.success|{"size":"3.0 GB"}',
    });
  });

  it('words a held lock and a running deploy in the reader language', () => {
    expect(diskPruneOutcome(refused('ops_busy'), t)).toEqual({
      tone: 'error',
      message: failed('admin.backups.opsBusy'),
    });
    expect(diskPruneOutcome(refused('deploy_running'), t)).toEqual({
      tone: 'error',
      message: failed('admin.systemVersions.actions.deployRunning'),
    });
  });

  it('shows the step that failed, a timeout, or the generic failure', () => {
    expect(
      diskPruneOutcome(answered({ ok: false, exitCode: 1, stderr: ' no space \n' }), t),
    ).toEqual({ tone: 'error', message: failed('no space') });
    expect(diskPruneOutcome(answered({ ok: false, exitCode: null, timedOut: true }), t)).toEqual({
      tone: 'error',
      message: failed('admin.common.dockerComposeTimedOut'),
    });
    expect(diskPruneOutcome(answered({ ok: false, exitCode: 1 }), t)).toEqual({
      tone: 'error',
      message: failed('admin.common.componentActionFailed'),
    });
  });

  it('leaves any other failure to failureMessage, under the same words', () => {
    const outcome = diskPruneOutcome(refused(null, 500), t);
    expect(outcome?.tone).toBe('error');
    expect(outcome?.message.startsWith('admin.systemVersions.host.prune.failed|')).toBe(true);
    expect(diskPruneOutcome({ ok: false, kind: 'aborted' }, t)).toBeNull();
  });
});
