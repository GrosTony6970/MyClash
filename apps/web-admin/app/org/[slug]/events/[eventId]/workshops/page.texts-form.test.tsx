import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * Ruling 557: the organiser writes a Workshop's catalogue line and its prerequisites in the
 * Workshop form. "Saturday longsword" has the line "Your first steps"; the organiser empties it
 * and writes "Bring a mask" as its prerequisites.
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

const READS = {
  [`/api/v1/events/${EVENT_ID}`]: {
    id: EVENT_ID,
    status: 'running',
    start_date: '2026-05-02',
    end_date: '2026-05-03',
    timezone: 'Europe/Paris',
  },
  [`/api/v1/events/${EVENT_ID}/instructors`]: [],
  '/api/v1/organizations/org-1/venues': [],
  [`/api/v1/events/${EVENT_ID}/workshops`]: [
    {
      id: 'w-1',
      slug: 'w-1',
      title: 'Saturday longsword',
      shortDescription: 'Your first steps',
      prerequisites: null,
      category: null,
      level: null,
      weapon: null,
      language: 'en',
      capacity: 12,
      durationMinutes: 60,
      status: 'published',
      color: null,
      coverImageUrl: null,
      venueId: null,
      venue: null,
      instructors: [],
      sessions: [],
    },
  ],
  [`/api/v1/events/${EVENT_ID}/workshop-breaks`]: [],
  '/api/v1/workshops/w-1': { descriptionMd: null },
};

let page: OpenedPage;
afterEach(() => page.unmount());

const press = async (label: string) => {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
const field = (id: string) =>
  document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[role="dialog"] #${id}`)!;
const patchBody = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.find(
      ([, p, init]) => p === '/api/v1/workshops/w-1' && init?.method === 'PATCH',
    )?.[2]?.body;

describe("the Workshop form's two short texts", () => {
  it('shows the stored ones, and saves a written one and an emptied one (null clears it)', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, READS, {
      'PATCH /api/v1/workshops/w-1': {},
    });
    await press('Edit');

    expect(field('workshop-short-description').value).toBe('Your first steps');
    expect(field('workshop-prerequisites').value).toBe('');

    await act(async () => type(field('workshop-short-description'), ''));
    await act(async () => type(field('workshop-prerequisites'), '  Bring a mask '));
    await press('Save');

    expect(patchBody()).toMatchObject({ shortDescription: null, prerequisites: 'Bring a mask' });
  });

  it("sends neither when neither was touched, so the instructor's newer text is kept", async () => {
    page = await openEventPage(<WorkshopsAdminPage />, READS, {
      'PATCH /api/v1/workshops/w-1': {},
    });
    await press('Edit');
    await press('Save');

    expect(patchBody()).toMatchObject({ title: 'Saturday longsword' });
    expect(patchBody()).not.toHaveProperty('shortDescription');
    expect(patchBody()).not.toHaveProperty('prerequisites');
  });

  it('sends both on a new Workshop', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, READS, {
      [`POST /api/v1/events/${EVENT_ID}/workshops`]: { id: 'w-new' },
    });
    await press('+ New workshop');
    const title = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="text"]',
    )!;
    await act(async () => type(title, 'Dagger intro'));
    await act(async () => type(field('workshop-short-description'), 'Daggers, gently'));
    await act(async () => type(field('workshop-prerequisites'), 'Gloves'));
    await press('Create');

    const body = vi
      .mocked(apiRequest)
      .mock.calls.find(
        ([, p, init]) => p === `/api/v1/events/${EVENT_ID}/workshops` && init?.method === 'POST',
      )?.[2]?.body;
    expect(body).toMatchObject({ shortDescription: 'Daggers, gently', prerequisites: 'Gloves' });
  });
});
