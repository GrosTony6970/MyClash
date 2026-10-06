import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TakenBack } from '../offline/take-back';
import { undoLastEntry, voidOnServer } from './clear-last';

/**
 * "Undo last entry": the newest hit or card of a bout, wherever it is.
 *
 * On an over Event the server does not void the hit of an organiser's account:
 * it files a correction request and answers 202. The pad read that as a void
 * that landed, refreshed, and said nothing while the hit stayed on the screen.
 */
const API_URL = 'http://localhost:4000';
const t = (key: string) => key;
const HIT = { kind: 'exchange', id: 'ex-7' } as const;
const REASON =
  'Dernière saisie annulée sur la tablette de score / Last entry undone on the scoring pad';

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(json(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

type Call = [string, { method?: string; body?: string } | undefined];

describe('voidOnServer', () => {
  // Ruling 258: the reason is saved on the entry and on a request for review. A
  // reviewer of either language reads it, so it is one sentence in both.
  it('asks the void of that one hit, with one fixed reason in French and English', async () => {
    const fetchMock = answer(200, { id: 'ex-7', voided: true });

    await expect(voidOnServer(API_URL, HIT, t)).resolves.toEqual({ kind: 'voided' });

    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe(`${API_URL}/api/v1/exchanges/ex-7/void`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body ?? '')).toEqual({ reason: REASON });
  });

  it('voids a card by the card’s own route (ruling 318)', async () => {
    const fetchMock = answer(200, { id: 'card-3', voided: true });

    await expect(voidOnServer(API_URL, { kind: 'penalty', id: 'card-3' }, t)).resolves.toEqual({
      kind: 'voided',
    });

    const [url, init] = fetchMock.mock.calls[0] as Call;
    expect(url).toBe(`${API_URL}/api/v1/match-penalties/card-3/void`);
    expect(JSON.parse(init?.body ?? '')).toEqual({ reason: REASON });
  });

  it('a 202 is a request sent for review: the hit is NOT voided', async () => {
    answer(202, { pendingReview: true, requestId: 'request-1', status: 'pending' });

    await expect(voidOnServer(API_URL, HIT, t)).resolves.toEqual({ kind: 'sent-for-review' });
  });

  it.each([
    ['event_results_frozen', 'scoring.corrections.eventOver'],
    ['black_card_undo_refused', 'scoring.corrections.blackCardUndoRefused'],
  ])('the coded refusal %s is said in the referee’s language', async (code, sentence) => {
    answer(409, { status: 409, detail: 'the server’s English', code });

    await expect(voidOnServer(API_URL, HIT, t)).resolves.toEqual({
      kind: 'failed',
      message: sentence,
    });
  });

  it('a refusal the pad has no sentence for is said as the server worded it', async () => {
    answer(400, { status: 400, detail: 'Exchange is already voided', code: 'BAD_REQUEST' });

    await expect(voidOnServer(API_URL, HIT, t)).resolves.toEqual({
      kind: 'failed',
      message: 'Exchange is already voided',
    });
  });

  it('the service worker’s 503 and a dead network both read as offline', async () => {
    answer(503, { message: 'offline' });
    await expect(voidOnServer(API_URL, HIT, t)).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.onlineOnly',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(voidOnServer(API_URL, HIT, t)).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.onlineOnly',
    });
  });
});

