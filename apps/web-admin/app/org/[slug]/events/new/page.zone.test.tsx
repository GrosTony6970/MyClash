import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { openEventPage, type, type OpenedPage } from '../[eventId]/archived-page.fixtures';
import NewEventPage from './page';

/** The create wizard asks for the Event's zone, Paris by default (ruling 411 row C). */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club' }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
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

let page: OpenedPage;
afterEach(() => page.unmount());

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

/** The body the wizard sent to make the Event. */
function createdBody(): Record<string, unknown> | undefined {
  const call = vi
    .mocked(ApiClient.apiRequest)
    .mock.calls.find(
      ([, path, init]) => path === '/api/v1/organizations/org-1/events' && init?.method === 'POST',
    );
  return call?.[2]?.body as Record<string, unknown> | undefined;
}

describe('the create wizard: the zone', () => {
  it('asks for the zone on step 1, on Europe/Paris, and makes the Event on the one picked', async () => {
    page = await openEventPage(
      <NewEventPage />,
      { '/api/v1/organizations/org-1/venues': [] },
      { 'POST /api/v1/organizations/org-1/events': { id: 'e-1' } },
    );
    const zone = byId<HTMLSelectElement>('wizard-timezone');
    expect(document.querySelector('label[for="wizard-timezone"]')?.textContent).toBe('Time zone');
    expect(zone.value).toBe('Europe/Paris');
    const help = document.getElementById(zone.getAttribute('aria-describedby') ?? '');
    expect(help?.textContent).toBe(
      'Bout times, the programme and the live board all run on this clock.',
    );

    act(() => type(zone, 'America/New_York'));
    act(() => type(byId<HTMLInputElement>('wizard-event-name'), 'Open 2027'));
    await click(byId('wizard-start-date'));
    await click(buttonNamed('10'));
    await click(byId('wizard-end-date'));
    await click(buttonNamed('12'));
    await click(byTestId('wizard-next'));
    act(() => type(byId<HTMLInputElement>('wizard-venue-name'), 'Gymnase'));
    await click(byTestId('wizard-next'));
    await click(byTestId('wizard-next'));
    expect(document.body.textContent).toContain('Time zone: America/New_York');
    await click(byTestId('wizard-create'));

    expect(createdBody()).toMatchObject({ timezone: 'America/New_York' });
  });
});
