import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addToWaitingList, tryRegisterInTournament } from './registration-helpers';

const API = 'https://api.test';

/**
 * A Response double complete enough for the seam.
 *
 * `text()` and not just `json()`: `apiRequest` reads the body with
 * `parseBody`, which calls `res.text()` so a 204 and an empty body resolve to
 * `undefined` instead of throwing a parse error. A double carrying only
 * `json()` made every case here come back as a NETWORK failure — the request
 * looked like it never reached the server. That is the shape to watch for
 * whenever a fetch-mocked test meets this seam.
 */
function mockFetch(body: unknown, init: { status?: number; throws?: Error } = {}): typeof fetch {
  return vi.fn(async () => {
    if (init.throws) throw init.throws;
    const status = init.status ?? 200;
    const ok = status >= 200 && status < 300;
    const text = body === null || body === undefined ? '' : JSON.stringify(body);
    return {
      ok,
      status,
      text: async () => text,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('tryRegisterInTournament', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch(null));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns status='ok' with the parsed body on 201", async () => {
    vi.stubGlobal('fetch', mockFetch({ id: 'reg-1' }, { status: 201 }));

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    expect(result).toEqual({ status: 'ok', data: { id: 'reg-1' } });
  });

  it("returns status='full' when the 409 body carries details.reason='tournament_full'", async () => {
    // Backend response shape from
    // apps/api/src/modules/registrations/registrations.service.ts:120-174 via
    // the ApiExceptionFilter. The discriminator is what unblocks the
    // operator's "tournament is full → offer waitlist" UX.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Conflict Exception',
          details: { reason: 'tournament_full', registeredCount: 16, maxParticipants: 16 },
        },
        { status: 409 },
      ),
    );

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    expect(result).toEqual({ status: 'full', registeredCount: 16, maxParticipants: 16 });
  });

  it("returns status='error' on a 409 that isn't tournament_full so other conflicts still surface", async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { statusCode: 409, message: 'Some other conflict', details: { reason: 'something_else' } },
        { status: 409 },
      ),
    );

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    // The whole failure travels back now, so the caller can render the reason
    // with `failureMessage` instead of the plucked string this used to return.
    expect(result).toMatchObject({
      status: 'error',
      failure: { kind: 'http', status: 409, detail: 'Some other conflict' },
    });
  });

  it("returns status='error' carrying the BE reason on 400 (duplicate registration path)", async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { statusCode: 400, message: 'This person is already registered in this tournament' },
        { status: 400 },
      ),
    );

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    expect(result).toMatchObject({
      status: 'error',
      failure: {
        kind: 'http',
        status: 400,
        detail: 'This person is already registered in this tournament',
      },
    });
  });

  it("returns status='error' as a NETWORK failure when fetch itself throws", async () => {
    vi.stubGlobal('fetch', mockFetch(null, { throws: new Error('network down') }));

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    // A dropped connection is its own kind, not an HTTP status. The old
    // contract returned the thrown Error's own text — untranslatable, and the
    // reason the two English fallbacks in this module existed at all.
    expect(result).toEqual({ status: 'error', failure: { ok: false, kind: 'network' } });
  });

  it("returns status='error' as ABORTED when the caller's signal fires", async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(null, { throws: Object.assign(new Error('aborted'), { name: 'AbortError' }) }),
    );

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    // Distinguishable from a network failure, which is what lets a caller stay
    // silent for its own unmount instead of blaming the server.
    expect(result).toEqual({ status: 'error', failure: { ok: false, kind: 'aborted' } });
  });
});

describe('addToWaitingList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch(null));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok:true on 201', async () => {
    vi.stubGlobal('fetch', mockFetch({ id: 'reg-2' }, { status: 201 }));

    const result = await addToWaitingList(API, 't-1', { personId: 'p-1' });

    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false carrying the BE reason when the waitlist itself is full', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { statusCode: 409, message: 'Waitlist is full', details: { reason: 'waitlist_full' } },
        { status: 409 },
      ),
    );

    const result = await addToWaitingList(API, 't-1', { personId: 'p-1' });

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'http', status: 409, detail: 'Waitlist is full' },
    });
  });
});
