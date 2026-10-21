import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import {
  EDGE_REFUSED_READ,
  FAILED_READ,
  FORBIDDEN_READ,
  openArchivedPage,
  openEventPage,
  type,
  type OpenedPage,
} from '../../../archived-page.fixtures';
import {
  PINNED,
  RECAP,
  TABS,
  TOURNAMENT_ID,
  TOURNAMENT_READS,
  TOURNAMENT_ROW,
  button,
  filePicker,
  isClosed,
  press,
  recap,
} from './page.fixtures';
import { control } from './page.rules.fixtures';
import TournamentSettingsPage from './page';

/**
 * The settings of a Tournament, opened by Léa, who scores for the club and is not its admin
 * (rulings 90, 101-103). The server refuses her every save of this page, the Recap's included, so
 * the page closes them all, as it does on an archived Event, and one line under the header says
 * why. The Tournament read tells the page (`viewer_may_edit`); a read the API refuses her (a 403)
 * tells it too. A read that does not say (pending, failed, an edge's 403, no field) leaves the
 * page as it was: the server still refuses.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', tournamentId: 't-1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/t-1/settings',
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

const TOURNAMENT = `/api/v1/tournaments/${TOURNAMENT_ID}`;
const PUBLISHED = { '/api/v1/events/ev1': { name: 'Open 2025', status: 'published' } };
const ADMIN_ONLY = 'Only a club admin can change these settings.';
const ADMIN_ONLY_FR = 'Seul un administrateur du club peut modifier ces réglages.';
const ARCHIVED = 'This event is archived and read-only.';
/** Léa's read of the Tournament. */
const LEAS_ROW = { ...TOURNAMENT_ROW, viewer_may_edit: false };
/** A read that does not say whether its reader may edit: the key is absent, as JSON omits it. */
const { viewer_may_edit: _said, ...SILENT_ROW } = TOURNAMENT_ROW;

/** Opens the settings page on `tab`, the Tournament read answering `tournament`. */
async function openTab(
  tab: string,
  tournament: unknown = LEAS_ROW,
  reads: Record<string, unknown> = {},
  locale: 'en' | 'fr' = 'en',
): Promise<OpenedPage> {
  window.history.replaceState(null, '', `/#${tab}`);
  return openEventPage(
    <TournamentSettingsPage />,
    { ...TOURNAMENT_READS, ...PUBLISHED, ...reads, [TOURNAMENT]: tournament },
    {},
    { locale },
  );
}

const said = (text: string) => document.body.textContent?.includes(text) ?? false;

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the settings of a Tournament, for a reader who is not its club’s admin', () => {
  it.each(TABS)('closes every save of the %s tab, and says why', async (tab, closed) => {
    page = await openTab(tab);

    for (const label of closed) expect.soft(isClosed(button(label)), label).toBe(true);
    expect(button('Save changes').title).toBe(ADMIN_ONLY);
    expect(said(ADMIN_ONLY)).toBe(true);
    await press(page, closed);
    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });

  it('closes the ruleset change and the drift acknowledgement', async () => {
    page = await openTab('basics');

    expect.soft(isClosed(button('Acknowledge'))).toBe(true);
    const ruleset = [...document.body.querySelectorAll('select')].find((s) => s.value === PINNED);
    await act(async () => type(ruleset!, 'Generic_PointsCap:1.0.0'));

    expect.soft(isClosed(button('Change ruleset'))).toBe(true);
    await press(page, ['Change ruleset', 'Acknowledge']);
    expect(page.writes()).toEqual([]);
  });

  it('closes the logo picker', async () => {
    page = await openTab('display');

    expect(filePicker()).not.toBeNull();
    expect(isClosed(filePicker())).toBe(true);
  });

  it.each([
    ['draft', 'Publish'],
    ['published', 'Unpublish'],
  ] as const)('closes the Recap of a %s recap: Regenerate and %s', async (status, shown) => {
    page = await openTab('recap', LEAS_ROW, { [`${RECAP}?locale=en`]: recap(status) });

    expect.soft(isClosed(button('Regenerate'))).toBe(true);
    expect.soft(isClosed(button(shown))).toBe(true);
    expect(button(shown).title).toBe(ADMIN_ONLY);
    await press(page, ['Regenerate', shown]);
    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });

  it('says why in French', async () => {
    page = await openTab('basics', LEAS_ROW, {}, 'fr');

    expect(said(ADMIN_ONLY_FR)).toBe(true);
  });

  it('closes the page when the API refuses the Tournament read itself', async () => {
    // A read_only member: the Venues tab still draws, its own reads are not the Tournament's.
    page = await openTab('venues', FORBIDDEN_READ);

    expect(said(ADMIN_ONLY)).toBe(true);
    expect(isClosed(button('Save changes'))).toBe(true);
  });

  it.each([
    ['a failed read', FAILED_READ],
    ['an edge’s 403', EDGE_REFUSED_READ],
  ])('leaves the page as it was after %s: the server still refuses', async (_, answer) => {
    page = await openTab('venues', answer);

    expect(said(ADMIN_ONLY)).toBe(false);
    expect(isClosed(button('Save changes'))).toBe(false);
  });

  it('prefers the archived sentence on a Save when the Event is archived too', async () => {
    window.history.replaceState(null, '', '/#basics');
    page = await openArchivedPage(<TournamentSettingsPage />, {
      ...TOURNAMENT_READS,
      [TOURNAMENT]: LEAS_ROW,
    });

    expect(button('Save changes').title).toBe(ARCHIVED);
    expect(said(ADMIN_ONLY)).toBe(true);
  });
});

describe('the settings of a Tournament, for its club’s admin', () => {
  /** The Basics save's body, the MARKER name in it. */
  const sentName = () =>
    vi
      .mocked(ApiClient.apiRequest)
      .mock.calls.filter(([, path, init]) => path === TOURNAMENT && init?.method === 'PATCH')
      .map(([, , init]) => (init?.body as { name?: string }).name);

  it.each([
    ['says so', TOURNAMENT_ROW],
    ['does not say', SILENT_ROW],
  ])('saves when the read %s, and draws no line', async (_, row) => {
    page = await openTab('basics', row);
    await act(async () => type(control('Name'), 'Longsword MARKER'));
    await act(async () => button('Save changes').click());
    await page.settle();

    expect(said(ADMIN_ONLY)).toBe(false);
    expect(sentName()).toEqual(['Longsword MARKER']);
  });

  it('closes Generate while a generation is out: each one costs money', async () => {
    page = await openTab('recap', TOURNAMENT_ROW);
    let answer!: () => void;
    const out = new Promise<void>((resolve) => (answer = resolve));
    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
      if (init?.method === 'POST') await out;
      return server(base, path, init);
    });
    // The positive twin: an admin's Generate is live before the press.
    expect(isClosed(button('Generate recap'))).toBe(false);
    await act(async () => button('Generate recap').click());
    await page.settle();

    expect(isClosed(button('Generate recap'))).toBe(true);
    await act(async () => answer());
    await page.settle();
  });
});
