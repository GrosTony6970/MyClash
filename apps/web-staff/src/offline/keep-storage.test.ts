import { describe, expect, it, vi } from 'vitest';
import { keepTabletStorage } from './keep-storage';

/**
 * The pad's queue lives in the browser's storage (IndexedDB `myclash-staff`).
 * Unless the site asks for it to be kept, the browser may clear it when the
 * tablet runs short of space — and with it the hits that wait for a network.
 */
describe('keepTabletStorage', () => {
  const storage = (persisted: boolean, grants: boolean) => ({
    persisted: vi.fn(() => Promise.resolve(persisted)),
    persist: vi.fn(() => Promise.resolve(grants)),
  });

  it('asks the browser to keep the storage', async () => {
    const s = storage(false, true);

    await expect(keepTabletStorage(s)).resolves.toBe('kept');

    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it('asks nothing when the storage is already kept', async () => {
    const s = storage(true, true);

    await expect(keepTabletStorage(s)).resolves.toBe('kept');

    expect(s.persist).not.toHaveBeenCalled();
  });

  it('says when the browser refuses, and goes on', async () => {
    await expect(keepTabletStorage(storage(false, false))).resolves.toBe('refused');
  });

  it('goes on in a browser that has no such request', async () => {
    await expect(keepTabletStorage(undefined)).resolves.toBe('unsupported');
  });

  it('is asked when the queue first starts, and once only', async () => {
    const s = storage(false, true);
    vi.stubGlobal('navigator', { storage: s, onLine: true });
    try {
      const { getSyncEngine } = await import('./sync');
      getSyncEngine('http://api.test');
      getSyncEngine('http://api.test');
      await vi.waitFor(() => expect(s.persist).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('goes on when the request throws', async () => {
    const s = { persisted: () => Promise.reject(new Error('blocked')), persist: vi.fn() };

    await expect(keepTabletStorage(s)).resolves.toBe('refused');
  });
});
