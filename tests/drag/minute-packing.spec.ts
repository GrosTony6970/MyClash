import { test, expect } from '@playwright/test';
import {
  LICE_A,
  LICE_B,
  MATCH_1,
  MATCH_2,
  MATCH_3,
  RUN_MATCH_IDS,
  RUN_START,
  at,
  runScheduleFixture,
  scheduleFixture,
  unscheduledFixture,
} from './schedule-grid.fixture';
import {
  SCHEDULE_URL,
  dragCardToCell,
  mockApi,
  openDetailedGrid,
  settledReadCount,
  slotOfCard,
  type Harness,
} from './schedule-grid.harness';
import {
  SCHEDULE_PATH,
  STRIP,
  openRunBlocks,
  openRunGrid,
  openStatefulGrid,
  placementStatus,
} from './stateful-board';

/**
 * The board DRAWS in 5-minute rows and MOVES bouts by the exact minute.
 *
 * It used to move them in its rows too. A row floors, so an 8-minute bout was
 * one row, five minutes: every gesture that laid bouts back to back laid them
 * five minutes apart, and the server refused the batch because it overlapped
 * itself. The same floor split a Pool's header strip, hid the last minutes of a
 * bout from a drop, and cut the axis short of a bout's real end.
 *
 * These run against the fake server WITH a memory (./piste-occupancy), which
 * checks real minutes as the API does. The fixtures are Paris, 08:00 axis: slot
 * 24 is 10:00, slot 141 is 19:45.
 */

/** Six bouts, as the run fixture lays them but `lengthMinutes` long, not placed. */
const unplacedPool = (lengthMinutes: number | null = null) =>
  runScheduleFixture(lengthMinutes).map((bout) => ({ ...bout, liceId: null, scheduledAt: null }));

/** The bodies sent to the server's re-fan, `POST …/programme/schedule-group`. */
const refans = (api: Harness) =>
  api.writes
    .filter((r) => new URL(r.url()).pathname.endsWith('/programme/schedule-group'))
    .map((r) => r.postDataJSON() as Record<string, unknown>);

