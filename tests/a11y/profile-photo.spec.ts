import { expect, test, type Page } from '@playwright/test';
import { collectPageIssues, expectNoPageIssues } from './helpers';
import { openProfile } from './profile-stub';

/**
 * Quick win M2 (operator, 2026-10-14): a refused photo says why UNDER THE PHOTO. The reason used to
 * show a form-length below, next to Save; a failed upload left the cropper open over it.
 */

// A 1 × 1 PNG: enough for the cropper to measure a crop.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const photo = (page: Page) => page.getByTestId('profile-photo');
const pick = (page: Page, name: string, buffer: Buffer) =>
  photo(page).locator('input[type="file"]').setInputFiles({ name, mimeType: 'image/png', buffer });

test('a photo over 15 MB is refused, and the reason is under the photo', async ({ page }) => {
  const issues = collectPageIssues(page);
  await openProfile(page);

  await pick(page, 'big.png', Buffer.alloc(16 * 1024 * 1024));

  await expect(photo(page).getByRole('alert')).toHaveText('Image must be 15 MB or smaller.');
  // Said once, under the photo: nothing waits beside Save.
  await expect(page.getByText('Image must be 15 MB or smaller.')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectNoPageIssues(issues);
});

test('a failed upload closes the cropper and says why under the photo', async ({ page }) => {
  await openProfile(page);
  let uploads = 0;
  await page.route('**/api/v1/fighters/me/photo', (route) => {
    uploads += 1;
    return route.fulfill({ status: 500, json: { detail: 'storage down' } });
  });

  await pick(page, 'me.png', PIXEL);
  const cropper = page.getByRole('dialog', { name: 'Adjust your photo' });
  await expect(cropper).toBeVisible();
  await cropper.getByRole('button', { name: 'Save photo' }).click();

  await expect(cropper).toHaveCount(0);
  await expect(photo(page).getByRole('alert')).toHaveText(
    'Could not update your photo. Please try again.',
  );
  await expect(page.getByText('Could not update your photo. Please try again.')).toHaveCount(1);
  expect(uploads).toBe(1);

  // A new try starts clean: the old reason goes as soon as another file is picked.
  await pick(page, 'me.png', PIXEL);
  await expect(page.getByRole('dialog', { name: 'Adjust your photo' })).toBeVisible();
  await expect(photo(page).getByRole('alert')).toHaveCount(0);
});
