import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mutateAll,
  mutateSchedule,
  NETWORK_FAILURE_STATUS,
  ScheduleMutationError,
} from './schedule-mutations';

/** Minimal Response stand-in — jsdom has no fetch, so we own both sides. */
function response(init: {
  ok?: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}): Response {
  return {
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    status: init.status,
    statusText: init.statusText ?? '',
    json: init.json ?? (() => Promise.resolve(null)),
  } as unknown as Response;
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl as unknown as typeof fetch));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mutateSchedule', () => {
  it('sends credentials so the organiser cookie is on the wire', async () => {
    let seen: RequestInit | undefined;
    stubFetch((_url, init) => {
      seen = init;
      return Promise.resolve(response({ status: 200 }));
    });

    await mutateSchedule('/api/v1/matches/m1/schedule', {
      method: 'PATCH',
      body: { liceId: 'l1' },
    });

    expect(seen?.credentials).toBe('include');
    expect(seen?.method).toBe('PATCH');
    expect(seen?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(seen?.body).toBe(JSON.stringify({ liceId: 'l1' }));
  });

  it('omits the body and its Content-Type for a bodyless verb', async () => {
    let seen: RequestInit | undefined;
    stubFetch((_url, init) => {
      seen = init;
      return Promise.resolve(response({ status: 204 }));
    });

    await mutateSchedule('/api/v1/events/e1/programme/blocks/b1', { method: 'DELETE' });

    expect(seen?.body).toBeUndefined();
    expect(seen?.headers).toBeUndefined();
  });

  it('returns the parsed body', async () => {
    stubFetch(() =>
      Promise.resolve(
        response({ status: 201, json: () => Promise.resolve({ block: { id: 'b9' } }) }),
      ),
    );

    await expect(
      mutateSchedule('/api/v1/events/e1/programme/blocks', { method: 'POST', body: {} }),
    ).resolves.toEqual({ block: { id: 'b9' } });
  });

  it('returns null for 204 without trying to parse a body', async () => {
    const json = vi.fn(() => Promise.resolve(null));
    stubFetch(() => Promise.resolve(response({ status: 204, json })));

    await expect(mutateSchedule('/api/v1/lices/l1', { method: 'DELETE' })).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  // The whole point of the module: a non-OK response must be impossible to
  // ignore. This is the case that shipped broken — a rejected drag left the
  // chip moved on screen and unmoved in the database.
  it('throws on a non-OK response, carrying the server message', async () => {
    stubFetch(() =>
      Promise.resolve(
        response({ status: 403, json: () => Promise.resolve({ message: 'Event is archived' }) }),
      ),
    );

    const err = await mutateSchedule('/api/v1/matches/m1/schedule', {
      method: 'PATCH',
      body: {},
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ScheduleMutationError);
    expect((err as ScheduleMutationError).message).toBe('Event is archived');
    expect((err as ScheduleMutationError).status).toBe(403);
    expect((err as ScheduleMutationError).url).toBe('/api/v1/matches/m1/schedule');
  });

  it('joins a class-validator message array', async () => {
    stubFetch(() =>
      Promise.resolve(
        response({
          status: 400,
          json: () =>
            Promise.resolve({ message: ['liceId must be a UUID', 'scheduledAt is invalid'] }),
        }),
      ),
    );

    await expect(
      mutateSchedule('/api/v1/matches/m1/schedule', { method: 'PATCH', body: {} }),
    ).rejects.toThrow('liceId must be a UUID, scheduledAt is invalid');
  });

  it('falls back to the status line when the error body is not JSON', async () => {
    stubFetch(() =>
      Promise.resolve(
        response({
          status: 502,
          statusText: 'Bad Gateway',
          json: () => Promise.reject(new Error('not json')),
        }),
      ),
    );

    await expect(mutateSchedule('/x', { method: 'POST', body: {} })).rejects.toThrow(
      '502 Bad Gateway',
    );
  });

  it('falls back to the status line when the body has no usable message', async () => {
    stubFetch(() =>
      Promise.resolve(
        response({
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({}),
        }),
      ),
    );

    await expect(mutateSchedule('/x', { method: 'POST', body: {} })).rejects.toThrow(
      '500 Internal Server Error',
    );
  });

  it('turns a network failure into the same error type, with status 0', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const err = await mutateSchedule('/x', { method: 'POST', body: {} }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ScheduleMutationError);
    expect((err as ScheduleMutationError).status).toBe(NETWORK_FAILURE_STATUS);
    expect((err as ScheduleMutationError).message).toBe('Failed to fetch');
  });
});

describe('mutateAll', () => {
  it('reports no failures when every call succeeds', async () => {
    stubFetch(() => Promise.resolve(response({ status: 200 })));
    const calls = ['m1', 'm2', 'm3'].map(
      (id) => () => mutateSchedule(`/api/v1/matches/${id}/schedule`, { method: 'PATCH', body: {} }),
    );

    await expect(mutateAll(calls)).resolves.toEqual({ total: 3, failures: [] });
  });

  // A drag that displaces neighbours fires one PATCH per moved row. Promise.all
  // would reject on the first failure and leave the rest unreported.
  it('attempts every call and collects the failures', async () => {
    const attempted: string[] = [];
    stubFetch((url) => {
      attempted.push(url);
      return Promise.resolve(
        url.includes('m2')
          ? response({ status: 403, json: () => Promise.resolve({ message: 'nope' }) })
          : response({ status: 200 }),
      );
    });
    const calls = ['m1', 'm2', 'm3'].map(
      (id) => () => mutateSchedule(`/api/v1/matches/${id}/schedule`, { method: 'PATCH', body: {} }),
    );

    const result = await mutateAll(calls);

    expect(attempted).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toBe('nope');
  });

  it('does not reject even when every call fails', async () => {
    stubFetch(() => Promise.reject(new TypeError('offline')));
    const calls = ['m1', 'm2'].map(
      (id) => () => mutateSchedule(`/api/v1/matches/${id}/schedule`, { method: 'PATCH', body: {} }),
    );

    const result = await mutateAll(calls);

    expect(result.failures).toHaveLength(2);
    expect(result.failures.every((f) => f instanceof ScheduleMutationError)).toBe(true);
  });

  it('wraps a non-ScheduleMutationError rejection rather than dropping it', async () => {
    const result = await mutateAll([() => Promise.reject(new Error('thrown before the request'))]);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toBeInstanceOf(ScheduleMutationError);
    expect(result.failures[0]?.message).toBe('thrown before the request');
  });

  it('handles an empty fan-out', async () => {
    await expect(mutateAll([])).resolves.toEqual({ total: 0, failures: [] });
  });
});
