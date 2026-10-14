import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import PersonsPage from './page';

/**
 * O16 (ruled 2026-10-14): walk-ins at the desk. The Add window closed after each person and
 * Enter did nothing. Now it is a form: Enter in the club field picks the first suggestion,
 * elsewhere it saves; "Save and add another" keeps the ticked Tournaments and clears the person
 * and the club; a full Tournament asks before the next person; every add says so.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/persons',
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
  '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2026', status: 'running' },
  '/api/v1/events/ev1/persons': [],
  '/api/v1/events/ev1/registrations': [],
  '/api/v1/events/ev1/tournaments': [{ id: 't1', name: 'Longsword' }],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
  '/api/v1/clubs?q=Lyon&searchAbv=true': [{ id: 'c1', name: 'Lyon Escrime', abbreviation: null }],
  '/api/v1/global-persons?q=Ana': [
    { id: 'g1', display_name: 'Ana Red', given_name: 'Ana', family_name: 'Red', clubs: null },
  ],
};
const ADD_PERSON = 'POST /api/v1/events/ev1/persons';
const REGISTER = 'POST /api/v1/tournaments/t1/registrations';
const TAKEN = { [ADD_PERSON]: { id: 'p1', globalPersonId: null }, [REGISTER]: {} };

let page: OpenedPage;
afterEach(() => page.unmount());

const inWindow = <T extends Element>(selector: string) =>
  document.body.querySelector<T>(`[role="dialog"] ${selector}`)!;
const field = (testId: string) => inWindow<HTMLInputElement>(`[data-testid="${testId}"]`);
const clubField = () =>
  [...document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="search"]')][1]!;
/** The box of the Longsword Tournament. */
const tick = () =>
  [...document.body.querySelectorAll('[role="dialog"] label')]
    .find((label) => label.textContent?.trim() === 'Longsword')!
    .querySelector<HTMLInputElement>('input')!;
const dialogs = () => [...document.body.querySelectorAll('[role="dialog"]')];

async function openAdd(taken: Record<string, unknown> = TAKEN) {
  page = await openEventPage(<PersonsPage />, READS, taken);
  const add = document.body.querySelector<HTMLButtonElement>('[data-testid="persons-add"]')!;
  await act(async () => add.click());
}

async function press(testId: string) {
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click(),
  );
  await page.settle();
}

function typeName(given: string, family: string) {
  act(() => type(field('person-given-name'), given));
  act(() => type(field('person-family-name'), family));
}

/** The club search waits a quarter second before it reads. */
async function waitForSuggestions() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  await page.settle();
}

function enter(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('adding walk-ins', () => {
  it('picks the first club with Enter in the club field, and sends nothing', async () => {
    await openAdd();
    act(() => type(clubField(), 'Lyon'));
    await waitForSuggestions();
    enter(clubField());
    expect(inWindow('p.text-success')?.textContent).toContain('Lyon Escrime');
    expect(page.writes()).toEqual([]);
  });

  it('picks the first profile with Enter in the profile search', async () => {
    await openAdd();
    const search = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="search"]',
    )!;
    act(() => type(search, 'Ana'));
    await waitForSuggestions();
    enter(search);
    expect(field('person-given-name').value).toBe('Ana');
    expect(page.writes()).toEqual([]);
  });

  it('saves the person when the form is sent, as Enter in a name field sends it', async () => {
    await openAdd();
    typeName('Ana', 'Red');
    const submit = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="persons-add-submit"]',
    )!;
    expect(submit.type).toBe('submit');
    const form = submit.form!;
    expect(form.contains(field('person-given-name'))).toBe(true);
    await act(async () => form.requestSubmit(submit));
    await page.settle();
    expect(page.writes()).toEqual([ADD_PERSON]);
    expect(dialogs()).toHaveLength(0);
    expect(document.body.textContent).toContain('Added Ana Red.');
  });

  it('"Save and add another" keeps the Tournaments ticked and clears the person', async () => {
    await openAdd();
    act(() => tick().click());
    typeName('Ana', 'Red');
    await press('persons-add-another');
    expect(page.writes()).toEqual([ADD_PERSON, REGISTER]);
    expect(dialogs()).toHaveLength(1);
    expect(field('person-given-name').value).toBe('');
    expect(field('person-given-name')).toBe(document.activeElement);
    expect(tick().checked).toBe(true);
    expect(document.body.textContent).toContain('Added Ana Red to 1 tournament(s).');
  });

  it('opens again empty after Cancel: the ticks of the last window are gone', async () => {
    await openAdd();
    act(() => tick().click());
    const cancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent === 'Cancel')!;
    await act(async () => cancel.click());
    const add = document.body.querySelector<HTMLButtonElement>('[data-testid="persons-add"]')!;
    await act(async () => add.click());
    expect(tick().checked).toBe(false);
  });

  it('asks about a full Tournament at once, over the window, before the next person', async () => {
    await openAdd();
    const server = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
      path === '/api/v1/tournaments/t1/registrations' && init?.method === 'POST'
        ? {
            ok: false,
            kind: 'http',
            status: 409,
            detail: 'full',
            validationErrors: null,
            code: 'CONFLICT',
            details: { reason: 'tournament_full', registeredCount: 16, maxParticipants: 16 },
          }
        : server(base, path, init),
    );
    act(() => tick().click());
    typeName('Ana', 'Red');
    await press('persons-add-another');
    expect(dialogs()).toHaveLength(2);
    expect(dialogs()[1]!.textContent).toContain('Tournament full');
    expect(field('person-given-name').value).toBe('');
  });
});
