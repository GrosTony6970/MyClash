import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PersonsPage from './page';

/**
 * "Register as referee" on a selection wrote one person after the other and showed a
 * green toast counting only the writes that landed: a refused one was dropped in
 * silence. Now the toast says how many were refused, and those stay selected.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/persons',
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

const person = (id: string, givenName: string) => ({
  id,
  givenName,
  familyName: 'Roux',
  email: null,
  hemaRatingsId: null,
  clubId: null,
  clubLabel: null,
  claimStatus: 'unclaimed',
  globalPersonId: `g${id}`,
  claimedByUserId: null,
});
const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  '/api/v1/events/ev1/persons': [person('p-1', 'Ana'), person('p-2', 'Bo')],
  '/api/v1/events/ev1/registrations': [],
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Longsword', color: null }],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};
const ANA = 'POST /api/v1/events/ev1/referees/gp-1';
const BO = 'POST /api/v1/events/ev1/referees/gp-2';

let page: OpenedPage;
afterEach(() => page.unmount());

/** The row checkbox of each person, by first name. */
const rowBox = (name: string) => {
  const row = [...document.body.querySelectorAll('tr')].find((tr) =>
    tr.textContent?.includes(name),
  );
  return row?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
};
async function tap(control: Element | null | undefined) {
  if (!control) throw new Error('nothing to tap');
  await act(async () => (control as HTMLElement).click());
  await page.settle();
}
const buttonNamed = (label: string, within: ParentNode = document.body) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const toasts = () =>
  [...document.body.querySelectorAll('[role="status"], [role="alert"]')]
    .map((n) => n.textContent)
    .join(' | ');

async function registerBoth(taken: Record<string, unknown>) {
  page = await openEventPage(<PersonsPage />, READS, taken);
  await tap(rowBox('Ana'));
  await tap(rowBox('Bo'));
  await tap(buttonNamed('Register as referee'));
  const dialog = document.body.querySelector('[role="dialog"]')!;
  await tap([...dialog.querySelectorAll('button')].pop());
}

describe('register a selection as referees', () => {
  it('says how many were refused, and keeps them selected', async () => {
    await registerBoth({ [ANA]: {} });
    expect(page.writes()).toEqual([ANA, BO]);
    // The reason is the server's own words for Bo's refusal (the fixture's refusal).
    expect(toasts()).toContain(
      '1 done, 1 refused. This event is archived and read-only. The refused ones stay selected: press again to retry them.',
    );
    expect(toasts()).not.toContain('now referee');
    expect(rowBox('Ana')?.checked).toBe(false);
    expect(rowBox('Bo')?.checked).toBe(true);
  });

  it('says they are referees when every write lands, and clears the selection', async () => {
    await registerBoth({ [ANA]: {}, [BO]: {} });
    expect(toasts()).toContain('2 participant(s) now referee for this event.');
    expect(rowBox('Ana')?.checked).toBe(false);
    expect(rowBox('Bo')?.checked).toBe(false);
  });
});
