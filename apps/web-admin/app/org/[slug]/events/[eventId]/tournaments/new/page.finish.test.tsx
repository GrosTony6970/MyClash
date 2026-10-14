import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { TOURNAMENT_READS, button } from '../[tournamentId]/settings/page.fixtures';
import NewTournamentPage from './page';

/**
 * The end of the Tournament wizard (quick win O14). After a refused publish it showed
 * a red "could not reach the server" AND a green "Tournament saved.", and nothing said
 * the Tournament was still a draft. Now it says one thing: saved as a draft, published,
 * or saved as a draft and NOT published, with the reason.
 */
const NAVIGATION = vi.hoisted(() => ({ left: [] as string[] }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: (to: string) => NAVIGATION.left.push(to) }),
  usePathname: () => '/org/org/events/ev1/tournaments/new',
  useSearchParams: () => new URLSearchParams('id=t-1&step=4'),
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

const SAVE = 'PATCH /api/v1/tournaments/t-1';
const RUNNING_EVENT = { id: EVENT_ID, name: 'Open 2026', status: 'running' };

let page: OpenedPage;
afterEach(() => page.unmount());

/** Opens step 4; a publish answers as `publish` says, the step's own save is taken. */
async function openStep4(publish: 'taken' | 'no network') {
  NAVIGATION.left = [];
  page = await openEventPage(
    <NewTournamentPage />,
    { ...TOURNAMENT_READS, [`/api/v1/events/${EVENT_ID}`]: RUNNING_EVENT },
    { [SAVE]: {} },
  );
  const served = vi.mocked(apiRequest).getMockImplementation()!;
  vi.mocked(apiRequest).mockImplementation(async (base, path, init) => {
    const body = init?.body as { status?: string } | undefined;
    if (body?.status === 'published' && publish === 'no network') {
      await served(base, path, init); // written down as a save, then lost
      return { ok: false, kind: 'network' } as never;
    }
    return served(base, path, init);
  });
}
const publishBox = () =>
  [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].pop()!;
const toasts = () =>
  [...document.body.querySelectorAll('[role="status"], [role="alert"]')].map((n) => n.textContent);
const publishes = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => (init?.body as { status?: string })?.status === 'published');
async function tap(control: HTMLElement) {
  await act(async () => control.click());
  await page.settle();
}

describe('the end of the Tournament wizard', () => {
  it('a refused publish says "saved as a draft, not published", and nothing green', async () => {
    await openStep4('no network');
    await tap(publishBox());
    await tap(button('Finish'));
    const said = toasts().join(' | ');
    expect(said).toContain('Saved as a draft, not published.');
    expect(said).not.toContain('Tournament saved');
    expect(NAVIGATION.left).toEqual(['/org/org/events/ev1/tournaments']);
  });

  it('a publish that lands says so', async () => {
    await openStep4('taken');
    await tap(publishBox());
    await tap(button('Finish'));
    expect(toasts().join(' | ')).toContain('Tournament saved and published.');
  });

  it('a finish with no publish says the Tournament is a draft', async () => {
    await openStep4('taken');
    await tap(button('Finish'));
    expect(publishes()).toHaveLength(0);
    expect(toasts().join(' | ')).toContain('Tournament saved as a draft.');
  });

  it('"Use defaults and finish" publishes when "Publish on finish" is ticked', async () => {
    await openStep4('taken');
    await tap(publishBox());
    const useDefaults = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Use defaults and finish'),
    )!;
    await tap(useDefaults);
    expect(publishes()).toHaveLength(1);
    expect(toasts().join(' | ')).toContain('Tournament saved and published.');
  });
});
