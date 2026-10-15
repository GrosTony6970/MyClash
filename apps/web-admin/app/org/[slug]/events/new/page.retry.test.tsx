import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type, type OpenedPage } from '../[eventId]/archived-page.fixtures';
import NewEventPage from './page';

/**
 * O13 (ruled 2026-10-14): a retry after a partial failure keeps the Event made, locks its
 * address, and sends only what is missing. The second Create used to send the Event again and
 * read "slug already taken".
 */
const NAVIGATION = vi.hoisted(() => {
  const pushed: string[] = [];
  return { pushed, router: { push: (to: string) => pushed.push(to), replace: () => undefined } };
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club' }),
  useRouter: () => NAVIGATION.router,
  usePathname: () => '/org/club/events/new',
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

const EVENT_POST = 'POST /api/v1/organizations/org-1/events';
const VENUE_POST = 'POST /api/v1/organizations/org-1/venues';
const LICE_POST = 'POST /api/v1/events/e-1/lices';

let page: OpenedPage;
afterEach(() => {
  page.unmount();
  NAVIGATION.pushed.length = 0;
});

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
function buttonNamed(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no "${label}" button`);
  return found;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
  await page.settle();
}

/** Steps 1 to 4: a name, two dates, a new venue; the two default pistes. */
async function fillTheWizard() {
  act(() => type(byId<HTMLInputElement>('wizard-event-name'), 'Open 2027'));
  await click(byId('wizard-start-date'));
  await click(buttonNamed('10'));
  await click(byId('wizard-end-date'));
  await click(buttonNamed('12'));
  await click(byTestId('wizard-next'));
  act(() => type(byId<HTMLInputElement>('wizard-venue-name'), 'Gymnase'));
  await click(byTestId('wizard-next'));
  await click(byTestId('wizard-next'));
}

describe('a second Create after a refusal', () => {
  it('keeps the Event made, locks its address, and sends only what is missing', async () => {
    // The server takes the Event and refuses the venue, this once.
    const taken: Record<string, unknown> = { [EVENT_POST]: { id: 'e-1' } };
    page = await openEventPage(
      <NewEventPage />,
      { '/api/v1/organizations/org-1/venues': [] },
      taken,
    );
    await fillTheWizard();
    await click(byTestId('wizard-create'));
    expect(page.writes()).toEqual([EVENT_POST, VENUE_POST]);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      'This event is archived and read-only.',
    );

    // Back to step 1: the Event exists, so its address no longer moves.
    for (let step = 0; step < 3; step++) await click(buttonNamed('Back'));
    expect(byId<HTMLInputElement>('wizard-event-slug').disabled).toBe(true);
    expect(document.getElementById('wizard-event-slug-locked')).not.toBeNull();

    taken[VENUE_POST] = { id: 'v-1' };
    taken[LICE_POST] = { id: 'l-1' };
    for (let step = 0; step < 3; step++) await click(byTestId('wizard-next'));
    await click(byTestId('wizard-create'));
    expect(page.writes()).toEqual([EVENT_POST, VENUE_POST, VENUE_POST, LICE_POST, LICE_POST]);
    expect(NAVIGATION.pushed).toEqual(['/org/club/events/e-1']);
  });
});

// Ruled 2026-10-15: it said "Your changes are not saved yet. They will be lost." over an Event
// the server already held.
describe('leaving after a Create that stopped half-way', () => {
  it('says the Event is kept as a draft, and names what is not saved', async () => {
    page = await openEventPage(
      <NewEventPage />,
      { '/api/v1/organizations/org-1/venues': [] },
      { [EVENT_POST]: { id: 'e-1' } },
    );
    await fillTheWizard();
    await click(byTestId('wizard-create'));

    await click(buttonNamed('club'));
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      '“Open 2027” is saved as a draft. Not saved: the new venue, the pistes.',
    );
  });
});
