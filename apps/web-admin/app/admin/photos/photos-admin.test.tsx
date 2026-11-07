import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformPhotoEvent } from '@myclash/types';
import { ToastProvider } from '@myclash/ui';
import * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import {
  photoReads,
  reportedRead,
  SUMMARY_READ,
  waitingRead,
} from '../../org/[slug]/events/[eventId]/photos/photos-page.fixtures';
import PlatformPhotosPage from './page';
import PlatformEventPhotosPage from './[eventId]/page';

/**
 * The platform's Photos page (rulings 491-494): the list of photo Events, then one Event's queue
 * moderated through the club's own routes, with no QR link, mode switch or download.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/admin/photos/ev1',
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

const LIST = '/api/v1/admin/photos/events';
const FORBIDDEN = Symbol('403');

const LYON: PlatformPhotoEvent = {
  id: 'ev1',
  name: 'Open 2025',
  clubName: 'Lyon AMHE',
  startDate: '2026-11-07',
  endDate: '2026-11-08',
  mode: 'approve',
  waiting: 2,
  reported: 1,
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Answers each read by its path; a write answers `{}`; every call is kept. */
async function open(page: ReactNode, reads: Record<string, unknown>) {
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (_base, path, init) => {
    if (init?.method && init.method !== 'GET') return { ok: true, data: {} } as never;
    const answer = reads[path];
    if (answer === FORBIDDEN) {
      return {
        ok: false,
        kind: 'unauthenticated',
        status: 403,
        detail: 'Forbidden',
        code: null,
        details: null,
      } as never;
    }
    if (answer === undefined) throw new Error(`unexpected read ${path}`);
    return { ok: true, data: answer } as never;
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en">
        <ToastProvider>{page}</ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

const text = () => document.body.textContent ?? '';
const calls = () =>
  vi
    .mocked(ApiClient.apiRequest)
    .mock.calls.map(([, path, init]) => `${init?.method ?? 'GET'} ${path}`);
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};

describe('the list of photo Events', () => {
  it('shows each Event with its club, mode and counts, and links to its queue', async () => {
    await open(<PlatformPhotosPage />, { [LIST]: [LYON] });
    expect(text()).toContain('Open 2025');
    expect(text()).toContain('Lyon AMHE');
    expect(text()).toContain('Approve first');
    const link = document.body.querySelector('a[href="/admin/photos/ev1"]');
    expect(link?.textContent).toBe('Open 2025');
  });

  it("names each mode in the club page's words", async () => {
    const modes = (['off', 'live', 'approve'] as const).map((mode, n) => ({
      ...LYON,
      id: `ev${n}`,
      mode,
    }));
    await open(<PlatformPhotosPage />, { [LIST]: modes });
    const cells = [...document.body.querySelectorAll('tbody tr')].map(
      (row) => row.querySelectorAll('td')[3]?.textContent,
    );
    expect(cells).toEqual(['Off', 'Live', 'Approve first']);
  });

  it('says so when no Event takes photos', async () => {
    await open(<PlatformPhotosPage />, { [LIST]: [] });
    expect(text()).toContain('No Event takes photos.');
  });

  it('tells a platform admin or viewer why it is refused (a 403)', async () => {
    await open(<PlatformPhotosPage />, { [LIST]: FORBIDDEN });
    expect(text()).toContain('Access denied. Super admin required.');
  });
});

describe("one Event's queue, for a super admin", () => {
  it('tells a platform admin or viewer who typed the address why it is refused (a 403)', async () => {
    await open(<PlatformEventPhotosPage />, { ...photoReads(), [SUMMARY_READ]: FORBIDDEN });
    expect(text()).toContain('Access denied. Super admin required.');
    expect(text()).not.toContain('The photos could not be loaded.');
  });

  it('reads the queue and the head, never the QR link, and offers no mode, link or download', async () => {
    await open(<PlatformEventPhotosPage />, photoReads());
    expect(calls()).toEqual(expect.arrayContaining([`GET ${SUMMARY_READ}`, `GET ${waitingRead}`]));
    expect(calls().some((call) => call.includes('/photos/link'))).toBe(false);
    expect(text()).toContain('Open 2025');
    expect(text()).toContain('Photos: Approve first');
    expect(document.body.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(button('New link')).toBeUndefined();
    expect(button('Download zip')).toBeUndefined();
  });

  it("approves, asks before deleting, and Keeps, through the club's routes", async () => {
    await open(<PlatformEventPhotosPage />, photoReads());
    await click(button('Approve')!);
    expect(calls()).toContain('POST /api/v1/events/ev1/photos/p1/approve');

    await click(button('Delete')!);
    expect(calls().filter((call) => call.startsWith('DELETE'))).toEqual([]);
    const dialog = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].pop()!;
    await click([...dialog.querySelectorAll('button')].pop()!);
    expect(calls()).toContain('DELETE /api/v1/events/ev1/photos/p1');

    await click(
      [...document.body.querySelectorAll('button')].find((b) =>
        b.textContent?.startsWith('Reported'),
      )!,
    );
    expect(calls()).toContain(`GET ${reportedRead}`);
    await click(button('Keep')!);
    expect(calls()).toContain('POST /api/v1/events/ev1/photos/p3/keep');
  });
});
