/**
 * The stubbed server of `pad-best-of-no-network.spec.ts`, and that spec's
 * locators.
 *
 * It keeps a best-of-3 Pool bout as the server does: a hit counts in the round
 * that is open when it ARRIVES, a round closes at the cap, "Start round N"
 * opens the next one only while a round waits, and two rounds won complete
 * the bout. The cap is 2, so one "+2" closes a round. A dead network is the
 * answer the pad's service worker gives: a 503 with `{ error: 'offline' }`.
 */
import { expect, type Page, type Route } from '@playwright/test';
import { roundOver, roundScore, rulesOf } from './pad-rounds-score';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const OFFLINE = { status: 503, json: { error: 'offline', status: 503 } };

interface ClosedRound {
  round: number;
  redScore: number;
  blueScore: number;
  winnerColor: 'red' | 'blue' | null;
  /** `time_limit`: "End round" closed it. The server never puts such a round back in play. */
  endReason: 'first_to_points' | 'time_limit';
}

const ROW = {
  id: BOUT,
  tournament_id: 'tournament-1',
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
  rounds_json: [] as ClosedRound[],
  awaiting_round_advance: false,
};
const SUMMARY = {
  roundCode: 'P1',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
  phaseType: 'pool',
  bestOf: 3,
  tournamentId: 'tournament-1',
};

interface Stub {
  network: 'up' | 'down';
  /** The cap of a round, as the Tournament's rules give it to the tablet. */
  cap: number;
  /**
   * The cap the SERVER closes a round at: above 2, it counts another way than the tablet.
   * In a bout that counts down it is also where the server starts a round.
   */
  serverCap: number;
  /** The bout counts down: a fighter starts at the cap, and loses at zero. */
  countdown: boolean;
  /** Every read of the bout's row waits until this resolves. */
  holdRow: Promise<void> | null;
  /** Every write the server took or refused, in order: `POST /clock start`, `POST /rounds/advance 2`. */
  sent: string[];
  /** The body of each round press that arrived. */
  roundBodies: Array<Record<string, unknown>>;
  row: typeof ROW;
  hits: Array<Record<string, unknown>>;
  clock: { status: string; activeMs: number; runningFrom: string | null; startedAt: string | null };
}

const refusal = (route: Route, status: number, code: string) =>
  route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ status, code, detail: 'API words', message: 'API words' }),
  });

/** The open round is over on the server: it is written down, and the bout waits or completes. */
function closeRound(
  stub: Stub,
  winnerColor: 'red' | 'blue' | null,
  endReason: ClosedRound['endReason'] = 'first_to_points',
) {
  const { row } = stub;
  const rounds = [
    ...row.rounds_json,
    {
      round: row.current_round,
      redScore: row.red_score,
      blueScore: row.blue_score,
      winnerColor,
      endReason,
    },
  ];
  const red = rounds.filter((round) => round.winnerColor === 'red').length;
  const blue = rounds.filter((round) => round.winnerColor === 'blue').length;
  const over = red === 2 || blue === 2 || rounds.length === 3;
  stub.row = {
    ...row,
    rounds_json: rounds,
    red_round_wins: red,
    blue_round_wins: blue,
    awaiting_round_advance: !over,
    status: over ? 'completed' : 'paused',
    winner_registration_id: over ? (red > blue ? 'red-1' : blue > red ? 'blue-1' : null) : null,
  };
  const ran = stub.clock.runningFrom ? Date.now() - Date.parse(stub.clock.runningFrom) : 0;
  stub.clock = {
    ...stub.clock,
    status: over ? 'ended' : 'halted',
    runningFrom: null,
    activeMs: stub.clock.activeMs + ran,
  };
}

/** The open round's score, counted again from its hits, as the server does. */
function rescore(stub: Stub) {
  const { hits, row, countdown, serverCap } = stub;
  const score = roundScore(hits, row.current_round, countdown, serverCap);
  stub.row = { ...row, red_score: score.red, blue_score: score.blue };
  return score;
}

function answerHit(stub: Stub, route: Route) {
  const hit = route.request().postDataJSON() as {
    clientUuid: string;
    type: string;
    firstStrikerColor: 'red' | 'blue' | null;
    firstStrikeValue: number | null;
  };
  stub.sent.push('POST /exchanges');
  if (stub.row.awaiting_round_advance) return refusal(route, 400, 'round_awaits_advance');
  stub.hits.push({
    id: `hit-${stub.hits.length + 1}`,
    client_uuid: hit.clientUuid,
    sequence: stub.hits.length + 1,
    type: hit.type,
    voided: false,
    occurredAt: new Date().toISOString(),
    occurred_at: new Date().toISOString(),
    scoringSide: hit.firstStrikerColor,
    scoreDelta: hit.firstStrikeValue ?? 0,
    round_number: stub.row.current_round,
  });
  const { red, blue } = rescore(stub);
  if (roundOver({ red, blue }, stub.countdown, stub.serverCap)) {
    closeRound(stub, red > blue ? 'red' : 'blue');
  }
  return route.fulfill({ status: 201, json: { id: `hit-${stub.hits.length}` } });
}

