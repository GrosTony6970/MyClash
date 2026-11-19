import { rmSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { runContext } from '../e2e/_context';
import type { Api } from '../e2e/_api';
import type { Person } from '../e2e/_bracket';
import { shootAround } from './_around';

/**
 * The guide's "More than a tournament" screenshots
 * (docs/superpowers/archive/specs/2026-11-19-guide-beyond-the-tournament-design.md): a workshop's list,
 * form and roster; the compensation report and plan; the club's Leagues page.
 *
 * Runs on the caller's test Event once its bouts are fought, so the compensation report has
 * referees with completed bouts. Writes only to that Event: a workshop, its sessions and bookings,
 * an instructor tag and the compensation settings, all gone with the Event's hard delete. It adds
 * no AI key and joins no league.
 *
 * Split out of screenshots.spec.ts for the 400-line file budget (quality:complexity).
 */
export async function shootBeyond(
  page: Page,
  api: Api,
  o: { eventId: string; people: Person[]; out: string },
): Promise<void> {
  const org = `/org/${runContext().orgSlug}`;
  const at = `${org}/events/${o.eventId}`;
  await makeWorkshop(api, o.eventId, o.people);
  await shootWorkshops(page, at, o.out);
  await shootCompensation(page, api, o.eventId, at, o.out);

  // The club's Leagues page, read only. No AI settings shot: the deploy seeds an AI key into the
  // E2E club, and that page lists its keys with their spend.
  await page.goto(`${org}/leagues`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Discover & join' })).toBeVisible();
  await shootClean(page, `${o.out}/24-leagues.png`);
  // Part 5 ("Before and after"), from here: the spec file is at its 400-line budget.
  await shootAround(page, api, o.eventId, o.out);
}

/** One instructor, two sessions on day 2, four bookings for three places, then published. */
async function makeWorkshop(api: Api, eventId: string, people: Person[]): Promise<void> {
  const [instructor, ...attendees] = people as Array<Person & { globalPersonId?: string | null }>;
  expect(instructor?.globalPersonId, 'the instructor needs a MyClash profile').toBeTruthy();
  await api.ok(await api.post(`events/${eventId}/instructors/${instructor!.id}`));
  const workshop = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/workshops`, {
      data: {
        slug: `cutting-basics-${Date.now().toString(36)}`,
        title: 'Cutting basics',
        shortDescription: 'The four main cuts, slowly, then at speed.',
        capacity: 3,
        durationMinutes: 90,
        status: 'draft',
      },
    }),
  );
  // Both on day 2: the pools fill day 1, and every invented person fights or referees there.
  const sessions: Array<{ id: string }> = [];
  for (const [start, end] of [
    ['09:00', '10:30'],
    ['14:00', '15:30'],
  ]) {
    const data = {
      startTime: `2099-05-03T${start}:00.000Z`,
      endTime: `2099-05-03T${end}:00.000Z`,
      location: 'Small hall',
    };
    sessions.push(
      await api.json<{ id: string }>(await api.post(`workshops/${workshop.id}/sessions`, { data })),
    );
  }
  await api.ok(
    await api.post(`workshops/${workshop.id}/instructors`, {
      data: { globalPersonId: instructor!.globalPersonId },
    }),
  );
  // One at a time: the fourth goes on the waitlist, so the roster shows both lists.
  for (const person of attendees.slice(0, 4)) {
    await api.ok(await api.post(`workshop-sessions/${sessions[0]!.id}/enrollments/${person.id}`));
  }
  await api.ok(await api.patch(`workshops/${workshop.id}`, { data: { status: 'published' } }));
}

/**
 * The Workshops page: the list, then the form and a session's roster, each shot as its own
 * window once it has faded in and loaded. No schedule shot: its grid needs a workshop venue,
 * which belongs to the club and would outlive the Event.
 */
async function shootWorkshops(page: Page, at: string, out: string): Promise<void> {
  await page.goto(`${at}/workshops`, { waitUntil: 'domcontentloaded' });
  const row = page.getByRole('row', { name: /Cutting basics/u });
  await expect(row).toBeVisible();
  await shootClean(page, `${out}/23-workshops.png`);

  const dialog = page.getByRole('dialog');
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByRole('textbox').first()).toHaveValue('Cutting basics');
  await settleAnimations(page);
  await shootClean(page, `${out}/23-workshop-form.png`, dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await row
    .getByRole('button', { name: /^Roster/u })
    .first()
    .click();
  await expect(dialog.getByText('Session roster')).toBeVisible();
  await expect(dialog.getByText(/Loading/u)).toHaveCount(0);
  await settleAnimations(page);
  await shootClean(page, `${out}/23-workshop-roster.png`, dialog);
  await page.keyboard.press('Escape');
}

/** A window fades in: shoot it once no CSS animation or transition is still running. */
async function settleAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
}

/** The built-in FFAMHE plan on this Event, then its report and the plan page. */
async function shootCompensation(
  page: Page,
  api: Api,
  eventId: string,
  at: string,
  out: string,
): Promise<void> {
  const plans = await api.json<Array<{ id: string; name: string; builtIn: boolean }>>(
    await api.get('compensation-plans'),
  );
  const ffamhe = plans.find((plan) => plan.builtIn && plan.name === 'FFAMHE');
  expect(ffamhe, 'the built-in FFAMHE plan is missing').toBeTruthy();
  await api.ok(
    await api.put(`events/${eventId}/compensation/settings`, {
      data: { planId: ffamhe!.id, minCompensationAmount: null, maxCompensationAmount: null },
    }),
  );
  await page.goto(`${at}/compensation`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Total to pay').first()).toBeVisible();
  await shootClean(page, `${out}/25-compensation-report.png`);
  await page.goto(`${at}/compensation/plan`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Built-in plans').first()).toBeVisible();
  await shootClean(page, `${out}/25-compensation-plan.png`);
}

/**
 * Settle, then shoot, once the page shows no person's picture and no email but the E2E
 * account's (hard rule 7). The sidebar holds the E2E club's logo, which the guide may show
 * (operator ruling), so only the page body and an open dialog are checked for images.
 *
 * The check runs again after the shot: a late render between the check and the shot would
 * otherwise reach the picture. A failed second check deletes the file before it stops the run.
 */
export async function shootClean(page: Page, path: string, only?: Locator): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await expectNothingPrivate(page);
  await (only ?? page).screenshot({ path });
  await expectNothingPrivate(page).catch((err: unknown) => {
    rmSync(path, { force: true });
    throw err;
  });
}

async function expectNothingPrivate(page: Page): Promise<void> {
  expect(
    await page.locator('main img, [role="dialog"] img').count(),
    'an image is on screen; it may show a real person, so this screenshot is not taken',
  ).toBe(0);
  const e2eEmail = (process.env.E2E_ADMIN_EMAIL ?? '').toLowerCase();
  const emails = (await page.locator('body').innerText()).match(/[\w.+-]+@[\w-]+\.[\w.]+/gu) ?? [];
  expect(
    emails.filter((email) => email.toLowerCase() !== e2eEmail),
    'an email other than the E2E account is on screen',
  ).toEqual([]);
}
