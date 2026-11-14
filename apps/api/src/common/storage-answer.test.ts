import { createClient, StorageApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { storageGaveNoAnswer } from './storage-answer';

describe('storageGaveNoAnswer', () => {
  it('is true for what the real library returns when nobody answers', async () => {
    const { error } = await createClient('http://127.0.0.1:1', 'key').storage.getBucket('b');
    expect(storageGaveNoAnswer(error)).toBe(true);
  });

  it('is true for a body that the storage timeout stopped mid-read', () => {
    const stopped = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(storageGaveNoAnswer(stopped)).toBe(true);
  });

  it.each([
    ['an answer storage gave', new StorageApiError('Bucket not found', 404, '404')],
    ['a body cut mid-read, about one object', new TypeError('terminated')],
    ['a plain error object', { message: 'Bucket not found' }],
    ['no error', null],
  ])('is false for %s', (_label, error) => {
    expect(storageGaveNoAnswer(error)).toBe(false);
  });
});
