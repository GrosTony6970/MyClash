import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { type } from '../../../archived-page.fixtures';
import { button } from './page.fixtures';
import { openTab, switchTo, type OpenedTab } from './page.rules.fixtures';

/**
 * The Locks tab shows the auto-lock in force, as the API answers it (`effectiveRules.lock`: what
 * the auto-lock worker applies), and a Save sends only what the organiser changed (operator
 * rulings 43, 46). It read a key the API never sends and showed "off, 30 min" for every
 * Tournament, and its untouched Save turned auto-lock off.
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

const switches = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
const delayField = () => document.body.querySelector<HTMLInputElement>('input[type="number"]');
const shown = () => ({
  on: switches().map((s) => s.getAttribute('aria-checked')),
  delay: delayField()?.value,
});

/** The auto-lock in force: 45 minutes, which the raw column (NULL) does not hold. */
const IN_FORCE = {
  autoLockEnabled: false,
  autoLockDelayMinutes: 45,
  autoLockCompletedPools: true,
  autoLockCompletedBrackets: false,
};

async function save() {
  await act(async () => button('Save changes').click());
  await opened.page.settle();
}

describe('the Locks tab', () => {
  it('shows the auto-lock in force, not the raw column, and an untouched Save sends nothing', async () => {
    opened = await openTab('locks', {
      row: { lock_config_json: null },
      effectiveRules: { lock: IN_FORCE },
    });
    expect(shown()).toEqual({ on: ['false', 'true', 'false'], delay: '45' });

    await save();
    expect(opened.saved).toEqual([]);
    expect(document.body.textContent).toContain('No changes to save');
  });

  it('sends exactly the setting changed, and a change undone after a save', async () => {
    // Auto-lock on: the delay is a field the organiser can use.
    opened = await openTab('locks', {
      effectiveRules: { lock: { ...IN_FORCE, autoLockEnabled: true } },
    });
    await act(async () => type(delayField()!, '60'));
    await save();
    await act(async () => type(delayField()!, '45'));
    await save();
    expect(opened.saved).toEqual([
      { lockConfig: { autoLockDelayMinutes: 60 } },
      { lockConfig: { autoLockDelayMinutes: 45 } },
    ]);
  });

  it('shows the auto-lock in force once its rules are read, none before', async () => {
    opened = await openTab('basics');
    const read = opened.hold();
    await switchTo(opened.page, 'locks');
    expect(switches()).toEqual([]);

    await read.release();
    expect(shown().delay).toBe('15');
  });
});
