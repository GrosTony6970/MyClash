/**
 * "Undo last entry" on the round-break screen (operator, 2026-10-11).
 *
 * Red is one hit from the cap. The official means blue and taps red: "Round 1
 * complete" opens at once. It had one button, "Start round 2", so the wrong
 * hit could not be taken back there. Now the screen offers the bout's undo:
 * the hit is taken back, and the round is in play again.
 *
 * The API is stubbed (`pad-rounds-stub.ts` keeps the rounds as the server
 * does, and puts a round back in play when the hit that closed it is
 * cancelled). The undo itself has the unit tests (`clear-last.*.test.ts`).
 */
import { test, expect } from '@playwright/test';
import {
  comeBackOnline,
  gate,
  hitIsOnScreen,
  notConfirmedRound,
  openBestOf,
  plusOne,
  plusTwo,
  queuedOnTablet,
  roundBreak,
  startAndHalt,
  startNextRound,
} from './pad-rounds-stub';

const undo = (page: Parameters<typeof roundBreak>[0]) => page.getByTestId('round-break-undo');

test('with no network, the hit that closed the round by mistake is taken back on the round-break screen', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);
  await plusOne(page, 'blue').click();

  // The slip: red, where blue was meant. Red is at the cap of 2.
  await plusTwo(page, 'red').click();
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('2 – 1');
  // "Start round 2" keeps the focus: a Space starts the round, as before.
  await expect(startNextRound(page)).toBeFocused();
  expect((await undo(page).boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await undo(page).click();

  // The round is in play again, without the wrong hit.
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(page.getByText(/round 1/i).first()).toBeVisible();
  await expect.poll(() => queuedOnTablet(page)).toBe(3);
  await expect(plusOne(page, 'blue')).toBeEnabled();

  // The hit that was meant: blue takes the round.
  await plusOne(page, 'blue').click();
  await expect(roundBreak(page)).toContainText('Bo Blue');
  await expect(roundBreak(page)).toContainText('0 – 2');

  await comeBackOnline(page, stub);

  // The wrong hit never reached the server.
  await expect
    .poll(() => stub.sent)
    .toEqual(['POST /clock start', 'POST /clock halt', 'POST /exchanges', 'POST /exchanges']);
  expect(stub.row).toMatchObject({ blue_round_wins: 1, red_round_wins: 0, blue_score: 2 });
});

test('with the network up, the undo cancels the hit on the server and the round is in play again', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  // The server closed the round: the screen is the server's, confirmed.
  await expect(roundBreak(page)).toContainText('2 – 0');
  await expect(notConfirmedRound(page)).toHaveCount(0);
  expect(stub.row).toMatchObject({ awaiting_round_advance: true, red_round_wins: 1 });

  await undo(page).click();

  await expect(roundBreak(page)).toHaveCount(0);
  await expect(plusTwo(page, 'red')).toBeEnabled();
  expect(stub.sent).toEqual([
    'POST /clock start',
    'POST /clock halt',
    'POST /exchanges',
    'PATCH /void',
  ]);
  expect(stub.row).toMatchObject({
    awaiting_round_advance: false,
    red_round_wins: 0,
    red_score: 0,
    current_round: 1,
  });
});

test('one undo lands per round break: a second tap before the screen has closed takes back nothing more', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  await startAndHalt(page);
  await plusOne(page, 'blue').click();
  await plusTwo(page, 'red').click();
  await expect(roundBreak(page)).toContainText('2 – 1');
  await expect.poll(() => stub.sent).toHaveLength(4);
  // The server's row with the round closed has been read: the screen is the server's.
  await expect(notConfirmedRound(page)).toHaveCount(0);
  // The bout's row is read only when the test lets it: the screen stays up.
  const read = gate();
  stub.holdRow = read.closed;

  await undo(page).click();
  await expect.poll(() => stub.sent.at(-1)).toBe('PATCH /void');
  // The slip of a hand, and the Space key on the button that kept the focus.
  await undo(page).click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await expect(roundBreak(page)).toBeVisible();

  read.open();

  await expect(roundBreak(page)).toHaveCount(0);
  // Blue's hit, which was meant, is still there.
  expect(stub.sent.filter((call) => call === 'PATCH /void')).toHaveLength(1);
  expect(stub.row).toMatchObject({ red_score: 0, blue_score: 1, awaiting_round_advance: false });
});

test('what an undo said in a round is not on the next round-break screen', async ({ page }) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await startNextRound(page).click();
  // By habit, in round 2: nothing of this round is there to undo.
  await page.getByTestId('undo-last-entry').click();
  await expect(
    page.getByRole('alert').filter({ hasText: /closed with their round/i }),
  ).toBeVisible();

  await plusTwo(page, 'blue').click();

  // Round 2 to blue, 1 round each. The screen says nothing about an undo, and its undo works.
  await expect(roundBreak(page)).toContainText(/round 2 complete/i);
  await expect(page.getByRole('alert').filter({ hasText: /closed with their round/i })).toHaveCount(
    0,
  );
  await undo(page).click();
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
  await expect.poll(() => queuedOnTablet(page)).toBe(4);
});

test('with no network, a round closed by "End round" is not undone there: the screen says why, and "Start round 2" still works', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);
  await plusOne(page, 'blue').click();
  await hitIsOnScreen(page);
  await page.getByTestId('clock-end-button').click();
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);

  await undo(page).click();

  // Said inside the screen, which is the only thing the official can read.
  await expect(
    roundBreak(page)
      .getByRole('alert')
      .filter({ hasText: /closed with their round/i }),
  ).toBeVisible();
  await expect.poll(() => queuedOnTablet(page)).toBe(4);

  await startNextRound(page).click();
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
});
