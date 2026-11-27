/**
 * Marie opens the link Claude gave her: the assistant page opens that one draft and shows it in
 * words (rulings 989, 993; call V). Never an id, never JSON. The draft is older than the newest
 * 50 the page lists, so the page reads it by its id.
 *
 * The API is stubbed: every read the page and the organiser shell make is answered here.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, waitForPageMain } from './helpers';
import { EVENT_ID, ORG_SLUG, eventFixture, meFixture } from '../drag/schedule-grid.fixture';

const ADMIN = 'http://localhost:3003';
const ORG_ID = '77777777-7777-4777-8777-777777777777';
const DRAFT_ID = '0b9c5a52-5f0e-4c43-9d0e-3f1f3f3b1a01';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The draft as the API answers it: its raw actions hold ids, its `readable` holds names. */
const DRAFT = {
  id: DRAFT_ID,
  eventId: EVENT_ID,
  tournamentId: 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5',
  draftType: 'pool_plan',
  prompt: 'Claude proposed: generate_pools',
  summary: null,
  proposedActions: [
    { kind: 'generate_pools', tournamentId: 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5', poolCount: 4 },
  ],
  readable: [
    {
      kind: 'generate_pools',
      tournament: { name: 'Longsword Open' },
      poolCount: 4,
      schoolSeparation: true,
    },
  ],
  validationState: { ok: true, warnings: [], errors: [] },
  status: 'ready',
  applyStarted: false,
  error: null,
};

const READS: Record<string, unknown> = {
  '/api/v1/me': meFixture,
  [`/api/v1/organizations/slug/${ORG_SLUG}`]: { id: ORG_ID, slug: ORG_SLUG, name: 'Test Org' },
  [`/api/v1/organizations/${ORG_ID}/events`]: [eventFixture],
  [`/api/v1/organizations/${ORG_ID}/ai-settings`]: { provider: 'anthropic' },
  [`/api/v1/events/${EVENT_ID}`]: eventFixture,
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [],
  [`/api/v1/events/${EVENT_ID}/ai-assistant/drafts`]: [],
  [`/api/v1/events/${EVENT_ID}/ai-assistant/drafts/${DRAFT_ID}`]: DRAFT,
  '/api/v1/public/feature-flags': {
    maintenanceBanner: { enabled: false, message: null, severity: null },
    realtimeDisabled: false,
    timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null, mode: null },
    serverNowIso: new Date().toISOString(),
  },
};

const DRAFT_PATH = `/api/v1/events/${EVENT_ID}/ai-assistant/drafts/${DRAFT_ID}`;

/** The draft's own read answers `draft`: a draft, or a refusal with its status. */
async function openDraftLink(page: Page, draft: { status: number; json: unknown }) {
  // Anything else the shell asks for answers an empty list, as the schedule board's specs do:
  // an unanswered read stalls the page.
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === DRAFT_PATH) return route.fulfill(draft);
    return route.fulfill({ json: path in READS ? READS[path] : [] });
  });
  await page.goto(`${ADMIN}/org/${ORG_SLUG}/events/${EVENT_ID}/ai-assistant?draft=${DRAFT_ID}`);
  await waitForPageMain(page);
}

test('a draft opened from its link reads in words, axe clean, with no id on the page', async ({
  page,
}) => {
  await openDraftLink(page, { status: 200, json: DRAFT });

  await expect(page.getByText('Make 4 Pools in Longsword Open — clubs kept apart')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await expectNoCriticalAxeViolations(page);
  expect(await page.locator('body').innerText()).not.toMatch(UUID);
});

test('a link to no draft at this Event says so aloud, axe clean, with no id', async ({ page }) => {
  await openDraftLink(page, {
    status: 404,
    json: { code: 'not_found', detail: `AI assistant draft ${DRAFT_ID} not found` },
  });

  // In `main`: Next's own route announcer is an alert too.
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'This draft is not at this Event.',
  );
  await expectNoCriticalAxeViolations(page);
  expect(await page.locator('body').innerText()).not.toMatch(UUID);
});

test('a partly applied draft says so, axe clean, with no Apply or Reject', async ({ page }) => {
  await openDraftLink(page, {
    status: 200,
    json: { ...DRAFT, status: 'failed', applyStarted: true },
  });

  await expect(page.getByText('Partly applied before it failed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
});
