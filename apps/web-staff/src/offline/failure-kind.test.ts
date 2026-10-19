import { describe, expect, it } from 'vitest';
import { classifySyncFailure, isMadeUpAnswer, offlineResponse } from './failure-kind';

describe('classifySyncFailure', () => {
  it("reads the service worker's own offline marker", () => {
    // The ONLY unambiguous signal, because our code writes it. sw.js turns a
    // dead network into `503 { error: 'offline' }` rather than letting fetch
    // reject — which is why SyncEngine's catch block could never report
    // offline in production.
    expect(classifySyncFailure(503, { error: 'offline' })).toBe('offline');
  });

  it('treats a bare 503 as offline', () => {
    // Traefik with no API behind it, or the API restarting mid-deploy. From
    // the referee's side this is identical to no wifi: the hit is queued and
    // will retry, and "check connection" is the right advice anyway.
    expect(classifySyncFailure(503, null)).toBe('offline');
  });

  // Ruling 335. Every 503 the API writes carries a code: only this one is maintenance.
  it('reads the API’s read-only 503 as maintenance, and any other coded 503 as offline', () => {
    expect(classifySyncFailure(503, { code: 'read_only_mode' })).toBe('maintenance');
    expect(classifySyncFailure(503, { code: 'INTERNAL_SERVER_ERROR' })).toBe('offline');
  });

  it('treats a status-less response as offline', () => {
    expect(classifySyncFailure(0, null)).toBe('offline');
  });

  it.each([
    [400, 'a refusal'],
    [401, 'an expired session'],
    [409, 'a conflict'],
    [500, 'a server fault'],
  ])('treats %i (%s) as a server answer, not as offline', (status) => {
    expect(classifySyncFailure(status, { message: 'nope' })).toBe('server');
  });

  it('believes the marker over the status', () => {
    // A proxy that rewrites the status must not turn an outage into a red bar.
    expect(classifySyncFailure(502, { error: 'offline' })).toBe('offline');
  });
});

// Ruling L (2026-10-19): for a Start, only the made-up answer is "no network"; an edge 503 is a
// network met. Read from a clone, so the answer is still filed from its own body.
describe('isMadeUpAnswer', () => {
  const answer = (status: number, body: string) => new Response(body, { status });

  it('is the made-up answer of the service worker and of the drill', async () => {
    expect(await isMadeUpAnswer(offlineResponse())).toBe(true);
    expect(await isMadeUpAnswer(answer(503, JSON.stringify({ error: 'offline' })))).toBe(true);
  });

  it('is not an edge 503, nor read-only mode, nor a body that is no JSON', async () => {
    expect(await isMadeUpAnswer(answer(503, '{}'))).toBe(false);
    expect(await isMadeUpAnswer(answer(503, JSON.stringify({ code: 'read_only_mode' })))).toBe(
      false,
    );
    expect(await isMadeUpAnswer(answer(503, '<html>Bad gateway</html>'))).toBe(false);
  });

  it('reads no body but a 503’s, and leaves the answer’s own body to read', async () => {
    const taken = answer(200, JSON.stringify({ error: 'offline' }));
    expect(await isMadeUpAnswer(taken)).toBe(false);
    expect(taken.bodyUsed).toBe(false);

    const readOnly = answer(503, JSON.stringify({ code: 'read_only_mode' }));
    await isMadeUpAnswer(readOnly);
    expect(readOnly.bodyUsed).toBe(false);
    expect(await readOnly.json()).toEqual({ code: 'read_only_mode' });
  });
});
