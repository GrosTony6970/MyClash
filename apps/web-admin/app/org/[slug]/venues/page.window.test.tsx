import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type, type OpenedPage } from '../events/[eventId]/archived-page.fixtures';
import OrgVenuesPage from './page';

/**
 * O25 (ruled 2026-10-14): removing a venue area asks first and names the pistes and sessions it
 * leaves without an area; removing a piste does not ask. A refusal shows in the venue window.
 * Enter adds. Removal was instant, and a refusal silent.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/venues',
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

const VENUE = {
  id: 'v-1',
  organization_id: 'org-1',
  name: 'Gymnase',
  address: null,
  hosts_tournament: true,
  hosts_workshop: true,
  sort_order: 0,
  venue_lices: [{ id: 'vl-1', name: 'Piste 1', sort_order: 0 }],
  venue_areas: [
    {
      id: 'a-1',
      name: 'Hall A',
      sort_order: 0,
      leaves: {
        pistes: [{ name: 'Piste 3', event: 'Open 2027' }],
        sessions: [{ title: 'Dague', startsAt: '2027-05-01T09:00:00Z', event: 'Open 2027' }],
      },
    },
  ],
  events: [],
};
const READS = { '/api/v1/organizations/org-1/venues': [VENUE] };
const DROP_AREA = 'DELETE /api/v1/venue-areas/a-1';
const DROP_PISTE = 'DELETE /api/v1/venue-lices/vl-1';
const ADD_PISTE = 'POST /api/v1/venues/v-1/lices';

let page: OpenedPage;
afterEach(() => page.unmount());

const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')];
const buttonIn = (within: ParentNode, label: string) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
async function tap(target: HTMLElement) {
  await act(async () => target.click());
  await page.settle();
}
async function openWindow(taken: Record<string, unknown> = {}) {
  page = await openEventPage(<OrgVenuesPage />, READS, taken);
  await tap(buttonIn(document.body, 'Edit'));
}
/** The Remove button on the row that names `item`. */
const removeOf = (item: string) =>
  [...dialogs()[0]!.querySelectorAll('li')]
    .find((li) => li.textContent?.includes(item))!
    .querySelector('button')!;

describe('the venue window', () => {
  it('asks before an area goes, naming the piste and the session it holds', async () => {
    await openWindow({ [DROP_AREA]: {} });
    await tap(removeOf('Hall A'));
    const question = dialogs()[1]!;
    expect(question.textContent).toContain('Remove the area "Hall A"?');
    expect(question.textContent).toContain('Piste Piste 3 (Open 2027)');
    expect(question.textContent).toContain('Workshop Dague (Open 2027)');
    expect(page.writes()).toEqual([]);

    await tap(buttonIn(question, 'Remove'));
    expect(page.writes()).toEqual([DROP_AREA]);
    expect(dialogs()[0]!.textContent).not.toContain('Hall A');
  });

  it('keeps the area when the question is answered no', async () => {
    await openWindow({ [DROP_AREA]: {} });
    await tap(removeOf('Hall A'));
    await tap(buttonIn(dialogs()[1]!, 'Cancel'));
    expect(page.writes()).toEqual([]);
    expect(dialogs()[0]!.textContent).toContain('Hall A');
  });

  it('removes a piste at once, with no question', async () => {
    await openWindow({ [DROP_PISTE]: {} });
    await tap(removeOf('Piste 1'));
    expect(dialogs()).toHaveLength(1);
    expect(page.writes()).toEqual([DROP_PISTE]);
  });

  it('says why inside the window when a removal is refused', async () => {
    await openWindow();
    await tap(removeOf('Piste 1'));
    expect(dialogs()[0]!.querySelector('[role="alert"]')?.textContent).toBe(
      'This event is archived and read-only.',
    );
    expect(dialogs()[0]!.textContent).toContain('Piste 1');
  });

  it('adds a piste with Enter', async () => {
    await openWindow({ [ADD_PISTE]: { id: 'vl-2', name: 'Piste 2', sort_order: 1 } });
    const field = dialogs()[0]!.querySelector<HTMLInputElement>('input[placeholder="Piste 1"]')!;
    act(() => type(field, 'Piste 2'));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await page.settle();
    expect(page.writes()).toEqual([ADD_PISTE]);
    expect(dialogs()[0]!.textContent).toContain('Piste 2');
  });

  it('sends one piste for a held Enter', async () => {
    await openWindow({ [ADD_PISTE]: { id: 'vl-2', name: 'Piste 2', sort_order: 1 } });
    const field = dialogs()[0]!.querySelector<HTMLInputElement>('input[placeholder="Piste 1"]')!;
    act(() => type(field, 'Piste 2'));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }),
      );
    });
    await page.settle();
    expect(page.writes()).toEqual([ADD_PISTE]);
  });
});
