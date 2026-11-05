import { expect, test, type Page } from '@playwright/test';
import { collectPageIssues, expectNoCriticalAxeViolations, expectNoPageIssues } from './helpers';
import { PUBLIC } from './public-pages-stub';
import {
  answerWith,
  dialog,
  openPhotos,
  pageOf,
  photo,
  range,
  reportsTo,
  tileOf,
  tiles,
} from './photos-public-stub';

/**
 * A spectator's Report of a public photo (design Goal 6; rulings 452-453): it asks first, takes an
 * optional comment of 200 characters, and says each answer of the server in the reader's language.
 */

test.use({ viewport: { width: 390, height: 844 } });

test.describe('a Report', () => {
  const opened = (page: Page) =>
    openPhotos(
      page,
      answerWith(pageOf([photo(0, { caption: 'Final' }), photo(1, { caption: 'Salute' })])),
    );
  const reportButton = (page: Page, caption: string) =>
    tileOf(page, caption).getByRole('button', { name: 'Report' });

  test('asks first: Cancel sends nothing', async ({ page }) => {
    await opened(page);
    const posts = await reportsTo(page, []);
    await reportButton(page, 'Final').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('It stays on show until they decide.');
    // The box says what it is for, to a sighted spectator too.
    await expect(dialog(page).getByText('Why? (optional)', { exact: true })).toBeVisible();

    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });

  test('sends its comment, then reads Reported', async ({ page }) => {
    await opened(page);
    const posts = await reportsTo(page, [answerWith({ reported: true })]);
    await reportButton(page, 'Final').click();
    await dialog(page).getByRole('textbox', { name: 'Why? (optional)' }).fill('  this is me  ');
    await dialog(page).getByRole('button', { name: 'Report' }).click();

    await expect(tileOf(page, 'Final').getByRole('button', { name: 'Reported' })).toBeDisabled();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url()).toContain('/photos/p0/report');
    expect(posts[0]!.postDataJSON()).toEqual({ comment: 'this is me' });
    // The other photo is untouched.
    await expect(reportButton(page, 'Salute')).toBeEnabled();
  });

  test('with no comment sends null', async ({ page }) => {
    await opened(page);
    const posts = await reportsTo(page, [answerWith({ reported: true })]);
    await reportButton(page, 'Final').click();
    await dialog(page).getByRole('button', { name: 'Report' }).click();

    await expect(tileOf(page, 'Final').getByRole('button', { name: 'Reported' })).toBeVisible();
    expect(posts[0]!.postDataJSON()).toEqual({ comment: null });
  });

  test('refuses a 201st character, and says why', async ({ page }) => {
    await opened(page);
    await reportButton(page, 'Final').click();
    const field = dialog(page).getByRole('textbox', { name: 'Why? (optional)' });

    // Counted as the server counts: an emoji is one character, as in a caption.
    await field.fill('🤺'.repeat(200));
    await expect(dialog(page).getByRole('button', { name: 'Report' })).toBeEnabled();
    await field.fill('x'.repeat(200));
    await expect(dialog(page).getByRole('button', { name: 'Report' })).toBeEnabled();
    await field.fill('x'.repeat(201));
    await expect(dialog(page).getByText('At most 200 characters.')).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Report' })).toBeDisabled();
  });

  test('is sent once, however often the button is tapped while it is out', async ({ page }) => {
    await opened(page);
    let release: (() => void) | null = null;
    const posts = await reportsTo(page, [
      async (route) => {
        await new Promise<void>((resolve) => (release = resolve));
        await route.fulfill({ json: { reported: true } });
      },
    ]);
    await reportButton(page, 'Final').click();
    await dialog(page).getByRole('button', { name: 'Report' }).click();

    const sending = tileOf(page, 'Final').getByRole('button', { name: 'Reporting…' });
    await expect(sending).toBeDisabled();
    await sending.click({ force: true });
    await expect(dialog(page)).toHaveCount(0);
    expect(posts).toHaveLength(1);
    release!();
    await expect(tileOf(page, 'Final').getByRole('button', { name: 'Reported' })).toBeVisible();
  });

  test('of a photo deleted meanwhile says it is no longer shown', async ({ page }) => {
    await opened(page);
    await reportsTo(page, [
      answerWith({ statusCode: 404, code: 'photo_not_found', detail: 'Photo not found' }, 404),
    ]);
    await reportButton(page, 'Final').click();
    await dialog(page).getByRole('button', { name: 'Report' }).click();

    await expect(tileOf(page, 'Final')).toContainText('This photo is no longer shown.');
    await expect(reportButton(page, 'Final')).toHaveCount(0);
  });

  test("at the phone's hourly limit says to try later, and Report opens again", async ({
    page,
  }) => {
    await opened(page);
    await reportsTo(page, [
      answerWith({ statusCode: 429, code: 'photo_report_limit', detail: 'Limit' }, 429),
    ]);
    await reportButton(page, 'Final').click();
    await dialog(page).getByRole('button', { name: 'Report' }).click();

    await expect(tileOf(page, 'Final')).toContainText(
      'This phone has reported many photos this hour. Try again later.',
    );
    await expect(reportButton(page, 'Final')).toBeEnabled();
  });

  test('in French, says the limit in French', async ({ page, context }) => {
    await context.addCookies([{ name: 'mc_locale', value: 'fr', url: PUBLIC }]);
    await openPhotos(page, answerWith(pageOf([photo(0, { caption: 'Finale' })])));
    await reportsTo(page, [
      answerWith({ statusCode: 429, code: 'photo_report_limit', detail: 'Limit' }, 429),
    ]);
    await tileOf(page, 'Finale').getByRole('button', { name: 'Signaler' }).click();
    await page
      .getByRole('dialog', { name: 'Signaler cette photo ?' })
      .getByRole('button', { name: 'Signaler' })
      .click();

    await expect(tileOf(page, 'Finale')).toContainText(
      'Ce téléphone a signalé beaucoup de photos cette heure-ci. Réessayez plus tard.',
    );
  });
});

test('the page and its Report dialog pass axe, with no page issue', async ({ page }) => {
  const issues = collectPageIssues(page);
  await openPhotos(page, answerWith(pageOf(range(0, 3, { caption: 'A bout' }))));
  await expect(tiles(page)).toHaveCount(4);
  await expectNoCriticalAxeViolations(page);

  await tiles(page).first().getByRole('button', { name: 'Report' }).click();
  await expect(dialog(page)).toBeVisible();
  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});
