import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { TOURNAMENT_READS, TOURNAMENT_ROW, button } from '../[tournamentId]/settings/page.fixtures';
import NewTournamentPage from './page';

/**
 * A wizard step's change that needs the audit (the audited settings change, commit 5c; ruling
 * 168): the wizard has no dialog, so the step says so inline, above its button, with a link to
 * the matching tab of the Tournament's settings. A locked card pin has no ceremony: no link.
 */
const STEP = vi.hoisted(() => ({ n: 2 }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/new',
  useSearchParams: () => new URLSearchParams(`id=t-1&step=${STEP.n}`),
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

const TOURNAMENT = '/api/v1/tournaments/t-1';
const READS = { ...TOURNAMENT_READS, [TOURNAMENT]: TOURNAMENT_ROW };
const refused = (code: string) => ({
  ok: false,
  kind: 'unauthenticated',
  status: 403,
  detail: 'An English sentence.',
  code,
  details: { changes: [], fighters: [] },
});

let page: OpenedPage;
afterEach(() => page.unmount());

/** Opens the wizard on step `step`; its save is refused with `code`. */
async function openRefused(step: number, code: string) {
  STEP.n = step;
  page = await openEventPage(<NewTournamentPage />, READS);
  const read = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
    init?.method === 'PATCH'
      ? (refused(code) as Awaited<ReturnType<typeof ApiClient.apiRequest>>)
      : read(base, path, init),
  );
}

const SENTENCE =
  'This change needs a reason and your confirmation. Make it from the tournament’s settings.';
const link = () =>
  [...document.body.querySelectorAll('a')].find((a) =>
    a.getAttribute('href')?.includes('/settings'),
  );

describe('a wizard step whose change needs the audit', () => {
  it.each([
    [2, 'Next', 'match-format'],
    [3, 'Next', 'display'],
    [4, 'Finish', 'advanced'],
  ])('step %i says so inline, with a link to the settings tab', async (step, label, tab) => {
    await openRefused(step, 'rules_change_needs_audit');
    await act(async () => button(label).click());
    await page.settle();

    expect(document.body.textContent).toContain(SENTENCE);
    expect(document.body.textContent).not.toContain('An English sentence.');
    expect(link()?.getAttribute('href')).toBe(
      `/org/org/events/ev1/tournaments/t-1/settings#${tab}`,
    );
  });

  it('a locked card pin: its own words, no link', async () => {
    await openRefused(2, 'card_change_locked');
    await act(async () => button('Next').click());
    await page.settle();

    expect(document.body.textContent).toContain('its card rules are locked');
    expect(link()).toBeUndefined();
  });
});
