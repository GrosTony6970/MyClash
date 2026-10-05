/**
 * A press sent at once and refused for WHO sends it turns the bar red (ruling 311).
 *
 * The clock, a correction and a forfeit are not queued: the server answers the
 * press. Refused for the person (rulings 244, 245), the press said why under
 * its own button, and the bar stayed green: "Sign that account out" is on the
 * bar, which turned red only at the first queued hit. Every refused press of
 * the pad is worded by `refusalMessage`, so it tells the engine there, and the
 * bar says the cause with its ways out, as for a queued hit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue, quarantine } from './outbox';
import { SyncEngine, type SyncState, type SyncStatus } from './sync';
import { refusalMessage } from '../lib/refusal-copy';
import { offersAccountSignOut, syncBarLabel, syncPhaseOf } from '../lib/sync-bar';

const API_URL = 'http://localhost:4000';
const t = (key: string) => key;

/** The API's code, the status the bar takes, its sentence with hits waiting, and with none. */
const CALLERS: Array<[string, SyncStatus, string, string]> = [
  [
    'account_cannot_score',
    'account-refused',
    'scoring.lice.accountCannotScore',
    'scoring.lice.accountCannotScoreNoHits',
  ],
  [
    'staff_account_disabled',
    'pin-disabled',
    'scoring.lice.pinDisabled',
    'scoring.lice.pinDisabledNoHits',
  ],
  [
    'staff_role_not_allowed',
    'pin-role-refused',
    'scoring.lice.pinRoleCannotScore',
    'scoring.lice.pinRoleCannotScoreNoHits',
  ],
];

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

function watched() {
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  return { engine, states, last: () => states.at(-1) };
}

const refused = (status: number, code?: string) =>
  ({ ok: false, kind: 'forbidden', status, code: code ?? null, detail: 'in English' }) as never;

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

describe.each(CALLERS)('a press refused for the person (%s)', (code, status) => {
  it('turns the bar to that refusal, with no hit queued', async () => {
    const { last } = watched();

    refusalMessage(refused(403, code), t, 'scoring.clock.actionFailed');

    await vi.waitFor(() => expect(last()).toBeDefined());
    expect(last()).toMatchObject({ status, pendingCount: 0, rejectedCount: 0 });
  });

  it('is said over a held hit too, as a queued one is', async () => {
    await quarantine(await addHit(1, 'uuid-held'), 'Match is locked');
    const { last } = watched();

    refusalMessage(refused(403, code), t, 'scoring.clock.actionFailed');

    await vi.waitFor(() => expect(last()).toBeDefined());
    expect(last()).toMatchObject({ status, rejectedCount: 1 });
  });

  it('goes green at the next drain when nothing waits: nothing is left to refuse', async () => {
    const { engine, last } = watched();
    refusalMessage(refused(403, code), t, 'scoring.clock.actionFailed');
    await vi.waitFor(() => expect(last()?.status).toBe(status));

    await engine.drainAsNewCaller();

    expect(last()).toMatchObject({ status: 'idle', pendingCount: 0 });
  });
});

describe('a press refused for another cause', () => {
  it.each<[string, unknown]>([
    ['a 403 about the bout', refused(403, 'FORBIDDEN')],
    ['a 403 with no code', refused(403)],
    ['a 409 that carries a person’s code', refused(409, 'account_cannot_score')],
    ['an over Event', refused(409, 'event_results_frozen')],
    ['a server fault', refused(500)],
    ['no connection', { ok: false, kind: 'network' }],
    ['the worker’s 503', refused(503, 'account_cannot_score')],
  ])('%s leaves the bar as it is', async (_what, failure) => {
    const { states } = watched();

    refusalMessage(failure as never, t, 'scoring.clock.actionFailed');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(states).toEqual([]);
  });
});

describe('what the bar says of it', () => {
  it.each(CALLERS)('%s: no "hits not sent" while none waits', (_code, status, queued, none) => {
    const phase = syncPhaseOf('online', status);
    expect(syncBarLabel(phase, 0, t, 0)).toBe(`⚠ ${none}`);
    expect(syncBarLabel(phase, 3, t, 0), 'a held hit is not a waiting one').toBe(`⚠ ${none}`);
    expect(syncBarLabel(phase, 0, t, 1)).toBe(`⚠ ${queued}`);
  });

  it('still offers the account’s sign-out, which is why the bar turns red', () => {
    expect(offersAccountSignOut(syncPhaseOf('online', 'account-refused'))).toBe(true);
  });
});

describe('the pad’s screens', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', '..', ...path), 'utf8');

  it('tell the engine from the ONE place every refused press is worded', () => {
    const copy = read('src', 'lib', 'refusal-copy.ts');
    expect(copy.match(/tellCallerRefusal\(/g)).toHaveLength(1);
    expect(copy).toContain('if (failure.status === 403) tellCallerRefusal(failure.code);');
    for (const screen of ['MatchView', 'MatchClock', 'MatchCorrectionsDrawer', 'ForfeitPanel']) {
      expect(read('src', 'components', `${screen}.tsx`), screen).not.toContain('tellCallerRefusal');
    }
  });

  it('draw the bar’s sentence from the hits that wait', () => {
    const bar = read('src', 'components', 'SyncBar.tsx');
    expect(bar).toContain('{syncBarLabel(phase, rejected, t, pending)}');
  });
});
