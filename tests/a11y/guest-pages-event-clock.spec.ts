/**
 * The guest pages of an Event tell the time on the EVENT's clock (quick win F8).
 *
 * They used the phone's clock. A fighter who travels from another time zone,
 * and whose phone has not changed zone yet, read every bout hours off.
 *
 * The API is stubbed (`public-pages-stub.ts`). The Event is in Paris and the
 * browser in New York, six hours behind: a bout at 10:30 in the hall read 04:30.
 */
import { test, expect } from '@playwright/test';
import {
  boardBout,
  emptySchedule,
  liveState,
  openGuestSchedule,
  openLiveBoard,
  openPersonPage,
  scheduledBout,
  tableDuty,
} from './public-pages-stub';

test.use({ timezoneId: 'America/New_York' });

const AT_1030_IN_THE_HALL = '2027-06-12T08:30:00.000Z';
const AT_1415_IN_THE_HALL = '2027-06-12T12:15:00.000Z';

test('the guest schedule tells a bout by the hall clock', async ({ page }) => {
  await openGuestSchedule(page, {
    ...emptySchedule,
    matches: [scheduledBout('Match 1', AT_1030_IN_THE_HALL)],
  });

  await expect(page.getByText('10:30')).toBeVisible();
  await expect(page.getByText('04:30')).toHaveCount(0);
});

test("a person's page tells a bout and a duty by the hall clock", async ({ page }) => {
  await openPersonPage(page, {
    ...emptySchedule,
    matches: [scheduledBout('Match 1', AT_1030_IN_THE_HALL)],
    refereeSlots: [tableDuty(AT_1415_IN_THE_HALL)],
  });

  await expect(page.getByText('10:30')).toBeVisible();
  await expect(page.getByText('14:15')).toBeVisible();
  await expect(page.getByText('04:30')).toHaveCount(0);
  await expect(page.getByText('08:15')).toHaveCount(0);
});

test('the live board tells the next bout of a piste by the hall clock', async ({ page }) => {
  await openLiveBoard(
    page,
    liveState([
      {
        lice: { id: 'lice-1', name: 'Piste 1', sortOrder: 1 },
        runningMatch: null,
        nextMatch: boardBout('M02', { status: 'scheduled', scheduledAt: AT_1030_IN_THE_HALL }),
      },
    ]),
  );

  await expect(page.getByText('10:30')).toBeVisible();
  await expect(page.getByText('04:30')).toHaveCount(0);
});
