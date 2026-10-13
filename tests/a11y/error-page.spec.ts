/**
 * A public page that fails offers a way home beside "Try again" (quick win F14).
 *
 * The error pages had one button. When the second try failed too, the visitor
 * had no way out but the address bar.
 *
 * A bout's page reads on the SERVER, and no API runs in this harness: its read
 * never lands, so the page fails and its error page shows. That is the failure
 * this story needs.
 */
import { test, expect } from '@playwright/test';
import { stubPublicApi } from './helpers';

test('a bout page that fails offers Try again and the way to the Event home', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto('http://localhost:3001/e/test-event/match/m-1');

  const alert = page.getByRole('alert').filter({ hasText: 'Try again' });
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(alert.getByRole('link', { name: 'Back to event home' })).toHaveAttribute(
    'href',
    '/e/test-event/home',
  );
});
