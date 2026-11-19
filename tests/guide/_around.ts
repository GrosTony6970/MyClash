import { expect, type Page } from '@playwright/test';
import { runContext } from '../e2e/_context';
import type { Api } from '../e2e/_api';
import { shootClean } from './_beyond';

/**
 * The guide's "Before and after" screenshots
 * (docs/superpowers/archive/specs/2026-11-19-guide-after-the-event-design.md): the Photos page with its mode
 * and QR panel, the Notifications page, and the Debrief. The print pack opens a print window, which
 * a screenshot cannot take.
 *
 * Runs on the caller's test Event, after its bouts. Writes only the Event's photo mode, gone with
 * the Event's hard delete. The QR code it shows sends to that Event, which the run then deletes.
 * Called from `shootBeyond`: screenshots.spec.ts is at the 400-line budget.
 */
export async function shootAround(page: Page, api: Api, eventId: string, out: string) {
  const at = `/org/${runContext().orgSlug}/events/${eventId}`;
  await api.ok(await api.patch(`events/${eventId}`, { data: { photoMode: 'approve' } }));

  await page.goto(`${at}/photos`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Who sees the photos').first()).toBeVisible();
  await shootClean(page, `${out}/28-photos.png`);

  await page.goto(`${at}/notifications`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Send notification' }).first()).toBeVisible();
  await shootClean(page, `${out}/29-notifications.png`);

  await page.goto(`${at}/debrief`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Exchanges the server refused').first()).toBeVisible();
  await shootClean(page, `${out}/30-debrief.png`);
}
