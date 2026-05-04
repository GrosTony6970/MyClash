import { test, expect } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  focusUntil,
} from './helpers';

test('my-schedule page - axe clean and keyboard operable', async ({ page }) => {
  const issues = collectPageIssues(page);
  await page.route('**/api/v1/events/**/my-schedule', (route) =>
    route.fulfill({
      json: {
        personId: 'person-1',
        matches: [
          {
            id: 'match-1',
            matchNumberLabel: 'Pool 1 - Match 1',
            status: 'scheduled',
            scheduledAt: '2027-03-13T09:00:00.000Z',
            opponentName: 'Ada Lovelace',
            redScore: 0,
            blueScore: 0,
            isRed: true,
            poolName: 'Pool 1',
            tournamentName: 'Longsword Open',
            liceName: 'Lice 1',
          },
        ],
        refereeSlots: [
          {
            matchId: 'match-2',
            matchNumberLabel: 'Pool 2 - Match 3',
            scheduledAt: '2027-03-14T10:00:00.000Z',
            role: 'arbitre_table',
            poolName: 'Pool 2',
            tournamentName: 'Longsword Open',
          },
        ],
        workshops: [
          {
            workshopId: 'workshop-1',
            workshopName: 'Messer fundamentals',
            sessionStart: '2027-03-14T14:00:00.000Z',
            sessionEnd: '2027-03-14T16:00:00.000Z',
            location: 'Room A',
          },
        ],
      },
    }),
  );

  await page.goto('http://localhost:3001/e/test-event/my-schedule');
  await page.waitForSelector('main');

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
