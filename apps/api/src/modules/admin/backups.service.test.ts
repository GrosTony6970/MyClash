import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminBackupsService } from './backups.service';

async function writeBackup(rootDir: string, filename: string, content = 'backup') {
  const target = path.join(rootDir, 'backups', 'nightly', filename);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

describe('AdminBackupsService', () => {
  it('falls back to local backup inventory when the ops runner is absent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'myclash-backups-api-'));
    await writeBackup(dir, 'db-20260505T030000Z.sql.gz');
    await writeBackup(dir, 'storage-20260505T030000Z.tar.gz.gpg');

    const service = new AdminBackupsService({
      rootDir: dir,
      backupsDir: path.join(dir, 'backups'),
    });

    const result = await service.listBackups();
    const status = await service.getStatus();

    expect(result.backups).toHaveLength(1);
    expect(result.backups[0]).toEqual(
      expect.objectContaining({
        id: '20260505T030000Z',
        local: expect.objectContaining({ available: true }),
        cloud: expect.objectContaining({ available: false }),
      }),
    );
    expect(result.backups[0]?.local.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'db', encrypted: false }),
        expect.objectContaining({ kind: 'storage', encrypted: true }),
      ]),
    );
    expect(status.lastBackup).toEqual(
      expect.objectContaining({ timestamp: '20260505T030000Z', localAvailable: true }),
    );
  });

  it('requires the ops runner for mutating operations', async () => {
    const service = new AdminBackupsService();

    await expect(service.triggerBackup()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('enforces restore confirmation before calling the ops runner', async () => {
    const fetchImpl = vi.fn();
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      service.restoreBackup({
        location: 'local',
        backupId: '20260505T030000Z',
        confirmation: 'RESTORE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts restore requests to the ops runner after validation', async () => {
    const operation = {
      id: 'op-1',
      kind: 'restore',
      status: 'running',
      startedAt: '2026-05-05T03:00:00.000Z',
      logTail: [],
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ operation }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075/',
      opsRunnerSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      service.restoreBackup({
        location: 's3',
        backupId: '20260505T030000Z',
        confirmation: 'RESTORE MYCLASH 20260505T030000Z',
      }),
    ).resolves.toEqual({ operation });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://ops-runner:4075/operations/restore',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    );
  });

  it('validates uploaded backup filenames and size', async () => {
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      uploadMaxBytes: 3,
    });

    await expect(service.uploadBackup('notes.txt', Buffer.from('x'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.uploadBackup('db-20260505T030000Z.sql.gz', Buffer.from('toolarge')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
