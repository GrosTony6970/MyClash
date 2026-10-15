import { expect, test, type Dialog, type Page } from '@playwright/test';
import { collectPageIssues, expectNoPageIssues } from './helpers';
import { openProfile, profileOf, PUBLIC } from './profile-stub';

/**
 * Quick win M4 (operator, 2026-10-14): an unsaved profile asks before it is left — by a tab, by a
 * link of the personal space, or by closing or reloading the browser tab. Switching tab used to
 * throw a half-typed bio away without a word.
 */

const BIO = 'Longsword since my first Open in Lyon.';
const asks = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });
const bio = (page: Page) => page.getByRole('textbox', { name: 'Bio' });
const refereeTab = (page: Page) => page.getByRole('tab', { name: 'Referee profile' });

test('a tab switch asks first: Stay keeps the bio, Leave opens the tab', async ({ page }) => {
  const issues = collectPageIssues(page);
  await openProfile(page);
  await bio(page).fill(BIO);

  await refereeTab(page).click();
  await expect(asks(page)).toBeVisible();
  await asks(page).getByRole('button', { name: 'Stay' }).click();
  await expect(asks(page)).toHaveCount(0);
  await expect(bio(page)).toHaveValue(BIO);
  expect(new URL(page.url()).search).toBe('');

  await refereeTab(page).click();
  await asks(page).getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(`${PUBLIC}/me/profile?tab=referee`);

  // The bio was left with the form: from the Referee tab, nothing is unsaved.
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page).toHaveURL(`${PUBLIC}/me/settings`);
  await expect(asks(page)).toHaveCount(0);
  // The two panels that threw on an unanswered read have drawn their answers: a fault of either
  // is in `issues` by now, every time.
  await expect(page.getByText('No keys yet. Add one to generate your insights.')).toBeVisible();
  await expect(page.getByText(/^Version 2026-01 · /)).toHaveCount(2);
  await expectNoPageIssues(issues);
});

test('a new photo saves at once: it leaves nothing unsaved', async ({ page }) => {
  await openProfile(page);
  await page.route('**/api/v1/fighters/me/photo', (route) =>
    route.fulfill({ json: { url: '/brand/Logomini_nobackground.png' } }),
  );
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .getByTestId('profile-photo')
    .locator('input[type="file"]')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: pixel });
  const cropper = page.getByRole('dialog', { name: 'Adjust your photo' });
  await cropper.getByRole('button', { name: 'Save photo' }).click();
  await expect(cropper).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();

  await refereeTab(page).click();
  await expect(page).toHaveURL(`${PUBLIC}/me/profile?tab=referee`);
  await expect(asks(page)).toHaveCount(0);
});

test('a link of the personal space asks first', async ({ page }) => {
  await openProfile(page);
  await bio(page).fill(BIO);
  const settings = page.getByRole('link', { name: 'Settings' }).first();

  await settings.click();
  await expect(asks(page)).toBeVisible();
  await asks(page).getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(`${PUBLIC}/me/profile`);
  await expect(bio(page)).toHaveValue(BIO);

  await settings.click();
  await asks(page).getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(`${PUBLIC}/me/settings`);
});

test('on a phone, a link of the drawer asks first, and the drawer closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProfile(page);
  await bio(page).fill(BIO);
  const drawerOpen = page.getByRole('button', { name: 'Close personal menu' });

  await page.getByRole('button', { name: 'Open personal menu' }).click();
  await expect(drawerOpen).toBeVisible();
  // The drawer's own Settings link: the sidebar's is hidden at this width.
  await page.getByRole('link', { name: 'Settings' }).locator('visible=true').click();
  await expect(asks(page)).toBeVisible();
  await asks(page).getByRole('button', { name: 'Leave' }).click();

  await expect(page).toHaveURL(`${PUBLIC}/me/settings`);
  await expect(drawerOpen).toHaveCount(0);
});

test('nothing asks once the profile is saved, or before anything is typed', async ({ page }) => {
  const profile = await openProfile(page);
  await refereeTab(page).click();
  await expect(page).toHaveURL(`${PUBLIC}/me/profile?tab=referee`);

  await page.getByRole('tab', { name: 'Fighter profile' }).click();
  await bio(page).fill(BIO);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  expect(profile.saves).toHaveLength(1);

  await refereeTab(page).click();
  await expect(page).toHaveURL(`${PUBLIC}/me/profile?tab=referee`);
  await expect(asks(page)).toHaveCount(0);
});

test('a word typed while the profile saves is kept, and still asks before leaving', async ({
  page,
}) => {
  await openProfile(page);
  // Registered after the stub: this one answers the save, when the story says so.
  let answer: (() => Promise<void>) | null = null;
  await page.route('**/api/v1/fighters/me/profile', (route) => {
    // The server saved what was SENT: the bio before the last words.
    answer = () => route.fulfill({ json: profileOf({ bio: BIO }) });
  });

  await bio(page).fill(BIO);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => answer !== null).toBe(true);
  await bio(page).fill(`${BIO} And sabre.`);
  await answer!();

  await expect(page.getByText('Profile saved.')).toBeVisible();
  await expect(bio(page)).toHaveValue(`${BIO} And sabre.`);
  await refereeTab(page).click();
  await expect(asks(page)).toBeVisible();
});

test('closing the browser tab with unsaved edits raises the browser prompt', async ({ page }) => {
  await openProfile(page);
  const prompts: string[] = [];
  page.on('dialog', (dialog: Dialog) => {
    prompts.push(dialog.type());
    void dialog.accept();
  });

  // Chromium shows the prompt only after a gesture on the page: a click and real key presses
  // (`fill` is no gesture).
  await bio(page).click();
  await page.keyboard.type(BIO);
  await expect(bio(page)).toHaveValue(BIO);
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => prompts).toEqual(['beforeunload']);
});

test('closing a clean profile raises no prompt', async ({ page }) => {
  await openProfile(page);
  const prompts: string[] = [];
  page.on('dialog', (dialog: Dialog) => {
    prompts.push(dialog.type());
    void dialog.accept();
  });
  // A gesture that changes nothing: the page could prompt, and must not.
  await bio(page).click();
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(prompts).toEqual([]);
});
