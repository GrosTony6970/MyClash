import { describe, expect, it, vi } from 'vitest';
import type { PhotoBucketProbe, PhotoBucketSetting } from '../../photos/photo-bucket';
import { collectPhotoStorage } from './photo-storage-collector';

const ON: PhotoBucketSetting = {
  kind: 'on',
  config: {
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    bucket: 'myclash-photos',
    region: 'fr-par',
    endpoint: 'https://s3.fr-par.scw.cloud',
  },
};

describe('collectPhotoStorage', () => {
  it('reports not configured when the keys are off, and never probes', async () => {
    const probe = vi.fn();
    await expect(collectPhotoStorage({ kind: 'off' }, probe)).resolves.toEqual({
      configured: false,
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('names the missing keys when the keys are partly set', async () => {
    const probe = vi.fn();
    await expect(
      collectPhotoStorage({ kind: 'partial', missing: ['PHOTO_BUCKET_SECRET_KEY'] }, probe),
    ).rejects.toThrow('Photo bucket is partly configured: missing PHOTO_BUCKET_SECRET_KEY');
    expect(probe).not.toHaveBeenCalled();
  });

  it('times the probe', async () => {
    const ticks = [1_000, 1_042];
    await expect(
      collectPhotoStorage(ON, async () => {}, { now: () => ticks.shift() ?? 0 }),
    ).resolves.toEqual({ configured: true, bucket: 'myclash-photos', latencyMs: 42 });
  });

  it('aborts the probe and gives up at the timeout, even if the probe ignores the signal', async () => {
    let aborted = false;
    const probe: PhotoBucketProbe = (_config, signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise(() => {});
    };
    await expect(collectPhotoStorage(ON, probe, { timeoutMs: 20 })).rejects.toThrow(
      'Photo bucket did not answer within 20 ms',
    );
    expect(aborted).toBe(true);
  });

  it('passes the bucket error through', async () => {
    const probe: PhotoBucketProbe = async () => {
      throw new Error('NoSuchBucket');
    };
    await expect(collectPhotoStorage(ON, probe)).rejects.toThrow('NoSuchBucket');
  });
});
