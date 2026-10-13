/**
 * A piste TV in a browser, with its API stubbed: one piste, one bout on it.
 *
 * The piste's read names the bout (`current`) and the bouts that wait behind it
 * (`queue`). The bout's own reads follow: its display payload, its clock, and
 * two empty lists. A story gives only what it changes.
 */
import type { Page } from '@playwright/test';
import { stubPublicApi } from './helpers';

export const PUBLIC = 'http://localhost:3001';
export const PISTE_TV = `${PUBLIC}/e/test-event/lice/Piste%201/display`;

/** A Pool bout in play, its clock halted after one minute. */
export const BOUT = {
  id: 'm-1',
  status: 'paused',
  phaseType: 'pool',
  matchNumberLabel: 'L1-P1-M01',
  redScore: 5,
  blueScore: 3,
  redFighterName: 'Ada Lovelace',
  blueFighterName: 'Mary Somerville',
  rulesetCode: 'TF_v1',
  startedAt: '2027-03-13T09:00:00.000Z',
  endedAt: null,
  event: { name: 'Open de Lyon' },
  lice: { name: 'Piste 1' },
  tournament: { name: 'Longsword' },
  poolName: 'Pool A',
  nextMatchId: 'm-2',
  nextMatch: {
    id: 'm-2',
    matchNumberLabel: 'L1-P1-M02',
    roundCode: null,
    redFighterName: 'Grace Hopper',
    blueFighterName: 'Emmy Noether',
  },
};

export const HALTED = { status: 'halted', activeMs: 60_000, runningFrom: null, events: [] };
export const ENDED = { status: 'ended', activeMs: 180_000, runningFrom: null, events: [] };

/** The bout above, over: its clock ended and its row completed. */
export const ENDED_BOUT = { ...BOUT, status: 'completed', endedAt: '2027-03-13T09:03:00.000Z' };

export interface PisteTv {
  /** The bout on the piste. Default: `BOUT`. */
  bout?: object;
  clock?: object;
  /** What the piste's read answers. Default: it names the bout, nothing waits. */
  board?: object;
}

export const BOARD = {
  liceId: 'lice-1',
  liceName: 'Piste 1',
  event: { name: 'Open de Lyon' },
  current: { id: 'm-1' },
  queue: [],
};

/** The bout that waits behind `BOUT`: not started, and the last of the piste. */
export const NEXT_BOUT = {
  ...BOUT,
  id: 'm-2',
  status: 'scheduled',
  matchNumberLabel: 'L1-P1-M02',
  redScore: 0,
  blueScore: 0,
  redFighterName: 'Grace Hopper',
  blueFighterName: 'Emmy Noether',
  startedAt: null,
  nextMatchId: null,
  nextMatch: null,
};

export const IDLE = { status: 'idle', activeMs: 0, runningFrom: null, events: [] };

/** What a bout's reads answer. A story can change both while the screen is up. */
export interface LiveBout {
  bout: object;
  clock: object;
}

/** One bout's four reads. */
export async function stubBout(page: Page, id: string, bout: object, clock: object) {
  await stubLiveBout(page, id, { bout, clock });
}

async function stubLiveBout(page: Page, id: string, live: LiveBout) {
  await page.route(`**/api/v1/matches/${id}/display`, (route) =>
    route.fulfill({ json: live.bout }),
  );
  await page.route(`**/api/v1/matches/${id}/clock`, (route) => route.fulfill({ json: live.clock }));
  for (const list of ['penalties', 'exchanges']) {
    await page.route(`**/api/v1/matches/${id}/${list}`, (route) => route.fulfill({ json: [] }));
  }
}

/** The piste's read, as a story can change it and count it while the screen is up. */
export interface PisteBoard extends LiveBout {
  /** What the next read of the piste answers. */
  answer: object;
  /** How many times the screen read its piste. */
  reads: number;
  /**
   * Run once, at the next read of the piste, before it is answered: what
   * happened on the piste just before that read. A story that changes the bout
   * here knows the scoreboard's own poll did not see the change first.
   */
  atNextRead: (() => void) | null;
}

export async function stubPisteTv(page: Page, tv: PisteTv = {}): Promise<PisteBoard> {
  const board: PisteBoard = {
    answer: tv.board ?? BOARD,
    reads: 0,
    bout: tv.bout ?? BOUT,
    clock: tv.clock ?? HALTED,
    atNextRead: null,
  };
  await stubPublicApi(page);
  await page.route('**/api/v1/events/test-event/lices/*/current', (route) => {
    board.atNextRead?.();
    board.atNextRead = null;
    board.reads += 1;
    return route.fulfill({ json: board.answer });
  });
  await stubLiveBout(page, 'm-1', board);
  await stubBout(page, 'm-2', NEXT_BOUT, IDLE);
  return board;
}

export async function openPisteTv(page: Page, tv: PisteTv = {}): Promise<PisteBoard> {
  const board = await stubPisteTv(page, tv);
  await page.goto(PISTE_TV);
  return board;
}

/**
 * A mark on the page's `window`. A page that is loaded again loses it: a story
 * that still reads it knows the screen changed without a load.
 */
export async function markPage(page: Page) {
  await page.evaluate(() => {
    const mark = { sawSpinner: false };
    (window as unknown as { tvMark?: typeof mark }).tvMark = mark;
    // From now on: did the screen ever go to its "Loading scoreboard" spinner?
    new MutationObserver(() => {
      if (document.body.innerText.includes('Loading scoreboard')) mark.sawSpinner = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

type Mark = { tvMark?: { sawSpinner: boolean } };

export const pageKeptItsMark = (page: Page) =>
  page.evaluate(() => (window as unknown as Mark).tvMark !== undefined);

/** Since the mark: the scoreboard was replaced by its spinner at some moment. */
export const sawSpinner = (page: Page) =>
  page.evaluate(() => (window as unknown as Mark).tvMark?.sawSpinner === true);
