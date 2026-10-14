import { expect, test, type Page } from '@playwright/test';
import { collectPageIssues, expectNoCriticalAxeViolations, expectNoPageIssues } from './helpers';
import { openProfile } from './profile-stub';

/**
 * Quick win M1 (operator, 2026-10-14): Save stops on a half-typed year or an unfinished medal row,
 * and points at the field. It used to say "Profile saved." while the server cleared the start year
 * or deleted the medal. A row with nothing typed in it is still dropped without a word.
 */

const THIS_YEAR = new Date().getFullYear();
const RANGE = `Enter a year from 2000 to ${THIS_YEAR}.`;
const NOTHING_SAVED = 'Nothing was saved. Fix the fields marked in red.';

const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true }).click();
// The visibility list has a checkbox of the same name: the field is the number box.
const startYear = (page: Page) => page.getByRole('spinbutton', { name: 'Practicing since (year)' });
const medalRow = (page: Page, index: number) => page.getByTestId('medal-row').nth(index);

test('a half-typed start year stops the save and says why beside the field', async ({ page }) => {
  const issues = collectPageIssues(page);
  const profile = await openProfile(page, { practicing_since_year: 2012 });

  await startYear(page).fill('20');
  await save(page);

  await expect(startYear(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(RANGE)).toBeVisible();
  await expect(page.getByText(NOTHING_SAVED)).toBeVisible();
  await expect(page.getByText('Profile saved.')).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);

  // The known save after the refused one: the list holds it alone, so the "20" sent nothing.
  await startYear(page).fill('2015');
  await save(page);
  await expect(page.getByText('Profile saved.')).toBeVisible();
  expect(profile.saves.map((body) => body.practicingSinceYear)).toEqual([2015]);
  await expect(page.getByText(RANGE)).toHaveCount(0);
  await expectNoPageIssues(issues);
});

test('a medal with no weapon stops the save; a row with nothing typed is dropped', async ({
  page,
}) => {
  const issues = collectPageIssues(page);
  const profile = await openProfile(page, {
    medals: [{ competition: 'Open de Lyon', year: 2024, rank: 3, weapon: 'Sabre' }],
  });

  await medalRow(page, 0).getByLabel('Weapon').selectOption('');
  await page.getByRole('button', { name: 'Add a medal' }).click();
  await expect(page.getByTestId('medal-row')).toHaveCount(2);
  await save(page);

  await expect(medalRow(page, 0).getByText('Choose the weapon of this medal.')).toBeVisible();
  await expect(medalRow(page, 0).getByLabel('Weapon')).toHaveAttribute('aria-invalid', 'true');
  await expect(medalRow(page, 1).getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(NOTHING_SAVED)).toBeVisible();

  await medalRow(page, 0).getByLabel('Weapon').selectOption('Sabre');
  await save(page);
  await expect(page.getByText('Profile saved.')).toBeVisible();
  expect(profile.saves.map((body) => body.medals)).toEqual([
    [{ competition: 'Open de Lyon', year: 2024, rank: 3, weapon: 'Sabre' }],
  ]);
  await expectNoPageIssues(issues);
});

test('a medal year from before 2000 stops the save', async ({ page }) => {
  const profile = await openProfile(page, {
    medals: [{ competition: 'Open de Lyon', year: 2024, rank: 1, weapon: 'Longsword' }],
  });

  await medalRow(page, 0).getByLabel('Year').fill('1998');
  await save(page);
  await expect(medalRow(page, 0).getByText(RANGE)).toBeVisible();
  await expect(medalRow(page, 0).getByLabel('Year')).toHaveAttribute('aria-invalid', 'true');

  await medalRow(page, 0).getByLabel('Year').fill('2001');
  await save(page);
  await expect(page.getByText('Profile saved.')).toBeVisible();
  expect(profile.saves.map((body) => body.medals)).toEqual([
    [{ competition: 'Open de Lyon', year: 2001, rank: 1, weapon: 'Longsword' }],
  ]);
});
