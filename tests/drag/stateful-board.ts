import { expect, type Page } from '@playwright/test';
import { EVENT_ID, LICE_A, runScheduleFixture } from './schedule-grid.fixture';
import {
  SCHEDULE_URL,
  mockApi,
  settledReadCount,
  slotOfCard,
  type Harness,
} from './schedule-grid.harness';

/**
 * Openers and one probe for the drag specs that run against the fake server WITH
 * a memory (`occupancy`, ./piste-occupancy): ./multi-bout.spec (a gesture is one
 * save) and ./minute-packing.spec (a gesture moves bouts by the minute).
 */

export const SCHEDULE_PATH = `/events/${EVENT_ID}/schedule`;
/** The Detailed grid's header strip of the run fixture's Pool. */
export const STRIP = 'Pool A - Longsword Open';

/** The status the server answered the `n`th batch with, once that answer has landed. */
export async function placementStatus(api: Harness, n = 0): Promise<number | undefined> {
  const posts = api.writes.filter((r) =>
    new URL(r.url()).pathname.endsWith('/schedule/placements'),
  );
  return (await posts[n]?.response())?.status();
}

/** The six-bout run in the Blocks view, catch-up read settled, server stateful. */
export async function openRunBlocks(page: Page, schedule: unknown = runScheduleFixture()) {
  const api = await mockApi(page, { schedule, occupancy: true });
  await page.goto(SCHEDULE_URL);
  await expect(page.getByRole('button', { name: 'Edit Pool A', exact: true })).toBeVisible();
  await settledReadCount(api, SCHEDULE_PATH);
  return api;
}

/** Any board on the Detailed grid, catch-up read settled, server stateful. */
export async function openStatefulGrid(page: Page, schedule: unknown): Promise<Harness> {
  const api = await mockApi(page, { schedule, occupancy: true });
  await page.goto(SCHEDULE_URL);
  await page.getByRole('button', { name: 'Detailed grid' }).click();
  await expect(page.locator('[data-lice-id][data-slot]').first()).toBeAttached();
  await settledReadCount(api, SCHEDULE_PATH);
  return api;
}

/** The six-bout run on the Detailed grid, and the row its first bout is drawn on. */
export async function openRunGrid(
  page: Page,
  schedule: unknown = runScheduleFixture(),
): Promise<{ api: Harness; startSlot: number }> {
  const api = await openStatefulGrid(page, schedule);
  return { api, startSlot: await slotOfCard(page, 'LSW-PA-M1', LICE_A) };
}
