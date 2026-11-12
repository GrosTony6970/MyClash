import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import ClubFightBookFlagsPage from './page';

let slug = 'club-a';
vi.mock('next/navigation', () => ({ useParams: () => ({ slug }) }));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const fighter = (name: string) => ({ globalPersonId: 'g', name, photoUrl: null, club: null });
const rowA = {
  id: 'fa',
  createdAt: '2026-11-10T09:00:00.000Z',
  reason: 'other',
  text: 'Report of club A.',
  reporter: fighter('Reporter A'),
  flagged: fighter('Flagged A'),
  kind: 'free',
  eventName: null,
  club: null,
  day: '2026-11-08',
  place: 'Hall A',
  weapons: [],
  handled: false,
};
const FORBIDDEN = {
  ok: false,
  kind: 'unauthenticated',
  status: 403,
  detail: 'Forbidden',
  code: null,
  details: null,
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  slug = 'club-a';
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('the club page after a switch to another club', () => {
  it('keeps no row of the first club when the second club refuses the read', async () => {
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (_base, path) => {
      if (path === '/api/v1/organizations/slug/club-a')
        return { ok: true, data: { id: 'orgA' } } as never;
      if (path === '/api/v1/organizations/slug/club-b')
        return { ok: true, data: { id: 'orgB' } } as never;
      if (path === '/api/v1/organizations/orgA/fightbook/flags?page=0')
        return { ok: true, data: { items: [rowA], more: false } } as never;
      if (path === '/api/v1/organizations/orgB/fightbook/flags?page=0') return FORBIDDEN as never;
      throw new Error(`unexpected ${path}`);
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const render = () =>
      act(async () => {
        root!.render(
          <I18nProvider locale="en">
            <ClubFightBookFlagsPage />
          </I18nProvider>,
        );
      });
    await render();
    await settle();
    expect(document.body.textContent).toContain('Report of club A.');

    slug = 'club-b';
    await render();
    await settle();
    expect(document.body.textContent).not.toContain('Report of club A.');
    expect(document.body.textContent).toContain("Only the club's admins can read safety reports");
  });
});
