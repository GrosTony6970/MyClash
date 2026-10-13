/**
 * The live board of an Event: what a spectator opens on the phone to know what
 * is on each piste.
 *
 * The API is stubbed (`public-pages-stub.ts`): the page reads on the client.
 * The page's live channel is down here (nothing answers it), so the page reads
 * by its poll.
 */
import { test, expect } from '@playwright/test';
import { expectNoCriticalAxeViolations } from './helpers';
import { boardBout, liveState, openLiveBoard } from './public-pages-stub';

const piste = (
  name: string,
  id: string,
  runningMatch: object | null,
  nextMatch: object | null,
) => ({
  lice: { id, name, sortOrder: 1 },
  runningMatch,
  nextMatch,
});

const TWO_PISTES = liveState([
  piste('Piste 1', 'lice-1', boardBout('M01'), boardBout('M02', { status: 'scheduled' })),
  piste('Piste 2', 'lice-2', null, boardBout('M07', { status: 'scheduled', redScore: 0 })),
]);

// Quick win F4. The server sent the score; the board showed who fights and not
// the score: "what's the score on piste 3?" had no answer on the phone.
test('the board shows the score of the bout on each piste', async ({ page }) => {
  await openLiveBoard(page, TWO_PISTES);

  const first = page.getByRole('link', { name: /Piste 1/ });
  await expect(first).toContainText('Ada Lovelace');
  await expect(first.getByTestId('live-score')).toHaveText(/^5\s*–\s*3$/);

  // A piste with no bout in play shows the next bout, and no score.
  const second = page.getByRole('link', { name: /Piste 2/ });
  await expect(second).toContainText('L1-P1-M07');
  await expect(second.getByTestId('live-score')).toHaveCount(0);

  await expectNoCriticalAxeViolations(page);
});

test('one piste: the bout in play shows its score and opens its page', async ({ page }) => {
  await openLiveBoard(page, TWO_PISTES, '?lice=lice-1');

  const bout = page.getByRole('link', { name: /L1-P1-M01/ });
  await expect(bout).toContainText('Ada Lovelace');
  await expect(bout).toContainText('Mary Somerville');
  await expect(bout).toContainText('5');
  await expect(bout).toContainText('3');
  // The bout's Back returns to this piste of the board.
  await expect(bout).toHaveAttribute(
    'href',
    '/e/test-event/match/M01?return=%2Fe%2Ftest-event%2Flive%3Flice%3Dlice-1',
  );
  // The next bout of the piste is named under it.
  await expect(page.getByText('L1-P1-M02')).toBeVisible();

  await expectNoCriticalAxeViolations(page);
});

test('one piste: a bout whose clock is halted says so', async ({ page }) => {
  await openLiveBoard(
    page,
    liveState([piste('Piste 1', 'lice-1', boardBout('M01', { status: 'paused' }), null)]),
    '?lice=lice-1',
  );

  await expect(page.getByRole('link', { name: /L1-P1-M01/ })).toContainText('Paused');
});
