/**
 * The cards of the guest schedule: what each one says, and where it leads.
 *
 * The API is stubbed (`public-pages-stub.ts`): the page reads on the client.
 */
import { test, expect } from '@playwright/test';
import { expectNoCriticalAxeViolations } from './helpers';
import { emptySchedule, openGuestSchedule, scheduledBout, tableDuty } from './public-pages-stub';

const AT_1030 = '2027-06-12T08:30:00.000Z';
const AT_1415 = '2027-06-12T12:15:00.000Z';

// Quick win F3. A bout's card was plain text: its score and its hits were a
// search away. The card is now a link, and the bout's Back returns here.
test("a bout's card opens the bout's page, which knows the way back", async ({ page }) => {
  await openGuestSchedule(page, {
    ...emptySchedule,
    matches: [scheduledBout('m-1', AT_1030)],
    refereeSlots: [tableDuty(AT_1415)],
  });

  const bout = page.getByRole('link', { name: /Pool 1 - m-1/ });
  await expect(bout).toHaveAttribute(
    'href',
    '/e/test-event/match/m-1?return=%2Fe%2Ftest-event%2Fmy-schedule',
  );
  // The whole card is the link: the opponent and the piste are inside it.
  await expect(bout).toContainText('Ada Lovelace');
  await expect(bout).toContainText('Piste 3');

  // A duty over a whole Pool names no bout: its card opens nothing.
  await expect(page.getByRole('link', { name: /Pool 2/ })).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
});

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

// A halted bout is still on the piste: the hub calls it "Paused", and so does the card. It had no
// badge at all, as if the bout were over or not begun.
test('a running bout says "Live"; a halted one says "Paused"; a coming one says neither', async ({
  page,
}) => {
  await openGuestSchedule(page, {
    ...emptySchedule,
    matches: [
      scheduledBout('m-1', AT_1030, { status: 'running' }),
      scheduledBout('m-2', AT_1030, { status: 'paused' }),
      scheduledBout('m-3', AT_1415),
    ],
  });

  // The two at 10:30 clash, so each card also names the other: find a card by its own title.
  const card = (id: string) =>
    page.getByRole('link').filter({ has: page.getByText(`Pool 1 - ${id}`, { exact: true }) });
  await expect(card('m-1').getByText('LIVE', { exact: true })).toBeVisible();
  await expect(card('m-1').getByText('Paused')).toHaveCount(0);
  await expect(card('m-2').getByText('Paused', { exact: true })).toBeVisible();
  await expect(card('m-2').getByText('LIVE', { exact: true })).toHaveCount(0);
  await expect(card('m-3').getByText(/^(LIVE|Paused)$/)).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
});
