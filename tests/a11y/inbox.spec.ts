import { expect, test, type Page, type Route } from '@playwright/test';
import { collectPageIssues, expectNoCriticalAxeViolations, expectNoPageIssues } from './helpers';
import { PUBLIC, signInAsLea } from './me-stub';

/**
 * Quick win M5 (operator, 2026-10-14). The inbox of a person's event messages:
 *   - each message shows its time on its EVENT's clock, with the zone's name;
 *   - while the read is out it shows a placeholder, not "No event messages yet";
 *   - a push tap opens `/notifications`, which sends the phone on to `/me/notifications`, where the
 *     personal space renews the login (the bare page never did, so the read was refused and the
 *     inbox said "empty").
 */

// Léa reads her inbox at home in Montréal; the Event is in Lyon.
test.use({ timezoneId: 'America/Montreal', locale: 'en-GB' });

const MESSAGE = {
  id: 'rcp-1',
  broadcastId: 'bc-1',
  eventId: 'event-1',
  eventSlug: 'fal',
  eventName: 'FAL 2026',
  eventTimezone: 'Europe/Paris',
  severity: 'warning',
  targetType: 'all',
  title: 'Piste 3 delayed',
  body: '20 minutes.',
  // 09:12 in Lyon, 03:12 in Montréal.
  createdAt: '2026-10-14T07:12:00.000Z',
  deliveryStatus: 'sent',
  deliveredAt: '2026-10-14T07:12:30.000Z',
};

const inbox = (page: Page) => page.getByTestId('broadcast-inbox');

test("a message shows its time on the Event's clock, after a placeholder", async ({ page }) => {
  const issues = collectPageIssues(page);
  await signInAsLea(page);
  let answer: (() => Promise<void>) | null = null;
  await page.route('**/api/v1/notifications/broadcasts', (route: Route) => {
    answer = () => route.fulfill({ json: [MESSAGE] });
  });

  await page.goto(`${PUBLIC}/me/notifications`);
  await expect.poll(() => answer !== null).toBe(true);
  await expect(inbox(page).getByTestId('broadcast-inbox-loading')).toBeVisible();
  await expect(page.getByText('No event messages yet.')).toHaveCount(0);

  await answer!();
  const message = inbox(page).getByRole('article');
  await expect(message).toContainText('Piste 3 delayed');
  await expect(message.locator('time')).toHaveAttribute('datetime', MESSAGE.createdAt);
  await expect(message.locator('time')).toContainText('09:12');
  await expect(message.locator('time')).toContainText('CEST');
  await expect(message.locator('time')).not.toContainText('03:12');
  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

test('an empty inbox says so once the read has answered', async ({ page }) => {
  await signInAsLea(page);
  await page.goto(`${PUBLIC}/me/notifications`);
  await expect(page.getByText('No event messages yet.')).toBeVisible();
  await expect(inbox(page).getByTestId('broadcast-inbox-loading')).toHaveCount(0);
});

test('a read refused for a login that did not come back goes to sign-in', async ({ page }) => {
  await signInAsLea(page);
  await page.route('**/api/v1/notifications/broadcasts', (route) =>
    route.fulfill({ status: 401, json: { status: 401, detail: 'Sign in' } }),
  );
  await page.goto(`${PUBLIC}/me/notifications`);
  await expect(page).toHaveURL(`${PUBLIC}/login?next=%2Fme%2Fnotifications`);
});

test('a push tap on /notifications lands in the personal inbox', async ({ page }) => {
  await signInAsLea(page);
  await page.route('**/api/v1/notifications/broadcasts', (route) =>
    route.fulfill({ json: [MESSAGE] }),
  );
  await page.goto(`${PUBLIC}/notifications`);
  await expect(page).toHaveURL(`${PUBLIC}/me/notifications`);
  await expect(inbox(page).getByRole('article')).toContainText('Piste 3 delayed');
});
