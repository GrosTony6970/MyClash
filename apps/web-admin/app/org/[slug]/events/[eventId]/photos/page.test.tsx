import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_MODES, type PhotoQueuePage } from '@myclash/types';
import * as ApiClient from '@myclash/api-client';
import { FAILED_READ, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import EventPhotosPage from './page';
import { STALE_LINKS_MS } from '@/components/photos/usePhotoQueue';
import {
  allRead,
  LINK_READ,
  page as queuePage,
  photo,
  photoReads,
  SUMMARY,
  SUMMARY_READ,
  waitingRead,
} from './photos-page.fixtures';

/**
 * The organiser's Photos page (design, "Moderation"; slice 5a): the mode, the QR code, the caps
 * and the queue, each write followed by a reload.
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
afterEach(() => {
  opened.unmount();
  vi.restoreAllMocks();
});

const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === label)!;
const reads = (path: string) =>
  vi.mocked(ApiClient.apiRequest).mock.calls.filter((call) => call[1] === path).length;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await opened.settle();
};
/** The confirm dialog's yes: the last button of the open dialog. */
const confirmYes = async () => {
  const dialog = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].pop()!;
  await click([...dialog.querySelectorAll('button')].pop()!);
};

const open = (reads = photoReads(), taken: Record<string, unknown> = {}) =>
  openEventPage(<EventPhotosPage />, reads, taken).then((p) => (opened = p));

describe('the head of the page', () => {
  it('says a read failed, and Refresh clears it once the read works', async () => {
    await open({ ...photoReads(), [SUMMARY_READ]: FAILED_READ });
    expect(text()).toContain('The photos could not be loaded.');

    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      path === SUMMARY_READ ? { ok: true as const, data: SUMMARY } : server(base, path, init),
    );
    await click(button('Refresh'));

    expect(text()).not.toContain('The photos could not be loaded.');
    expect(text()).toContain('12 / 300 photos this hour');
  });

  it('shows the stored mode, the caps, the deletion date and the waiting count', async () => {
    await open();

    const checked = document.body.querySelector<HTMLInputElement>(
      'input[name="photo-mode"]:checked',
    );
    expect(checked?.value).toBe('approve');
    expect(text()).toContain('12 / 300 photos this hour');
    expect(text()).toContain('2.5 GB / 15 GB stored');
    expect(text()).toContain('Every photo is deleted on 9 December 2026');
    expect(text()).toContain('Waiting (2)');
  });

  it('says so when photo storage is not set up', async () => {
    await open(photoReads({ summary: { storage: 'off' } }));
    expect(text()).toContain('Photo storage is not set up yet');
  });

  it('prints the upload link with its token in the hash', async () => {
    await open();
    expect(text()).toContain('/e/open-2025/photos/send#tok_1');
  });
});

describe('the mode', () => {
  it('lists Approve first between Off and Live, so an arrow key from Off never lands on Live', async () => {
    await open();
    const order = [
      ...document.body.querySelectorAll<HTMLInputElement>('input[name="photo-mode"]'),
    ].map((radio) => radio.value);
    expect(order).toEqual(['off', 'approve', 'live']);
    expect(new Set(order)).toEqual(new Set(PHOTO_MODES));
  });

  it('sends the chosen mode and reloads', async () => {
    await open(photoReads(), { 'PATCH /api/v1/events/ev1': {} });
    const before = reads(SUMMARY_READ);

    await click(document.body.querySelector<HTMLInputElement>('input[value="live"]')!);

    expect(opened.writes()).toEqual(['PATCH /api/v1/events/ev1']);
    expect(vi.mocked(ApiClient.apiRequest)).toHaveBeenCalledWith(
      'http://api.test',
      '/api/v1/events/ev1',
      { method: 'PATCH', body: { photoMode: 'live' } },
    );
    expect(reads(SUMMARY_READ)).toBe(before + 1);
  });

  it('says why a change was refused, and keeps showing the stored mode', async () => {
    await open();
    await click(document.body.querySelector<HTMLInputElement>('input[value="live"]')!);

    expect(text()).toContain('This event is archived and read-only.');
    const checked = document.body.querySelector<HTMLInputElement>(
      'input[name="photo-mode"]:checked',
    );
    expect(checked?.value).toBe('approve');
  });
});

