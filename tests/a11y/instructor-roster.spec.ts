import { expect, test, type Page } from '@playwright/test';
import { collectPageIssues, expectNoCriticalAxeViolations } from './helpers';
import { PUBLIC, signInAsLea } from './me-stub';

/**
 * Quick win M6 (operator, 2026-10-14): an instructor's roster is read again after a failed read.
 * One failure used to be final: every later "View roster" skipped the read, until a page reload.
 */

const SESSION = {
  id: 'ses-1',
  startsAt: '2027-03-13T09:00:00.000Z',
  endsAt: '2027-03-13T10:00:00.000Z',
  status: 'scheduled',
  locationLabel: null,
  venue: null,
  area: null,
  capacity: 12,
  confirmedCount: 1,
  waitlistCount: 1,
};

const WORKSHOPS = {
  events: [
    {
      event: {
        id: 'ev-1',
        slug: 'fal',
        name: 'FAL 2026',
        timezone: 'Europe/Paris',
        startDate: '2027-03-13',
      },
      workshops: [
        {
          id: 'ws-1',
          slug: 'bind-and-wind',
          title: 'Bind and wind',
          shortDescription: null,
          descriptionMd: null,
          category: null,
          weapon: null,
          level: null,
          language: null,
          color: null,
          coverImageUrl: null,
          capacity: 12,
          durationMinutes: 60,
          sessions: [SESSION],
          instructors: [{ globalPersonId: 'gp-1', displayName: 'Léa Martin' }],
        },
      ],
    },
  ],
};

const entry = (id: string, status: string, givenName: string, waitlistPosition: number | null) => ({
  id,
  status,
  waitlistPosition,
  personId: `p-${id}`,
  guest: false,
  persons: { id: `p-${id}`, givenName, familyName: 'Durand', clubs: null },
});
const ROSTER = [entry('e-1', 'confirmed', 'Marc', null), entry('e-2', 'waitlisted', 'Inès', 1)];
const AFTER_ACCEPT = [
  entry('e-1', 'confirmed', 'Marc', null),
  entry('e-2', 'confirmed', 'Inès', null),
];

/** The roster read answers from a script: each read takes the next answer. */
async function openDashboard(page: Page, answers: Array<'fail' | unknown[]>) {
  await signInAsLea(page);
  await page.route('**/api/v1/me/instructor-workshops', (route) =>
    route.fulfill({ json: WORKSHOPS }),
  );
  const reads: number[] = [];
  await page.route('**/api/v1/workshop-sessions/ses-1/roster', (route) => {
    const answer = answers[reads.length] ?? answers[answers.length - 1];
    reads.push(reads.length);
    return answer === 'fail'
      ? route.fulfill({ status: 500, json: { status: 500, detail: 'down' } })
      : route.fulfill({ json: answer });
  });
  await page.route('**/api/v1/workshop-sessions/ses-1/enrollments/*/accept', (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.goto(`${PUBLIC}/me/instructor`);
  return { reads };
}

const viewRoster = (page: Page) => page.getByRole('button', { name: 'View roster' });
const hideRoster = (page: Page) => page.getByRole('button', { name: 'Hide roster' });
const ROSTER_ERROR = 'Could not load the roster.';

test('a failed roster read is tried again when the roster is opened again', async ({ page }) => {
  collectPageIssues(page);
  const { reads } = await openDashboard(page, ['fail', ROSTER]);

  await viewRoster(page).click();
  await expect(page.getByText(ROSTER_ERROR)).toBeVisible();

  await hideRoster(page).click();
  await viewRoster(page).click();
  await expect(page.getByText('Inès Durand')).toBeVisible();
  await expect(page.getByText(ROSTER_ERROR)).toHaveCount(0);
  expect(reads).toHaveLength(2);
  await expectNoCriticalAxeViolations(page);
});

test('a roster read once is not read again on the next open', async ({ page }) => {
  const { reads } = await openDashboard(page, [ROSTER]);
  await viewRoster(page).click();
  await expect(page.getByText('Inès Durand')).toBeVisible();
  await hideRoster(page).click();
  await viewRoster(page).click();
  await expect(page.getByText('Inès Durand')).toBeVisible();
  expect(reads).toHaveLength(1);
});

test('a fast close and open while the read is out sends one read', async ({ page }) => {
  await signInAsLea(page);
  await page.route('**/api/v1/me/instructor-workshops', (route) =>
    route.fulfill({ json: WORKSHOPS }),
  );
  const held: Array<() => Promise<void>> = [];
  await page.route('**/api/v1/workshop-sessions/ses-1/roster', (route) => {
    held.push(() => route.fulfill({ json: ROSTER }));
  });
  await page.goto(`${PUBLIC}/me/instructor`);

  await viewRoster(page).click();
  await expect.poll(() => held.length).toBe(1);
  await hideRoster(page).click();
  await viewRoster(page).click();
  await expect(page.getByText('Loading roster…')).toBeVisible();
  expect(held).toHaveLength(1);

  await held[0]!();
  await expect(page.getByText('Inès Durand')).toBeVisible();
  expect(held).toHaveLength(1);
});

test('an accept whose re-read failed leaves no error once the roster is opened again', async ({
  page,
}) => {
  const { reads } = await openDashboard(page, [ROSTER, 'fail', AFTER_ACCEPT]);
  await viewRoster(page).click();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText(ROSTER_ERROR)).toBeVisible();

  await hideRoster(page).click();
  await viewRoster(page).click();
  await expect(page.getByText(ROSTER_ERROR)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  expect(reads).toHaveLength(3);
});

test('a roster read refused for a login that did not come back goes to sign-in', async ({
  page,
}) => {
  await signInAsLea(page);
  await page.route('**/api/v1/me/instructor-workshops', (route) =>
    route.fulfill({ json: WORKSHOPS }),
  );
  await page.route('**/api/v1/workshop-sessions/ses-1/roster', (route) =>
    route.fulfill({ status: 401, json: { status: 401, detail: 'Sign in' } }),
  );
  await page.goto(`${PUBLIC}/me/instructor`);
  await viewRoster(page).click();
  await expect(page).toHaveURL(`${PUBLIC}/login?next=%2Fme%2Finstructor`);
});
