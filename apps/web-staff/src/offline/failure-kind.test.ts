import { describe, expect, it } from 'vitest';
import { classifySyncFailure } from './failure-kind';

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
