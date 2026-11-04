import { describe, expect, it } from 'vitest';
import { photoStorageRows } from './photo-storage-rows';

const t = (key: string) => key;

describe('photoStorageRows', () => {
  it('shows the bucket and its response time when healthy', () => {
    expect(
      photoStorageRows(t, { status: 'healthy', bucket: 'myclash-photos', latencyMs: 42 }),
    ).toEqual([
      ['admin.systemVersions.runtimeHealth.photoStorage.bucket', 'myclash-photos'],
      ['admin.systemVersions.runtimeHealth.photoStorage.latency', '42 ms'],
    ]);
  });

  it('says no bucket is set when not configured', () => {
    expect(photoStorageRows(t, { status: 'not_configured' })).toEqual([
      [
        'admin.systemVersions.runtimeHealth.photoStorage.bucket',
        'admin.systemVersions.runtimeHealth.photoStorage.notConfigured',
      ],
    ]);
  });

  it('shows the error when unavailable', () => {
    expect(photoStorageRows(t, { status: 'unavailable', error: 'NoSuchBucket' })).toEqual([
      ['admin.systemVersions.runtimeHealth.unavailable', 'NoSuchBucket'],
    ]);
  });
});
