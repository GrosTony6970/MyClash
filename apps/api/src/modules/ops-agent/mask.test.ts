import { describe, expect, it } from 'vitest';
import type { BackupStatusDto } from '../admin/dto/admin-backups.dto';
import type { SystemVersionsResponseDto } from '../admin/dto/system-versions.dto';
import {
  maskActionResult,
  maskBackupStarted,
  maskBackups,
  maskVersions,
  withoutErrorText,
} from './mask';

// Slice 4: an action's answer on the door holds no shell output and no error text.
describe('the answers of the door actions', () => {
  it('an action result keeps six fields, built by name', () => {
    // What the runner answers, extra fields and all.
    const fromRunner = {
      ok: true,
      exitCode: 0,
      timedOut: false,
      stdout: 'marker-out',
      stderr: 'marker-err',
      error: 'marker-error',
      extra: 'marker-extra',
    };
    const answer = maskActionResult(fromRunner, 'worker', 'restart');
    expect(answer).toEqual({
      ok: true,
      service: 'worker',
      action: 'restart',
      exitCode: 0,
      timedOut: false,
      scheduled: false,
    });
  });

  it('a scheduled renewal says so, with no exit code yet', () => {
    expect(
      maskActionResult({ ok: true, scheduled: true, exitCode: null }, 'traefik', 'renew-certs'),
    ).toEqual({
      ok: true,
      service: 'traefik',
      action: 'renew-certs',
      exitCode: null,
      timedOut: false,
      scheduled: true,
    });
  });

  it('a started backup keeps its id, kind, status and start, never its shell lines', () => {
    const answer = maskBackupStarted({
      operation: {
        id: 'op-1',
        kind: 'backup',
        status: 'running',
        startedAt: 's',
        logTail: ['marker-line'],
        error: 'marker-error',
      },
    } as never);
    expect(answer).toEqual({
      operation: { id: 'op-1', kind: 'backup', status: 'running', startedAt: 's' },
    });
  });
});

const LOGIN = 'marker-login-7f3';

function versions(): SystemVersionsResponseDto {
  return {
    generatedAt: '2026-11-18T10:00:00Z',
    deploy: {
      kind: 'deploy',
      previousCommit: 'aaa111',
      deployedCommit: 'bbb222',
      deployedAt: '2026-11-18T09:00:00Z',
      deployedBy: LOGIN,
      backupFile: 'db-20261118T085900Z.sql.gz',
    },
    groups: [
      {
        key: 'app',
        label: 'Application',
        components: [
          { key: 'myclash', label: 'MyClash app', version: '1.2.3', source: 'manifest' },
        ],
      },
      {
        key: 'deploy',
        label: 'Deploy',
        components: [
          { key: 'deployedCommit', label: 'Deployed commit', version: 'bbb222', source: 'deploy' },
          { key: 'deployedBy', label: 'Deployed by', version: LOGIN, source: 'deploy' },
          {
            key: 'backupFile',
            label: 'Backup file',
            version: 'db-20261118T085900Z.sql.gz',
            source: 'deploy',
          },
        ],
      },
    ],
  };
}

describe('maskVersions', () => {
  it('leaves out who deployed, in the deploy block and in the deploy group', () => {
    const text = JSON.stringify(maskVersions(versions()));
    expect(text).not.toContain(LOGIN);
    expect(text).not.toContain('deployedBy');
  });

  it('keeps every other deploy field and component', () => {
    const masked = maskVersions(versions());
    expect(masked.deploy).toEqual({
      kind: 'deploy',
      previousCommit: 'aaa111',
      deployedCommit: 'bbb222',
      deployedAt: '2026-11-18T09:00:00Z',
      backupFile: 'db-20261118T085900Z.sql.gz',
    });
    expect(masked.generatedAt).toBe('2026-11-18T10:00:00Z');
    expect(masked.groups.map((g) => g.components.map((c) => c.key))).toEqual([
      ['myclash'],
      ['deployedCommit', 'backupFile'],
    ]);
  });

  // Slice 6, ruling 908: the manifest is written before the build; the API's own GIT_COMMIT is
  // what compose gave the running container.
  it('adds the commit the API container was started with', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    expect(maskVersions(versions(), { GIT_COMMIT: commit }).runningCommit).toBe(commit);
  });

  it('says unknown when that commit is missing or not 40 hex characters', () => {
    for (const env of [
      {},
      { GIT_COMMIT: 'unknown' },
      { GIT_COMMIT: 'bbb222' },
      { GIT_COMMIT: '' },
    ]) {
      expect(maskVersions(versions(), env).runningCommit).toBe('unknown');
    }
  });
});

