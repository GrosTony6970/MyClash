import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type, type OpenedPage } from '../../../archived-page.fixtures';
import {
  RECAP,
  RECAP_TAKEN,
  TOURNAMENT_READS,
  button,
  filePicker,
  isClosed,
  press,
} from './page.fixtures';
import TournamentSettingsPage from './page';

/**
 * The settings of a Tournament in an archived Event (rulings 377, 379). The
 * server refuses every save of these tabs but the Recap's, so each tab still
 * shows what was set and its saves are closed. A recap is written after the
 * Event is over: Generate, Publish and Unpublish stay live.
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

/** Opens the settings page on `tab`: the page keeps its tab in the address. */
async function openTab(tab: string, taken: Record<string, unknown> = {}): Promise<OpenedPage> {
  window.history.replaceState(null, '', `/#${tab}`);
  return openArchivedPage(<TournamentSettingsPage />, TOURNAMENT_READS, taken);
}

/** The ruleset the Tournament is pinned to, as the ruleset select holds it. */
const PINNED = 'TF_v1:1.0.0';

/** Every save the page sent, but the Recap's own three. */
const refusedSaves = (page: OpenedPage) =>
  page.writes().filter((save) => !save.startsWith(`POST ${RECAP}/`));

/** Each tab, and the buttons it must still DRAW, closed. */
const TABS: Array<[tab: string, closed: string[]]> = [
  ['basics', ['Save changes']],
  ['match-format', ['Save changes']],
  [
    'venues',
    ['Save changes', 'Move pool matches now', 'Move Swiss matches now', 'Move bracket matches now'],
  ],
  ['display', ['Replace logo', 'Remove', 'Save changes']],
  ['advanced', ['Customise this format', 'Save changes']],
  ['locks', ['Save changes']],
];

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the settings of a Tournament in an archived Event', () => {
  it.each(TABS)('sends no save from the %s tab', async (tab, closed) => {
    page = await openTab(tab);

    for (const label of closed) expect.soft(isClosed(button(label)), label).toBe(true);
    await press(page, closed);
    await page.pressEverything();

    expect(refusedSaves(page)).toEqual([]);
  });

  it('closes the logo picker itself: a picked file is an upload at once', async () => {
    page = await openTab('display');

    expect(filePicker()).not.toBeNull();
    expect(isClosed(filePicker())).toBe(true);
  });

  it('closes the ruleset change and the drift acknowledgement', async () => {
    page = await openTab('basics');

    expect.soft(isClosed(button('Acknowledge'))).toBe(true);
    // The button is drawn only once the ruleset in the select is another one.
    const ruleset = [...document.body.querySelectorAll('select')].find((s) => s.value === PINNED);
    await act(async () => type(ruleset!, 'Generic_PointsCap:1.0.0'));

    expect.soft(isClosed(button('Change ruleset'))).toBe(true);
    await press(page, ['Change ruleset', 'Acknowledge']);
    expect(page.writes()).toEqual([]);
  });

  it('still generates, publishes and unpublishes the recap', async () => {
    page = await openTab('recap', RECAP_TAKEN);

    await press(page, ['Generate recap', 'Publish', 'Unpublish']);

    expect(page.writes()).toEqual([
      `POST ${RECAP}/generate?locale=en`,
      `POST ${RECAP}/publish?locale=en`,
      `POST ${RECAP}/unpublish?locale=en`,
    ]);
  });
});
