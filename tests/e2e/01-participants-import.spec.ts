import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { runContext } from './_context';

/**
 * Imports participants into the throwaway test event via the CSV import wizard.
 * CSV resolution order:
 *   1. E2E_PARTICIPANTS_CSV (explicit override)
 *   2. participants.local.csv — your real roster, kept local + git-ignored (PII)
 *   3. participants.sample.csv — the committed synthetic sample (used in CI)
 * Auto-detects `,` or `;` delimiter. Required columns: given_name, family_name.
 */
const LOCAL_CSV = 'tests/e2e/fixtures/participants.local.csv';
const SAMPLE_CSV = 'tests/e2e/fixtures/participants.sample.csv';
const CSV = process.env.E2E_PARTICIPANTS_CSV ?? (existsSync(LOCAL_CSV) ? LOCAL_CSV : SAMPLE_CSV);

test('import participants from a CSV file', async ({ page }) => {
  const { orgSlug, eventId } = runContext();

  await page.goto(`/org/${orgSlug}/events/${eventId}/persons/import`);

  // Upload → validate (server dry-run preview).
  await page.getByTestId('import-file-input').setInputFiles(CSV);
  await page.getByTestId('import-validate').click();

  // Preview renders; commit becomes enabled once there are rows to create/link.
  const commit = page.getByTestId('import-commit');
  await expect(commit).toBeEnabled();
  await commit.click();

  // Done step: assert the import actually created/updated at least one row.
  await expect(page.getByText(/Import complete/i)).toBeVisible();
  const summary = page.getByText(/created ·/i);
  await expect(summary).toBeVisible();
  expect(await summary.textContent()).toMatch(/[1-9]\d* (created|updated)/);
});
