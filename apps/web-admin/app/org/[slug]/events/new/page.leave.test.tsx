import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type, type OpenedPage } from '../[eventId]/archived-page.fixtures';
import NewEventPage from './page';

/**
 * O12 (ruled 2026-10-14): the new-Event wizard asks before its own exits. A stray "Cancel"
 * threw away four steps of dates, venue and pistes.
 */
const NAVIGATION = vi.hoisted(() => {
  const pushed: string[] = [];
  return { pushed, router: { push: (to: string) => pushed.push(to), replace: () => undefined } };
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club' }),
  useRouter: () => NAVIGATION.router,
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

const READS = { '/api/v1/organizations/org-1/venues': [] };

let page: OpenedPage;
afterEach(() => {
  page.unmount();
  NAVIGATION.pushed.length = 0;
});

function buttonNamed(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no "${label}" button`);
  return found;
}

async function tap(label: string) {
  await act(async () => buttonNamed(label).click());
  await page.settle();
}

const question = () => document.body.querySelector('[role="dialog"]');
const nameField = () => document.body.querySelector<HTMLInputElement>('#wizard-event-name')!;

describe('the new-Event wizard asks before it is left', () => {
  it('asks before Cancel throws the typing away: Stay keeps it, Leave goes', async () => {
    page = await openEventPage(<NewEventPage />, READS);
    act(() => type(nameField(), 'Open 2027'));

    await tap('Cancel');
    expect(question()?.textContent).toContain('Leave without saving?');
    await tap('Stay');
    expect(NAVIGATION.pushed).toEqual([]);
    expect(nameField().value).toBe('Open 2027');

    await tap('club');
    await tap('Leave');
    expect(NAVIGATION.pushed).toEqual(['/org/club']);
  });

  it('leaves an empty form at once', async () => {
    page = await openEventPage(<NewEventPage />, READS);
    await tap('Cancel');
    expect(question()).toBeNull();
    expect(NAVIGATION.pushed).toEqual(['/org/club']);
  });
});
