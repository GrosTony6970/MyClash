/**
 * The cards of the guest schedule: what each one says, and where it leads.
 *
 * The API is stubbed (`public-pages-stub.ts`): the page reads on the client.
 */
import { test, expect } from '@playwright/test';
import { emptySchedule, openGuestSchedule, tableDuty } from './public-pages-stub';

const AT_1415 = '2027-06-12T12:15:00.000Z';

// Quick win F17. The card printed the role's id, "arbitre table". The server
// sends the name the organiser gave the role: the card says that name.
test("a duty names its role as the organiser named it, never by the role's id", async ({
  page,
}) => {
  await openGuestSchedule(page, { ...emptySchedule, refereeSlots: [tableDuty(AT_1415)] });

  const duty = page.locator('main div.rounded-xl', { hasText: 'Pool 2' });
  await expect(duty.getByText('Table · Longsword Open')).toBeVisible();
  await expect(page.getByText(/arbitre/i)).toHaveCount(0);
});

test('a duty whose role has no name is a plain "Referee"', async ({ page }) => {
  await openGuestSchedule(page, {
    ...emptySchedule,
    refereeSlots: [{ ...tableDuty(AT_1415), skillName: null }],
  });

  const duty = page.locator('main div.rounded-xl', { hasText: 'Pool 2' });
  await expect(duty.getByText('Referee · Longsword Open')).toBeVisible();
  await expect(page.getByText(/arbitre/i)).toHaveCount(0);
});
