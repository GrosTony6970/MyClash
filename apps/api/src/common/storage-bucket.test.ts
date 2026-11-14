import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ensurePublicBucket } from './storage-bucket';

type Storage = Parameters<typeof ensurePublicBucket>[0];

function storageWith(
  getBucket: { data: unknown; error: unknown },
  createBucket: { data?: unknown; error: unknown } = { data: {}, error: null },
) {
  const fake = {
    getBucket: vi.fn(async () => getBucket),
    createBucket: vi.fn(async () => createBucket),
  };
  return { fake, storage: fake as unknown as Storage };
}

const PNG_ONLY = new Set(['image/png']);

describe('ensurePublicBucket', () => {
  it('creates nothing when the bucket is already there', async () => {
    const { fake, storage } = storageWith({ data: { id: 'logos' }, error: null });
    await ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY);
    expect(fake.createBucket).not.toHaveBeenCalled();
  });

  it('creates a missing bucket as public, with its size cap and image types', async () => {
    const { fake, storage } = storageWith({ data: null, error: { message: 'Bucket not found' } });
    await ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY);
    expect(fake.createBucket).toHaveBeenCalledWith('logos', {
      public: true,
      fileSizeLimit: 1024,
      allowedMimeTypes: ['image/png'],
    });
  });

  it('takes a bucket another request created meanwhile as success', async () => {
    const { storage } = storageWith(
      { data: null, error: { message: 'Bucket not found' } },
      { error: { message: 'The resource already exists' } },
    );
    await expect(ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY)).resolves.toBeUndefined();
  });

  it('refuses with the storage message when the create fails for another reason', async () => {
    const { storage } = storageWith(
      { data: null, error: { message: 'Bucket not found' } },
      { error: { message: 'permission denied' } },
    );
    const refusal = ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY);
    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow('permission denied');
  });
});
