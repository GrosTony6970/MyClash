import { expect, test, type Page } from '@playwright/test';
import { LEA, PUBLIC, signInAsLea } from './me-stub';

/**
 * Quick win M3 (operator, 2026-10-14): the word that confirms an account deletion is the reader's
 * own (DELETE, SUPPRIMER), in small letters or capitals, with stray spaces. The box showed DELETE
 * in capitals while it held "delete", and the button stayed dead. The page always SENDS the API's
 * literal, DELETE.
 */

async function openDeletion(page: Page, hasPassword = true) {
  await signInAsLea(page);
  await page.route('**/api/v1/me/security-status', (route) =>
    route.fulfill({ json: { hasPassword, email: LEA.email } }),
  );
  await page.route('**/api/v1/persons/me/email-change', (route) => route.fulfill({ json: null }));
  const deletions: unknown[] = [];
  await page.route('**/api/v1/me/account', (route) => {
    deletions.push(route.request().postDataJSON());
    // Refused, so the page stays where the story can read it.
    return route.fulfill({ status: 500, json: { status: 500, detail: 'down' } });
  });
  await page.goto(`${PUBLIC}/me/security`);
  return { deletions };
}

test.describe('in English', () => {
  test.use({ locale: 'en-GB' });

  test('"delete" in small letters confirms, and DELETE is sent', async ({ page }) => {
    const { deletions } = await openDeletion(page);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Type DELETE to confirm' });
    const confirm = dialog.getByRole('button', { name: 'Delete account' });

    await dialog.getByLabel('Current password', { exact: true }).fill('old-Password-1!');
    await dialog.getByLabel('Type DELETE to confirm').fill('delet');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm').fill(' delete ');
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(deletions).toEqual([{ currentPassword: 'old-Password-1!', confirmation: 'DELETE' }]);
  });

  // An account that signs in with Google alone has no password: the field was hidden, and the
  // sentence above it still said "Enter your current password".
  test('an account with no password is not asked for one, in the words either', async ({
    page,
  }) => {
    await openDeletion(page, false);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Type DELETE to confirm' });

    await expect(
      dialog.getByText('Type DELETE to permanently remove this account.', { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByText(/password/i)).toHaveCount(0);
    await dialog.getByLabel('Type DELETE to confirm').fill('delete');
    await expect(dialog.getByRole('button', { name: 'Delete account' })).toBeEnabled();
  });
});

test.describe('in French', () => {
  test.use({ locale: 'fr-FR' });

  test('"supprimer" confirms, the English word does not, and DELETE is sent', async ({ page }) => {
    const { deletions } = await openDeletion(page);
    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Tapez SUPPRIMER pour confirmer' });
    const confirm = dialog.getByRole('button', { name: 'Supprimer le compte' });

    await dialog.getByLabel('Mot de passe actuel', { exact: true }).fill('old-Password-1!');
    await dialog.getByLabel('Tapez SUPPRIMER pour confirmer').fill('delete');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Tapez SUPPRIMER pour confirmer').fill('  supprimer ');
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(deletions).toEqual([{ currentPassword: 'old-Password-1!', confirmation: 'DELETE' }]);
  });
});
