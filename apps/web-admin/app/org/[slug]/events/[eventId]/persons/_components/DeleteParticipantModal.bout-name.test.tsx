import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { API, EVENT_ID, openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { DeleteParticipantModal } from './DeleteParticipantModal';

/**
 * A bout with no number (one made by hand) was named in this window by its database id.
 * Ruled 2026-10-15: its Tournament and its round, "Longsword Open · Bracket".
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/persons',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const BY_HAND = 'a3f9c2d1-0000-4000-8000-000000000001';
const round = { roundToken: null, poolName: null, phaseType: 'single_elim' };
const bout = {
  matchId: BY_HAND,
  label: '',
  status: 'running',
  tournamentId: 't-1',
  tournamentName: 'Longsword Open',
  ...round,
};
const REPORT = {
  personId: 'p-1',
  pools: [],
  bracketSlots: [],
  matchesAsFighter: [bout],
  matchesAsReferee: [{ ...bout, matchId: 'b-2', status: 'scheduled', roundToken: 'QF' }],
  blockingMatches: [{ ...bout, reason: 'fighter' }],
  hasBlockingMatch: true,
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('a bout with no number in the remove-a-fighter window', () => {
  it('is named by its Tournament and its round, never by its id', async () => {
    page = await openEventPage(
      <DeleteParticipantModal
        apiUrl={API}
        eventId={EVENT_ID}
        persons={[{ id: 'p-1', displayName: 'Léa Martin' }]}
        tournamentId={null}
        registrationsInScope={[]}
        onClose={() => undefined}
        onDeleted={() => undefined}
      />,
      { [`/api/v1/events/${EVENT_ID}/persons/p-1/assignments`]: REPORT },
    );

    const text = document.body.textContent ?? '';
    expect(text).not.toContain(BY_HAND);
    expect(text).toContain('Longsword Open · Bracket');
    expect(text).toContain('Longsword Open · Quarter Final');
  });
});
