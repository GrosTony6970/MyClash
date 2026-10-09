import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { API, openArchivedPage, type OpenedPage } from './archived-page.fixtures';
import { TournamentQueryPanel } from './TournamentQueryPanel';

/**
 * The Event page's "ask about a Tournament" panel on an archived Event (ruling
 * 377). A question, its cost estimate and the panel's settings are all sent as
 * saves, and the server refuses a save there. The estimate went out while the
 * organiser typed, with no button pressed.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const READS = {
  '/api/v1/tournaments/t-1/query/history': {
    queries: [
      { question: 'Who leads pool 1?', summary: 'Ana', cost_eur: 0.01, created_at: '2026-10-01' },
    ],
  },
  '/api/v1/tournaments/t-1/query/settings': {
    accessPolicy: 'organizers_only',
    rateLimitPerHour: 60,
  },
};

const panel = (readOnly: boolean) => (
  <TournamentQueryPanel
    apiUrl={API}
    tournaments={[{ id: 't-1', name: 'Longsword' }]}
    readOnly={readOnly}
  />
);

/** Long enough for the estimate's own delay to run out. */
const afterTheEstimateDelay = () => new Promise((resolve) => setTimeout(resolve, 300));

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the Tournament query panel', () => {
  it('sends nothing on an archived Event', async () => {
    page = await openArchivedPage(panel(true), READS);
    expect(document.body.textContent).toContain('Who leads pool 1?');

    await page.pressEverything(1);
    await afterTheEstimateDelay();

    expect(page.writes()).toEqual([]);
  });

  it('is told by the Event page that the Event is archived', () => {
    const eventPage = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

    expect(eventPage).toMatch(/<TournamentQueryPanel[^>]*readOnly=\{isReadOnly\}/);
  });

  it('asks on an Event that is not archived', async () => {
    page = await openArchivedPage(panel(false), READS);

    await page.pressEverything(1);
    await afterTheEstimateDelay();

    expect([...new Set(page.writes())].sort()).toEqual([
      'PATCH /api/v1/tournaments/t-1/query/settings',
      'POST /api/v1/tournaments/t-1/query',
      'POST /api/v1/tournaments/t-1/query/estimate',
    ]);
  });
});
