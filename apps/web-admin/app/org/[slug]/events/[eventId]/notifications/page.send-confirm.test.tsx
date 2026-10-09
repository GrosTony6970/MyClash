import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import EventNotificationsPage from './page';

/**
 * A broadcast reaches every phone of its audience and cannot be taken back. One
 * click on Send sends nothing: the page first says to whom the message goes and
 * as what (quick win O3).
 */
/** The page's query: a Tournament's page opens this one with a message ready. */
const ADDRESS = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/notifications',
  useSearchParams: () => ADDRESS.search,
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

const person = (id: string, givenName: string) => ({
  id,
  givenName,
  familyName: 'Roux',
  email: `${id}@example.org`,
  clubLabel: null,
});
const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  [`/api/v1/events/${EVENT_ID}/persons`]: [person('p-1', 'Ana'), person('p-2', 'Tom')],
  [`/api/v1/events/${EVENT_ID}/notifications/broadcasts`]: [],
};
const SEND = `POST /api/v1/events/${EVENT_ID}/notifications/broadcast`;

let page: OpenedPage;
afterEach(() => {
  page.unmount();
  ADDRESS.search = new URLSearchParams();
});

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const titleField = () => document.body.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
const press = async (label: string, within: ParentNode = document.body) => {
  const button = [...within.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
/** Opens the page and writes a message, ready to send. */
const openWithMessage = async () => {
  page = await openEventPage(<EventNotificationsPage />, READS, {
    [SEND]: { recipientCount: 2 },
  });
  await act(async () => {
    type(titleField(), 'Lunch');
    type(document.body.querySelector('textarea')!, 'Back at 14:00.');
  });
};
const sentBody = () =>
  vi.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === 'POST')?.[2]?.body;

describe('Send on the broadcast page', () => {
  it('sends nothing on one click: it asks, naming the message, the audience and the type', async () => {
    await openWithMessage();
    await press('Alert');
    await press('Send notification');
    expect(page.writes()).toEqual([]);
    expect(dialog()?.textContent).toContain('Send "Lunch"?');
    expect(dialog()?.textContent).toContain('Recipients: Everyone at event.');
    expect(dialog()?.textContent).toContain('Type: Alert.');
  });

  it('sends nothing on no, and keeps what was typed', async () => {
    await openWithMessage();
    await press('Send notification');
    await press('Cancel', dialog()!);
    expect(dialog()).toBeNull();
    expect(page.writes()).toEqual([]);
    expect(titleField().value).toBe('Lunch');
  });

  it('sends the message on yes', async () => {
    await openWithMessage();
    await press('Send notification');
    await press('Send notification', dialog()!);
    expect(page.writes()).toEqual([SEND]);
    expect(sentBody()).toEqual({
      targetType: 'all',
      severity: 'info',
      title: 'Lunch',
      body: 'Back at 14:00.',
      tournamentId: undefined,
      personIds: undefined,
    });
  });

  it('counts the people picked by hand', async () => {
    await openWithMessage();
    await press('Specific people');
    const boxes = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => boxes[1]!.click());
    await press('Send notification');
    expect(dialog()?.textContent).toContain('Recipients: Selected people: 1.');
    expect(page.writes()).toEqual([]);
  });

  it('says so when the page was opened from a Tournament, which narrows the audience', async () => {
    ADDRESS.search = new URLSearchParams({ targetType: 'fighters', tournamentId: 't-1' });
    await openWithMessage();
    await press('Send notification');
    expect(dialog()?.textContent).toContain('Recipients: Fighters only, of one tournament only.');
  });

  it('does not say so for everyone: the server ignores the Tournament there', async () => {
    ADDRESS.search = new URLSearchParams({ targetType: 'all', tournamentId: 't-1' });
    await openWithMessage();
    await press('Send notification');
    expect(dialog()?.textContent).toContain('Recipients: Everyone at event. Type');
  });
});
