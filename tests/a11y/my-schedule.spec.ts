import { test, expect, type Page } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  focusUntil,
  stubPublicApi,
  waitForPageMain,
} from './helpers';

const bout = (id: string, scheduledAt: string, opponentName: string) => ({
  id,
  matchNumberLabel: `Pool 1 - ${id}`,
  status: 'scheduled',
  scheduledAt,
  durationMinutes: 5,
  opponentName,
  redScore: 0,
  blueScore: 0,
  isRed: true,
  poolId: 'pool-1',
  poolName: 'Pool 1',
  tournamentName: 'Longsword Open',
  liceName: 'Lice 1',
});

/**
 * A fighter in Pool 1, whose bouts at 09:00 and 09:30 make it span 09:00–09:35,
 * enrolled in a workshop at 09:10–09:20 — between the two bouts, overlapping
 * neither. A fighter is busy for the whole Pool, so the workshop clashes with it.
 */
const SCHEDULE = {
  personId: 'person-1',
  matches: [
    bout('Match 1', '2027-03-13T09:00:00.000Z', 'Ada Lovelace'),
    bout('Match 4', '2027-03-13T09:30:00.000Z', 'Mary Somerville'),
  ],
  poolSpans: [
    {
      poolId: 'pool-1',
      poolName: 'Pool 1',
      tournamentName: 'Longsword Open',
      startsAt: '2027-03-13T09:00:00.000Z',
      endsAt: '2027-03-13T09:35:00.000Z',
    },
  ],
  refereeSlots: [
    {
      id: 'duty-1',
      matchId: 'match-2',
      matchNumberLabel: 'Pool 2 - Match 3',
      scheduledAt: '2027-03-14T10:00:00.000Z',
      startsAt: '2027-03-14T10:00:00.000Z',
      endsAt: '2027-03-14T10:05:00.000Z',
      role: 'arbitre_table',
      poolName: 'Pool 2',
      tournamentName: 'Longsword Open',
    },
  ],
  workshops: [
    {
      workshopId: 'workshop-2',
      workshopName: 'Stick and guard',
      sessionStart: '2027-03-13T09:10:00.000Z',
      sessionEnd: '2027-03-13T09:20:00.000Z',
      location: 'Room B',
    },
    {
      workshopId: 'workshop-1',
      workshopName: 'Messer fundamentals',
      sessionStart: '2027-03-14T14:00:00.000Z',
      sessionEnd: '2027-03-14T16:00:00.000Z',
      location: 'Room A',
    },
  ],
};

/**
 * The same day when the API could not read the Event's sheet: no bout has a
 * length. Match 1 ends where the API fell back on, its next bout at 09:25 — so
 * it runs over the 09:10 workshop. Match 4 is the day's last on its piste and
 * has no end; nor has the Pool, which is no card. One card cannot be checked.
 */
const DEGRADED = {
  ...SCHEDULE,
  matches: [
    { ...SCHEDULE.matches[0], durationMinutes: null, fallbackEndsAt: '2027-03-13T09:25:00.000Z' },
    { ...SCHEDULE.matches[1], durationMinutes: null, fallbackEndsAt: null },
  ],
  poolSpans: [{ ...SCHEDULE.poolSpans[0], endsAt: null }],
};

async function openMySchedule(page: Page, schedule: object = SCHEDULE): Promise<void> {
  await stubPublicApi(page);
  await page.route('**/api/v1/events/**/my-schedule', (route) => route.fulfill({ json: schedule }));
  await page.goto('http://localhost:3001/e/test-event/my-schedule');
  await waitForPageMain(page);
}

test('my-schedule page - axe clean and keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  await openMySchedule(page);

  await expectNoCriticalAxeViolations(page);

  const toggle = page.getByRole('button', { name: 'Show all' });
  await focusUntil(page, toggle);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Focus on me' })).toBeVisible();

  const allDays = page.getByRole('button', { name: 'All days' });
  await focusUntil(page, allDays);
  await page.keyboard.press('Space');
  await expect(allDays).toHaveAttribute('aria-pressed', 'true');

  await expectNoPageIssues(issues);
});

