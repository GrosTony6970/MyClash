/**
 * The sign-in screen says why a sign-in failed (quick win S1).
 *
 * A volunteer types a correct PIN while the wifi is down. The screen said
 * "Could not sign in with this event, username, and PIN", as for a wrong PIN:
 * they typed it again and again, into the lock of the account. Each cause now
 * has its own sentence.
 *
 * The API is stubbed (`pad-sign-in-stub.ts`). The rule has its unit tests
 * (`lib/sign-in-failure.test.ts`).
 */
import { test, expect } from '@playwright/test';
import {
  emailForm,
  openLinked,
  openSignIn,
  pinForm,
  problem,
  signIn,
  stubSignIn,
} from './pad-sign-in-stub';

const OLD_SENTENCE = /could not sign in with this event/i;

test('a wrong PIN is called a wrong username or PIN', async ({ page }) => {
  const stub = await stubSignIn(page);
  stub.answer = problem(401, 'UNAUTHORIZED', 'Invalid staff credentials');
  await openLinked(page);

  await signIn(page);

  await expect(pinForm(page).getByRole('alert')).toHaveText(/wrong username or PIN/i);
});

test('too many tries says to stop typing the PIN', async ({ page }) => {
  const stub = await stubSignIn(page);
  stub.answer = problem(429, 'HTTP_429', 'ThrottlerException: Too Many Requests');
  await openLinked(page);

  await signIn(page);

  await expect(pinForm(page).getByRole('alert')).toHaveText(/too many tries.*do not type the PIN/i);
});

for (const network of ['down', 'cut'] as const) {
  test(`with no network (${network}) the screen says so, and blames no PIN`, async ({ page }) => {
    const stub = await stubSignIn(page);
    await openLinked(page);
    stub.network = network;

    await signIn(page);

    const alert = pinForm(page).getByRole('alert');
    await expect(alert).toHaveText(/could not reach the server/i);
    await expect(alert).not.toHaveText(OLD_SENTENCE);
  });
}

test('with no Event chosen the screen asks for one, and sends nothing', async ({ page }) => {
  const stub = await stubSignIn(page);
  await openSignIn(page);
  // Two Events are listed and this tablet remembers none: no row is chosen.
  await expect(page.getByRole('button', { name: /spring open/i })).toBeVisible();
  await page.locator('#staffUsername').fill('marie');

  await signIn(page);

  await expect(pinForm(page).getByRole('alert')).toHaveText(/choose your event first/i);
  expect(stub.sent).toHaveLength(0);

  // The Event is tapped: the same press now reaches the server.
  await page.getByRole('button', { name: /spring open/i }).click();
  stub.answer = problem(401, 'UNAUTHORIZED', 'Invalid staff credentials');
  await signIn(page);
  await expect(pinForm(page).getByRole('alert')).toHaveText(/wrong username or PIN/i);
  expect(stub.sent).toHaveLength(1);
});

test('an Event that is not found, an account that is closed, a server that fails', async ({
  page,
}) => {
  const stub = await stubSignIn(page);
  await openLinked(page);
  const alert = pinForm(page).getByRole('alert');

  stub.answer = problem(404, 'NOT_FOUND', 'Event not found');
  await signIn(page);
  await expect(alert).toHaveText(/this event was not found/i);

  stub.answer = problem(403, 'FORBIDDEN', 'Staff account is disabled');
  await signIn(page);
  await expect(alert).toHaveText(/closed for staff sign-in/i);
  // The server's own English sentence is not printed.
  await expect(alert).not.toHaveText(/disabled/i);

  stub.answer = problem(500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  await signIn(page);
  await expect(alert).toHaveText(/your PIN was not checked/i);
});

// Quick win S2. A borrowed tablet turned "marie" into "Marie" and a code into
// a word of the dictionary.
test('the keyboard leaves a username and an event code as they are typed', async ({ page }) => {
  await stubSignIn(page);
  await openLinked(page);

  for (const id of ['#staffUsername', '#eventSlugOrCode']) {
    const field = page.locator(id);
    await expect(field).toHaveAttribute('autocapitalize', 'none');
    await expect(field).toHaveAttribute('autocorrect', 'off');
    await expect(field).toHaveAttribute('spellcheck', 'false');
  }
  await expect(page.locator('#staffUsername')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('#staffPin')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#eventSlugOrCode')).toHaveAttribute('autocomplete', 'off');
  // The email field keeps the keyboard's help: an address is a word of the owner.
  await expect(page.locator('#email')).not.toHaveAttribute('autocorrect', 'off');
});

test('the field for a typed Event is called "Event code", in the words above it too', async ({
  page,
}) => {
  const stub = await stubSignIn(page);
  stub.events = [];
  await openSignIn(page);

  await expect(page.getByLabel('Event code')).toBeVisible();
  await expect(page.getByText(/type the event code instead/i)).toBeVisible();
  await expect(page.getByText(/slug/i)).toHaveCount(0);
});

// Quick win S4. The list printed the date as the server stores it: 2026-08-08.
test('the list of Events writes each date in words', async ({ page }) => {
  await stubSignIn(page);
  await openSignIn(page);

  const row = page.getByRole('button', { name: /spring open/i });
  await expect(row).toContainText('Sat, August 8, 2026');
  await expect(row).not.toContainText('2026-08-08');
});

// Quick win S3. The organiser's form had no name: volunteers typed their email
// in it. A failure printed "POST /api/v1/auth/magic-link failed (400)".
test('the email form says whose it is', async ({ page }) => {
  await stubSignIn(page);
  await openLinked(page);

  await expect(emailForm(page).getByRole('heading', { name: 'MyClash account' })).toBeVisible();
  await expect(emailForm(page)).toContainText(/for organisers/i);
});

test('a login link that is not sent says why, and prints no request line', async ({ page }) => {
  const stub = await stubSignIn(page);
  await openLinked(page);
  const alert = emailForm(page).getByRole('alert');
  const send = async () => {
    await page.locator('#email').fill('ada@example.com');
    await emailForm(page).locator('button[type="submit"]').click();
  };

  stub.answer = problem(400, 'BAD_REQUEST', 'Validation failed');
  await send();
  await expect(alert).toHaveText(/this email address was refused/i);
  await expect(alert).not.toHaveText(/POST|magic-link|validation/i);

  stub.answer = problem(429, 'HTTP_429', 'ThrottlerException: Too Many Requests');
  await send();
  await expect(alert).toHaveText(/too many requests/i);

  stub.answer = problem(500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  await send();
  await expect(alert).toHaveText(/the login link was not sent/i);

  stub.network = 'down';
  await send();
  await expect(alert).toHaveText(/could not reach the server/i);
});

test('"check your email" has a way back to the form, with the address kept', async ({ page }) => {
  const stub = await stubSignIn(page);
  stub.answer = { status: 200, json: { message: 'sent' } };
  await openLinked(page);

  await page.locator('#email').fill('ada@exmaple.com');
  await emailForm(page).locator('button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
  await expect(page.locator('#email')).toHaveCount(0);

  await page.getByRole('button', { name: 'Use another address' }).click();

  // The mistyped address is there to correct, not to type again.
  await expect(page.locator('#email')).toHaveValue('ada@exmaple.com');
  await expect(page.getByRole('heading', { name: /check your email/i })).toHaveCount(0);
});