test.describe('the board moves bouts by the minute', () => {
  // A desktop workspace; see schedule-grid.spec.ts.
  test.use({ viewport: { width: 1680, height: 1600 } });

  test('a pushed neighbour starts when an 8-minute bout ends, not a slot later', async ({
    page,
  }) => {
    const eightMinutes = scheduleFixture.map((bout) => ({ ...bout, durationMinutes: 8 }));
    const api = await openDetailedGrid(page, { schedule: eightMinutes, occupancy: true });
    await settledReadCount(api, SCHEDULE_PATH);

    const occupied = await slotOfCard(page, 'LSW-P1-M2', LICE_B);
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, occupied);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(await placementStatus(api)).toBe(200);
    const rows = api.placementRows(0);
    const startOf = (id: string) =>
      Date.parse(String(rows.find((r) => r['matchId'] === id)!['scheduledAt']));
    expect(startOf(MATCH_2) - startOf(MATCH_1)).toBe(8 * 60_000);
  });

  test('a Pool of 8-minute bouts is laid 8 minutes apart and pushes what it lands on', async ({
    page,
  }) => {
    // Dragged from the Unscheduled panel onto 10:00 on Piste 1, where two
    // 8-minute bouts sit back to back. The Pool takes 10:00–10:48 and both bouts
    // go after it, each where the one before it ends.
    const [first, second] = scheduleFixture;
    const busy = [
      { ...first!, durationMinutes: 8 },
      { ...second!, liceId: LICE_A, scheduledAt: at('10:08'), durationMinutes: 8 },
    ];
    const api = await openStatefulGrid(page, [...unplacedPool(8), ...busy]);

    await dragCardToCell(page, 'Pool A', LICE_A, 24);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(await placementStatus(api)).toBe(200);
    const rows = api.placementRows(0);
    const inOrder = [...RUN_MATCH_IDS, MATCH_1, MATCH_2];
    expect(inOrder.map((id) => rows.find((r) => r['matchId'] === id)?.['scheduledAt'])).toEqual(
      inOrder.map((_, i) => new Date(Date.parse(at('10:00')) + i * 8 * 60_000).toISOString()),
    );
  });

  test('a Pool dropped on a piste re-sends no bout it leaves where it is', async ({ page }) => {
    // The schedule read serves the database's own time text, and the board
    // writes `toISOString()`. Compared as text, the 12:00 bout already on the
    // piste read as moved and went into the batch, unchanged.
    const later = { ...scheduleFixture[0]!, scheduledAt: '2026-06-06T10:00:00+00:00' };
    const api = await openStatefulGrid(page, [...unplacedPool(), later]);

    await dragCardToCell(page, 'Pool A', LICE_A, 24);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    const moved = api.placementRows(0).map((r) => r['matchId']);
    expect(moved.sort()).toEqual([...RUN_MATCH_IDS].sort());
  });

  test("an 8-minute Pool's header strip carries the whole Pool", async ({ page }) => {
    // Drawn in 5-minute rows, each bout's last three minutes fall between rows;
    // the strip must still see one Pool.
    const { api, startSlot } = await openRunGrid(page, runScheduleFixture(8));
    await expect(page.locator('[draggable="true"]').filter({ hasText: STRIP })).toHaveCount(1);
    const target = Math.ceil((startSlot + 3) / 3) * 3;

    await dragCardToCell(page, STRIP, LICE_A, target);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(await placementStatus(api)).toBe(200);
    const rows = api.placementRows(0);
    expect(rows.map((r) => r['matchId']).sort()).toEqual([...RUN_MATCH_IDS].sort());
  });

  test("a Pool's header spans its rest, and the grid says it is a rest", async ({ page }) => {
    // As the server lays it: 5-minute bouts 10 s apart, and the Pool's 10-minute
    // rest after the third. In rows, the rest leaves two rows empty.
    const offsetSeconds = [0, 310, 620, 1530, 1840, 2150];
    const laid = runScheduleFixture().map((bout, i) => ({
      ...bout,
      scheduledAt: new Date(Date.parse(at('10:00')) + offsetSeconds[i]! * 1000).toISOString(),
      poolRestMinutes: 10,
    }));
    const { api, startSlot } = await openRunGrid(page, laid);
    await expect(page.locator('[draggable="true"]').filter({ hasText: STRIP })).toHaveCount(1);
    await expect(page.getByText('Rest · 10 min', { exact: true })).toBeVisible();

    await dragCardToCell(page, STRIP, LICE_A, startSlot + 12);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(await placementStatus(api)).toBe(200);
    const rows = api.placementRows(0);
    expect(rows.map((r) => r['matchId']).sort()).toEqual([...RUN_MATCH_IDS].sort());
  });

  test('a drop onto a bout still running starts when that bout ends', async ({ page }) => {
    // M2 runs 10:08–10:16 but is drawn on the 10:05 row only, so the 10:15 row
    // looks free. M1 dropped there starts at 10:16: M2 keeps its place, and M3,
    // which starts after the drop line, goes on after M1.
    const [first, second] = scheduleFixture;
    const third = unscheduledFixture[2]!;
    const api = await openStatefulGrid(page, [
      { ...first!, durationMinutes: 8 },
      { ...second!, scheduledAt: at('10:08'), durationMinutes: 8 },
      { ...third, liceId: LICE_B, scheduledAt: at('10:16'), durationMinutes: 8 },
    ]);
    const line = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 2;

    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, line);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(await placementStatus(api)).toBe(200);
    expect(api.placementRows(0)).toEqual([
      { matchId: MATCH_1, liceId: LICE_B, scheduledAt: at('10:16') },
      { matchId: MATCH_3, liceId: LICE_B, scheduledAt: at('10:24') },
    ]);
  });

  test('redo, and a drop on the row it already lands on, follow the landing', async ({ page }) => {
    // M2 runs 10:08–10:16, drawn on the 10:05 row only. M1 released on 10:15
    // lands at 10:16. Redo must put it at 10:16 again, not on 10:15 on top of
    // M2. Released on that row a second time, it is where it would land: no
    // save and no history, so the Ctrl+Z after it undoes the redo.
    const [first, second] = scheduleFixture;
    const api = await openStatefulGrid(page, [
      { ...first!, durationMinutes: 8 },
      { ...second!, scheduledAt: at('10:08'), durationMinutes: 8 },
    ]);
    const line = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 2;
    const landed = { matchId: MATCH_1, liceId: LICE_B, scheduledAt: at('10:16') };

    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, line);
    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(api.placementRows(0)).toEqual([landed]);
    await page.keyboard.press('Control+z');
    await expect.poll(() => api.placementWrites().length).toBe(2);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => api.placementWrites().length).toBe(3);
    expect(api.placementRows(2)).toEqual([landed]);
    expect(await placementStatus(api, 2)).toBe(200);

    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, line);
    await page.keyboard.press('Control+z');

    await expect.poll(() => api.placementWrites().length).toBe(4);
    expect(api.placementRows(3)).toEqual([
      { matchId: MATCH_1, liceId: LICE_A, scheduledAt: at('10:00') },
    ]);
  });

  test('a bout pushed past 20:00 goes on after the drop, not above it', async ({ page }) => {
    // M2 runs 19:54–20:02. M1, ten minutes long, dropped on 19:45 pushes it to
    // 19:55. An axis cut at M2's floored row, 20:00, had no room for that and
    // pushed M2 up above M1 instead.
    const [first, second] = scheduleFixture;
    const api = await openStatefulGrid(page, [
      { ...first!, durationMinutes: 10 },
      { ...second!, scheduledAt: at('19:54'), durationMinutes: 8 },
    ]);

    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, 141);

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(api.placementRows(0)).toEqual([
      { matchId: MATCH_1, liceId: LICE_B, scheduledAt: at('19:45') },
      { matchId: MATCH_2, liceId: LICE_B, scheduledAt: at('19:55') },
    ]);
  });

  test("moving a Pool's top edge puts its first bout on the line and keeps the spacing", async ({
    page,
  }) => {
    // Six 8-minute bouts from 10:43; the edge is dragged five rows down, onto the
    // 11:00 line. Every bout moves the same 17 minutes. Snapped to their rows
    // first, they landed 11:00, 11:10, 11:15 … and overlapped.
    const api = await openRunBlocks(page, runScheduleFixture(8));
    const edge = await page
      .getByRole('separator', { name: 'Resize start of Pool A' })
      .boundingBox();
    const x = edge!.x + edge!.width / 2;
    const y = edge!.y + edge!.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 80, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => api.placementWrites().length).toBe(1);
    expect(await placementStatus(api)).toBe(200);
    const rows = api.placementRows(0);
    expect(
      RUN_MATCH_IDS.map((id) => rows.find((r) => r['matchId'] === id)?.['scheduledAt']),
    ).toEqual(
      RUN_MATCH_IDS.map((_, i) => new Date(Date.parse(at('11:00')) + i * 8 * 60_000).toISOString()),
    );
  });

  test('a bracket round moved onto more pistes is re-laid from its own start', async ({ page }) => {
    // The server re-fans a round from the start the board sends. A round that
    // starts at 10:43 was sent its row, 10:40.
    const round = [0, 1].map((i) => ({
      ...scheduleFixture[0]!,
      id: RUN_MATCH_IDS[i]!,
      matchNumberLabel: `M${i + 1}`,
      roundCode: `LSW-B-QF-M${i + 1}`,
      phaseType: 'single_elim',
      scheduledAt: new Date(Date.parse(RUN_START) + i * 5 * 60_000).toISOString(),
      redRegistrationId: `reg-red-qf-${i}`,
      blueRegistrationId: `reg-blue-qf-${i}`,
    }));
    const api = await mockApi(page, { schedule: round });
    await page.goto(SCHEDULE_URL);
    await page.getByRole('button', { name: 'Edit Quarter-finals', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Piste 2' }).check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect.poll(() => refans(api).length).toBe(1);
    expect(refans(api)[0]).toMatchObject({ startTime: RUN_START, mode: 'bracket-branch' });
  });
});
