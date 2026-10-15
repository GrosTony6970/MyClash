import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { createTranslator, getMessages } from '@myclash/i18n';
import { statusLabel } from '@myclash/ui';
import { EVENT_ID, openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { AttachToLeaguePanel } from './AttachToLeaguePanel';

/**
 * A refused league request and a sent one were one grey line (quick win O4,
 * the same fault as the broadcast page): the organiser could not tell whether
 * the league was asked.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/tournaments',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  '/api/v1/leagues/attachable': [{ id: 'lg-1', name: 'Lyon Cup' }],
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [{ id: 't-1', name: 'Longsword' }],
  [`/api/v1/events/${EVENT_ID}/league-attachments`]: [],
  '/api/v1/leagues/lg-1/groups': [],
};
const REQUEST = 'POST /api/v1/admin/leagues/lg-1/tournaments/t-1/request';

let page: OpenedPage;
afterEach(() => page.unmount());

const press = async (label: string) => {
  const button = [...document.body.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith(label),
  );
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
const alertLine = () => document.body.querySelector('section [role="alert"]');
const statusLine = () => document.body.querySelector('section [role="status"]');

async function openAndRequest(taken: Record<string, unknown>) {
  page = await openEventPage(<AttachToLeaguePanel eventId={EVENT_ID} />, READS, taken);
  await press('Request league attachment');
  await press('Submit request');
}

describe('the league request outcome', () => {
  it('a refused request is an alert, not a status', async () => {
    await openAndRequest({});
    expect(page.writes()).toEqual([REQUEST]);
    expect(alertLine()?.textContent).toBeTruthy();
    expect(statusLine()).toBeNull();
  });

  it('a request that lands is a status, and no alert stays', async () => {
    await openAndRequest({ [REQUEST]: {} });
    expect(statusLine()?.textContent).toBe('Request sent.');
    expect(alertLine()).toBeNull();
  });
});

describe('the league request word', () => {
  it('a request not yet answered says the word the league admin reads', async () => {
    const asked = { id: 'l-1', tournament_id: 't-1', league_id: 'lg-1', status: 'requested' };
    page = await openEventPage(<AttachToLeaguePanel eventId={EVENT_ID} />, {
      ...READS,
      [`/api/v1/events/${EVENT_ID}/league-attachments`]: [asked],
    });
    await press('Request league attachment');
    const adminWord = statusLabel(
      'leagueAttachment',
      'requested',
      createTranslator(getMessages('en')),
    );
    const pill = [...document.body.querySelectorAll('section li span')].find(
      (span) => span.textContent === adminWord,
    );
    expect(pill).toBeDefined();
  });
});
