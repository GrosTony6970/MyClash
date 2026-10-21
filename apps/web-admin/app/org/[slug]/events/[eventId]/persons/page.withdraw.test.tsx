import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PersonsPage from './page';

/**
 * Rulings 110, 111 and 115: the roster withdraws a Fighter by hand, and undoes it. Beside the
 * entry, on the tab of one Tournament: on "All" a row can hold several entries. Withdraw asks
 * first, since her remaining Pool bouts will be forfeited; its undo asks nothing.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/persons',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: 'draft' }] }),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const person = (id: string, givenName: string, familyName: string) => ({
  id,
  givenName,
  familyName,
  email: null,
  hemaRatingsId: null,
  clubId: null,
  clubLabel: null,
  claimStatus: 'unclaimed',
  globalPersonId: null,
  claimedByUserId: null,
});
const entry = (id: string, personId: string, entryStatus: string, status = entryStatus) => ({
  id,
  personId,
  tournamentId: 't-1',
  // A marker: the confirm names the Tournament the entry is in, read off the entry.
  tournamentName: 'Longsword Zeta',
  status,
  entryStatus,
  seed: null,
  waitlistPosition: entryStatus === 'waitlist' ? 1 : null,
});

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1/persons': [
    person('p-1', 'Ana', 'Roux'),
    person('p-2', 'Ben', 'Morel'),
    person('p-3', 'Cy', 'Blanc'),
  ],
  '/api/v1/events/ev1/registrations': [
    // Ana is out by a forfeit, her hand still checked in: Withdraw is what her hand offers.
    entry('r-ana', 'p-1', 'checked_in', 'withdrawn'),
    entry('r-ben', 'p-2', 'withdrawn'),
    entry('r-cy', 'p-3', 'waitlist'),
  ],
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Longsword Zeta', color: null }],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};

let container: HTMLDivElement;
let root: Root;
let answer: { ok: boolean; [key: string]: unknown };

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openRoster(search: string, locale: 'en' | 'fr' = 'en') {
  window.history.replaceState(null, '', `/org/org/events/ev1/persons${search ? `?${search}` : ''}`);
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <PersonsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

/** The status changes the page sent: path and body. */
const writes = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(
      ([, , init]) => (init as { method?: string } | undefined)?.method === 'PATCH',
    )
    .map(([, path, init]) => [path, (init as { body?: unknown }).body]);

const rowOf = (name: string) =>
  [...container.querySelectorAll('tr')].find((row) => row.textContent?.includes(name));
const buttonIn = (scope: ParentNode | undefined, label: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label);
const dialog = () => document.body.querySelector('[role="dialog"]');

async function press(button: HTMLButtonElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = { ok: true, data: {} };
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init?: unknown) => {
    if ((init as { method?: string } | undefined)?.method === 'PATCH') return answer as never;
    if (path in READS) return { ok: true, data: READS[path] } as never;
    throw new Error(`unexpected request ${path}`);
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('withdrawing a Fighter by hand, on the roster (rulings 110, 111, 115)', () => {
  it('on a Tournament’s tab: Withdraw beside an entry in, its undo beside one withdrawn by hand', async () => {
    await openRoster('tournamentId=t-1');
    expect(buttonIn(rowOf('ROUX'), 'Withdraw')).toBeDefined();
    expect(buttonIn(rowOf('MOREL'), 'Undo withdrawal')).toBeDefined();
    expect(buttonIn(rowOf('MOREL'), 'Withdraw')).toBeUndefined();
    // A waiting entry is seated or dropped, never withdrawn.
    const cy = rowOf('BLANC');
    expect(buttonIn(cy, 'Withdraw') ?? buttonIn(cy, 'Undo withdrawal')).toBeUndefined();
  });

  it('on "All" a row can hold several entries: no button', async () => {
    await openRoster('');
    expect(buttonIn(container, 'Withdraw')).toBeUndefined();
    expect(buttonIn(container, 'Undo withdrawal')).toBeUndefined();
  });

  it('Withdraw asks first, naming the Tournament and the forfeits; a cancel sends nothing', async () => {
    await openRoster('tournamentId=t-1');
    await press(buttonIn(rowOf('ROUX'), 'Withdraw'));

    expect(dialog()?.textContent).toContain('Longsword Zeta');
    expect(dialog()?.textContent).toContain('Their remaining Pool bouts will be forfeited.');
    await press(buttonIn(dialog() ?? undefined, 'Cancel'));
    expect(writes()).toEqual([]);
  });

  it('confirmed, it withdraws her entry and reads the roster again', async () => {
    await openRoster('tournamentId=t-1');
    const readsBefore = vi.mocked(apiRequest).mock.calls.length;
    await press(buttonIn(rowOf('ROUX'), 'Withdraw'));
    const confirm = [...(dialog()?.querySelectorAll('button') ?? [])].at(-1) as HTMLButtonElement;
    await press(confirm);

    expect(writes()).toEqual([['/api/v1/registrations/r-ana/status', { status: 'withdrawn' }]]);
    const after = vi
      .mocked(apiRequest)
      .mock.calls.slice(readsBefore)
      .map(([, path]) => path);
    expect(after).toContain('/api/v1/events/ev1/registrations');
  });

  it('Undo withdrawal puts her entry back as registered, with no question', async () => {
    await openRoster('tournamentId=t-1');
    await press(buttonIn(rowOf('MOREL'), 'Undo withdrawal'));

    expect(dialog()).toBeNull();
    expect(writes()).toEqual([['/api/v1/registrations/r-ben/status', { status: 'registered' }]]);
    // Another cause may still hold her out: the toast does not promise she is back.
    expect(document.body.textContent).toContain(
      'The withdrawal of MOREL Ben from Longsword Zeta is undone. If nothing else holds them out',
    );
  });

  it('an undo refused because her seat was given away says so, in words', async () => {
    answer = {
      ok: false,
      kind: 'http',
      status: 409,
      code: 'CONFLICT',
      detail: 'Conflict',
      details: { reason: 'tournament_full' },
    };
    await openRoster('tournamentId=t-1');
    await press(buttonIn(rowOf('MOREL'), 'Undo withdrawal'));

    expect(document.body.textContent).toContain(
      'Longsword Zeta is full: the seat was given to a fighter from the waiting list.',
    );
  });

  it('a second press while the first is on its way sends nothing more', async () => {
    let land: (value: unknown) => void = () => undefined;
    vi.mocked(apiRequest).mockImplementation(
      async (_base: string, path: string, init?: unknown) => {
        if ((init as { method?: string } | undefined)?.method === 'PATCH') {
          return new Promise((resolve) => (land = resolve)) as never;
        }
        return { ok: true, data: READS[path] } as never;
      },
    );
    await openRoster('tournamentId=t-1');
    const undo = buttonIn(rowOf('MOREL'), 'Undo withdrawal');
    await press(undo);
    await press(undo);

    expect(writes()).toHaveLength(1);
    await act(async () => land({ ok: true, data: {} }));
  });

  it('in French', async () => {
    await openRoster('tournamentId=t-1', 'fr');
    expect(buttonIn(rowOf('ROUX'), 'Retirer')).toBeDefined();
    expect(buttonIn(rowOf('MOREL'), 'Annuler le retrait')).toBeDefined();
  });
});
