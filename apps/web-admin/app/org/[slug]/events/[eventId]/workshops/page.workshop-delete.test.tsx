import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * An organiser deletes a Workshop from its form (operator ruling, 2026-11-09): one nobody is
 * booked on. The page asks first. With people booked the server refuses by name, and the page
 * says the way out in the reader's language: remove the session first, which tells them.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/workshops',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('./WorkshopScheduleBoard', () => ({ WorkshopScheduleBoard: () => null }));

const workshop = (id: string, title: string) => ({
  id,
  slug: id,
  title,
  category: null,
  level: null,
  weapon: null,
  language: 'en',
  capacity: 20,
  durationMinutes: 60,
  status: 'published',
  color: null,
  coverImageUrl: null,
  venueId: null,
  venue: null,
  instructors: [],
  sessions: [],
});

const READS = {
  [`/api/v1/events/${EVENT_ID}`]: {
    id: EVENT_ID,
    status: 'running',
    start_date: '2026-05-01',
    end_date: null,
    timezone: 'Europe/Paris',
  },
  [`/api/v1/events/${EVENT_ID}/instructors`]: [],
  '/api/v1/organizations/org-1/venues': [],
  [`/api/v1/events/${EVENT_ID}/workshops`]: [
    workshop('mistake', 'Created by mistake'),
    workshop('booked', 'Saturday longsword'),
  ],
  [`/api/v1/events/${EVENT_ID}/workshop-breaks`]: [],
  '/api/v1/workshops/mistake': { descriptionMd: null },
  '/api/v1/workshops/booked': { descriptionMd: null },
};
const DELETE_MISTAKE = 'DELETE /api/v1/workshops/mistake';
const BOOKED = '/api/v1/workshops/booked';

let page: OpenedPage;
afterEach(() => page.unmount());

const open = async () => {
  page = await openEventPage(<WorkshopsAdminPage />, READS, { [DELETE_MISTAKE]: undefined });
  // People are booked on "Saturday longsword": the server refuses by name.
  const server = vi.mocked(apiRequest).getMockImplementation()!;
  const refused: ApiClient.ApiResult<unknown> = {
    ok: false,
    kind: 'http',
    status: 409,
    detail: 'People are booked on this workshop. Remove its sessions first.',
    code: 'WORKSHOP_HAS_BOOKINGS',
    details: null,
    validationErrors: null,
  };
  vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
    path === BOOKED && init?.method === 'DELETE' ? refused : server(base, path, init),
  );
};
const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')];
const question = () =>
  dialogs()
    .filter((dialog) => dialog.textContent?.includes('Delete "'))
    .pop();
const form = () => dialogs().find((dialog) => dialog.textContent?.includes('Edit workshop'));
const press = async (label: string, within: ParentNode = document.body, nth = 0) => {
  const button = [...within.querySelectorAll('button')].filter((b) => b.textContent === label)[nth];
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
const deletes = () => page.writes().filter((write) => write.startsWith('DELETE'));

describe('deleting a Workshop from its form', () => {
  it('offers no delete on a new Workshop', async () => {
    await open();
    await press('+ New workshop');
    const created = dialogs().find((dialog) => dialog.textContent?.includes('New workshop'));
    expect(created).toBeDefined();
    expect([...created!.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Delete',
    );
  });

  it('asks first, and deletes nothing on no', async () => {
    await open();
    await press('Edit', document.body, 0);
    await press('Delete', form());
    expect(question()?.textContent).toContain('Delete "Created by mistake"?');
    expect(question()?.textContent).toContain('Its photos stay.');
    await press('Cancel', question());
    expect(deletes()).toEqual([]);
    expect(form()).toBeDefined();
  });

  it('deletes it on yes, and closes the form', async () => {
    await open();
    await press('Edit', document.body, 0);
    await press('Delete', form());
    await press('Delete the workshop', question());
    expect(page.writes()).toEqual([DELETE_MISTAKE]);
    expect(form()).toBeUndefined();
  });

  it('says the way out when people are booked, keeping the form open', async () => {
    await open();
    await press('Edit', document.body, 1);
    await press('Delete', form());
    await press('Delete the workshop', question());
    expect(document.body.textContent).toContain(
      'People are booked on this workshop. Remove its sessions from the schedule first',
    );
    expect(document.body.textContent).not.toContain('Remove its session first.');
    expect(form()).toBeDefined();
  });
});
