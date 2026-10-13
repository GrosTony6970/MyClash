/**
 * The words of the TV scoreboard follow the language of the hall (quick win T2).
 *
 * A French hall read "MATCH ENDED", "Next match in 3…", "NEXT ▸", "Round 2/3",
 * "Total", and a pill that said `halted`: the scoreboard wrote them itself, in
 * English, whatever the language. They now come from the translations.
 *
 * The API is stubbed (`tv-stub.ts`). The browser's language is what the page
 * reads when no language was chosen.
 */
import { test, expect, type Page } from '@playwright/test';
import { BOUT, ENDED, ENDED_BOUT, openPisteTv } from './tv-stub';

/** A best-of-three bout in its second round. */
const BEST_OF = { ...BOUT, bestOf: 3, currentRound: 2, redRoundWins: 1, blueRoundWins: 0 };

/** The exact text is on screen, in this spelling and case. */
const says = (page: Page, text: string) => page.getByText(text, { exact: true });

test.describe('in a French hall', () => {
  test.use({ locale: 'fr-FR' });

  test('a bout in play reads French: the clock, the round, the next bout', async ({ page }) => {
    await openPisteTv(page, { bout: BEST_OF });
    await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

    await expect(says(page, 'En pause')).toBeVisible();
    await expect(page.getByText('Manche 2/3')).toBeVisible();
    await expect(page.getByText('Temps total')).toBeVisible();
    await expect(page.getByText('À suivre')).toBeVisible();
    await expect(says(page, 'contre')).toBeVisible();

    await expect(says(page, 'halted')).toHaveCount(0);
    await expect(page.getByText('Round 2/3')).toHaveCount(0);
    await expect(page.getByText('NEXT')).toHaveCount(0);
    await expect(says(page, 'vs')).toHaveCount(0);
  });

  test('a bout that ended says so in French, and counts down to the next one', async ({ page }) => {
    await openPisteTv(page, { bout: ENDED_BOUT, clock: ENDED });

    await expect(says(page, 'Assaut terminé')).toBeVisible();
    await expect(page.getByText(/Prochain assaut dans \d…/)).toBeVisible();
    await expect(says(page, 'Terminé')).toBeVisible();

    await expect(page.getByText('MATCH ENDED')).toHaveCount(0);
    await expect(page.getByText(/Next match in/)).toHaveCount(0);
  });

  test('the last bout of the piste says so in French', async ({ page }) => {
    await openPisteTv(page, {
      bout: { ...ENDED_BOUT, nextMatchId: null, nextMatch: null },
      clock: ENDED,
    });

    await expect(says(page, 'Dernier assaut sur cette lice')).toBeVisible();
    await expect(page.getByText(/Last match/)).toHaveCount(0);
  });
});

test('an English hall reads English', async ({ page }) => {
  await openPisteTv(page, { bout: BEST_OF });
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

  await expect(says(page, 'Halted')).toBeVisible();
  await expect(page.getByText('Round 2/3')).toBeVisible();
  await expect(page.getByText('Total time')).toBeVisible();
  await expect(page.getByText('Up next')).toBeVisible();
});
