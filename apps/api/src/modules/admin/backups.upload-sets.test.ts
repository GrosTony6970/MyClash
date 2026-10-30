import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminBackupsService } from './backups.service';
import { RestoreBackupDto } from './dto/admin-backups.dto';

/**
 * An uploaded backup is one night, `upload-<ts>` (rulings 213-218): its id at the door and in the
 * service, the scope its restore was shown with, its own Delete, and the runner's coded refusal.
 */
describe('AdminBackupsService and an uploaded night', () => {
  // An uploaded set is one night, `upload-<ts>` (ruling 213); the old per-file id is gone.
  it('takes an uploaded night by its id, at the door and in the service', async () => {
    const body = (backupId: string) => ({ location: 'upload', backupId, confirmed: true });
    expect(RestoreBackupDto.schema.safeParse(body('upload-20260505T030000Z')).success).toBe(true);
    expect(RestoreBackupDto.schema.safeParse(body('20260505T030000Z')).success).toBe(true);
    for (const backupId of ['upload-20260505T030000Z-abcd1234', 'anything-goes-here']) {
      expect(RestoreBackupDto.schema.safeParse(body(backupId)).success, backupId).toBe(false);
    }

    const fetchImpl = vi.fn();
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      service.restoreBackup({
        location: 'upload',
        backupId: '20260505T030000Z',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // A scope names what an upload restores: on a server set it would be ignored in silence.
  it('takes a scope with an upload only', () => {
    const body = (location: string) => ({
      location,
      backupId: location === 'upload' ? 'upload-20260505T030000Z' : '20260505T030000Z',
      scope: 'images',
      confirmed: true,
    });
    expect(RestoreBackupDto.schema.safeParse(body('upload')).success).toBe(true);
    expect(RestoreBackupDto.schema.safeParse(body('local')).success).toBe(false);
    expect(RestoreBackupDto.schema.safeParse(body('s3')).success).toBe(false);
  });

  // The night changed since the dialog: the runner's code reaches the screen, which words it.
  it("relays the runner's coded refusal with its code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'This upload changed since the page read it.',
          code: 'upload_changed',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const refusal = await service
      .restoreBackup({
        location: 'upload',
        backupId: 'upload-20260505T030000Z',
        scope: 'images',
        confirmed: true,
      })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(BadRequestException);
    expect((refusal as BadRequestException).getResponse()).toMatchObject({
      message: 'This upload changed since the page read it.',
      code: 'upload_changed',
    });
  });

  // The ops runner refuses a night that changed since the dialog said what it restores.
  it('forwards what the dialog said an upload restores', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ operation: {} }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await service.restoreBackup({
      location: 'upload',
      backupId: 'upload-20260505T030000Z',
      scope: 'images',
      confirmed: true,
    });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      location: 'upload',
      backupId: 'upload-20260505T030000Z',
      includeStorage: true,
      scope: 'images',
      confirmation: 'RESTORE MYCLASH upload-20260505T030000Z',
    });
  });

  // Ruling 218: an uploaded night has its own Delete.
  it('forwards the delete of an uploaded night to the ops runner', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          deleted: true,
          backupId: 'upload-20260505T030000Z',
          location: 'upload',
          deletedArtifacts: ['db-20260505T030000Z.sql.gz'],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await service.deleteBackup('upload-20260505T030000Z', 'upload');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://ops-runner:4075/backups/upload-20260505T030000Z?location=upload',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('refuses a delete whose id is not the shape of its location', async () => {
    const fetchImpl = vi.fn();
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    for (const [backupId, location] of [
      ['bad-id', 'local'],
      ['upload-20260505T030000Z', 'local'],
      ['20260505T030000Z', 'upload'],
      // The old layout: one folder per upload, with a random suffix.
      ['upload-20260505T030000Z-abcd1234', 'upload'],
      ['20260505T030000Z', 'elsewhere'],
    ] as const) {
      await expect(
        service.deleteBackup(backupId, location as 'local'),
        `${backupId} at ${location}`,
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