describe('the queue', () => {
  it('approves a photo, then reloads', async () => {
    await open(photoReads(), { 'POST /api/v1/events/ev1/photos/p1/approve': {} });
    const before = reads(SUMMARY_READ);

    await click(button('Approve'));

    expect(opened.writes()).toEqual(['POST /api/v1/events/ev1/photos/p1/approve']);
    expect(reads(SUMMARY_READ)).toBe(before + 1);
  });

  it('asks before a delete, and sends nothing when the answer is no', async () => {
    await open(photoReads(), { 'DELETE /api/v1/events/ev1/photos/p1': null });

    await click(button('Delete'));
    expect(text()).toContain('Delete this photo?');
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!);
    expect(opened.writes()).toEqual([]);

    await click(button('Delete'));
    await confirmYes();
    expect(opened.writes()).toEqual(['DELETE /api/v1/events/ev1/photos/p1']);
  });

  it('says a photo another organiser deleted is gone, in the reader’s words', async () => {
    await open();
    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      path.endsWith('/approve')
        ? {
            ok: false,
            kind: 'http',
            status: 404,
            detail: 'This photo is not in this Event.',
            code: 'photo_not_found',
            validationErrors: null,
            details: null,
          }
        : server(base, path, init),
    );
    const before = reads(SUMMARY_READ);

    await click(button('Approve'));

    expect(text()).toContain('This photo was already deleted.');
    expect(text()).not.toContain('This photo is not in this Event.');
    expect(reads(SUMMARY_READ)).toBe(before + 1);
  });

  it('opens the original in a new tab, and shows a tile for a photo with no link', async () => {
    await open(
      photoReads({
        waiting: queuePage([photo('p1'), photo('p2', { previewUrl: null, originalUrl: null })]),
      }),
    );

    const link = document.body.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
    expect(link.href).toBe('https://bucket.test/p1/original.jpg?sig=1');
    expect(link.rel).toBe('noopener noreferrer');
    expect(document.body.querySelectorAll('img')).toHaveLength(1);
    expect(text()).toContain('Image unavailable');
  });

  it('loads the next page after the cursor, and appends it', async () => {
    const cursor = '2026-11-07T14:00:00.123456+00:00';
    const more = `${allRead}&before=${encodeURIComponent(cursor)}`;
    await open({
      ...photoReads({ all: queuePage([photo('p1')], cursor) }),
      [more]: queuePage([photo('p9', { uploaderName: 'Zoé' })]),
    });
    await click(button('All'));

    await click(button('Load more'));

    expect(reads(more)).toBe(1);
    expect(text()).toContain('Léa');
    expect(text()).toContain('Zoé');
  });

  it('drops a Waiting page 2 that answers after the tab moved to All, and sends one at a time', async () => {
    const cursor = '2026-11-07T14:00:00.123456+00:00';
    const more = `${waitingRead}&before=${encodeURIComponent(cursor)}`;
    await open(
      photoReads({ waiting: queuePage([photo('p1')], cursor), all: queuePage([photo('p5')]) }),
    );
    // Page 2 of Waiting answers only when the test says so.
    let answer: (value: unknown) => void = () => undefined;
    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      path === more
        ? new Promise((resolve) => (answer = resolve)).then(() => ({
            ok: true as const,
            data: queuePage([photo('p9', { uploaderName: 'Zoé' })]),
          }))
        : server(base, path, init),
    );

    await click(button('Load more'));
    await click(button('Load more'));
    expect(reads(more)).toBe(1);

    await click(button('All'));
    await act(async () => answer(undefined));
    await opened.settle();

    expect(text()).not.toContain('Zoé');
  });

  it('retires the QR code only after asking, then reads the new link', async () => {
    await open(photoReads(), { 'POST /api/v1/events/ev1/photos/link/rotate': {} });
    const before = reads(LINK_READ);

    await click(button('New link'));
    await confirmYes();

    expect(opened.writes()).toEqual(['POST /api/v1/events/ev1/photos/link/rotate']);
    expect(reads(LINK_READ)).toBe(before + 1);
  });
});

describe('an image that does not load', () => {
  const failImages = async () => {
    await act(async () => {
      for (const img of document.body.querySelectorAll('img'))
        img.dispatchEvent(new Event('error'));
    });
    await opened.settle();
  };

  it('on a fresh read, shows the tile as unavailable and reloads nothing', async () => {
    await open();
    const before = reads(SUMMARY_READ);
    const loaded = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(loaded + 2 * 60_000);

    await failImages();

    expect(reads(SUMMARY_READ)).toBe(before);
    expect(text()).toContain('Image unavailable');
  });

  it('on a read older than its links, reloads once however many images fail', async () => {
    await open();
    const before = reads(SUMMARY_READ);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + STALE_LINKS_MS + 60_000);

    await failImages();

    expect(reads(SUMMARY_READ)).toBe(before + 1);
  });

  it('tries the fresh links, and cannot loop when they break too', async () => {
    await open();
    const before = reads(SUMMARY_READ);
    // From now on the server signs fresh links.
    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
      const res = await server(base, path, init);
      if (path !== waitingRead || !res.ok) return res;
      const fresh = (res.data as PhotoQueuePage).photos.map((p) => ({
        ...p,
        previewUrl: `${p.previewUrl}&fresh=1`,
      }));
      return { ...res, data: { photos: fresh, next: null } };
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + STALE_LINKS_MS + 60_000);
    await failImages();
    expect(reads(SUMMARY_READ)).toBe(before + 1);
    expect(document.body.querySelectorAll('img')).toHaveLength(2);

    // The bucket is down: the fresh links break too, on a read made at the same clock.
    await failImages();

    expect(reads(SUMMARY_READ)).toBe(before + 1);
    expect(text()).toContain('Image unavailable');
  });
});
