import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PersonsPage from './page';

/**
 * The roster of an archived Event (ruling 222b, 222d).
 *
 * An Event archives itself a day after its last Tournament is completed, and
 * nothing un-archives it. On Wednesday the organiser prepares the HEMA Ratings
 * export and finds a misspelt name: the row's own fields can still be edited.
 * Its registrations, its referee and instructor tags and its deletion cannot:
 * the server refuses those writes on an archived Event.
 */
const NAVIGATION = vi.hoisted(() => ({
  params: { slug: 'org', eventId: 'ev1' },
  router: { replace: () => undefined, push: () => undefined },
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useParams: () => NAVIGATION.params,
  useRouter: () => NAVIGATION.router,
  usePathname: () => '/org/org/events/ev1/persons',
  useSearchParams: () => NAVIGATION.search,
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

const ANNA = {
  id: 'p-1',
  givenName: 'Ana',
  familyName: 'Roux',
  email: null,
  hemaRatingsId: null,
  clubId: null,
  clubLabel: null,
  claimStatus: 'unclaimed',
  globalPersonId: 'gp-1',
  claimedByUserId: null,
};

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': { status: 'archived' },
  '/api/v1/events/ev1/persons': [ANNA],
  '/api/v1/events/ev1/registrations': [
    {
      id: 'r-1',
      personId: 'p-1',
      tournamentId: 't-1',
      tournamentName: 'Longsword',
      status: 'registered',
      seed: null,
      waitlistPosition: null,
    },
  ],
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Longsword', color: null }],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};

/** Every write the page sent, as `METHOD path`. */
function writes(): string[] {
  return vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => init?.method && init.method !== 'GET')
    .map(([, path, init]) => `${init!.method} ${path}`);
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const button = (label: string): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(found, `no "${label}" button`).toBeDefined();
  return found!;
};

/** The checkbox of the label that reads `text`. */
const checkbox = (text: string): HTMLInputElement => {
  const label = [...document.body.querySelectorAll('label')].find((l) => l.textContent === text);
  const input = label?.querySelector('input[type="checkbox"]');
  expect(input, `no "${text}" checkbox`).toBeTruthy();
  return input as HTMLInputElement;
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method && init.method !== 'GET') return { ok: true, data: undefined };
    if (path in READS) return { ok: true, data: READS[path] };
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <PersonsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the roster of an archived Event', () => {
  it('offers Edit on a row, and not Delete', () => {
    expect(button('Edit').disabled).toBe(false);
    expect(button('Delete').disabled).toBe(true);
  });

  it('saves the row’s own fields and nothing the server refuses', async () => {
    await act(async () => button('Edit').click());
    await settle();

    expect(checkbox('Also register as referee for this event').disabled).toBe(true);
    expect(checkbox('Also tag as instructor for this event').disabled).toBe(true);
    expect(checkbox('Longsword').disabled).toBe(true);
    // Clicked anyway: a box the page left open would send a write the server refuses.
    for (const text of [
      'Also register as referee for this event',
      'Also tag as instructor for this event',
      'Longsword',
    ]) {
      await act(async () => checkbox(text).click());
    }

    await act(async () => button('Save changes').click());
    await settle();

    expect(writes()).toEqual(['PATCH /api/v1/persons/p-1']);
  });
});
