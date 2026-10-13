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
import { openLinked, openSignIn, pinForm, problem, signIn, stubSignIn } from './pad-sign-in-stub';

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
