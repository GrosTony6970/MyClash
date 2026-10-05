/**
 * A queued hit refused for WHO sends it WAITS, and the pad says why (rulings
 * 244, 244a, 245, 245a).
 *
 * Three refusals of the API are about the person, not about one bout: a
 * disabled staff account, a staff account whose role cannot score, an account
 * with no scoring role in the organisation. Each meets every hit the tablet
 * holds. Held one by one (ruling 242), a whole queue filled the refused-hits
 * inbox with "not allowed". The drain now stops at the first one, as it does
 * at a 401, and the bar names the cause. A refusal about the bout (another
 * piste, another Event) is still held, and the queue goes on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { callerRefusalOf } from './caller-refusal';
import { enqueue, getRejected, quarantine } from './outbox';
import { SyncEngine, type SyncState, type SyncStatus } from './sync';
import { signAccountOut } from '../lib/account-sign-out';
import { refusalMessage } from '../lib/refusal-copy';
import {
  needsOperator,
  offersAccountSignOut,
  syncBarLabel,
  syncBarTone,
  syncPhaseOf,
} from '../lib/sync-bar';

const API_URL = 'http://localhost:4000';
const OFF_PISTE = { message: 'Staff account is not assigned to this Lice', code: 'FORBIDDEN' };

/** The API's code, the status the drain stops on, the bar's sentence, the refusal's sentence. */
const CALLERS: Array<[string, SyncStatus, string, string]> = [
  [
    'account_cannot_score',
    'account-refused',
    'scoring.lice.accountCannotScore',
    'scoring.corrections.accountCannotScore',
  ],
  [
    'staff_account_disabled',
    'pin-disabled',
    'scoring.lice.pinDisabled',
    'scoring.corrections.pinDisabled',
  ],
  [
    'staff_role_not_allowed',
    'pin-role-refused',
    'scoring.lice.pinRoleCannotScore',
    'scoring.corrections.pinRoleCannotScore',
  ],
];

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

/** Answers each POST from the sequence it carried; a GET lists no row. */
function mockApi(post: (sequence: number) => { status: number; body: unknown }) {
  const posted: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      const sequence = (JSON.parse(init?.body ?? '{}') as { sequence: number }).sequence;
      posted.push(sequence);
      const r = post(sequence);
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
    }),
  );
  return { posted };
}