function backups(): BackupStatusDto {
  return {
    generatedAt: '2026-11-18T10:00:00Z',
    cloudConfigured: true,
    lastBackup: {
      timestamp: '20261118T030000Z',
      status: 'failed',
      finishedAt: '2026-11-18T03:04:00Z',
      error: 'marker-error',
      code: 'scheduled_backup_missed',
      localAvailable: true,
      cloudAvailable: false,
    },
    runningOperation: {
      id: 'op-1',
      kind: 'backup',
      status: 'running',
      startedAt: '2026-11-18T10:00:00Z',
      finishedAt: '2026-11-18T10:05:00Z',
      source: 'local',
      backupId: '20261118T100000Z',
      logTail: ['marker-line'],
      error: 'marker-error',
      code: null,
    },
    // The ops runner's JSON arrives untyped (backups.service.ts): an extra key must not pass.
    ...({ extra: 'marker-extra' } as object),
  } as BackupStatusDto;
}

describe('maskBackups', () => {
  it('leaves out the shell output, both error texts and anything it does not know', () => {
    const text = JSON.stringify(maskBackups(backups()));
    expect(text).not.toContain('marker-line');
    expect(text).not.toContain('marker-error');
    expect(text).not.toContain('marker-extra');
    expect(text).not.toContain('logTail');
  });

  it('keeps the fields that say how backups stand', () => {
    expect(maskBackups(backups())).toEqual({
      generatedAt: '2026-11-18T10:00:00Z',
      cloudConfigured: true,
      lastBackup: {
        timestamp: '20261118T030000Z',
        status: 'failed',
        finishedAt: '2026-11-18T03:04:00Z',
        code: 'scheduled_backup_missed',
        localAvailable: true,
        cloudAvailable: false,
      },
      runningOperation: {
        id: 'op-1',
        kind: 'backup',
        status: 'running',
        startedAt: '2026-11-18T10:00:00Z',
        finishedAt: '2026-11-18T10:05:00Z',
        source: 'local',
        backupId: '20261118T100000Z',
        code: null,
      },
    });
  });

  it('passes "nothing running" and "no backup yet" through as null', () => {
    const masked = maskBackups({ ...backups(), lastBackup: null, runningOperation: null });
    expect(masked.lastBackup).toBeNull();
    expect(masked.runningOperation).toBeNull();
  });
});

describe('withoutErrorText', () => {
  // A Postgres or shell message can quote a row: error texts stay withheld (ruling 870).
  const health = {
    checkedAt: '2026-11-18T10:00:00Z',
    overall: 'unavailable',
    database: { status: 'unavailable', error: 'duplicate key (email)=(marker@example.test)' },
    redis: { status: 'unavailable', error: 'timeout' },
    disk: { status: 'unavailable', error: 'ops runner said: marker-shell-line' },
    queues: { status: 'healthy', queues: [{ name: 'q', active: 1, reason: null }] },
  };

  it('withholds every error text, however deep, and says that it did', () => {
    const masked = withoutErrorText(health);
    const text = JSON.stringify(masked);
    expect(text).not.toContain('marker');
    expect(masked.database.error).toBe('withheld');
    expect(masked.disk.error).toBe('withheld');
  });

  it("keeps the API's own error codes, and every other field", () => {
    const masked = withoutErrorText(health);
    expect(masked.redis.error).toBe('timeout');
    expect(masked.database.status).toBe('unavailable');
    expect(masked.queues).toEqual(health.queues);
    expect(masked.checkedAt).toBe('2026-11-18T10:00:00Z');
  });

  it('reaches errors inside lists, as the certificate read has one per host', () => {
    const tls = { hosts: [{ host: 'app.example.test', reachable: false, error: 'marker-tls' }] };
    expect(withoutErrorText(tls).hosts[0]!.error).toBe('withheld');
  });
});
