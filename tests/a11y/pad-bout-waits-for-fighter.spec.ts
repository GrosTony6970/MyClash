/**
 * A bout waiting for a Fighter takes no Start, hit, card or colour swap (operator, 2026-11-24).
 *
 * Léa opens the final on her pad. Its blue side is the winner of a semi-final still running, so
 * the blue name is blank. Before, she could start the final and score it against nobody. Now the
 * pad says the bout waits for a Fighter, greys Start, and a press of the Space key sends nothing.
 * The drawer's colour swap and direct card are greyed too.
 *
 * The API is stubbed (`pad-clock-stub.ts`). The decision is `sideMissing`
 * (`lib/bout-sides.test.ts`); the server's refusal is `bout-sides.doors.test.ts` in the API.
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout, primary, status } from './pad-clock-stub';

const WAITING =
  'Waiting for a Fighter. This bout takes no Start, hit, card or colour swap until both sides are known.';
const REFUSED = 'This bout is waiting for a Fighter. Try again once both sides are known.';

/** Every write the pad makes from now on. Registered after the stub: it sees them first. */
async function recordWrites(page: Page): Promise<string[]> {
  const writes: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && !path.endsWith('/staff/heartbeat')) {
      writes.push(`${request.method()} ${path.replace(/^.*\/match-1/, '')}`);
    }
    return route.fallback();
  });
  return writes;
}

test('a bout with a side still to come takes no Start, and its drawer swaps and cards nobody', async ({
  page,
}) => {
  const stub = await openBout(page, { row: { blue_registration_id: null } });
  const writes = await recordWrites(page);

  await expect(page.getByTestId('bout-waiting-for-fighter')).toHaveText(WAITING);
  await expect(primary(page)).toHaveAttribute('data-action', 'start');
  await expect(primary(page)).toBeDisabled();

  // The Space key is the pad's other Start: it is refused at the same door, and says why.
  await page.keyboard.press('Space');
  // Wait for either answer of the pad: its refusal on screen, or a Start sent from its queue.
  const refused = page.getByText(REFUSED);
  await expect
    .poll(async () => stub.arrived.length + writes.length > 0 || (await refused.isVisible()))
    .toBe(true);
  expect(stub.arrived).toEqual([]);
  expect(writes).toEqual([]);
  await expect(refused).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'idle');

  await page.getByTestId('open-corrections').click();
  await expect(page.getByRole('button', { name: 'Swap fighter color' })).toBeDisabled();
  // The side swap changes no side: it stays.
  await expect(page.getByRole('button', { name: 'Swap fighter side' })).toBeEnabled();
  // With a reason typed, a direct card would be live: it is greyed.
  await page.getByTestId('direct-card-reason').fill('Late on the piste');
  const cards = page.getByTestId('direct-card-button');
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) await expect(card).toBeDisabled();
  expect(writes).toEqual([]);
});
