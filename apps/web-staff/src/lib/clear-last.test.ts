import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { voidOnServer } from './clear-last';

/**
 * "Clear last exchange" on a hit the server holds.
 *
 * On an over Event the server does not void the hit of an organiser's account:
 * it files a correction request and answers 202. The pad read that as a void
 * that landed, refreshed, and said nothing while the hit stayed on the screen.
 */
const API_URL = 'http://localhost:4000';
const t = (key: string) => key;

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('voidOnServer', () => {
  it('asks the void of that one hit, with the referee’s reason', async () => {
    const fetchMock = answer(200, { id: 'ex-7', voided: true });

    await expect(voidOnServer(API_URL, 'ex-7', t)).resolves.toEqual({ kind: 'voided' });

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${API_URL}/api/v1/exchanges/ex-7/void`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Clear last exchange (referee)' });
  });

  it('a 202 is a request sent for review: the hit is NOT voided', async () => {
    answer(202, { pendingReview: true, requestId: 'request-1', status: 'pending' });

    await expect(voidOnServer(API_URL, 'ex-7', t)).resolves.toEqual({ kind: 'sent-for-review' });
  });

  it('a coded refusal is said in the referee’s language', async () => {
    answer(409, { status: 409, detail: 'Event results are frozen', code: 'event_results_frozen' });

    await expect(voidOnServer(API_URL, 'ex-7', t)).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.eventOver',
    });
  });

  it('a refusal the pad has no sentence for is said as the server worded it', async () => {
    answer(400, { status: 400, detail: 'Exchange is already voided', code: 'BAD_REQUEST' });

    await expect(voidOnServer(API_URL, 'ex-7', t)).resolves.toEqual({
      kind: 'failed',
      message: 'Exchange is already voided',
    });
  });

  it('the service worker’s 503 and a dead network both read as offline', async () => {
    answer(503, { message: 'offline' });
    await expect(voidOnServer(API_URL, 'ex-7', t)).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.onlineOnly',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(voidOnServer(API_URL, 'ex-7', t)).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.onlineOnly',
    });
  });
});

describe('the bout screen', () => {
  const screen = readFileSync(
    join(__dirname, '..', 'components', 'ScoringCenterControls.tsx'),
    'utf8',
  );

  it('says a request was sent, and does not report a void', () => {
    expect(screen).toMatch(
      /outcome\.kind === 'sent-for-review'\) \{\s+setClearNotice\(t\('scoring\.corrections\.clearLastSentForReview'\)\);\s+return;/,
    );
  });

  it('shows the notice as a status, not as an error', () => {
    expect(screen).toMatch(
      /\{clearNotice && \(\s+<p className="[^"]*text-info[^"]*" role="status">/,
    );
  });

  it('holds no second copy of the call', () => {
    expect(screen).not.toMatch(/exchanges\/\$\{/);
  });
});
