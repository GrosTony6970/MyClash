import { test, expect, type Page } from '@playwright/test';
import {
  LICE_A,
  LICE_B,
  MATCH_1,
  MATCH_2,
  RUN_MATCH_IDS,
  at,
  runScheduleFixture,
} from './schedule-grid.fixture';
import {
  dragCardToCell,
  openDetailedGrid,
  settledReadCount,
  slotOfCard,
} from './schedule-grid.harness';
import {
  SCHEDULE_PATH,
  STRIP,
  openRunBlocks,
  openRunGrid,
  placementStatus,
} from './stateful-board';

/**
 * A gesture that moves several bouts is ONE save, judged as a whole.
 *
 * Every multi-bout gesture on the board used to send one PATCH per bout, all at
 * once, and the server judged each against bouts that had not moved yet. Drag a
 * Pool of six fifteen minutes later and bouts 1–3 ask for times bouts 4–6 still
 * hold: three PATCHes in six were refused with a 409, the banner said "3/6
 * changes were not saved", and the board re-read a Pool split in two. Which bouts
 * lose depends on which request the server reads first, so the same drag could
 * pass on the next try.
 *
 * These cases run against the harness's server WITH a memory (`occupancy`, see
 * ./piste-occupancy): it refuses a single PATCH onto a held piste and accepts a
 * batch only as a whole. The contract asserted is the REQUEST: exactly one
 * `…/schedule/placements`, zero single-Match PATCHes, and the cards where the
 * operator put them.
 */

/** The board's "Change not saved:" banner — where every refused write lands. */
const saveErrorBanner = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Change not saved:' });

