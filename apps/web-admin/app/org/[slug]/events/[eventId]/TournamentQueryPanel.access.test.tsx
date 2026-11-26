import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { API, openArchivedPage, type OpenedPage } from './archived-page.fixtures';
import { TournamentQueryPanel } from './TournamentQueryPanel';

/**
 * The panel's "who can use queries" select (ruling 988): the coaches setting is gone, so the
 * organiser picks between three. The Event referees' label says what the setting does (ruling 987).
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const READS = {
  '/api/v1/tournaments/t-1/query/history': { queries: [] },
  '/api/v1/tournaments/t-1/query/settings': {
    accessPolicy: 'organizers_head_judges',
    rateLimitPerHour: 60,
  },
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the Tournament query panel access select', () => {
  it('lists exactly three settings, with no coaches', async () => {
    page = await openArchivedPage(
      <TournamentQueryPanel
        apiUrl={API}
        tournaments={[{ id: 't-1', name: 'Longsword' }]}
        readOnly={false}
      />,
      READS,
    );

    const select = document.body.querySelector<HTMLSelectElement>('#queryAccessPolicy');
    expect(select).not.toBeNull();
    expect([...select!.options].map((option) => option.value)).toEqual([
      'organizers_only',
      'organizers_head_judges',
      'anyone_with_tournament_access',
    ]);
    expect(select!.value).toBe('organizers_head_judges');
  });
});
