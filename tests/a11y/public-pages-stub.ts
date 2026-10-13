/**
 * Three guest pages of an Event in a browser, with the API stubbed: the guest
 * schedule, a person's page and the live board. They read on the client, so a
 * story gives the answers. The Event is on Paris time.
 */
import type { Page } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';

export const PUBLIC = 'http://localhost:3001';
export const EVENT_HOME = `${PUBLIC}/e/test-event/home`;
export const PARIS = 'Europe/Paris';

/** A bout of the fighter whose schedule it is, in June: Paris is two hours ahead of UTC. */
export const scheduledBout = (id: string, scheduledAt: string, more: object = {}) => ({
  id,
  matchNumberLabel: `Pool 1 - ${id}`,
  status: 'scheduled',
  scheduledAt,
  durationMinutes: 5,
  opponentName: 'Ada Lovelace',
  redScore: 0,
  blueScore: 0,
  outcome: null,
  isRed: true,
  poolId: 'pool-1',
  poolName: 'Pool 1',
  tournamentName: 'Longsword Open',
  liceName: 'Piste 3',
  ...more,
});

/** A duty at the table of a Pool: the API names the role by its id AND by the organiser's name. */
export const tableDuty = (scheduledAt: string) => ({
  id: 'duty-1',
  matchId: '',
  matchNumberLabel: '',
  scheduledAt,
  startsAt: scheduledAt,
  endsAt: null,
  role: 'arbitre_table',
  skillName: 'Table',
  skillColor: null,
  poolName: 'Pool 2',
  tournamentName: 'Longsword Open',
  liceName: 'Piste 1',
});

export const emptySchedule = {
  personId: 'person-1',
  timezone: PARIS,
  matches: [],
  poolSpans: [],
  refereeSlots: [],
  workshops: [],
};

export async function openGuestSchedule(page: Page, schedule: object): Promise<void> {
  await stubPublicApi(page);
  await page.route('**/api/v1/events/**/my-schedule', (route) => route.fulfill({ json: schedule }));
  await page.goto(`${PUBLIC}/e/test-event/my-schedule`);
  await waitForPageMain(page);
}

const PROFILE = {
  id: 'person-1',
  givenName: 'Grace',
  familyName: 'Hopper',
  clubLabel: 'Lyon HEMA',
  roles: ['competitor'],
  allowBeingFollowed: true,
  followState: 'not_following',
  hasAccount: true,
};

export async function openPersonPage(page: Page, schedule: object): Promise<void> {
  await stubPublicApi(page);
  await page.route('**/api/v1/events/test-event', (route) =>
    route.fulfill({ json: { id: 'ev-1', name: 'Open de Lyon', timezone: PARIS } }),
  );
  await page.route('**/api/v1/events/ev-1/people/person-1', (route) =>
    route.fulfill({ json: PROFILE }),
  );
  await page.route('**/api/v1/events/ev-1/people/person-1/schedule', (route) =>
    route.fulfill({ json: schedule }),
  );
  await page.goto(`${PUBLIC}/e/test-event/people/person-1`);
  await page.getByRole('heading', { name: 'Grace Hopper' }).waitFor();
}

/** A bout of the live board. */
export const boardBout = (id: string, more: object = {}) => ({
  id,
  matchNumberLabel: `L1-P1-${id}`,
  redFighterName: 'Ada Lovelace',
  blueFighterName: 'Mary Somerville',
  scheduledAt: '2027-06-12T08:30:00.000Z',
  status: 'running',
  tournamentName: 'Longsword Open',
  redScore: 5,
  blueScore: 3,
  ...more,
});

export const liveState = (lices: object[]) => ({
  currentBlock: null,
  nextBlock: null,
  timezone: PARIS,
  lices,
});

/** The live board's read, as a story can change it, fail it and count it. */
export interface LiveBoard {
  answer: object;
  /** While true the read fails, as a server that is down. */
  down: boolean;
  reads: number;
}

export async function openLiveBoard(page: Page, state: object, query = ''): Promise<LiveBoard> {
  const board: LiveBoard = { answer: state, down: false, reads: 0 };
  await stubPublicApi(page);
  await page.route('**/api/v1/events/test-event/live-state', (route) => {
    board.reads += 1;
    return board.down
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: board.answer });
  });
  await page.goto(`${PUBLIC}/e/test-event/live${query}`);
  await page.locator('main h1').waitFor();
  return board;
}
