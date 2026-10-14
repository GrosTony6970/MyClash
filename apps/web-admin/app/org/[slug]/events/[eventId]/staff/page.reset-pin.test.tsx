import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import EventStaffPage from './page';

/**
 * O27 (ruled 2026-10-14): the reset-PIN box names the person and the rule, checks the PIN as it
 * is typed, and has show / hide. It asked for "PIN" alone, for nobody in particular.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/staff',
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

const RESET = 'POST /api/v1/events/ev1/staff-accounts/acc-1/reset-pin';
const READS = {
  '/api/v1/events/ev1': { id: 'ev1', slug: 'open-2026', name: 'Open 2026', status: 'running' },
  '/api/v1/events/ev1/staff-accounts': [
    {
      id: 'acc-1',
      display_name: 'Léa',
      username: 'lea',
      status: 'active',
      role: 'scoring',
      liceIds: [],
    },
  ],
  '/api/v1/events/ev1/lices': [{ id: 'L1', name: 'Piste 1' }],
};

let page: OpenedPage;
afterEach(() => page.unmount());

const box = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!;
const buttonIn = (within: ParentNode, label: string) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;

describe('the reset-PIN box', () => {
  it('names the person, refuses a weak PIN as it is typed, and sends a good one', async () => {
    page = await openEventPage(<EventStaffPage />, READS, { [RESET]: {} });
    await act(async () => buttonIn(document.body, 'Reset PIN').click());

    expect(box().textContent).toContain('New PIN for Léa');
    expect(box().textContent).toContain('6 to 16 digits. Avoid runs and repeats.');
    const field = box().querySelector<HTMLInputElement>('input')!;
    act(() => type(field, '123456'));
    expect(buttonIn(box(), 'Reset PIN').disabled).toBe(true);
    expect(box().querySelector('[id$="-reason"]')?.textContent).not.toBe('');

    act(() => type(field, '482916'));
    await act(async () => buttonIn(box(), 'Reset PIN').click());
    await page.settle();
    expect(page.writes()).toEqual([RESET]);
    expect(document.body.textContent).toContain('PIN updated.');
  });
});
