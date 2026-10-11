import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { voidOnServer } from './clear-last';

/**
 * "Undo last entry": the void of one entry the server holds, and the screen's wiring.
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

  // Ruling 335: read-only mode's 503 is the API's own, and the wifi is fine.
  it('read-only mode’s 503 says maintenance, not "online required"', async () => {
    answer(503, { status: 503, detail: 'the server’s English', code: 'read_only_mode' });

    await expect(voidOnServer(API_URL, HIT, t)).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.maintenanceRefusal',
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

describe('the bout screen', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
  const screen = read('components', 'ScoringCenterControls.tsx');
  const view = read('components', 'MatchView.tsx');
  const dialogs = read('components', 'MatchPauseDialogs.tsx');
  /** The one undo of the bout screen: the controls and the round-break screen offer it. */
  const hook = read('hooks', 'useUndoLast.ts');

  it('has ONE undo, made by the bout screen and handed to both buttons', () => {
    expect(view.match(/useUndoLast\(/g)).toHaveLength(1);
    expect(view).toMatch(
      /const undo = useUndoLast\(\{\s+apiUrl,\s+matchId: match\.id,\s+syncEngine,\s+t,\s+refreshExchanges: scoring\.refreshExchanges,\s+onUndone: handleExchangeVoided,/,
    );
    expect(view).toMatch(/<ScoringCenterControls[\s\S]*?\n {10}undo=\{undo\}/);
    expect(view).toMatch(/<RoundBreakDialog[\s\S]*?\n {8}undo=\{undo\}/);
    expect(screen).not.toMatch(/undoLastEntry|takeBack/);
    expect(dialogs).not.toMatch(/undoLastEntry|takeBack/);
  });

  it('the round-break screen offers the undo second, behind "Start round", and says why it took nothing', () => {
    const roundBreak = dialogs.slice(dialogs.indexOf('export function RoundBreakDialog('));
    const start = roundBreak.indexOf('data-testid="start-next-round"');
    const back = roundBreak.indexOf('data-testid="round-break-undo"');
    expect(start).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(start);
    expect(roundBreak).toMatch(
      /data-testid="round-break-undo"\s+onClick=\{undo\.undo\}\s+className="min-h-\[44px\]/,
    );
    expect(roundBreak).toMatch(/\{undo\.error && \(\s+<p role="alert"/);
    expect(roundBreak).toMatch(/\{undo\.notice && \(\s+<p role="status"/);
  });

  it('a tap while an undo is out does nothing', () => {
    expect(hook).toMatch(/undo: \(\) => \{\s+if \(!busy && [^\n]+\) void run\(\);\s+\},/);
  });

  it('at a round break one undo lands, and no second one before the screen has closed', () => {
    expect(hook).toContain('if (!busy && !(once && landedIn === scope)) void run();');
    expect(hook).toMatch(/\n {6}setLandedIn\(scope\);\s+refreshExchanges\(\);/);
    expect(hook).toContain('if (landedIn !== null && landedIn !== scope) setLandedIn(null);');
    expect(view).toContain('once: series.awaitingStart,');
  });

  it('shows what an undo said only while the bout stands where it was said', () => {
    expect(view).toContain('scope: `${series.round}/${String(series.awaitingStart)}`,');
    expect(hook).toContain('if (said && said.scope !== scope) setSaid(null);');
    expect(hook).toContain('const here = said?.scope === scope ? said : null;');
    expect(hook).toMatch(/error: here\?\.error \?\? null,\s+notice: here\?\.notice \?\? null,/);
  });

  it('hands the undo to the module, with the engine’s take-back', () => {
    expect(hook).toMatch(
      /await undoLastEntry\(\{\s+apiUrl,\s+matchId,\s+t,\s+takeBack: \(entry\) => \(syncEngine \? syncEngine\.takeBack\(entry\) : takeBack\(entry\)\),\s+\}\);/,
    );
  });

  it('never asks "is a send running", and never reads the newest hit off its own list', () => {
    expect(screen).not.toMatch(/isDraining|activeExchanges\[|\.at\(-1\)/);
  });

  it('the button is off only while the bout’s list is empty, cards included', () => {
    expect(screen).toMatch(/disabled=\{events\.length === 0 \|\| undo\.busy\}/);
    expect(screen).toMatch(/data-testid="undo-last-entry"[\s\S]{0,80}onClick=\{undo\.undo\}/);
  });

  it('reads the bout again when the undo found nothing to take back', () => {
    expect(hook).toMatch(
      /if \(outcome\.message\) setError\(outcome\.message\);\s+else onUndone\(\);/,
    );
  });

  it('reads the hits and the bout again after an undo that took an entry back', () => {
    expect(hook).toMatch(/\n {6}refreshExchanges\(\);\s+onUndone\(\);\s+\} finally \{/);
  });

  it('says a request was sent, and does not report a void', () => {
    expect(hook).toMatch(
      /outcome\.kind === 'sent-for-review'\) \{\s+setNotice\(t\('scoring\.corrections\.clearLastSentForReview'\)\);\s+return;/,
    );
  });

  it('shows the notice as a status, not as an error', () => {
    expect(screen).toMatch(
      /\{undo\.notice && \(\s+<p className="[^"]*text-info[^"]*" role="status">/,
    );
  });

  // Operator, 2026-10-11: a round "End round" closed stays closed after an undo, and the
  // round-break screen says which entry was cancelled.
  it('words the entry an undo took before the lists are read again, from the lists of the tap', () => {
    expect(hook).toMatch(
      /\n {6}setSaid\(\{ scope, took: \{ label: args\.describe\(outcome\.entry\) \} \}\);\s+setLandedIn\(scope\);\s+refreshExchanges\(\);/,
    );
    expect(hook).toContain('took: here?.took ?? null,');
    expect(view).toContain(
      'describe: (entry) => entryLine(entry, { scoring, match, config: scoringConfig, t }),',
    );
  });

  it('says "the round stays closed" only of a round closed on time, and only in the round-break screen', () => {
    expect(view).toContain(
      'undo.took && closedRound?.onTime ? roundStaysClosed(undo.took.label, series.round, t) : null;',
    );
    expect(view).toMatch(/<RoundBreakDialog[\s\S]*?\n {8}undone=\{undone\}/);
    expect(dialogs.match(/\{undone && \(/g)).toHaveLength(1);
    expect(dialogs).toMatch(
      /\{undone && \(\s+<p\s+role="status"\s+data-testid="round-break-undone"/,
    );
    // A guard: drawn under the controls too, a screen reader would say it twice.
    expect(screen).not.toMatch(/undo\.took|undone/);
  });

  it('holds no second copy of the calls', () => {
    expect(screen).not.toMatch(/exchanges\/\$\{|match-penalties/);
  });
});
