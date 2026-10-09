import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type, type OpenedPage } from '../../archived-page.fixtures';
import {
  TOURNAMENT_READS,
  button,
  filePicker,
  isClosed,
  press,
} from '../[tournamentId]/settings/page.fixtures';
import NewTournamentPage from './page';

/**
 * The Tournament wizard of an archived Event (ruling 377). The server refuses a
 * new Tournament there, and every save of a draft one. So each step still shows
 * what was set, and the button that saves it is closed: step 1 on a new
 * Tournament, and each step of a draft the organiser resumes from the list.
 */
const NAVIGATION = vi.hoisted(() => ({ search: new URLSearchParams(), left: [] as string[] }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: (to: string) => NAVIGATION.left.push(to) }),
  usePathname: () => '/org/org/events/ev1/tournaments/new',
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

/** Opens the wizard as the list's "Resume setup" link does, or new with no `search`. */
function openWizard(search = ''): Promise<OpenedPage> {
  NAVIGATION.search = new URLSearchParams(search);
  NAVIGATION.left = [];
  return openArchivedPage(<NewTournamentPage />, TOURNAMENT_READS);
}

/** Each later step of a resumed draft, and the buttons it must still DRAW, closed. */
const STEPS: Array<[step: number, closed: string[]]> = [
  [1, ['Next']],
  [2, ['Next']],
  [3, ['Replace logo', 'Remove', 'Next']],
  [
    4,
    [
      'Save changes',
      'Move pool matches now',
      'Move Swiss matches now',
      'Move bracket matches now',
      'Customise this format',
      'Finish',
    ],
  ],
];

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the Tournament wizard of an archived Event', () => {
  it('creates no Tournament', async () => {
    page = await openWizard();

    const name = document.body.querySelector<HTMLInputElement>('[data-testid="tournament-name"]');
    await act(async () => type(name!, 'Sabre'));
    expect.soft(isClosed(button('Next'))).toBe(true);
    await press(page, ['Next']);
    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });

  it.each(STEPS)('saves nothing from step %i of a resumed draft', async (step, closed) => {
    page = await openWizard(`id=t-1&step=${step}`);

    for (const label of closed) expect.soft(isClosed(button(label)), label).toBe(true);
    await press(page, closed);
    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });

  it('closes the logo picker of step 3: a picked file is an upload at once', async () => {
    page = await openWizard('id=t-1&step=3');

    expect(filePicker()).not.toBeNull();
    expect(isClosed(filePicker())).toBe(true);
  });

  it('still leaves the wizard by "Use defaults and finish", which saves nothing', async () => {
    page = await openWizard('id=t-1&step=4');

    expect(isClosed(button('Use defaults and finish →'))).toBe(false);
    await press(page, ['Use defaults and finish →']);

    expect(page.writes()).toEqual([]);
    expect(NAVIGATION.left).toEqual(['/org/org/events/ev1/tournaments']);
  });
});