test("my-schedule page - a workshop inside the fighter's Pool conflicts with it, on every bout", async ({
  page,
}) => {
  const issues = collectPageIssues(page);
  await openMySchedule(page);

  // The workshop names the Pool; each bout names the workshop, though neither
  // bout overlaps it. The other day's workshop and duty clash with nothing.
  await expect(page.getByText('⚠ Conflicts with: Pool 1 · Longsword Open')).toHaveCount(1);
  await expect(page.getByText('⚠ Conflicts with: Stick and guard')).toHaveCount(2);
  await expect(page.getByText(/Conflicts with/)).toHaveCount(3);
  // Every end is known: the line is not there.
  await expect(page.getByText(/couldn't work out/)).toHaveCount(0);

  await expectNoPageIssues(issues);
});

/**
 * A Paris Event whose last bout of Saturday starts at 00:30 on Sunday, which is
 * 23:30 UTC on Saturday. The page offered a Sunday chip and then filtered on the
 * UTC day, so the chip hid the one bout it was made for (quick win F2).
 */
const PAST_MIDNIGHT = {
  ...SCHEDULE,
  timezone: 'Europe/Paris',
  matches: [
    bout('Match 1', '2027-03-13T11:00:00.000Z', 'Ada Lovelace'),
    bout('Match 9', '2027-03-13T23:30:00.000Z', 'Mary Somerville'),
  ],
  poolSpans: [],
  refereeSlots: [],
  workshops: [],
};

test('my-schedule page - a bout after midnight shows under the chip of its own day', async ({
  page,
}) => {
  await openMySchedule(page, PAST_MIDNIGHT);
  const main = page.locator('main');

  await page.getByRole('button', { name: 'Sun 14' }).click();
  await expect(main.getByText('Mary Somerville')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Sunday 14 March' })).toBeVisible();
  await expect(main.getByText('Ada Lovelace')).toHaveCount(0);
  await expect(main.getByText('Nothing scheduled on this day.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Sat 13' }).click();
  await expect(main.getByText('Ada Lovelace')).toBeVisible();
  await expect(main.getByText('Mary Somerville')).toHaveCount(0);
});

/**
 * The schedule's read answers `status` until the test says the server is well.
 * A read that fails is not a signed-out device (quick win F1).
 */
async function openMyScheduleAnswering(page: Page, status: number) {
  const server = { well: false, reads: 0 };
  await stubPublicApi(page);
  await page.route('**/api/v1/events/**/my-schedule', (route) => {
    server.reads += 1;
    return server.well
      ? route.fulfill({ json: SCHEDULE })
      : route.fulfill({ status, json: { detail: 'refused' } });
  });
  await page.goto('http://localhost:3001/e/test-event/my-schedule');
  await waitForPageMain(page);
  return server;
}

test('my-schedule page - a read that fails offers Retry, and says nothing about signing in', async ({
  page,
}) => {
  const server = await openMyScheduleAnswering(page, 500);
  const main = page.locator('main');

  await expect(
    main.getByRole('heading', { name: 'We could not load your schedule' }),
  ).toBeVisible();
  await expect(main.getByText(/sign in/i)).toHaveCount(0);
  // The page does not read again by itself. (The dev server mounts a page twice,
  // so the count at this point is not one.)
  const before = server.reads;

  server.well = true;
  await main.getByRole('button', { name: 'Try again' }).click();

  await expect(main.getByRole('heading', { name: 'My Schedule' })).toBeVisible();
  await expect(main.getByText('Ada Lovelace')).toBeVisible();
  expect(server.reads).toBe(before + 1);
});

test('my-schedule page - a device the server does not know gets the two doors in', async ({
  page,
}) => {
  await openMyScheduleAnswering(page, 401);
  const main = page.locator('main');

  await expect(main.getByRole('heading', { name: 'Sign in to see your schedule' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Participants list' })).toHaveAttribute(
    'href',
    '/e/test-event/participants',
  );
  await expect(main.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  await expect(main.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
});

test('my-schedule page - an account that is not on the list is not told to sign in', async ({
  page,
}) => {
  await stubPublicApi(page);
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ json: { type: 'claimed', user: { id: 'u-1', email: 'ana@example.org' } } }),
  );
  await page.route('**/api/v1/events/**/my-schedule', (route) =>
    route.fulfill({ status: 401, json: { detail: 'Authentication required' } }),
  );
  await page.goto('http://localhost:3001/e/test-event/my-schedule');
  await waitForPageMain(page);
  const main = page.locator('main');

  await expect(main.getByRole('heading', { name: 'Your schedule is not here' })).toBeVisible();
  await expect(main.getByText(/not on this event's participants list/i)).toBeVisible();
  await expect(main.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('my-schedule page - with no lengths, a bout ends at its next bout, and the page says what it cannot check', async ({
  page,
}) => {
  const issues = collectPageIssues(page);
  await openMySchedule(page, DEGRADED);

  // One commitment: the line's own wording for one.
  await expect(
    page.getByText(
      "We couldn't work out when 1 of your commitments ends, so it isn't checked for clashes.",
    ),
  ).toBeVisible();
  // Match 1 and the workshop name each other; nothing else clashes.
  await expect(page.getByText('⚠ Conflicts with: Stick and guard')).toHaveCount(1);
  await expect(page.getByText('⚠ Conflicts with: Pool 1 - Match 1')).toHaveCount(1);
  await expect(page.getByText(/Conflicts with/)).toHaveCount(2);

  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});
