import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { alertText, hasSave, openTab, switchTo, type OpenedTab } from './page.rules.fixtures';

/**
 * Every rules tab shows no form and no Save before its rules are read, an error and a Retry (and
 * no Save) when they cannot be, and its form again once Retry reads them (operator ruling 46). Each
 * tab wires the gate itself (`RulesFormState`), so each is opened here.
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

let opened: OpenedTab;
afterEach(() => opened.page.unmount());

const TABS = ['match-format', 'display', 'advanced', 'locks'];
const retry = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>('[role="alert"] button')].find(
    (b) => b.textContent === 'Retry',
  );

describe.each(TABS)('the %s tab', (tab) => {
  it('shows no Save before its rules are read, and its Save once they are', async () => {
    opened = await openTab('basics');
    const read = opened.hold();
    await switchTo(opened.page, tab);
    expect(hasSave()).toBe(false);
    const statuses = [...document.body.querySelectorAll('[role="status"]')];
    expect(statuses.some((s) => s.textContent?.includes('Loading'))).toBe(true);

    await read.release();
    expect(hasSave()).toBe(true);
  });

  it('shows the error, a Retry and no Save when the read fails; Retry reads them again', async () => {
    opened = await openTab(tab, { read: 'failed' });
    expect(alertText()).toContain('Could not load the rules');
    expect(retry()).toBeDefined();
    expect(hasSave()).toBe(false);

    opened.heal();
    await act(async () => retry()!.click());
    await opened.page.settle();
    expect(alertText()).toBeNull();
    expect(hasSave()).toBe(true);
  });

  it('shows the error and no Save when the API cannot answer the rules in force', async () => {
    opened = await openTab(tab, { effectiveRules: null });
    expect(alertText()).toContain('Could not load the rules');
    expect(hasSave()).toBe(false);
  });
});
