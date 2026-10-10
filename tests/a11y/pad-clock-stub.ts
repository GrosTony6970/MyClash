/**
 * The stubbed server of `pad-clock-on-tablet.spec.ts`, and that spec's locators.
 *
 * It keeps a clock as the server does: a press moves it, and a read gives it
 * back. A dead network is the answer the pad's service worker gives: a 503
 * with `{ error: 'offline' }`. The bout has the default format: 90 seconds,
 * first to 10.
 */
import { expect, type Page, type Route } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'M1',
  status: 'scheduled',
  ruleset_code: 'TF',
  ruleset_version: '1.0.0',
  red_registration_id: 'red-1',
  blue_registration_id: 'blue-1',
  red_score: 0,
  blue_score: 0,
  winner_registration_id: null as string | null,
  locked_at: null,
  lice_id: null,
  end_reason: null as string | null,
  current_round: 1,
  red_round_wins: 0,
  blue_round_wins: 0,
  rounds_json: null,
  awaiting_round_advance: false,
};
const SUMMARY = {
  roundCode: 'P1',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
  phaseType: 'pool',
  bestOf: 1,
};
const OFFLINE = { status: 503, json: { error: 'offline', status: 503 } };

interface ServerClock {
  status: 'idle' | 'running' | 'halted' | 'ended';
  activeMs: number;
  runningFrom: string | null;
  startedAt: string | null;
}

interface Stub {
  network: 'up' | 'down';
  /** The server's answer to a clock press waits until this resolves. */
  hold: Promise<void> | null;
  /** The server's answer to an End waits until this resolves. */
  holdEnd: Promise<void> | null;
  /** Every read of the bout answers "no network", while the writes go through. */
  readsFail: boolean;
  /** Every write that reached the server, answered or not: `start`, `hit`. */
  arrived: string[];
  /** The server refuses the next clock press with this code, once. */
  refuseNext: string | null;
  /** The server refuses the next hit with this code, once. */
  refuseNextHit: string | null;
  /** Every write the server TOOK or refused, in order: `POST /clock start`, `POST /exchanges`. */
  sent: string[];
  /** The body of each clock press that arrived. */
  presses: Array<{ action: string; clientUuid: string; pressedAt: string; sentAt: string }>;
  /** The two times of each hit that arrived. */
  hits: Array<{ occurredAt: string; sentAt: string }>;
  row: typeof ROW;
  clock: ServerClock;
}

/** The server's side of a press: the clock moves as the server's own fold moves it. */
function press(stub: Stub, action: string) {
  const now = new Date().toISOString();
  const { clock } = stub;
  const ran = clock.runningFrom ? Date.now() - Date.parse(clock.runningFrom) : 0;
  if (action === 'start' || action === 'resume') {
    stub.clock = {
      ...clock,
      status: 'running',
      runningFrom: now,
      startedAt: clock.startedAt ?? now,
    };
    stub.row = { ...stub.row, status: 'running' };
  } else if (action === 'halt') {
    stub.clock = { ...clock, status: 'halted', runningFrom: null, activeMs: clock.activeMs + ran };
    stub.row = { ...stub.row, status: 'paused' };
  } else {
    stub.clock = { ...clock, status: 'ended', runningFrom: null, activeMs: clock.activeMs + ran };
    const { red_score: red, blue_score: blue } = stub.row;
    const winner = red === blue ? null : red > blue ? 'red-1' : 'blue-1';
    stub.row = { ...stub.row, status: 'completed', winner_registration_id: winner };
  }
}

const clockBody = (stub: Stub) => ({
  ...stub.clock,
  matchId: BOUT,
  totalActiveMs: stub.clock.activeMs,
  levelResolutionSteps: 0,
  events: [],
});

