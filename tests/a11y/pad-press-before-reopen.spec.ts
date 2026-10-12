/**
 * A round press the server refuses because it was made before the bout was
 * last put back in play (operator, 2026-10-11).
 *
 * A best-of bout, round 1 at 2 - 1. Another device ended the bout and a referee
 * put it back in play. This tablet's "End round" was tapped before that: the
 * server does not close the round again. The tablet holds the press, says why
 * in its own words, and offers Discard alone, because no new send can cure it.
 *
 * The API is stubbed (`pad-rounds-stub.ts`); this spec answers "End round"
 * itself, with the server's own code. The server's rule is
 * `apps/api/src/modules/matches/press-before-reopen.ts`; the words and "no
 * Retry" have the unit tests (`held-round.test.ts`, `held-press.test.ts`).
 */
import { test, expect } from '@playwright/test';
import { held, openBestOf, plusOne, plusTwo, startAndHalt } from './pad-rounds-stub';

const SENTENCE =
  'This round action was made before the match was put back in play, ' +
  'so the server did not apply it. Discard it, then check the round with the table.';

test('an "End round" made before the bout was put back in play is held, with its reason and Discard alone', async ({
  page,
}) => {
  const stub = await openBestOf(page, { cap: 3 });
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await plusOne(page, 'blue').click();
  await expect.poll(() => stub.sent).toHaveLength(4);

  // Registered after the stub: this answer wins for "End round".
  const ended: string[] = [];
  await page.route('**/rounds/end', (route) => {
    ended.push(route.request().method());
    return route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        status: 409,
        code: 'pressed_before_reopen',
        detail: 'API words',
        message: 'API words',
      }),
    });
  });

  await page.getByTestId('clock-end-button').click();

  await expect(held(page)).toContainText('before the match was put back in play');
  await expect.poll(() => ended).toEqual(['POST']);
  // The round is not closed on the server.
  expect(stub.row.rounds_json).toEqual([]);

  await page.getByTestId('review-refused').click();
  const row = page.getByTestId('quarantine-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('End round 1');
  await expect(row).toContainText(SENTENCE);
  await expect(row).not.toContainText('API words');
  await expect(row.getByRole('button', { name: /^discard$/i })).toBeVisible();
  await expect(row.getByRole('button', { name: /retry/i })).toHaveCount(0);
});
