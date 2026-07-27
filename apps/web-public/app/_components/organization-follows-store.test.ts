import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureLoaded,
  getSnapshot,
  resetOrganizationFollowsStore,
  setFollowing,
  subscribe,
} from './organization-follows-store';

/**
 * The store is deliberately plain module state (no React), so it is testable
 * exactly like this: drive it directly and assert on the mocked fetch.
 */

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  resetOrganizationFollowsStore();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('organization-follows-store', () => {
  it('starts in loading with an empty set', () => {
    expect(getSnapshot()).toEqual({ status: 'loading', ids: new Set() });
  });

  it('loads the followed ids once, however many subscribers there are', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ organizationId: 'org-1' }, { organizationId: 'org-2' }]),
    );

    // Five buttons on one page must not be five requests — the whole point.
    const unsubscribes = Array.from({ length: 5 }, () => subscribe(() => {}));
    await ensureLoaded();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v1/me/follows/organizations');
    expect(getSnapshot().status).toBe('ready');
    expect(getSnapshot().ids.has('org-1')).toBe(true);
    for (const off of unsubscribes) off();
  });

  it('notifies subscribers when the set changes, and only then', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const listener = vi.fn();
    subscribe(listener);
    await ensureLoaded();
    expect(listener).toHaveBeenCalledTimes(1);

    const first = getSnapshot();
    await ensureLoaded();
    // A second ensureLoaded is a no-op: same snapshot object, no extra notify.
    expect(getSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats a 401 as anonymous rather than an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, false, 401));
    await ensureLoaded();
    expect(getSnapshot().status).toBe('anonymous');
  });

  it('falls back to anonymous when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await ensureLoaded();
    expect(getSnapshot().status).toBe('anonymous');
  });

  it('follows and unfollows, returning to the original set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ organizationId: 'org-1' }]));
    await ensureLoaded();

    fetchMock.mockResolvedValueOnce(jsonResponse({ following: true }));
    await setFollowing('org-2', true);
    expect(getSnapshot().ids).toEqual(new Set(['org-1', 'org-2']));
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toContain('/api/v1/me/follows/organizations');
    expect((init as RequestInit).method).toBe('POST');

    fetchMock.mockResolvedValueOnce(jsonResponse({ following: false }));
    await setFollowing('org-2', false);
    expect(getSnapshot().ids).toEqual(new Set(['org-1']));
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe('DELETE');
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/org-2');
  });

  it('reverts the optimistic update when the request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await ensureLoaded();

    fetchMock.mockResolvedValueOnce(jsonResponse(null, false, 500));
    const following = await setFollowing('org-9', true);

    expect(following).toBe(false);
    expect(getSnapshot().ids.has('org-9')).toBe(false);
  });
});
