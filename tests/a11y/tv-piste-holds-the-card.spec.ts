/**
 * The piste TV when a bout ends: the winner's card stays for its whole
 * countdown, whatever the piste says meanwhile (operator ruling, 2026-10-13).
 *
 * The server's read of a piste never names a bout that is over: the moment a
 * bout ends, the piste names the bout that waited, or nothing. The screen used
 * to show what the piste said at once, so the card was up for under a second.
 *
 * The API is stubbed (`tv-stub.ts`). The Event hides something from the public
 * here, so the screen reads its piste every five seconds: the same read a live
 * channel's event makes, with no socket to play. Each story changes the bout
 * AT a read of the piste (`atNextRead`), so the scoreboard's own poll cannot
 * have seen the change first.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  BOARD,
  BOUT,
  ENDED,
  ENDED_BOUT,
  HALTED,
  PISTE_TV,
  markPage,
  openPisteTv,
  pageKeptItsMark,
  sawSpinner,
  type PisteBoard,
} from './tv-stub';

const HIDDEN = { ...BOARD, hiddenFromPublic: true };
const NAMES_THE_NEXT = { ...HIDDEN, current: { id: 'm-2' } };
const NAMES_NOTHING = { ...HIDDEN, current: null };

/** Open the screen on a bout in play, and wait until it is drawn. */
async function openOnABoutInPlay(page: Page, bout: object = BOUT): Promise<PisteBoard> {
  const board = await openPisteTv(page, { board: HIDDEN, bout });
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
  await expect(page.getByText('Match ended')).toHaveCount(0);
  await markPage(page);
  return board;
}

/** The piste was read once more, with what `happens` changed just before. */
async function atTheNextRead(board: PisteBoard, happens: () => void) {
  const readsBefore = board.reads;
  board.atNextRead = happens;
  await expect.poll(() => board.reads, { timeout: 8_000 }).toBeGreaterThan(readsBefore);
}

test('a bout ends: the card stays for its countdown, then the next bout shows', async ({
  page,
}) => {
  const board = await openOnABoutInPlay(page);

  await atTheNextRead(board, () => {
    board.bout = ENDED_BOUT;
    board.clock = ENDED;
    board.answer = NAMES_THE_NEXT;
  });

  // The scoreboard is told to read its bout now: it does not wait for its poll.
  await expect(page.getByText('Match ended')).toBeVisible({ timeout: 2_000 });
  await page.waitForTimeout(4_000);
  await expect(page.getByText('Match ended')).toBeVisible();

  await expect(page.getByText('Not started', { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('Match ended')).toHaveCount(0);
  expect(await pageKeptItsMark(page)).toBe(true);
  expect(await sawSpinner(page)).toBe(false);
  expect(page.url()).toBe(PISTE_TV);
});

test('a bout moved to another piste leaves the screen at once', async ({ page }) => {
  const board = await openOnABoutInPlay(page);

  // The bout is still in play: it is only no longer on this piste.
  await atTheNextRead(board, () => {
    board.answer = NAMES_THE_NEXT;
  });

  await expect(page.getByText('Not started', { exact: true })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByText('Match ended')).toHaveCount(0);
  expect(await pageKeptItsMark(page)).toBe(true);
});

test('the last bout of the piste: its end card stays, then the waiting card shows', async ({
  page,
}) => {
  const last = { ...BOUT, nextMatchId: null, nextMatch: null };
  const board = await openOnABoutInPlay(page, last);

  await atTheNextRead(board, () => {
    board.bout = { ...ENDED_BOUT, nextMatchId: null, nextMatch: null };
    board.clock = ENDED;
    board.answer = NAMES_NOTHING;
  });

  await expect(page.getByText('Last match on this lice')).toBeVisible({ timeout: 2_000 });
  await page.waitForTimeout(4_000);
  await expect(page.getByText('Last match on this lice')).toBeVisible();

  // No countdown runs for a bout with no next of its own: the screen's cap ends the wait.
  await expect(page.getByText(/waiting for next match/i)).toBeVisible({ timeout: 10_000 });
  expect(await pageKeptItsMark(page)).toBe(true);
});

test('a bout reopened while its card is up keeps the screen', async ({ page }) => {
  const board = await openOnABoutInPlay(page);

  await atTheNextRead(board, () => {
    board.bout = ENDED_BOUT;
    board.clock = ENDED;
    board.answer = NAMES_THE_NEXT;
  });
  await expect(page.getByText('Match ended')).toBeVisible({ timeout: 2_000 });

  // A correction voids the closing hit: the bout is in play again, on this piste.
  await atTheNextRead(board, () => {
    board.bout = BOUT;
    board.clock = HALTED;
    board.answer = HIDDEN;
  });

  // Longer than the countdown and than the screen's cap: the bout is still there.
  await expect(page.getByText('Match ended')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
  await expect(page.getByText('Not started', { exact: true })).toHaveCount(0);
  expect(await pageKeptItsMark(page)).toBe(true);
});
