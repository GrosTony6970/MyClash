/**
 * The piste TV, five seconds after a bout ends: it reads its own piste again.
 * It used to go to the next bout's own address, and from there it followed a
 * chain of Match ids. A bout moved to another piste then took the TV with it,
 * until someone walked over (quick win T1).
 *
 * The API is stubbed. The bout on the piste has ended and names a next bout,
 * which is all the screen needs to start its countdown. The unit test holds
 * the address (`lice-board.test.ts`); only a live page proves where the screen
 * goes.
 */
import { test, expect, type Page } from '@playwright/test';
import { stubPublicApi } from './helpers';

const PUBLIC = 'http://localhost:3001';
const PISTE = `${PUBLIC}/e/test-event/lice/Piste%201/display`;

const ENDED_BOUT = {
  id: 'm-1',
  status: 'completed',
  phaseType: 'pool',
  matchNumberLabel: 'L1-P1-M01',
  redScore: 5,
  blueScore: 3,
  redFighterName: 'Ada Lovelace',
  blueFighterName: 'Mary Somerville',
  rulesetCode: 'TF_v1',
  startedAt: '2027-03-13T09:00:00.000Z',
  endedAt: '2027-03-13T09:03:00.000Z',
  nextMatchId: 'm-2',
};

async function openPiste(page: Page, bout: object = ENDED_BOUT): Promise<string[]> {
  await stubPublicApi(page);
  await page.route('**/api/v1/events/test-event/lices/*/current', (route) =>
    route.fulfill({
      json: {
        liceId: 'lice-1',
        liceName: 'Piste 1',
        event: { name: 'Open de Lyon' },
        current: { id: 'm-1' },
        queue: [],
      },
    }),
  );
  await page.route('**/api/v1/matches/m-1/display', (route) => route.fulfill({ json: bout }));
  await page.route('**/api/v1/matches/m-1/clock', (route) =>
    route.fulfill({ json: { status: 'ended', activeMs: 180_000, runningFrom: null, events: [] } }),
  );
  for (const list of ['penalties', 'exchanges']) {
    await page.route(`**/api/v1/matches/m-1/${list}`, (route) => route.fulfill({ json: [] }));
  }
  // Every address the screen loads, the first one included.
  const loaded: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) loaded.push(frame.url());
  });
  await page.goto(PISTE);
  return loaded;
}

test('when its bout ends, the piste TV loads its own piste again, not the next bout', async ({
  page,
}) => {
  const loaded = await openPiste(page);
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

  // The countdown is five seconds: the screen then loads an address once more.
  // Counted from here, because one load reports itself more than once.
  const before = loaded.length;
  await expect.poll(() => loaded.length, { timeout: 15_000 }).toBeGreaterThan(before);

  expect(loaded.filter((url) => url !== PISTE)).toEqual([]);
  expect(page.url()).toBe(PISTE);
});

test('a bout a correction reopened keeps the screen: it does not load again every five seconds', async ({
  page,
}) => {
  // The official voided the closing hit: the bout is paused again, and its
  // clock still reads ended. The piste still names it, so a rollover here
  // would load the same bout again, for ever.
  const loaded = await openPiste(page, { ...ENDED_BOUT, status: 'paused' });
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

  const before = loaded.length;
  // Longer than the countdown, which is five seconds.
  await page.waitForTimeout(7_000);

  expect(loaded.length).toBe(before);
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
});
