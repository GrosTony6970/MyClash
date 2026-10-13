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

export async function stubPisteTv(page: Page, tv: PisteTv = {}) {
  await stubPublicApi(page);
  await page.route('**/api/v1/events/test-event/lices/*/current', (route) =>
    route.fulfill({ json: tv.board ?? BOARD }),
  );
  await page.route('**/api/v1/matches/m-1/display', (route) =>
    route.fulfill({ json: tv.bout ?? BOUT }),
  );
  await page.route('**/api/v1/matches/m-1/clock', (route) =>
    route.fulfill({ json: tv.clock ?? HALTED }),
  );
  for (const list of ['penalties', 'exchanges']) {
    await page.route(`**/api/v1/matches/m-1/${list}`, (route) => route.fulfill({ json: [] }));
  }
}

export async function openPisteTv(page: Page, tv: PisteTv = {}) {
  await stubPisteTv(page, tv);
  await page.goto(PISTE_TV);
}
