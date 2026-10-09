import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import type * as Ui from '@myclash/ui';
import { mkRow } from '@/lib/live-board/live-board.fixtures';
import { openArchivedPage, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import { LiveBoard } from './LiveBoard';

/**
 * The Live board of an Event (rulings 377, 378). On an archived Event an alert
 * is not taken and a piste's scorer is not changed: the server refuses both.
 * And a save the server refuses says why: the row used to snap back with no word.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
// The open row's hit-by-hit timeline is a realtime subscription, and not this test's subject.
vi.mock('./BoardRowTimeline', () => ({ BoardRowTimeline: () => null }));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  useSecondsClock: () => ({ nowMs: Date.parse('2026-07-21T10:00:00Z') }),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const account = (accountId: string, name: string) => ({
  accountId,
  name,
  username: name.toLowerCase(),
  status: 'active',
  lastSeenAt: null,
  liceIds: [],
});

const READS = {
  '/api/v1/events/ev1/live-board': {
    rows: [mkRow({ attention: { reason: 'medic' } })],
    progress: { completed: 1, total: 4 },
    accounts: [account('a1', 'Léa'), account('a2', 'Tom')],
    eventSlug: 'open-2025',
  },
};

const board = <LiveBoard slug="org" eventId="ev1" />;

/** Opens the piste's row, so its scorer picker is on the page. */
async function expandRow(page: OpenedPage) {
  const toggle = document.body.querySelector<HTMLButtonElement>('[data-testid="live-row"] button');
  await act(async () => toggle!.click());
  await page.settle();
}

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the Live board of an archived Event', () => {
  it('takes no alert and changes no scorer', async () => {
    page = await openArchivedPage(board, READS);
    await expandRow(page);
    expect(document.body.querySelector('select')).not.toBeNull();

    await page.pressEverything(1);

    expect(page.writes()).toEqual([]);
  });
});

describe('a save of the Live board the server refuses', () => {
  it('says the server’s reason', async () => {
    // The Event archived itself while the board was open: the board still reads "running".
    page = await openEventPage(board, {
      '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'running' },
      ...READS,
    });
    const take = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Medic'),
    );

    await act(async () => take!.click());
    await page.settle();

    expect(page.writes()).toEqual(['POST /api/v1/events/ev1/live/attention/a1/ack']);
    expect(document.body.textContent).toContain('This event is archived');
  });
});
