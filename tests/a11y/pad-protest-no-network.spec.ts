/**
 * A protest tapped with no network is kept on the tablet and sent when the
 * network is back (hard rule 3: the scorekeeper loses nothing when the wifi
 * drops). The button goes off on a locked bout and on an Event that is over.
 *
 * The API is stubbed (`pad-penalty-stub.ts`): a protest the server takes is
 * kept and listed back. "No network" is what the pad's service worker answers
 * (a 503 `{ error: 'offline' }`), with `navigator.onLine` false.
 */
import { test, expect, type Page } from '@playwright/test';
import { openProtestBout, protestChip } from './pad-penalty-stub';

/** The rows of the tablet's queue, as `kind clientUuid`, read from the store itself. */
function queued(page: Page): Promise<Array<{ kind?: string; clientUuid: string }> | string> {
  return page.evaluate(
    () =>
      new Promise<Array<{ kind?: string; clientUuid: string }> | string>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve('the store did not open');
        open.onsuccess = () => {
          const all = open.result.transaction('outbox').objectStore('outbox').getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve(all.result as Array<{ kind?: string; clientUuid: string }>);
          };
        };
      }),
  );
}

test('a protest tapped with no network is kept, survives a reload, and is sent once when the network is back', async ({
  page,
}) => {
  const stub = await openProtestBout(page, { online: false });
  await expect(protestChip(page, 'red')).toBeEnabled();
  await expect(protestChip(page, 'red')).toHaveAttribute('data-count', '0');

  await protestChip(page, 'red').click();

  await expect.poll(async () => JSON.stringify(await queued(page))).toContain('"kind":"protest"');
  const rows = await queued(page);
  expect(Array.isArray(rows) && rows.map((row) => row.kind)).toEqual(['protest']);
  const clientUuid = Array.isArray(rows) ? rows[0]?.clientUuid : undefined;
  await expect(protestChip(page, 'red')).toHaveAttribute('data-count', '1');
  await expect(protestChip(page, 'blue')).toHaveAttribute('data-count', '0');
  expect(stub.protests, 'no protest reached the server').toEqual([]);

  // The tablet keeps it: a reload still counts it.
  await page.reload();
  await expect(protestChip(page, 'red')).toHaveAttribute('data-count', '1');

  // A read of the protests answered once the server holds this one.
  const reread = page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' &&
      res.url().endsWith('/protests') &&
      stub.protests.length > 0,
  );
  // The network is back: the browser tells the page.
  stub.savesReach = true;
  await page.evaluate(() => {
    (window as unknown as { padOnline: boolean }).padOnline = true;
    window.dispatchEvent(new Event('online'));
  });

  await expect.poll(() => stub.protests.map((row) => row['client_uuid'])).toEqual([clientUuid]);
  await expect.poll(async () => JSON.stringify(await queued(page))).toBe('[]');
  // The pad read the server's protests again after the server took this one: the chip below
  // is drawn from that read, not left over from the screen before the send.
  await expect.poll(() => stub.protestReads).toBeGreaterThan(stub.readsAtTake);
  await (await reread).finished();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  // Now the server's row: counted once, not once from the server and once from the tablet.
  await expect(protestChip(page, 'red')).toHaveAttribute('data-count', '1');
  expect(stub.protests.map((row) => row['client_uuid'])).toEqual([clientUuid]);
});

test('the protest button is off on a locked bout', async ({ page }) => {
  await openProtestBout(page, { lockedAt: '2026-11-17T10:00:00.000Z' });
  await expect(protestChip(page, 'red')).toBeDisabled();
  await expect(protestChip(page, 'blue')).toBeDisabled();
});

test('the protest button is off on a bout of an Event that is over', async ({ page }) => {
  await openProtestBout(page, { eventOver: true });
  await expect(protestChip(page, 'red')).toBeDisabled();
  await expect(protestChip(page, 'blue')).toBeDisabled();
});
