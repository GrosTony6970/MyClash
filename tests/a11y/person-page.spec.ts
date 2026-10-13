/**
 * A person's page at an Event: what a friend, a coach or a club mate reads to
 * know where that person is and when.
 *
 * The API is stubbed (`public-pages-stub.ts`): the page reads on the client.
 */
import { test, expect } from '@playwright/test';
import { emptySchedule, openPersonPage, scheduledBout, tableDuty } from './public-pages-stub';

const AT_1030 = '2027-06-12T08:30:00.000Z';

// Quick win F17. The page printed the role's id, "arbitre table".
test("a duty names its role as the organiser named it, never by the role's id", async ({
  page,
}) => {
  await openPersonPage(page, { ...emptySchedule, refereeSlots: [tableDuty(AT_1030)] });

  const duties = page.locator('section', { hasText: 'Referee duties' });
  await expect(duties.getByText('Table', { exact: true })).toBeVisible();
  await expect(page.getByText(/arbitre/i)).toHaveCount(0);
});

// Quick win F9. The server sent the piste; the page did not show it.
test('a bout to come names its piste', async ({ page }) => {
  await openPersonPage(page, {
    ...emptySchedule,
    matches: [scheduledBout('Match 1', AT_1030)],
  });

  const upcoming = page.locator('section', { hasText: 'Upcoming' });
  await expect(upcoming.getByText('Pool 1 - Match 1 · Piste 3')).toBeVisible();
});

test('a bout with no piste yet shows no dangling separator', async ({ page }) => {
  await openPersonPage(page, {
    ...emptySchedule,
    matches: [scheduledBout('Match 1', AT_1030, { liceName: null })],
  });

  const upcoming = page.locator('section', { hasText: 'Upcoming' });
  await expect(upcoming.getByText('Pool 1 - Match 1', { exact: true })).toBeVisible();
});

// A bout whose clock is halted is still in play. The page listed "running"
// bouts only: a halted bout was in no list at all.
test('a bout whose clock is halted is listed as live, with its piste', async ({ page }) => {
  await openPersonPage(page, {
    ...emptySchedule,
    matches: [scheduledBout('m-7', AT_1030, { status: 'paused' })],
  });

  const live = page.locator('section', { hasText: 'Live now' });
  await expect(live.getByText('Pool 1 - m-7 · Piste 3')).toBeVisible();
  await expect(live.getByRole('link')).toHaveAttribute('href', '/e/test-event/match/m-7');
});
