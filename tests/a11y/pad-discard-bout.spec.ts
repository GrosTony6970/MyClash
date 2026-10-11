/**
 * "Discard all of this match" in the refused-entries inbox (operator,
 * 2026-10-11).
 *
 * An Event closes with 12 unsent entries of one bout on a tablet. The server
 * refuses the first, and the Discard of one sends the next, which is refused
 * in its turn: 12 questions. One button takes every entry of that bout off the
 * tablet, with one question that says how many go.
 *
 * The API is stubbed (`pad-clock-stub.ts`). The store and the engine hold the
 * rules (`discard-bout.test.ts`, `sync.discard-bout.test.ts`); only a live
 * page proves what the official sees.
 */
import { test, expect, type Page } from '@playwright/test';
import { held, openBout, primary, redHit, result, status } from './pad-clock-stub';

const discardBout = (page: Page) => page.getByTestId('quarantine-discard-bout');
const question = (page: Page) =>
  page.getByRole('dialog').getByText('Discard the 3 entries of this match?');

test('one question takes the refused hit and the entries behind it off the tablet, and none is sent', async ({
  page,
}) => {
  const stub = await openBout(page);
  await primary(page).click();
  await primary(page).click();
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);
  stub.refuseNextHit = 'match_locked';

  // A hit the server refuses, then a second hit and the End, which wait behind it.
  await redHit(page).first().click();
  await expect(held(page)).toContainText(/this bout is locked/i);
  await redHit(page).first().click();
  await page.getByTestId('clock-end-button').click();
  await page.getByTestId('end-early-confirm').click();
  await expect(result(page)).toBeVisible();
  await result(page)
    .getByRole('button', { name: /^close$/i })
    .click();

  await page.getByTestId('review-refused').click();
  await expect(page.getByTestId('quarantine-waiting')).toHaveText(
    '2 entries of this match wait behind it.',
  );
  await expect(discardBout(page)).toHaveText('Discard all of this match');

  // Cancel deletes nothing.
  await discardBout(page).click();
  await expect(question(page)).toBeVisible();
  await page.getByRole('button', { name: /^cancel$/i }).click();
  await expect(question(page)).toHaveCount(0);
  await expect(page.getByTestId('quarantine-row')).toHaveCount(1);
  await expect(page.getByTestId('quarantine-waiting')).toBeVisible();

  await discardBout(page).click();
  await expect(question(page)).toBeVisible();
  await page.getByRole('button', { name: /discard permanently/i }).click();

  await expect(page.getByText('Nothing is being held.')).toBeVisible();
  await page.keyboard.press('Escape');

  // The bout's screen is the server's again: no refusal, no result of the tablet's own.
  await expect(held(page)).toHaveCount(0);
  await expect(result(page)).toHaveCount(0);
  await expect(page.getByTestId('network-bar')).not.toContainText(/refused|not recorded/i);
  await expect(status(page)).toHaveAttribute('data-status', 'halted');

  // Nothing of the bout was sent: the Resume the official presses next is the
  // very next call after the refused hit.
  await primary(page).click();
  await expect
    .poll(() => stub.sent)
    .toEqual(['POST /clock start', 'POST /clock halt', 'POST /exchanges', 'POST /clock resume']);
});

test('a refused entry with nothing behind it has no "Discard all": its Discard is the same act', async ({
  page,
}) => {
  const stub = await openBout(page);
  stub.refuseNext = 'clock_press_out_of_order';

  await primary(page).click();
  await expect(held(page)).toContainText(/moved from somewhere else/i);

  await page.getByTestId('review-refused').click();
  const row = page.getByTestId('quarantine-row');
  await expect(row).toContainText('Clock: Start');
  await expect(row.getByRole('button', { name: /^discard$/i })).toBeVisible();
  await expect(page.getByTestId('quarantine-waiting')).toHaveCount(0);
  await expect(discardBout(page)).toHaveCount(0);
});