test.describe('multi-bout gestures are one save', () => {
  // A desktop workspace; see schedule-grid.spec.ts.
  test.use({ viewport: { width: 1680, height: 1600 } });

  test('dragging a run later sends one batch the server accepts as a whole', async ({ page }) => {
    const { api, startSlot } = await openRunGrid(page);
    // Drops snap to the 15-minute grid: the first multiple of three slots that is
    // at least three slots (15 min) later, so the run lands ON the run it leaves.
    const target = Math.ceil((startSlot + 3) / 3) * 3;

    await dragCardToCell(page, STRIP, LICE_A, target);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    const body = api.placementWrites()[0]!;
    const rows = body['placements'] as Array<Record<string, unknown>>;
    expect(Object.keys(body)).toEqual(['placements']);
    expect(rows.map((r) => r['matchId']).sort()).toEqual([...RUN_MATCH_IDS].sort());
    for (const row of rows) expect(row['liceId']).toBe(LICE_A);
    // Six five-minute bouts, back to back from the drop slot.
    for (let i = 0; i < RUN_MATCH_IDS.length; i++) {
      expect(await slotOfCard(page, `LSW-PA-M${i + 1}`, LICE_A)).toBe(target + i);
    }
    // Only once the server's answer is in can "no banner" mean anything: checked
    // before it, the fan-out's banner had simply not been raised yet.
    expect(await placementStatus(api)).toBe(200);
    expect(api.scheduleWrites()).toEqual([]);
    await expect(saveErrorBanner(page)).toHaveCount(0);
  });

  test('a drop that moves nothing saves nothing', async ({ page }) => {
    // Two minutes later the run starts on a 15-minute line, so a drop on its own
    // first cell lands every bout where it already is: an empty batch, which the
    // server refuses. The next drop's save must be the first the server sees.
    const onTheLine = runScheduleFixture().map((bout) => ({
      ...bout,
      scheduledAt: new Date(Date.parse(bout.scheduledAt!) + 2 * 60_000).toISOString(),
    }));
    const { api, startSlot } = await openRunGrid(page, onTheLine);

    await dragCardToCell(page, STRIP, LICE_A, startSlot);
    await dragCardToCell(page, STRIP, LICE_A, startSlot + 3);

    await expect.poll(() => api.placementWrites().length).toBeGreaterThan(0);
    expect(api.placementRows(0)).toHaveLength(RUN_MATCH_IDS.length);
    expect(await placementStatus(api)).toBe(200);
    expect(api.placementWrites()).toHaveLength(1);
  });

  test('a drop that pushes a neighbour is one batch of both rows', async ({ page }) => {
    const api = await openDetailedGrid(page, { occupancy: true });
    await settledReadCount(api, SCHEDULE_PATH);

    const occupied = await slotOfCard(page, 'LSW-P1-M2', LICE_B);
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, occupied);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    const rows = api.placementRows(0);
    expect(rows.map((r) => r['matchId']).sort()).toEqual([MATCH_1, MATCH_2].sort());
    const dragged = rows.find((r) => r['matchId'] === MATCH_1)!;
    const displaced = rows.find((r) => r['matchId'] === MATCH_2)!;
    expect(String(displaced['scheduledAt']) > String(dragged['scheduledAt'])).toBe(true);
    expect(await placementStatus(api)).toBe(200);
    expect(api.scheduleWrites()).toEqual([]);
    await expect(saveErrorBanner(page)).toHaveCount(0);
  });

  test('Ctrl+Z is one batch too', async ({ page }) => {
    const api = await openDetailedGrid(page, { occupancy: true });
    await settledReadCount(api, SCHEDULE_PATH);
    const empty = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 24;
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, empty);
    await expect.poll(() => api.placementWrites().length).toBe(1);

    await page.keyboard.press('Control+z');

    await expect.poll(() => api.placementWrites().length).toBe(2);
    const rows = api.placementRows(1);
    expect(rows.map((r) => r['matchId'])).toEqual([MATCH_1]);
    expect(rows[0]!['liceId']).toBe(LICE_A);
    expect(await placementStatus(api, 1)).toBe(200);
    expect(api.scheduleWrites()).toEqual([]);
  });

  test('clearing the day is one batch of every bout on it', async ({ page }) => {
    const { api } = await openRunGrid(page);

    await page.getByRole('button', { name: 'Clear day (6)', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Clear day?' })
      .getByRole('button', { name: 'Clear day', exact: true })
      .click();

    await expect.poll(() => api.placementWrites().length).toBe(1);
    const rows = api.placementRows(0);
    expect(rows.map((r) => r['matchId']).sort()).toEqual([...RUN_MATCH_IDS].sort());
    for (const row of rows) {
      expect(row).toEqual({ matchId: row['matchId'], liceId: null, scheduledAt: null });
    }
    expect(await placementStatus(api)).toBe(200);
    expect(api.scheduleWrites()).toEqual([]);
  });

  test('pushing a late piste back is one batch of every bout still to come', async ({ page }) => {
    // M1 went on ten minutes late, so Piste 1's header offers "+10": M2–M6 move.
    const late = runScheduleFixture().map((bout, i) =>
      i === 0 ? { ...bout, status: 'running', startedAt: at('10:53') } : bout,
    );
    const api = await openRunBlocks(page, late);

    await page.getByRole('button', { name: '+10', exact: true }).click();

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(api.placementRows(0)).toEqual(
      late.slice(1).map((bout) => ({
        matchId: bout.id,
        liceId: LICE_A,
        scheduledAt: new Date(Date.parse(bout.scheduledAt!) + 10 * 60_000).toISOString(),
      })),
    );
    expect(await placementStatus(api)).toBe(200);
    expect(api.scheduleWrites()).toEqual([]);
  });

  test("stretching a Pool's block is one batch of its bouts", async ({ page }) => {
    const api = await openRunBlocks(page);
    const edge = await page.getByRole('separator', { name: 'Resize time of Pool A' }).boundingBox();
    const x = edge!.x + edge!.width / 2;
    const y = edge!.y + edge!.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 80, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => api.placementWrites().length).toBe(1);
    const rows = api.placementRows(0);
    expect(rows.map((r) => r['matchId']).sort()).toEqual([...RUN_MATCH_IDS].sort());
    for (const row of rows) expect(row['liceId']).toBe(LICE_A);
    expect(await placementStatus(api)).toBe(200);
    expect(api.scheduleWrites()).toEqual([]);
  });

  test('undoing a cleared run puts all six back in one batch', async ({ page }) => {
    const api = await openRunBlocks(page);
    await page.getByRole('button', { name: 'Unschedule Pool A', exact: true }).click();
    await expect.poll(() => api.placementWrites().length).toBe(1);

    await page.keyboard.press('Control+z');

    await expect.poll(() => api.placementWrites().length).toBe(2);
    const rows = api.placementRows(1);
    expect(rows).toHaveLength(RUN_MATCH_IDS.length);
    expect(rows).toEqual(
      expect.arrayContaining(
        runScheduleFixture().map((bout) => ({
          matchId: bout.id,
          liceId: LICE_A,
          scheduledAt: bout.scheduledAt,
        })),
      ),
    );
    expect(await placementStatus(api, 1)).toBe(200);
    expect(api.scheduleWrites()).toEqual([]);
  });
});
