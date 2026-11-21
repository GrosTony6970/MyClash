import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import type * as Ui from '@myclash/ui';
import { mkRow } from '@/lib/live-board/live-board.fixtures';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import { LiveBoard } from './LiveBoard';

/**
 * Two tablets on one piste (ruling 953). Two volunteers opened the pad for the
 * same piste and both scored its bout; nothing told the organiser. The board
 * now says so on the piste's row, and blocks nothing.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('./BoardRowTimeline', () => ({ BoardRowTimeline: () => null }));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  useSecondsClock: () => ({
    nowMs: Date.parse('2026-07-21T10:00:00Z'),
    serverNowMs: Date.parse('2026-07-21T10:00:00Z'),
  }),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const piste = (id: string, name: string, tablets: number) =>
  mkRow({
    lice: {
      id,
      name,
      sortOrder: 0,
      locationLabel: null,
      colorHex: null,
      venue: null,
      area: null,
    },
    tablets,
  });

const board = (rows: object[]) => ({
  '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'running' },
  '/api/v1/events/ev1/live-board': {
    rows,
    progress: { completed: 0, total: 2 },
    accounts: [],
    eventSlug: 'open-2025',
  },
});

const warningsOf = (lice: string) =>
  [...document.body.querySelectorAll(`[data-lice-name="${lice}"]`)].flatMap((row) => [
    ...row.querySelectorAll('[data-testid="tablets-warning"]'),
  ]);

let page: OpenedPage;
afterEach(() => page.unmount());

describe('a piste two tablets score', () => {
  it('says so on its row, and nothing on a piste with one tablet', async () => {
    page = await openEventPage(
      <LiveBoard slug="org" eventId="ev1" />,
      board([piste('L1', 'Piste 1', 2), piste('L2', 'Piste 2', 1)]),
    );

    const warnings = warningsOf('Piste 1');
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) expect(w.getAttribute('aria-label')).toBe('2 tablets on this piste');
    expect(warningsOf('Piste 2')).toEqual([]);
  });
});
