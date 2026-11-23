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

  const bout = page.getByRole('link', { name: /LSW-P1-m-1/ });
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

// A finished bout showed "3 – 8" in the side colours alone: the fighter had to remember their
// side to know if they won. The card now says the result and bolds the winner's number. The
// result is the server's `outcome`: a forfeit can be won on the lower score.
test("a finished bout says the viewer's result and bolds the winner's number", async ({ page }) => {
  const done = (id: string, at: string, red: number, blue: number, outcome: unknown) =>
    scheduledBout(id, at, { status: 'completed', redScore: red, blueScore: blue, outcome });
  await openGuestSchedule(page, {
    ...emptySchedule,
    matches: [
      done('m-1', '2027-06-12T07:00:00.000Z', 8, 3, 'win'),
      done('m-2', '2027-06-12T08:00:00.000Z', 3, 8, 'loss'),
      done('m-3', '2027-06-12T09:00:00.000Z', 2, 5, 'win'),
      done('m-4', '2027-06-12T10:00:00.000Z', 4, 4, 'draw'),
      done('m-5', '2027-06-12T11:00:00.000Z', 6, 1, undefined),
    ],
  });

  const card = (id: string) =>
    page.getByRole('link').filter({ has: page.getByText(`LSW-P1-${id}`, { exact: true }) });
  const score = (id: string, n: number) => card(id).getByText(String(n), { exact: true });
  const BOLD = '700';
  const PLAIN = '400';

  await expect(card('m-1').getByText('Won', { exact: true })).toBeVisible();
  await expect(score('m-1', 8)).toHaveCSS('font-weight', BOLD);
  await expect(score('m-1', 3)).toHaveCSS('font-weight', PLAIN);

  await expect(card('m-2').getByText('Lost', { exact: true })).toBeVisible();
  await expect(score('m-2', 8)).toHaveCSS('font-weight', BOLD);
  await expect(score('m-2', 3)).toHaveCSS('font-weight', PLAIN);

  // Won on the lower score: the numbers alone would say lost.
  await expect(card('m-3').getByText('Won', { exact: true })).toBeVisible();
  await expect(score('m-3', 2)).toHaveCSS('font-weight', BOLD);
  await expect(score('m-3', 5)).toHaveCSS('font-weight', PLAIN);

  await expect(card('m-4').getByText('Draw', { exact: true })).toBeVisible();
  await expect(score('m-4', 4).first()).toHaveCSS('font-weight', PLAIN);
  await expect(score('m-4', 4).last()).toHaveCSS('font-weight', PLAIN);

  // A copy cached before the API sent `outcome`: the score, and no claim about it.
  await expect(card('m-5').getByText(/^(Won|Lost|Draw)$/)).toHaveCount(0);
  await expect(score('m-5', 6)).toHaveCSS('font-weight', PLAIN);

  await expectNoCriticalAxeViolations(page);
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
    page.getByRole('link').filter({ has: page.getByText(`LSW-P1-${id}`, { exact: true }) });
  await expect(card('m-1').getByText('LIVE', { exact: true })).toBeVisible();
  await expect(card('m-1').getByText('Paused')).toHaveCount(0);
  await expect(card('m-2').getByText('Paused', { exact: true })).toBeVisible();
  await expect(card('m-2').getByText('LIVE', { exact: true })).toHaveCount(0);
  await expect(card('m-3').getByText(/^(LIVE|Paused)$/)).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
});