/**
 * A hit is cancelled. A round the CAP closed that is under the cap again goes
 * back in play, as on the server; a round "End round" closed stays closed. The
 * server's refusal of a void that takes a round from its winner is not kept.
 */
function answerVoid(stub: Stub, route: Route, path: string) {
  stub.sent.push('PATCH /void');
  const hit = stub.hits.find((row) => path.endsWith(`/exchanges/${String(row.id)}/void`));
  if (!hit || hit.voided) return refusal(route, 404, 'not_found');
  hit.voided = true;
  const score = rescore(stub);
  const { row } = stub;
  const byCap = row.rounds_json.some(
    (round) => round.round === row.current_round && round.endReason === 'first_to_points',
  );
  const underCap = !roundOver(score, stub.countdown, stub.serverCap);
  const reopens =
    row.awaiting_round_advance && hit.round_number === row.current_round && byCap && underCap;
  const rounds = reopens
    ? row.rounds_json.filter((round) => round.round !== row.current_round)
    : row.rounds_json;
  stub.row = {
    ...row,
    rounds_json: rounds,
    red_round_wins: rounds.filter((round) => round.winnerColor === 'red').length,
    blue_round_wins: rounds.filter((round) => round.winnerColor === 'blue').length,
    awaiting_round_advance: reopens ? false : row.awaiting_round_advance,
  };
  return route.fulfill({ json: {} });
}

function answerRound(stub: Stub, route: Route, door: 'advance' | 'end') {
  const body = route.request().postDataJSON() as { round: number };
  stub.sent.push(`POST /rounds/${door} ${body.round}`);
  stub.roundBodies.push(body as unknown as Record<string, unknown>);
  const { row } = stub;
  if (door === 'advance') {
    if (row.current_round >= body.round) {
      return route.fulfill({ json: { currentRound: row.current_round } });
    }
    const waits = row.awaiting_round_advance && row.current_round === body.round - 1;
    if (!waits) return refusal(route, 409, 'round_not_waiting');
    stub.row = { ...row, current_round: body.round, awaiting_round_advance: false };
    rescore(stub);
    stub.clock = { ...stub.clock, status: 'halted', activeMs: 0, runningFrom: null };
    return route.fulfill({ json: { currentRound: body.round } });
  }
  const closed = row.rounds_json.find((round) => round.round === body.round);
  if (closed) return route.fulfill({ json: closed });
  if (row.current_round !== body.round) return refusal(route, 409, 'round_not_open');
  const { red_score: red, blue_score: blue } = row;
  closeRound(stub, red === blue ? null : red > blue ? 'red' : 'blue', 'time_limit');
  return route.fulfill({ json: { redScore: red, blueScore: blue } });
}

function answerClock(stub: Stub, route: Route) {
  const { action } = route.request().postDataJSON() as { action: string };
  stub.sent.push(`POST /clock ${action}`);
  const now = new Date().toISOString();
  const { clock } = stub;
  const ran = clock.runningFrom ? Date.now() - Date.parse(clock.runningFrom) : 0;
  const moving = action === 'start' || action === 'resume';
  if (moving && stub.row.awaiting_round_advance) {
    return refusal(route, 400, 'round_awaits_advance');
  }
  if (moving) {
    stub.clock = {
      ...clock,
      status: 'running',
      runningFrom: now,
      startedAt: clock.startedAt ?? now,
    };
    stub.row = { ...stub.row, status: 'running' };
  } else {
    stub.clock = { ...clock, status: 'halted', runningFrom: null, activeMs: clock.activeMs + ran };
    stub.row = { ...stub.row, status: 'paused' };
  }
  return route.fulfill({ json: clockBody(stub) });
}

const clockBody = (stub: Stub) => ({
  ...stub.clock,
  matchId: BOUT,
  totalActiveMs: stub.clock.activeMs,
  levelResolutionSteps: 0,
  events: [],
});

interface Start {
  /** The cap of a round, for the tablet and the server alike: 2 when not given. */
  cap?: number;
  serverCap?: number;
  countdown?: boolean;
  /** The bout was started before, and its clock is halted at this time. */
  haltedAtMs?: number;
}

