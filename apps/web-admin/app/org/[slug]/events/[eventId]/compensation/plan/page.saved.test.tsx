import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import OrgCompensationPlansPage from './page';

/**
 * Saving a pay plan's rates or tiers said nothing at all (quick win O24): the organiser
 * reloaded the page to check that money settings were kept. Each save now says so,
 * and that the plan is the club's: every Event that uses it pays the new rates.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/compensation/plan',
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

const PLAN = {
  id: 'plan-1',
  organizationId: 'org-1',
  name: 'Club rates',
  description: null,
  builtIn: false,
  publicVisibility: false,
  createdAt: '2026-01-01T00:00:00Z',
  roleRates: [],
  tiers: [],
};
const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  '/api/v1/compensation-plans': [PLAN],
  [`/api/v1/events/${EVENT_ID}/referee-skills`]: [],
};
const RATES = 'PUT /api/v1/compensation-plans/plan-1/role-rates';
const TIERS = 'PUT /api/v1/compensation-plans/plan-1/tiers';

let page: OpenedPage;
afterEach(() => page.unmount());

async function press(label: string) {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
}
const toasts = () =>
  [...document.body.querySelectorAll('[role="status"], [role="alert"]')]
    .map((n) => n.textContent)
    .join(' | ');

describe('saving a pay plan', () => {
  it('says the rates were saved, for every Event of the club that uses the plan', async () => {
    page = await openEventPage(<OrgCompensationPlansPage />, READS, { [RATES]: PLAN });
    await press('Edit');
    await press('Save rates');
    expect(page.writes()).toEqual([RATES]);
    expect(toasts()).toContain(
      'Rates saved. This plan is your club’s: every Event that uses it pays these rates.',
    );
  });

  it('says the tiers were saved', async () => {
    page = await openEventPage(<OrgCompensationPlansPage />, READS, { [TIERS]: PLAN });
    await press('Edit');
    await press('Save tiers');
    expect(toasts()).toContain(
      'Tiers saved. This plan is your club’s: every Event that uses it pays these tiers.',
    );
  });

  it('says nothing green when the save is refused', async () => {
    page = await openEventPage(<OrgCompensationPlansPage />, READS);
    await press('Edit');
    await press('Save rates');
    expect(page.writes()).toEqual([RATES]);
    expect(toasts()).not.toContain('Rates saved');
  });
});
