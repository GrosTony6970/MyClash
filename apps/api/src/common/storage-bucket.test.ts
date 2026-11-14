import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createClient, StorageApiError } from '@supabase/supabase-js';
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
/** What storage-js returns when storage answers that the bucket does not exist. */
const NOT_FOUND = { data: null, error: new StorageApiError('Bucket not found', 404, '404') };

describe('ensurePublicBucket', () => {
  it('creates nothing when the bucket is already there', async () => {
    const { fake, storage } = storageWith({ data: { id: 'logos' }, error: null });
    await ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY);
    expect(fake.createBucket).not.toHaveBeenCalled();
  });

  it('creates a missing bucket as public, with its size cap and image types', async () => {
    const { fake, storage } = storageWith(NOT_FOUND);
    await ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY);
    expect(fake.createBucket).toHaveBeenCalledWith('logos', {
      public: true,
      fileSizeLimit: 1024,
      allowedMimeTypes: ['image/png'],
    });
  });

  it('takes a bucket another request created meanwhile as success', async () => {
    const { storage } = storageWith(NOT_FOUND, {
      error: { message: 'The resource already exists' },
    });
    await expect(ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY)).resolves.toBeUndefined();
  });

  it('refuses with the storage message when the create fails for another reason', async () => {
    const { storage } = storageWith(NOT_FOUND, { error: { message: 'permission denied' } });
    const refusal = ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY);
    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow('permission denied');
  });

  it('asks nothing more of a storage that gave no answer (down, or timed out)', async () => {
    // The real library's "no answer": a client pointed at a port nobody listens on.
    const noAnswer = await createClient('http://127.0.0.1:1', 'key').storage.getBucket('logos');
    expect(noAnswer.error).toBeTruthy();
    expect(noAnswer.error).not.toBeInstanceOf(StorageApiError);
    const { fake, storage } = storageWith(noAnswer);
    // A server fault (503, reported), not the caller's mistake.
    await expect(ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fake.createBucket).not.toHaveBeenCalled();
  });

  it('a create that gets no answer is a 503 too, not a refusal', async () => {
    const noAnswer = await createClient('http://127.0.0.1:1', 'key').storage.createBucket('logos');
    const { storage } = storageWith(NOT_FOUND, noAnswer);
    await expect(ensurePublicBucket(storage, 'logos', 1024, PNG_ONLY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
