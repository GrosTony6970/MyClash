/**
 * The organiser's sidebar offers "Teams" for an Event with a team Tournament, and only then
 * (Team Tournaments, slice 1b-1). The answer is the club's Event list (`hasTeamTournament`), read
 * by the shell through the selected Event.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as NextI18nClient from '@myclash/next-i18n/client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { OrganizerAdminShell } from './OrganizerAdminShell';

const selected = vi.hoisted(() => ({ hasTeamTournament: false }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({ default: () => null }));
// Its own router read is not this test's subject.
vi.mock('@myclash/next-i18n/client', async (importOriginal) => ({
  ...(await importOriginal<typeof NextI18nClient>()),
  LanguageSwitcher: () => null,
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('../lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
// No answer yet about who reads: the menu is the whole menu (no member role to narrow it).
vi.mock('../hooks/useIdentityGate', () => ({
  useIdentityGate: () => ({ state: { status: 'checking' } }),
}));
vi.mock('./organizer-event-context', () => {
  const event = () => ({
    id: 'ev1',
    name: 'Open 2026',
    status: 'published',
    start_date: null,
    end_date: null,
    timezone: 'Europe/Paris',
    hasTeamTournament: selected.hasTeamTournament,
  });
  return {
    useOrganizerSelectedEvent: () => ({
      orgName: 'Club',
      orgLogoUrl: null,
      menuProfile: 'everything',
      events: [event()],
      eventsError: null,
      selectedEventId: 'ev1',
      currentEvent: event(),
      selectEvent: () => undefined,
    }),
  };
});

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

async function openShell(hasTeamTournament: boolean): Promise<string[]> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  selected.hasTeamTournament = hasTeamTournament;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="en">
        <OrganizerAdminShell>
          <main />
        </OrganizerAdminShell>
      </I18nProvider>,
    );
  });
  return [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

const TEAMS = '/org/club/events/ev1/teams';

describe('the Teams entry of the organiser sidebar', () => {
  it('shows for an Event with a team Tournament', async () => {
    const hrefs = await openShell(true);
    expect(hrefs).toContain(TEAMS);
    expect(hrefs).toContain('/org/club/events/ev1/persons');
  });

  it('is not there for an Event without one', async () => {
    const hrefs = await openShell(false);
    expect(hrefs).not.toContain(TEAMS);
    expect(hrefs).toContain('/org/club/events/ev1/persons');
  });
});