function addHit(sequence: number, clientUuid: string) {
  return enqueue({
    clientUuid,
    matchId: 'm1',
    sequence,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

async function drainWatched(engine: SyncEngine): Promise<SyncState | undefined> {
  const states: SyncState[] = [];
  const stop = engine.subscribe((state) => states.push(state));
  await engine.drain();
  stop();
  return states.at(-1);
}

describe.each(CALLERS)('drain — the server refuses the person (%s)', (code, status) => {
  const refused = { status: 403, body: { message: 'in English', code } };

  it('keeps every hit waiting, in order, held nowhere, and says which refusal', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    const { posted } = mockApi(() => refused);

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(last).toMatchObject({ status, pendingCount: 3, rejectedCount: 0 });
    expect(posted, 'it stops at the first one').toEqual([1]);
    expect((await db.outbox.orderBy('id').toArray()).map((row) => row.clientUuid)).toEqual([
      'uuid-1',
      'uuid-2',
      'uuid-3',
    ]);
    expect((await db.outbox.toArray()).map((row) => row.attempts)).toEqual([0, 0, 0]);
    expect(await db.rejected.count(), 'a waiting hit is not a refused one').toBe(0);
  });

  it('is said over a held hit too: "refused" would hide why nothing goes', async () => {
    await quarantine(await addHit(1, 'uuid-held'), 'Match is locked');
    await addHit(2, 'uuid-waiting');
    mockApi(() => refused);

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(last).toMatchObject({ status, pendingCount: 1, rejectedCount: 1 });
  });

  it('a Discard in the inbox keeps the sentence while a hit still waits', async () => {
    await quarantine(await addHit(1, 'uuid-held'), 'Match is locked');
    await addHit(2, 'uuid-waiting');
    mockApi(() => refused);
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.discardRejectedEntry((await getRejected())[0]?.id as number);

    expect(states.at(-1)).toMatchObject({ status, pendingCount: 1, rejectedCount: 0 });
  });

  it('sends the same queue, in order, once the person may score', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    let allowed = false;
    const { posted } = mockApi((sequence) =>
      allowed ? { status: 201, body: { id: `srv-${sequence}` } } : refused,
    );
    const engine = new SyncEngine(API_URL);
    await engine.drain();

    allowed = true;
    const last = await drainWatched(engine);

    expect(posted).toEqual([1, 1, 2]);
    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-1', 'uuid-2']);
    expect(last).toMatchObject({ status: 'idle', pendingCount: 0 });
  });
});

describe('drain — a refusal about the bout, then one about the person', () => {
  it('holds the first, goes on, and stops at the second', async () => {
    await addHit(1, 'uuid-off-piste');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    const disabled = { message: 'Staff account is disabled', code: 'staff_account_disabled' };
    const { posted } = mockApi((sequence) => ({
      status: 403,
      body: sequence === 1 ? OFF_PISTE : disabled,
    }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(posted).toEqual([1, 2]);
    expect((await getRejected()).map((row) => row.clientUuid)).toEqual(['uuid-off-piste']);
    expect(last).toMatchObject({ status: 'pin-disabled', pendingCount: 2, rejectedCount: 1 });
  });

  it('knows a refusal about the person by the API’s code alone', () => {
    expect(CALLERS.map(([code]) => callerRefusalOf(code))).toEqual(
      CALLERS.map(([, status]) => status),
    );
    expect(callerRefusalOf('FORBIDDEN')).toBeUndefined();
    expect(callerRefusalOf('constructor'), 'a code is not a property name').toBeUndefined();
    expect(callerRefusalOf(undefined)).toBeUndefined();
  });

  it('a 409 with a person’s code is still held: only a 403 is about the caller', async () => {
    await addHit(1, 'uuid-1');
    mockApi(() => ({ status: 409, body: { message: 'x', code: 'staff_account_disabled' } }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(await db.rejected.count()).toBe(1);
    expect(last).toMatchObject({ status: 'error', pendingCount: 0, rejectedCount: 1 });
  });
});

describe('what the bar says of it', () => {
  const t = (key: string) => key;

  it.each(CALLERS)('%s: its own sentence, in red, with Retry', (_code, status, barKey) => {
    const phase = syncPhaseOf('online', status);
    expect(phase).toBe(status);
    expect(syncBarLabel(phase, 0, t, 1)).toBe(`⚠ ${barKey}`);
    expect(syncBarLabel(phase, 2, t, 1), 'a held hit does not reword it').toBe(`⚠ ${barKey}`);
    expect(syncBarTone(phase)).toBe(syncBarTone('error'));
    expect(needsOperator(phase)).toBe(true);
    expect(syncPhaseOf('offline', status), 'browser-offline wins').toBe('offline');
  });

  it('offers to sign the account out for the account’s refusal alone', () => {
    expect(offersAccountSignOut('account-refused')).toBe(true);
    for (const phase of ['pin-disabled', 'pin-role-refused', 'signed-out', 'error'] as const) {
      expect(offersAccountSignOut(phase), phase).toBe(false);
    }
  });

  it.each(CALLERS)('%s: a write outside the queue says why too', (code, _s, _b, sentence) => {
    const failure = { ok: false, kind: 'forbidden', status: 403, code, detail: 'in English' };
    expect(refusalMessage(failure as never, t, 'scoring.clock.actionFailed')).toBe(sentence);
  });
});

describe('the button that signs the account out (ruling 244a)', () => {
  function stubLogout(status: number) {
    const calls: Array<{ url: string; method?: string; credentials?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method, credentials: init?.credentials });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    return calls;
  }

  it('signs the ACCOUNT out, then sends the queue again: the PIN is asked now', async () => {
    const calls = stubLogout(200);
    const order: string[] = [];
    const engine = {
      drainAsNewCaller: vi.fn(async () => void order.push(`drain after ${calls.length}`)),
    };

    await signAccountOut(API_URL, engine);

    expect(calls).toEqual([
      { url: `${API_URL}/api/v1/auth/logout`, method: 'POST', credentials: 'include' },
    ]);
    expect(order).toEqual(['drain after 1']);
  });

  it('sends the queue again when the sign-out did not get through: the bar says what is true', async () => {
    stubLogout(503);
    const engine = { drainAsNewCaller: vi.fn(async () => undefined) };

    await signAccountOut(API_URL, engine);

    expect(engine.drainAsNewCaller).toHaveBeenCalledTimes(1);
  });

  it('tapped while a send waits on the server: the queue is sent again after that answer', async () => {
    // The race: a Retry's send left as the account, and its answer comes after
    // the sign-out. That answer says nothing of the PIN, so one more send follows.
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    const posted: number[] = [];
    let signedOut = false;
    let answerFirst: (res: unknown) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
        if (url.endsWith('/auth/logout')) {
          signedOut = true;
          return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
        }
        posted.push((JSON.parse(init?.body ?? '{}') as { sequence: number }).sequence);
        if (posted.length === 1) return new Promise((resolve) => (answerFirst = resolve));
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 's' }) });
      }),
    );
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));
    const retry = engine.drain();
    await vi.waitFor(() => expect(posted).toEqual([1]));

    const tapped = signAccountOut(API_URL, engine);
    await vi.waitFor(() => expect(signedOut).toBe(true));
    answerFirst({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'in English', code: 'account_cannot_score' }),
    });
    await Promise.all([retry, tapped]);

    expect(posted, 'the same hit again, for the PIN, then the one behind it').toEqual([1, 1, 2]);
    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-1', 'uuid-2']);
    expect(states.at(-1)).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('a drain asked for while one runs still returns at once', async () => {
    await addHit(1, 'uuid-1');
    let answer: (res: unknown) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise((resolve) => (answer = resolve))),
    );
    const engine = new SyncEngine(API_URL);
    const running = engine.drain();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    await engine.drain();

    expect(engine.isDraining(), 'the second call did not wait for the first').toBe(true);
    answer({ ok: true, status: 201, json: () => Promise.resolve({ id: 's' }) });
    await running;
    expect(engine.isDraining()).toBe(false);
  });
});

