import { test, expect, type Page } from '@playwright/test';
import {
  EVENT_ID,
  LICE_B,
  MATCH_1,
  MATCH_3,
  RUN_MATCH_IDS,
  runScheduleFixture,
  unscheduledFixture,
} from './schedule-grid.fixture';
import {
  SCHEDULE_URL,
  dragCardToCell,
  dropCardOnPanel,
  gridCard,
  mockApi,
  openDetailedGrid,
  settledReadCount,
  slotOfCard,
  type Harness,
} from './schedule-grid.harness';

/**
 * Sending bouts back to the Unscheduled list, in a real browser.
 *
 * Four doors on the board unschedule — the × on a run, a run header's Clear, a
 * card dropped on the Unscheduled panel, and undo — and all four once sent
 * `{ liceId: '', scheduledAt: '' }`, which the API refuses: an empty string is
 * neither a uuid nor a date. The organiser saw the run vanish, then "n/n changes
 * were not saved", then the bouts come back on the re-read. Each door now sends
 * ONE save, every bout of it a `null` row.
 *
 * THE BODY ASSERTION IS THE NET. This harness answers 200 to every write, the
 * refused body included, so the board clears on screen either way. The row the
 * API takes, `{ matchId, liceId: null, scheduledAt: null }`, is pinned on the API
 * side by `schedule-placements.dto.test.ts`.
 *
 * Every case lets the failed socket's catch-up read land BEFORE it acts. The
 * harness serves the same schedule to every read, so a read landing after the
 * gesture puts the bouts back on the board, and the on-screen checks below would
 * then pass or fail on timing rather than on the gesture.
 */

const unscheduled = (matchId: string) => ({ matchId, liceId: null, scheduledAt: null });
const SCHEDULE_PATH = `/events/${EVENT_ID}/schedule`;

/** The panel's own count. A bout sent back becomes a chip there carrying the same
 *  round code as its card, so the panel side is read from the heading. Case-blind
 *  because the heading is styled upper case. */
const unscheduledHeading = (page: Page, count: number) =>
  page.getByRole('heading', { name: new RegExp(`^Unscheduled \\(${count}\\)$`, 'i') });

/** The run fixture's board, read settled. The block view draws a Pool as one
 *  block, not as cards, so the board is ready when its ✎ is. */
async function openRunBoard(page: Page): Promise<Harness> {
  const api = await mockApi(page, { schedule: runScheduleFixture() });
  await page.goto(SCHEDULE_URL);
  await expect(page.getByRole('button', { name: 'Edit Pool A', exact: true })).toBeVisible();
  await settledReadCount(api, SCHEDULE_PATH);
  return api;
}

/** Every run bout was sent back in one save, each with the row the API accepts. */
async function expectRunUnscheduled(api: Harness): Promise<void> {
  await expect.poll(() => api.placementWrites().length).toBe(1);
  const rows = api.placementRows(0);
  expect(rows.map((r) => r['matchId']).sort()).toEqual([...RUN_MATCH_IDS].sort());
  for (const row of rows) expect(row).toEqual(unscheduled(row['matchId'] as string));
  expect(api.scheduleWrites()).toEqual([]);
}

test.describe('schedule grid unschedule', () => {
  // A desktop workspace; see schedule-grid.spec.ts.
  test.use({ viewport: { width: 1680, height: 1600 } });

  test('the × on a run sends every bout back with a body the API accepts', async ({ page }) => {
    const api = await openRunBoard(page);
    const unschedule = page.getByRole('button', { name: 'Unschedule Pool A', exact: true });
    await unschedule.click();

    await expectRunUnscheduled(api);
    await expect(unschedule).toHaveCount(0);
    await expect(unscheduledHeading(page, 6)).toBeVisible();
  });

  test('clearing a run from its Detailed header sends the same body', async ({ page }) => {
    const api = await openRunBoard(page);
    await page.getByRole('button', { name: 'Detailed grid' }).click();
    const strip = page.getByRole('button', { name: /^Pool A - Longsword Open/ });
    await strip.click();
    const dialog = page.getByRole('dialog', { name: 'Clear Pool A?' });
    await dialog.getByRole('button', { name: 'Clear', exact: true }).click();

    await expectRunUnscheduled(api);
    await expect(dialog).toBeHidden();
    await expect(strip).toHaveCount(0);
    await expect(unscheduledHeading(page, 6)).toBeVisible();
  });

  test('a card dropped on the Unscheduled panel is sent back with that body', async ({ page }) => {
    const api = await openDetailedGrid(page);
    await settledReadCount(api, SCHEDULE_PATH);
    await expect(gridCard(page, 'LSW-P1-M1')).toHaveCount(1);

    await dropCardOnPanel(page, 'LSW-P1-M1');

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(api.placementRows(0)).toEqual([unscheduled(MATCH_1)]);
    await expect(gridCard(page, 'LSW-P1-M1')).toHaveCount(0);
    await expect(unscheduledHeading(page, 1)).toBeVisible();
  });

  test('Ctrl+Z on a bout placed from the panel sends it back with that body', async ({ page }) => {
    // The undo entry remembers where the bout came from — nowhere — and undo
    // writes that position back. It used to turn each null into ''.
    const api = await openDetailedGrid(page, { schedule: unscheduledFixture });
    await settledReadCount(api, SCHEDULE_PATH);
    await expect(unscheduledHeading(page, 1)).toBeVisible();

    const empty = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 24;
    await dragCardToCell(page, 'LSW-P1-M3', LICE_B, empty);
    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(api.placementRows(0)[0]!['liceId']).toBe(LICE_B);
    await expect(gridCard(page, 'LSW-P1-M3')).toHaveCount(1);
    await expect(unscheduledHeading(page, 0)).toBeVisible();

    await page.keyboard.press('Control+z');

    await expect.poll(() => api.placementWrites().length).toBe(2);
    expect(api.placementRows(1)).toEqual([unscheduled(MATCH_3)]);
    await expect(gridCard(page, 'LSW-P1-M3')).toHaveCount(0);
    await expect(unscheduledHeading(page, 1)).toBeVisible();
  });
});
