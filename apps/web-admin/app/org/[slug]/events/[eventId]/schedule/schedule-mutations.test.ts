import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mutateAll,
  mutateSchedule,
  NETWORK_FAILURE_STATUS,
  ScheduleMutationError,
} from './schedule-mutations';

/**
 * Minimal Response stand-in — jsdom has no fetch, so we own both sides.
 *
 * It answers `text()`, not `json()`: the seam parses one string body and hands
 * the result to every reader, so a double that only spoke `json()` came back as
 * a NETWORK failure for every case here and told us nothing.
 */
function response(init: { ok?: boolean; status: number; body?: string }): Response {
  return {
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    status: init.status,
    text: () => Promise.resolve(init.body ?? ''),
  } as unknown as Response;
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl as unknown as typeof fetch));
}

function contentTypeOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('Content-Type');
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
    expect(contentTypeOf(seen)).toBe('application/json');
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
    expect(contentTypeOf(seen)).toBeNull();
  });

  // The board resolves the API base URL once and hands the same absolute string
  // to every write, so this module must not prepend anything of its own.
  it('keeps the caller url untouched', async () => {
    let seen = '';
    stubFetch((url) => {
      seen = url;
      return Promise.resolve(response({ status: 200 }));
    });

    await mutateSchedule('https://api.example.test/api/v1/lices/l1', { method: 'PATCH', body: {} });

    expect(seen).toBe('https://api.example.test/api/v1/lices/l1');
  });

  it('returns the parsed body', async () => {
    stubFetch(() =>
      Promise.resolve(response({ status: 201, body: JSON.stringify({ block: { id: 'b9' } }) })),
    );

    await expect(
      mutateSchedule('/api/v1/events/e1/programme/blocks', { method: 'POST', body: {} }),
    ).resolves.toEqual({ block: { id: 'b9' } });
  });

  it('returns null for 204 without trying to read a body', async () => {
    const text = vi.fn(() => Promise.resolve(''));
    stubFetch(() => Promise.resolve({ ok: true, status: 204, text } as unknown as Response));

    await expect(mutateSchedule('/api/v1/lices/l1', { method: 'DELETE' })).resolves.toBeNull();
    expect(text).not.toHaveBeenCalled();
  });

  // The whole point of the module: a non-OK response must be impossible to
  // ignore. This is the case that shipped broken — a rejected drag left the
  // chip moved on screen and unmoved in the database.
  it('throws on a non-OK response, carrying the server reason', async () => {
    stubFetch(() =>
      Promise.resolve(
        response({ status: 403, body: JSON.stringify({ message: 'Event is archived' }) }),
      ),
    );

    const err = (await mutateSchedule('/api/v1/matches/m1/schedule', {
      method: 'PATCH',
      body: {},
    }).catch((e: unknown) => e)) as ScheduleMutationError;

    expect(err).toBeInstanceOf(ScheduleMutationError);
    expect(err.message).toBe('Event is archived');
    expect(err.status).toBe(403);
    expect(err.url).toBe('/api/v1/matches/m1/schedule');
    expect(err.failure.kind).toBe('unauthenticated');
  });

  // Was: "surfaces a class-validator refusal as the one sentence the API
  // sends", asserting only the first rejected field. That WAS the contract of
  // the hand-rolled `messageFrom`, which read `body.message` and stopped there —
  // so an organiser who left a lice and a start time both wrong was told about
  // the lice, fixed it, and was then told about the time. The whole list ships
  // under `details.validationErrors`, and the failure now carries it.
  it('carries every field a class-validator refusal rejected, not just the first', async () => {
    stubFetch(() =>
      Promise.resolve(
        response({
          status: 400,
          body: JSON.stringify({
            message: 'liceId must be a UUID',
            details: { validationErrors: ['liceId must be a UUID', 'scheduledAt is invalid'] },
          }),
        }),
      ),
    );

    const err = (await mutateSchedule('/api/v1/matches/m1/schedule', {
      method: 'PATCH',
      body: {},
    }).catch((e: unknown) => e)) as ScheduleMutationError;

    expect(err.failure).toMatchObject({
      kind: 'http',
      status: 400,
      detail: 'liceId must be a UUID',
      validationErrors: ['liceId must be a UUID', 'scheduledAt is invalid'],
    });
  });

  // Was: asserts the thrown message is the literal "502 Bad Gateway". That
  // string was invented here, in English, and went straight into the board's
  // banner — prose no translator ever saw. An unreadable body means the API did
  // not answer for itself; the failure says so and the component picks words.
  it('invents no prose when the error body is not JSON', async () => {
    stubFetch(() => Promise.resolve(response({ status: 502, body: '<html>Bad Gateway</html>' })));

    const err = (await mutateSchedule('/x', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )) as ScheduleMutationError;

    expect(err.status).toBe(502);
    expect(err.failure).toMatchObject({ kind: 'http', status: 502, detail: null });
  });

  it('invents no prose when the body has no usable message', async () => {
    stubFetch(() => Promise.resolve(response({ status: 500, body: '{}' })));

    const err = (await mutateSchedule('/x', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )) as ScheduleMutationError;

    expect(err.status).toBe(500);
    expect(err.failure).toMatchObject({ kind: 'http', status: 500, detail: null });
  });

  it('turns a network failure into the same error type, with status 0', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const err = (await mutateSchedule('/x', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )) as ScheduleMutationError;

    expect(err).toBeInstanceOf(ScheduleMutationError);
    expect(err.status).toBe(NETWORK_FAILURE_STATUS);
    expect(err.failure.kind).toBe('network');
  });

  // An abort still has to reach the caller as a throw. Swallowing it would
  // resolve `null`, which reads as a write that landed and returned nothing.
  it('reports an aborted write as an abort, not as a refusal', async () => {
    stubFetch(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));

    const err = (await mutateSchedule('/x', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )) as ScheduleMutationError;

    expect(err.failure.kind).toBe('aborted');
    expect(err.status).toBe(NETWORK_FAILURE_STATUS);
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
          ? response({ status: 403, body: JSON.stringify({ message: 'nope' }) })
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
    expect(result.failures[0]?.failure.kind).toBe('network');
  });

  it('handles an empty fan-out', async () => {
    await expect(mutateAll([])).resolves.toEqual({ total: 0, failures: [] });
  });
});