function newStub(start: Start): Stub {
  const halted = start.haltedAtMs !== undefined;
  return {
    network: 'up',
    cap: start.cap ?? 2,
    serverCap: start.serverCap ?? start.cap ?? 2,
    countdown: start.countdown ?? false,
    holdRow: null,
    sent: [],
    roundBodies: [],
    row: { ...ROW, status: halted ? 'paused' : 'scheduled' },
    hits: [],
    clock: halted
      ? {
          status: 'halted',
          activeMs: start.haltedAtMs ?? 0,
          runningFrom: null,
          startedAt: '2026-01-01T10:00:00.000Z',
        }
      : { status: 'idle', activeMs: 0, runningFrom: null, startedAt: null },
  };
}

/** Opens the best-of-3 bout with the network up. Returns the stub's switches and its record. */
export async function openBestOf(page: Page, start: Start = {}) {
  const stub = newStub(start);
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (stub.network === 'down') return route.fulfill(OFFLINE);
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    // Matched by path before the body: the pad posts a heartbeat on its own.
    if (method === 'POST' && path.endsWith('/rounds/advance')) {
      return answerRound(stub, route, 'advance');
    }
    if (method === 'POST' && path.endsWith('/rounds/end')) return answerRound(stub, route, 'end');
    if (method === 'POST' && path.endsWith('/clock')) return answerClock(stub, route);
    if (method === 'POST' && path.endsWith('/exchanges')) return answerHit(stub, route);
    if (method === 'PATCH' && path.endsWith('/void')) return answerVoid(stub, route, path);
    if (method !== 'GET') return route.fulfill({ json: {} });
    if (path.endsWith('/penalty-ruleset')) return route.fulfill({ json: null });
    if (path.endsWith(`/matches/${BOUT}`)) {
      if (stub.holdRow) await stub.holdRow;
      return route.fulfill({ json: stub.row });
    }
    if (path.endsWith('/summary')) return route.fulfill({ json: SUMMARY });
    if (path.endsWith('/match-config'))
      return route.fulfill({ json: rulesOf(stub.countdown, stub.cap) });
    if (path.endsWith('/exchanges')) return route.fulfill({ json: stub.hits });
    if (path.endsWith('/penalties')) return route.fulfill({ json: [] });
    if (path.endsWith('/clock')) return route.fulfill({ json: clockBody(stub) });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(primary(page)).toBeEnabled();
  // The rules are read: the bout is a best-of, first to 2.
  await expect(page.getByText(/round 1/i).first()).toBeVisible();
  return stub;
}

/** Starts the clock and halts it: hits are entered on a halted clock. */
export async function startAndHalt(page: Page) {
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
}

/** A queued hit is drawn. Waited for before "End round": pressed sooner, it judges a level round. */
export const hitIsOnScreen = (page: Page) =>
  expect(page.getByTestId('provisional-score').first()).toBeVisible();

/** The network is back: the browser tells the page. */
export async function comeBackOnline(page: Page, stub: Stub) {
  stub.network = 'up';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

/** How many rows the tablet's queue holds, read from the store itself. */
export function queuedOnTablet(page: Page): Promise<number | string> {
  return page.evaluate(
    () =>
      new Promise<number | string>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve('the store did not open');
        open.onsuccess = () => {
          const count = open.result.transaction('outbox').objectStore('outbox').count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
  );
}

/** A promise a test resolves by hand, to hold one answer of the server back. */
export function gate(): { open: () => void; closed: Promise<void> } {
  let open = () => {};
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, closed };
}

export const primary = (page: Page) => page.getByTestId('clock-primary-button');
export const status = (page: Page) => page.getByTestId('clock-status');
export const held = (page: Page) => page.getByTestId('clock-press-held');
export const result = (page: Page) => page.getByTestId('match-result-overlay');
export const roundBreak = (page: Page) => page.getByRole('dialog');
export const notConfirmedRound = (page: Page) => page.getByTestId('round-closed-on-tablet');
export const startNextRound = (page: Page) => page.getByTestId('start-next-round');
const column = (page: Page, side: 'red' | 'blue') =>
  page.locator(`[data-testid="scoring-column"][data-side="${side}"]`);
/** The "+2" of a side: at a cap of 2 it closes the round. */
export const plusTwo = (page: Page, side: 'red' | 'blue') =>
  column(page, side).getByTestId('clean-hit-button').first();
/** The "+1" of a side. */
export const plusOne = (page: Page, side: 'red' | 'blue') =>
  column(page, side).getByTestId('clean-hit-button').nth(1);
