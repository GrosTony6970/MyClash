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

async function openMySchedule(page: Page): Promise<void> {
  await stubPublicApi(page);
  await page.route('**/api/v1/events/**/my-schedule', (route) => route.fulfill({ json: SCHEDULE }));
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

  await expectNoPageIssues(issues);
});
