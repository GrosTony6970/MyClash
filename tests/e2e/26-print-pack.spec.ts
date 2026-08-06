import { test, expect, type APIResponse } from '@playwright/test';
import { runContext } from './_context';

/**
 * The print pack, RENDERED.
 *
 * `print-pack.test.ts` covers the builders as pure functions; nothing there
 * proves the route mounts, that its four fetches resolve against a real API, or
 * that the print document it hands `window.open` is the one the builders were
 * unit-tested on. Those are exactly the failures a paper fallback cannot have —
 * it is picked up on the morning of an event, by which point nobody is
 * debugging a blank page.
 *
 * Pop-ups: the page calls `window.open(...).print()`. Playwright would either
 * block the window or hang on the print dialog, so the document is captured by
 * stubbing `window.open` and `print` before the click, and asserted as a
 * string. That still exercises the real fetches, the real mapping and the real
 * builders — only the browser's print plumbing is replaced.
 */

const api = (p: string) => `/api/v1/${p}`;

async function ok(res: APIResponse, label: string): Promise<APIResponse> {
  if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text()}`);
  return res;
}

test('print pack renders and builds a document from real tournament data', async ({
  page,
  request,
}) => {
  const { orgSlug, eventId } = runContext();

  // Minimum viable tournament: a piste, four fighters, a pool phase. Event
  // scoped, so global-teardown's event delete takes it with everything else.
  const liceRes = await ok(
    await request.post(api(`events/${eventId}/lices`), { data: { name: 'E2E Print Piste' } }),
    'create lice',
  );
  const liceId = ((await liceRes.json()) as { id: string }).id;

  const personIds: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await ok(
      await request.post(api(`events/${eventId}/persons`), {
        data: { givenName: `E2ePrint${i}`, familyName: 'Testrunner' },
      }),
      `create person ${i}`,
    );
    personIds.push(((await res.json()) as { id: string }).id);
  }

  const tournamentRes = await ok(
    await request.post(api(`events/${eventId}/tournaments`), {
      data: { name: 'E2E Print Cup', slug: `e2e-print-${Date.now().toString(36)}` },
    }),
    'create tournament',
  );
  const tournamentId = ((await tournamentRes.json()) as { id: string }).id;

  for (const personId of personIds) {
    await ok(
      await request.post(api(`tournaments/${tournamentId}/registrations`), { data: { personId } }),
      'register',
    );
  }
  await ok(
    await request.post(api(`tournaments/${tournamentId}/generate-pools`), {
      data: { poolCount: 1 },
    }),
    'generate pools',
  );

  // The piste sheet groups on `matches.lice_id`, which pool generation leaves
  // null — creating the lice is not what puts bouts on it. This is the endpoint
  // the organiser's own "assign a piste to this pool" control uses, and it
  // stamps every match in the pool, which is what the sheet reads back.
  const poolRows = (await (
    await ok(await request.get(api(`tournaments/${tournamentId}/pools-with-matches`)), 'read pools')
  ).json()) as Array<{ poolId?: string; id?: string; pool_id?: string }>;
  const poolId = poolRows[0]?.poolId ?? poolRows[0]?.id ?? poolRows[0]?.pool_id;
  await ok(
    await request.put(api(`pools/${poolId}/lice`), { data: { liceId } }),
    'assign pool to lice',
  );

  await page.goto(`/org/${orgSlug}/events/${eventId}/print`);

  // Capture the document instead of opening a real print window.
  await page.evaluate(() => {
    (window as unknown as { __printed?: string }).__printed = undefined;
    window.open = () =>
      ({
        document: {
          write: (html: string) => {
            (window as unknown as { __printed?: string }).__printed = html;
          },
          close: () => {},
        },
        focus: () => {},
        print: () => {},
      }) as unknown as Window;
  });

  // The page defaults to the FIRST tournament the event returns, which in a full
  // suite run is whatever `02` left behind — a wizard draft with no pools, so the
  // button is (correctly) disabled and every assertion below would be about the
  // wrong tournament. Pick this spec's own. The picker only renders when the
  // event holds more than one, so a solo run has nothing to choose.
  //
  // While either fetch is in flight the button is labelled "loading", so this
  // locator resolving at all IS the settle signal — before the select and again
  // after it, once the per-tournament refetch has landed.
  const printButton = page.getByRole('button', { name: /print|imprimer/i });
  await expect(printButton).toBeVisible({ timeout: 15_000 });
  const tournamentPicker = page.locator('main select');
  if ((await tournamentPicker.count()) > 0) {
    await tournamentPicker.selectOption({ label: 'E2E Print Cup' });
  }

  await expect(printButton).toBeEnabled({ timeout: 15_000 });
  await printButton.click();

  const html = await page.evaluate(
    () => (window as unknown as { __printed?: string }).__printed ?? '',
  );

  expect(html).toContain('<!doctype html>');
  // One sheet per pool, plus one per piste. A round-robin of four gives six
  // bouts on one pool sheet — the assertion is that a sheet exists at all,
  // not how many, so adding a section later does not make this brittle.
  expect(html).toContain('class="sheet"');
  expect(html).toContain('E2E Print Cup');
  expect(html).toContain('E2ePrint0');
  // The piste the bouts were placed on has to reach the paper.
  expect(html).toContain('E2E Print Piste');
  // No raw ids on a sheet handed to a human.
  expect(html).not.toContain(tournamentId);
});
