import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addToWaitingList, tryRegisterInTournament } from './registration-helpers';

const API = 'https://api.test';

function mockFetch(body: unknown, init: { status?: number; throws?: Error } = {}): typeof fetch {
  return vi.fn(async () => {
    if (init.throws) throw init.throws;
    const status = init.status ?? 200;
    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
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

    expect(result).toEqual({ status: 'error', message: 'Some other conflict' });
  });

  it("returns status='error' with the BE message on 400 (duplicate registration path)", async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { statusCode: 400, message: 'This person is already registered in this tournament' },
        { status: 400 },
      ),
    );

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    expect(result).toEqual({
      status: 'error',
      message: 'This person is already registered in this tournament',
    });
  });

  it("returns status='error' when fetch itself throws (network failure)", async () => {
    vi.stubGlobal('fetch', mockFetch(null, { throws: new Error('network down') }));

    const result = await tryRegisterInTournament(API, 't-1', { personId: 'p-1' });

    expect(result).toEqual({ status: 'error', message: 'network down' });
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

  it('returns ok:false with the BE message when the waitlist itself is full', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { statusCode: 409, message: 'Waitlist is full', details: { reason: 'waitlist_full' } },
        { status: 409 },
      ),
    );

    const result = await addToWaitingList(API, 't-1', { personId: 'p-1' });

    expect(result).toEqual({ ok: false, message: 'Waitlist is full' });
  });
});