describe('the bout screen', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', '..', ...path), 'utf8');
  const bar = read('src', 'components', 'SyncBar.tsx');

  it('draws its bar with the one component', () => {
    const page = read('app', 'matches', '[matchId]', 'page.tsx');
    expect(page.match(/<SyncBar\b/g)).toHaveLength(1);
    expect(page).not.toContain('data-testid="network-bar"');
  });

  it('offers the sign-out from the bar’s own decision, and nowhere else', () => {
    // Always mounted, so the question and the greyed button outlive a phase change.
    expect(bar).toContain(
      '<AccountSignOut offered={offersAccountSignOut(phase)} syncEngine={syncEngine} />',
    );
    expect(bar).toMatch(
      /\{offered && \(\s+<button\s+type="button"\s+data-testid="sign-account-out"/,
    );
    expect(bar.match(/<AccountSignOut\b/g)).toHaveLength(1);
    expect(bar.match(/signAccountOut\(/g)).toHaveLength(1);
    expect(bar).toContain('await signAccountOut(getApiUrl(), syncEngine)');
    expect(bar).toContain("{t('scoring.lice.signAccountOut')}");
  });

  it('greys the sign-out while it works, and frees it whatever came back', () => {
    expect(bar).toMatch(/setSigningOut\(true\);\s+try \{\s+await signAccountOut\(/);
    expect(bar).toMatch(/\} finally \{\s+setSigningOut\(false\);/);
    expect(bar).toMatch(/data-testid="sign-account-out"\s+disabled=\{signingOut\}/);
  });

  it('asks first, and says how far the sign-out reaches (ruling 312)', () => {
    // One login serves every MyClash site of the browser: the tap signs the
    // person out of the admin and public sites too.
    expect(bar, 'the button only opens the question').toMatch(
      /disabled=\{signingOut\}\s+onClick=\{\(\) => setConfirming\(true\)\}/,
    );
    expect(bar, 'the yes signs out').toMatch(
      /onConfirm=\{\(\) => \{\s+setConfirming\(false\);\s+void signOut\(\);\s+\}\}/,
    );
    expect(bar.match(/signOut\(\)/g), 'and nothing else does').toHaveLength(1);
    expect(bar).toContain('onCancel={() => setConfirming(false)}');
    expect(bar).toContain("title={t('scoring.lice.signAccountOutConfirmTitle')}");
    expect(bar).toContain("description={t('scoring.lice.signAccountOutConfirmBody')}");
    expect(bar).toContain("confirmLabel={t('scoring.lice.signAccountOutConfirm')}");
    expect(bar).toContain("cancelLabel={t('common.cancel')}");
  });
});