/** The server's lists of one bout, and what it answers to a void. */
function server(lists: {
  hits?: unknown;
  cards?: unknown;
  hitsStatus?: number;
  cardsStatus?: number;
}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') return Promise.resolve(json(200, { voided: true }));
    return Promise.resolve(
      url.endsWith('/exchanges')
        ? json(lists.hitsStatus ?? 200, lists.hits ?? [])
        : json(lists.cardsStatus ?? 200, lists.cards ?? []),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = () =>
    (fetchMock.mock.calls as Call[]).map(([url, init]) => [
      init?.method ?? 'GET',
      url.replace(API_URL, ''),
    ]);
  return { calls };
}

const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, '0')}:00.000Z`;
const hit = (id: string, minute: number, over: object = {}) => ({
  id,
  sequence: minute,
  voided: false,
  occurredAt: at(minute),
  ...over,
});
const card = (id: string, minute: number, over: object = {}) => ({
  id,
  sequence: minute,
  voided: false,
  occurred_at: at(minute),
  ...over,
});

const undo = (taken: TakenBack) => {
  const takeBack = vi.fn().mockResolvedValue(taken);
  return { takeBack, run: () => undoLastEntry({ apiUrl: API_URL, matchId: 'm1', t, takeBack }) };
};
const NONE: TakenBack = { kind: 'none' };
const landed = (entry: object, serverId: string) =>
  ({ kind: 'landed', entry: { clientUuid: 'uuid-1', ...entry }, serverId }) as TakenBack;

describe('undoLastEntry: the tablet first', () => {
  it('an entry removed on the tablet is undone with no call at all', async () => {
    const { calls } = server({});
    const { takeBack, run } = undo({ kind: 'removed' });

    await expect(run()).resolves.toEqual({ kind: 'voided' });

    expect(takeBack).toHaveBeenCalledWith('m1');
    expect(calls()).toEqual([]);
  });

  it('a hit that landed while the undo waited is voided by the id the server gave it', async () => {
    const { calls } = server({ hits: [hit('ex-newer', 9)] });

    await expect(undo(landed({}, 'srv-1')).run()).resolves.toEqual({ kind: 'voided' });

    expect(calls()).toEqual([['PATCH', '/api/v1/exchanges/srv-1/void']]);
  });

  it('a card that landed is voided by the card’s route', async () => {
    const { calls } = server({});

    await undo(landed({ kind: 'penalty' }, 'srv-card')).run();

    expect(calls()).toEqual([['PATCH', '/api/v1/match-penalties/srv-card/void']]);
  });

  // The answer carried no id: the store kept the entry's own uuid (a second try), or none.
  it.each(['uuid-1', ''])(
    'a landed entry with no id of the server (%j) is found by the fresh read',
    async (serverId) => {
      const { calls } = server({ hits: [hit('ex-2', 2)] });

      await undo(landed({}, serverId)).run();

      expect(calls().at(-1)).toEqual(['PATCH', '/api/v1/exchanges/ex-2/void']);
    },
  );
});

describe('undoLastEntry: the newest entry the server holds, read fresh', () => {
  it('reads the bout’s hits and cards, then voids the newest hit', async () => {
    const { calls } = server({
      hits: [hit('ex-1', 1), hit('ex-3', 3)],
      cards: [card('card-2', 2)],
    });

    await expect(undo(NONE).run()).resolves.toEqual({ kind: 'voided' });

    expect(calls()).toEqual([
      ['GET', '/api/v1/matches/m1/exchanges'],
      ['GET', '/api/v1/matches/m1/penalties'],
      ['PATCH', '/api/v1/exchanges/ex-3/void'],
    ]);
  });

  it('voids the card when the card is the newest (ruling 318)', async () => {
    const { calls } = server({ hits: [hit('ex-1', 1)], cards: [card('card-2', 2)] });

    await undo(NONE).run();

    expect(calls().at(-1)).toEqual(['PATCH', '/api/v1/match-penalties/card-2/void']);
  });

  it('newest is by the time scored, not by the order of the list', async () => {
    const { calls } = server({ hits: [hit('ex-late', 8, { sequence: 1 }), hit('ex-early', 2)] });

    await undo(NONE).run();

    expect(calls().at(-1)).toEqual(['PATCH', '/api/v1/exchanges/ex-late/void']);
  });

  it('passes over a voided entry', async () => {
    const { calls } = server({
      hits: [hit('ex-1', 1), hit('ex-3', 3, { voided: true })],
      cards: [card('card-4', 4, { voided: true })],
    });

    await undo(NONE).run();

    expect(calls().at(-1)).toEqual(['PATCH', '/api/v1/exchanges/ex-1/void']);
  });

  it('a bout with no live entry: nothing is asked, nothing is said', async () => {
    const { calls } = server({ hits: [hit('ex-1', 1, { voided: true })] });

    await expect(undo(NONE).run()).resolves.toEqual({ kind: 'failed', message: null });
    expect(calls().filter(([method]) => method === 'PATCH')).toEqual([]);
  });

  it.each<['hitsStatus' | 'cardsStatus']>([['hitsStatus'], ['cardsStatus']])(
    'a failed read (%s) removes nothing: a hit is never picked on half the list',
    async (which) => {
      const { calls } = server({
        hits: [hit('ex-1', 1)],
        cards: [card('card-2', 2)],
        [which]: 500,
      });

      // Said as a failure: "nothing to undo" (no message) would be a lie here.
      await expect(undo(NONE).run()).resolves.toEqual({
        kind: 'failed',
        message: 'scoring.corrections.clearLastFailed',
      });
      expect(calls().filter(([method]) => method === 'PATCH')).toEqual([]);
    },
  );

  it('offline with nothing on the tablet says "online required"', async () => {
    server({ hitsStatus: 503, cardsStatus: 503 });

    await expect(undo(NONE).run()).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.onlineOnly',
    });
  });
});

describe('the bout screen', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
  const screen = read('components', 'ScoringCenterControls.tsx');

  it('hands the undo to the module, with the engine’s take-back', () => {
    expect(screen).toMatch(
      /await undoLastEntry\(\{\s+apiUrl,\s+matchId,\s+t,\s+takeBack: \(id\) => \(syncEngine \? syncEngine\.takeBackNewest\(id\) : takeBackNewest\(id\)\),\s+\}\);/,
    );
  });

  it('never asks "is a send running", and never reads the newest hit off its own list', () => {
    expect(screen).not.toMatch(/isDraining|activeExchanges\[|\.at\(-1\)/);
  });

  it('the button is off only while the bout’s list is empty, cards included', () => {
    expect(screen).toMatch(/disabled=\{events\.length === 0 \|\| clearBusy\}/);
  });

  it('reads the bout again when the undo found nothing to take back', () => {
    expect(screen).toMatch(
      /if \(outcome\.message\) setClearError\(outcome\.message\);\s+else onExchangeVoided\?\.\(\);/,
    );
  });

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

  it('holds no second copy of the calls', () => {
    expect(screen).not.toMatch(/exchanges\/\$\{|match-penalties/);
  });
});
