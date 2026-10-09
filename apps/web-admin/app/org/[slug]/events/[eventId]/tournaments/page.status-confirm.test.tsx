import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import TournamentsPage from './page';

/**
 * "Completed" tells a Tournament's fighters that its results are out, and a
 * notice that left cannot be taken back. "Archived" takes it off the public
 * pages. A slip on the status menu, or on Archive, sends nothing until the
 * organiser says yes (quick win O1).
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/tournaments',
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
vi.mock('./_components/AttachToLeaguePanel', () => ({
  AttachToLeaguePanel: () => null,
}));

const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [
    { id: 't-1', slug: 'longsword', name: 'Longsword', status: 'running' },
  ],
};
const SAVE = 'PATCH /api/v1/tournaments/t-1';
/** The body of the one save the page sent. */
const saved = () =>
  vi.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === 'PATCH')?.[2]?.body;

let page: OpenedPage;
afterEach(() => page.unmount());

const open = async () => {
  page = await openEventPage(<TournamentsPage />, READS, { [SAVE]: {} });
};
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const statusMenu = () => document.body.querySelector<HTMLSelectElement>('select')!;
const press = async (label: string, within: ParentNode = document.body) => {
  const button = [...within.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
const pick = async (status: string) => {
  await act(async () => type(statusMenu(), status));
  await page.settle();
};

describe('the status menu of a Tournament', () => {
  it('sends "published" at once: nobody is told and nothing is hidden', async () => {
    await open();
    await pick('published');
    expect(dialog()).toBeNull();
    expect(page.writes()).toEqual([SAVE]);
  });

  it('asks before "completed", naming the Tournament and the notice', async () => {
    await open();
    await pick('completed');
    expect(page.writes()).toEqual([]);
    expect(dialog()?.textContent).toContain('Mark "Longsword" as completed?');
    expect(dialog()?.textContent).toContain(
      'its fighters who have an account are told that the results are out',
    );
  });

  it('sends nothing and keeps the old status when the organiser says no', async () => {
    await open();
    await pick('completed');
    await press('Cancel', dialog()!);
    expect(dialog()).toBeNull();
    expect(page.writes()).toEqual([]);
    expect(statusMenu().value).toBe('running');
  });

  it('sends "completed" once the organiser says yes', async () => {
    await open();
    await pick('completed');
    await press('Mark as completed', dialog()!);
    expect(page.writes()).toEqual([SAVE]);
    expect(saved()).toEqual({ status: 'completed' });
  });

  it('asks before "archived", naming what the public loses', async () => {
    await open();
    await pick('archived');
    expect(page.writes()).toEqual([]);
    expect(dialog()?.textContent).toContain('Archive "Longsword"?');
    expect(dialog()?.textContent).toContain('leaves the public pages');
  });
});

describe('the Archive button of a Tournament', () => {
  it('asks the same question, and sends nothing on no', async () => {
    await open();
    await press('Archive');
    expect(dialog()?.textContent).toContain('Archive "Longsword"?');
    await press('Cancel', dialog()!);
    expect(page.writes()).toEqual([]);
  });

  it('archives on yes', async () => {
    await open();
    await press('Archive');
    await press('Archive', dialog()!);
    expect(page.writes()).toEqual([SAVE]);
    expect(saved()).toEqual({ status: 'archived' });
  });
});
