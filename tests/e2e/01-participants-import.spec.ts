import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { runContext } from './_context';
import { isolateRoster } from './_roster';

/**
 * Imports participants into the throwaway test event via the CSV import wizard.
 * CSV resolution order:
 *   1. E2E_PARTICIPANTS_CSV (explicit override)
 *   2. participants.local.csv — your real roster, kept local + git-ignored (PII)
 *   3. participants.sample.csv — the committed synthetic sample (used in CI)
 * Auto-detects `,` or `;` delimiter. Required columns: given_name, family_name.
 *
 * The roster can be a real one, so nobody in it may be reached (`_roster.ts`):
 *   - every row is isolated before upload — it keeps its name and role, and
 *     loses its email, HEMA Ratings id, club and every other cell. No one is
 *     kept linked here: this spec only checks that the import creates rows.
 *   - the preview still suggests LINKING a row to an existing profile whose
 *     name looks alike, and the screen sends that choice with the commit. On
 *     prod that profile may be a real person's, so the spec presses "Create all
 *     as new" before importing.
 */
const LOCAL_CSV = 'tests/e2e/fixtures/participants.local.csv';
const SAMPLE_CSV = 'tests/e2e/fixtures/participants.sample.csv';
const CSV = process.env.E2E_PARTICIPANTS_CSV ?? (existsSync(LOCAL_CSV) ? LOCAL_CSV : SAMPLE_CSV);

test('import participants from a CSV file', async ({ page }) => {
  const { orgSlug, eventId } = runContext();

  // `networkidle`, then a count of one: for ~120 ms after navigation the wizard
  // holds a streamed copy and a client copy of every field, and a strict
  // locator landing in that window resolves to two (same fix as `02` and `03`).
  await page.goto(`/org/${orgSlug}/events/${eventId}/persons/import`, {
    waitUntil: 'networkidle',
  });
  const fileInput = page.getByTestId('import-file-input');
  await expect(fileInput).toHaveCount(1);

  // Upload → validate (server dry-run preview). The isolated copy, never the file.
  const isolated = isolateRoster(readFileSync(CSV, 'utf8'), []);
  await fileInput.setInputFiles({
    name: 'roster.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(isolated.csv, 'utf8'),
  });
  await page.getByTestId('import-validate').click();

  // Preview renders; commit becomes enabled once there are rows to create/link.
  const commit = page.getByTestId('import-commit');
  await expect(commit).toBeEnabled();

  // No row may link to an existing profile: the shortcut only shows when the
  // preview suggested one, and once pressed it greys out — every row is new.
  const createAllAsNew = page.getByRole('button', { name: /^Create all as new/ });
  if ((await createAllAsNew.count()) > 0) {
    if (await createAllAsNew.isEnabled()) await createAllAsNew.click();
    await expect(createAllAsNew, 'every suggested link must become a new profile').toBeDisabled();
  }
  await commit.click();

  // Done step: assert the import actually created at least one row (it never updates one).
  await expect(page.getByText(/Import complete/i)).toBeVisible();
  const summary = page.getByText(/created ·/i);
  await expect(summary).toBeVisible();
  expect(await summary.textContent()).toMatch(/[1-9]\d* created/);
});
