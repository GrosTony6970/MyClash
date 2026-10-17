import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../../archived-page.fixtures';
import { TOURNAMENT_ID, TOURNAMENT_READS, TOURNAMENT_ROW } from './page.fixtures';
import TournamentSettingsPage from './page';

/**
 * Ruling "TF_v1 version": a built-in's older version stays registered for the
 * bouts fought under it, and the picker offers the latest only. A Tournament
 * still pinned to the older one keeps its own choice on the Basics tab, named
 * for the earlier end rules it keeps, never a blank choice.
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

let page: OpenedPage;
afterEach(() => page.unmount());

const READS = {
  ...TOURNAMENT_READS,
  [`/api/v1/tournaments/${TOURNAMENT_ID}`]: { ...TOURNAMENT_ROW, ruleset_version: '1.0.0' },
  '/api/v1/rulesets/for-event/ev1': [
    { code: 'TF_v1', version: '1.1.0', label: 'TF v1', custom: false },
    { code: 'Generic_PointsCap', version: '1.1.0', label: 'Points cap', custom: false },
  ],
};

describe('the Basics tab of a Tournament on an earlier version of its ruleset', () => {
  it('shows that version as its choice, named for its earlier end rules', async () => {
    window.history.replaceState(null, '', '/#basics');
    page = await openEventPage(<TournamentSettingsPage />, READS, {});

    const picker = [...document.body.querySelectorAll('select')].find((select) =>
      select.querySelector('option[value="TF_v1:1.1.0"]'),
    );
    expect(picker?.value).toBe('TF_v1:1.0.0');
    expect(picker?.selectedOptions[0]?.textContent).toBe('TF_v1 (1.0.0, earlier end rules)');
  });
});