/** The server's answer to a clock press: held back, refused once, or taken. */
async function answerPress(stub: Stub, route: Route) {
  const body = route.request().postDataJSON() as Stub['presses'][number];
  stub.arrived.push(body.action);
  if (stub.hold) await stub.hold;
  if (body.action === 'end' && stub.holdEnd) await stub.holdEnd;
  stub.sent.push(`POST /clock ${body.action}`);
  stub.presses.push(body);
  if (stub.refuseNext) {
    const code = stub.refuseNext;
    stub.refuseNext = null;
    return route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 409, code, detail: 'API words', message: 'API words' }),
    });
  }
  press(stub, body.action);
  return route.fulfill({ json: clockBody(stub) });
}

/** The server's answer to a hit: taken, and the red score moves by its points. */
function answerHit(stub: Stub, route: Route) {
  const hit = route.request().postDataJSON() as Stub['hits'][number] & {
    firstStrikeValue?: number | null;
  };
  stub.arrived.push('hit');
  stub.hits.push({ occurredAt: hit.occurredAt, sentAt: hit.sentAt });
  stub.sent.push('POST /exchanges');
  if (stub.refuseNextHit) {
    const code = stub.refuseNextHit;
    stub.refuseNextHit = null;
    return route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 409, code, detail: 'API words', message: 'API words' }),
    });
  }
  stub.row = { ...stub.row, red_score: stub.row.red_score + (hit.firstStrikeValue ?? 0) };
  return route.fulfill({ status: 201, json: { id: `saved-${stub.sent.length}` } });
}

/** Opens the bout with the network up. Returns the stub's switches and its record. */
export async function openBout(
  page: Page,
  start: { row?: Partial<typeof ROW>; clock?: Partial<ServerClock>; phaseType?: string } = {},
) {
  const stub: Stub = {
    network: 'up',
    hold: null,
    holdEnd: null,
    readsFail: false,
    arrived: [],
    refuseNext: null,
    refuseNextHit: null,
    sent: [],
    presses: [],
    hits: [],
    row: { ...ROW, ...start.row },
    clock: { status: 'idle', activeMs: 0, runningFrom: null, startedAt: null, ...start.clock },
  };
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (stub.network === 'down') return route.fulfill(OFFLINE);
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    if (method === 'POST' && path.endsWith('/clock')) return answerPress(stub, route);
    if (method === 'POST' && path.endsWith('/exchanges')) return answerHit(stub, route);
    if (method !== 'GET') return route.fulfill({ json: {} });
    if (stub.readsFail) return route.fulfill(OFFLINE);
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: stub.row });
    if (path.endsWith('/summary')) {
      return route.fulfill({ json: { ...SUMMARY, phaseType: start.phaseType ?? 'pool' } });
    }
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: clockBody(stub) });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(primary(page)).toBeEnabled();
  return stub;
}

/** The network is back: the browser tells the page. */
export async function comeBackOnline(page: Page, stub: Stub) {
  stub.network = 'up';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

/** The copy the tablet keeps of the bout's clock, read from the store itself. */
export async function expectKeptClock(page: Page, status: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          new Promise<string | null>((resolve) => {
            const open = indexedDB.open('myclash-staff');
            open.onerror = () => resolve('the store did not open');
            open.onsuccess = () => {
              const get = open.result.transaction('reads').objectStore('reads').get(key);
              get.onsuccess = () => {
                const row = get.result as { body?: { status?: string } } | undefined;
                open.result.close();
                resolve(row?.body?.status ?? null);
              };
            };
          }),
        `clock/${BOUT}`,
      ),
    )
    .toBe(status);
}

export const primary = (page: Page) => page.getByTestId('clock-primary-button');
export const status = (page: Page) => page.getByTestId('clock-status');
export const held = (page: Page) => page.getByTestId('clock-press-held');
export const result = (page: Page) => page.getByTestId('match-result-overlay');
export const redHit = (page: Page) =>
  page.locator('[data-testid="scoring-column"][data-side="red"]').getByTestId('clean-hit-button');
