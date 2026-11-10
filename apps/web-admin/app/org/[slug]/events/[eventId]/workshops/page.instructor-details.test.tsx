import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * Slice 2.6b (rulings 556, 558, 561, 563, 564). Paul teaches "Saturday longsword". Marie is an
 * instructor of the Event, not of this Workshop. Since this page loaded, Paul wrote his own bio
 * for the Workshop from his personal page: the list on this page does not know it.
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

const DETAILS = '/api/v1/workshops/w-1/instructors/gp-paul/details';
const paul = (hasDetails: boolean) => ({
  globalPersonId: 'gp-paul',
  displayName: 'Paul',
  hasDetails,
});

const reads = (paulHasDetailsNow: boolean) => ({
  [`/api/v1/events/${EVENT_ID}`]: {
    id: EVENT_ID,
    status: 'running',
    start_date: '2026-05-02',
    end_date: '2026-05-03',
    timezone: 'Europe/Paris',
  },
  [`/api/v1/events/${EVENT_ID}/instructors`]: [
    { personId: 'gp-paul', displayName: 'Paul' },
    { personId: 'gp-marie', displayName: 'Marie' },
  ],
  '/api/v1/organizations/org-1/venues': [],
  [`/api/v1/events/${EVENT_ID}/workshops`]: [
    {
      id: 'w-1',
      slug: 'w-1',
      title: 'Saturday longsword',
      shortDescription: null,
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
      // As this page loaded it: nothing written for Paul yet.
      instructors: [paul(false)],
      sessions: [],
    },
  ],
  [`/api/v1/events/${EVENT_ID}/workshop-breaks`]: [],
  // The Workshop as the server holds it now.
  '/api/v1/workshops/w-1': { descriptionMd: null, instructors: [paul(paulHasDetailsNow)] },
  [DETAILS]: {
    override: { bio: null, club: 'Salle Lyon, Thursday group', photoUrl: null },
    profile: { bio: 'Fiore since 2010', club: 'Salle Lyon', photoUrl: null },
  },
});

let page: OpenedPage;
afterEach(() => page.unmount());

const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')];
const dialogSaying = (text: string) =>
  dialogs()
    .filter((dialog) => dialog.textContent?.includes(text))
    .pop();
const question = () => dialogSaying('Delete what this workshop says about them?');
const form = () => dialogSaying('Edit workshop');
const panel = () => dialogSaying('Paul in this workshop');
const buttons = (label: string, within: ParentNode = document.body) =>
  [...within.querySelectorAll('button')].filter((b) => b.textContent === label);
const press = async (label: string, within: ParentNode = document.body) => {
  const [button] = buttons(label, within);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
const tick = async (name: string) => {
  const label = [...form()!.querySelectorAll('label')].find((l) => l.textContent === name)!;
  await act(async () => label.querySelector('input')!.click());
  await page.settle();
};
const bodyOf = (method: string, path: string) =>
  vi.mocked(apiRequest).mock.calls.find(([, p, init]) => p === path && init?.method === method)?.[2]
    ?.body;

describe("a saved instructor's details for this Workshop (564)", () => {
  it('opens from a button by an instructor saved on the Workshop, and by no other', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, reads(false));
    await press('Edit');
    expect(buttons('Details for this workshop', form())).toHaveLength(1);

    // Ticked but not saved yet: no line to write on.
    await tick('Marie');
    expect(buttons('Details for this workshop', form())).toHaveLength(1);
    // Unticked: the line is about to go.
    await tick('Paul');
    expect(buttons('Details for this workshop', form())).toHaveLength(0);
  });

  it('shows the profile in grey and sends only the box the organiser changed (563, 558)', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, reads(false), { [`PATCH ${DETAILS}`]: {} });
    await press('Edit');
    await press('Details for this workshop', form());

    const bio = panel()!.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(bio.value).toBe('');
    expect(bio.placeholder).toBe('Fiore since 2010');
    await act(async () => type(bio, ' Ten years of Fiore '));
    await press('Save', panel());

    expect(page.writes()).toEqual([`PATCH ${DETAILS}`]);
    expect(bodyOf('PATCH', DETAILS)).toEqual({ bio: 'Ten years of Fiore' });
  });
});

describe('a Save that unticks an instructor (561)', () => {
  it('asks first when the Workshop says something of its own about him, though the list said nothing', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, reads(true), {
      'PATCH /api/v1/workshops/w-1': {},
    });
    await press('Edit');
    await tick('Paul');
    await press('Save', form());

    expect(question()?.textContent).toContain('Paul');
    expect(page.writes()).toEqual([]);
  });

  it('sends nothing at all on no, the Workshop itself included', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, reads(true), {
      'PATCH /api/v1/workshops/w-1': {},
    });
    await press('Edit');
    await tick('Paul');
    await press('Save', form());
    await press('Cancel', question());

    expect(question()).toBeUndefined();
    expect(page.writes()).toEqual([]);
    expect(form()).toBeDefined();
  });

  it('asks nothing when his line holds nothing', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, reads(false), {
      'PATCH /api/v1/workshops/w-1': {},
      'DELETE /api/v1/workshops/w-1/instructors/gp-paul': {},
    });
    await press('Edit');
    await tick('Paul');
    await press('Save', form());

    expect(question()).toBeUndefined();
    expect(page.writes()).toEqual([
      'PATCH /api/v1/workshops/w-1',
      'DELETE /api/v1/workshops/w-1/instructors/gp-paul',
    ]);
  });

  it('keeps the form open and says why when the server refuses the untick', async () => {
    // The DELETE is not among the saves the stand-in takes: it is refused.
    page = await openEventPage(<WorkshopsAdminPage />, reads(true), {
      'PATCH /api/v1/workshops/w-1': {},
    });
    await press('Edit');
    await tick('Paul');
    await press('Save', form());
    await press('Untick and delete', question());

    expect(page.writes()).toEqual([
      'PATCH /api/v1/workshops/w-1',
      'DELETE /api/v1/workshops/w-1/instructors/gp-paul',
    ]);
    expect(form()?.textContent).toContain('This event is archived and read-only.');
  });
});
