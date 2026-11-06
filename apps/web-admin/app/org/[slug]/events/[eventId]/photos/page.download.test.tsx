import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { FAILED_READ, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import EventPhotosPage from './page';
import { photoReads, SUMMARY, SUMMARY_READ, WORKSHOPS_READ } from './photos-page.fixtures';

/**
 * "Download all" on the organiser's Photos page (design Goal 10; rulings 467-471): the choice of
 * photos, the spreadsheet photos.csv is written for, the deletion date, and a click that checks
 * the login and the photos are still there before the browser follows the zip's link.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/photos',
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

let opened: OpenedPage;
let followed: Array<{ href: string; download: string }>;
/** A week before the fixture's deletion instant (9 December 2026, 00:00 in Paris). */
const NOW = '2026-12-01T12:00:00.000Z';
beforeEach(() => {
  // Only the date: the page's settle waits on real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  opened.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const DOWNLOAD = 'http://api.test/api/v1/events/ev1/photos/download';
const text = () => document.body.textContent ?? '';
const section = () => document.querySelector<HTMLElement>('[aria-labelledby="photo-download"]');
const downloadButton = () =>
  [...(section()?.querySelectorAll('button') ?? [])].find((b) =>
    b.textContent?.startsWith('Download zip'),
  );
/** The summary's next read waits until the test answers it. */
function holdNextCheck() {
  const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
  let answer: () => void = () => undefined;
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
    if (path !== SUMMARY_READ) return server(base, path, init);
    await new Promise<void>((resolve) => (answer = resolve));
    return { ok: true as const, data: SUMMARY };
  });
  return () => act(async () => answer());
}
const reads = (path: string) =>
  vi.mocked(ApiClient.apiRequest).mock.calls.filter((call) => call[1] === path).length;

async function open(read = photoReads()) {
  followed = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    followed.push({ href: this.href, download: this.getAttribute('download') ?? '(none)' });
  });
  opened = await openEventPage(<EventPhotosPage />, read);
}

/** Opens the button's menu and picks the file for `choice`. */
async function download(choice: 'Excel (French)' | 'Excel (English), other apps') {
  await act(async () => downloadButton()!.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) =>
    b.textContent?.startsWith(choice),
  )!;
  await act(async () => item.click());
  await opened.settle();
}

function pick(value: string) {
  const select = section()!.querySelector('select')!;
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Download all', () => {
  it('says what the zip holds, until when, and that the copies are the organiser’s', async () => {
    await open();
    expect(section()!.textContent).toContain('deleted on 9 December 2026');
    expect(section()!.textContent).toContain('yours to keep safe and delete');
    expect(downloadButton()).toBeTruthy();
  });

  it('says so, and still offers the zip, when the deletion date cannot be read', async () => {
    await open(photoReads({ summary: { deletesAt: null } }));
    expect(section()!.textContent).toContain('Copies you download are yours');
    expect(section()!.textContent).not.toContain('deleted on');
    expect(downloadButton()).toBeTruthy();
  });

  it('offers no zip when photo storage is not set up (the usage box says why)', async () => {
    await open(photoReads({ summary: { storage: 'off' } }));
    expect(section()).toBeNull();
    expect(text()).toContain('Photo storage is not set up yet');
  });

  it('offers no zip once the photos are deleted', async () => {
    await open(photoReads({ summary: { deletesAt: '2026-01-01T00:00:00.000Z' } }));
    expect(section()!.textContent).toContain('The photos of this Event are deleted');
    expect(downloadButton()).toBeUndefined();
  });

  it('lists every photo, then each Tournament and each Workshop', async () => {
    await open();
    const options = [...section()!.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['All photos', 'Longsword Open', 'Rapier basics']);
    const groups = [...section()!.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Tournaments', 'Workshops']);
  });

  it('shows no empty group for an Event with no Workshop', async () => {
    await open({ ...photoReads(), [WORKSHOPS_READ]: [] });
    const groups = [...section()!.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Tournaments']);
  });

  it('offers all photos only, and says why, when a list cannot be read', async () => {
    await open({ ...photoReads(), [WORKSHOPS_READ]: FAILED_READ });
    expect([...section()!.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'All photos',
    ]);
    expect(section()!.textContent).toContain('could not be loaded: only all photos');
  });

  it('checks the login and the photos first, then follows the zip as a download', async () => {
    await open();
    const before = reads(SUMMARY_READ);
    await download('Excel (English), other apps');
    expect(reads(SUMMARY_READ)).toBe(before + 1);
    expect(followed).toEqual([{ href: `${DOWNLOAD}?csv=standard`, download: '' }]);
  });

  it('asks for one Tournament’s or one Workshop’s photos, and French Excel’s csv', async () => {
    await open();
    pick('tournament:t1');
    await download('Excel (French)');
    pick('workshop:w1');
    await download('Excel (English), other apps');
    expect(followed.map((f) => f.href)).toEqual([
      `${DOWNLOAD}?csv=excel-fr&tournamentId=t1`,
      `${DOWNLOAD}?csv=standard&workshopId=w1`,
    ]);
  });

  it('follows nothing and says so when the check fails', async () => {
    await open();
    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      path === SUMMARY_READ
        ? {
            ok: false as const,
            kind: 'http' as const,
            status: 503,
            detail: null,
            code: null,
            details: null,
            validationErrors: null,
          }
        : server(base, path, init),
    );
    await download('Excel (English), other apps');
    expect(followed).toEqual([]);
    expect(section()!.querySelector('[role="alert"]')?.textContent).toBe(
      'The download could not start.',
    );
  });

  it('follows nothing, and the page shows why, when the photos went in the meantime', async () => {
    await open();
    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      path === SUMMARY_READ
        ? { ok: true as const, data: { ...SUMMARY, storage: 'off' as const } }
        : server(base, path, init),
    );
    const before = reads(SUMMARY_READ);
    await download('Excel (English), other apps');
    expect(followed).toEqual([]);
    expect(text()).toContain('Photo storage is not set up yet');
    // The check, then the page's reload.
    expect(reads(SUMMARY_READ)).toBe(before + 2);
  });

  it('follows nothing, and says the photos are deleted, when the date passes with the page open', async () => {
    // Opened ten minutes before the deletion instant (00:00 on 9 December, Paris)...
    vi.setSystemTime(new Date('2026-12-08T22:50:00.000Z'));
    await open();
    expect(downloadButton()).toBeTruthy();
    // ...and clicked five minutes after it.
    vi.setSystemTime(new Date('2026-12-08T23:05:00.000Z'));
    await download('Excel (English), other apps');
    expect(followed).toEqual([]);
    expect(section()!.textContent).toContain('The photos of this Event are deleted');
    expect(downloadButton()).toBeUndefined();
  });

  it('starts one zip however often the organiser picks while the check runs', async () => {
    await open();
    const answer = holdNextCheck();
    await download('Excel (English), other apps');
    expect(downloadButton()!.disabled).toBe(true);
    await act(async () => downloadButton()!.click());
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    await answer();
    await opened.settle();
    expect(followed).toHaveLength(1);
    expect(downloadButton()!.disabled).toBe(false);
  });

  it('starts no zip when the organiser leaves the page while the check runs', async () => {
    await open();
    const answer = holdNextCheck();
    await download('Excel (English), other apps');
    opened.unmount();
    await answer();
    expect(followed).toEqual([]);
    // afterEach unmounts again: a second unmount of a root is harmless.
  });
});
