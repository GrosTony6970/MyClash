/**
 * The piste TV, five seconds after a bout ends: it reads its own piste again,
 * and shows what the piste holds, WITHOUT loading the page.
 *
 * It used to go to the next bout's own address, and from there it followed a
 * chain of Match ids: a bout moved to another piste took the TV with it (quick
 * win T1). Then it loaded its own address again, which was right for the piste
 * and wrong for the screen: a page load ends fullscreen, so a TV put in
 * fullscreen fell out of it after every bout (quick win T5).
 *
 * The API is stubbed (`tv-stub.ts`). The bout on the piste has ended and names
 * a next bout, which is all the screen needs to start its countdown. A mark on
 * the page's `window` tells a screen that changed from a page that was loaded.
 *
 * The screen's live channel is down here (nothing answers it), and a screen
 * with no channel reads its piste every thirty seconds. The stories end well
 * before that, so what they see is the countdown's doing.
 */
import { test, expect } from '@playwright/test';
import {
  BOARD,
  ENDED,
  ENDED_BOUT,
  PISTE_TV,
  markPage,
  openPisteTv,
  pageKeptItsMark,
} from './tv-stub';

test('when its bout ends, the piste TV shows what its piste holds next, with no page load', async ({
  page,
}) => {
  const board = await openPisteTv(page, { bout: ENDED_BOUT, clock: ENDED });
  await expect(page.getByText('Match ended')).toBeVisible();
  await markPage(page);

  // The piste now names the bout that waited.
  board.answer = { ...BOARD, current: { id: 'm-2' } };
  const readsBefore = board.reads;

  // The countdown is five seconds. The next bout has not started: its clock says so.
  await expect(page.getByText('Not started', { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText('Grace Hopper').last()).toBeVisible();
  await expect(page.getByText('Match ended')).toHaveCount(0);

  expect(board.reads).toBe(readsBefore + 1);
  expect(await pageKeptItsMark(page)).toBe(true);
  expect(page.url()).toBe(PISTE_TV);
});

test('a bout a correction reopened keeps the screen: the piste is not read again', async ({
  page,
}) => {
  // The official voided the closing hit: the bout is paused again, and its
  // clock still reads ended. The bout is not over, so nothing counts down.
  const board = await openPisteTv(page, {
    bout: { ...ENDED_BOUT, status: 'paused' },
    clock: ENDED,
  });
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
  await markPage(page);
  const readsBefore = board.reads;

  // Longer than the countdown, which is five seconds.
  await page.waitForTimeout(7_000);

  expect(board.reads).toBe(readsBefore);
  expect(await pageKeptItsMark(page)).toBe(true);
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
});
