import { expect, test, type Dialog, type Page } from '@playwright/test';
import { collectPageIssues, expectNoPageIssues } from './helpers';
import { openProfile, PUBLIC } from './profile-stub';

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
  await expectNoPageIssues(issues);
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
