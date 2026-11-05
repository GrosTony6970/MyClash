import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import EventPhotosPage from './page';
import {
  LAST_REPORT,
  photo,
  photoReads,
  reportedPhoto,
  reportedRead,
  SUMMARY_READ,
} from './photos-page.fixtures';

/**
 * The Reported tab and Keep on the organiser's Photos page (slice 4c; rulings 452, 454-457): each
 * reported photo with its count and comments, and Keep, which clears the reports the page showed.
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

const KEEP = 'POST /api/v1/events/ev1/photos/p3/keep';

let opened: OpenedPage;
afterEach(() => {
  opened.unmount();
  vi.restoreAllMocks();
});

const text = () => document.body.textContent ?? '';
const buttons = (label: string) =>
  [...document.body.querySelectorAll('button')].filter((b) => b.textContent === label);
const reads = (path: string) =>
  vi.mocked(ApiClient.apiRequest).mock.calls.filter((call) => call[1] === path).length;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await opened.settle();
};
const open = (reads = photoReads(), taken: Record<string, unknown> = {}) =>
  openEventPage(<EventPhotosPage />, reads, taken).then((p) => (opened = p));
const showTab = async (name: string) => {
  const tab = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.startsWith(name),
  )!;
  await click(tab);
};
const showReported = () => showTab('Reported');

describe('the Reported tab', () => {
  it('shows the Reported tab with its count, and reads the reported page', async () => {
    await open();
    expect(text()).toContain('Reported (1)');
    expect(reads(reportedRead)).toBe(0);

    await showReported();

    expect(reads(reportedRead)).toBe(1);
  });

  it('shows the report count and every comment of a reported photo, newest first', async () => {
    await open();
    await showReported();

    expect(text()).toContain('Reports: 3');
    const list = document.body.querySelector('ul[aria-label="Comments from the reports"]')!;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'this is me, please remove',
      'blurry',
    ]);
  });

  it('shows the count and Keep in All too (ruling 456), and no Keep on a photo with no report', async () => {
    await open(photoReads({ all: { photos: [photo('p1'), reportedPhoto()], next: null } }));
    await showTab('All');

    expect(text()).toContain('Reports: 3');
    expect(buttons('Keep')).toHaveLength(1);
    expect(
      document.body.querySelectorAll('ul[aria-label="Comments from the reports"]'),
    ).toHaveLength(1);
  });
});

describe('Keep', () => {
  it('keeps a photo at once with the newest report shown, then reloads', async () => {
    await open(photoReads(), { [KEEP]: { id: 'p3', kept: true } });
    await showReported();
    const before = reads(SUMMARY_READ);

    await click(buttons('Keep')[0]!);

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(opened.writes()).toEqual([KEEP]);
    const sent = vi
      .mocked(ApiClient.apiRequest)
      .mock.calls.find((call) => call[1] === '/api/v1/events/ev1/photos/p3/keep');
    expect(sent?.[2]).toMatchObject({ method: 'POST', body: { reportsUpTo: LAST_REPORT } });
    expect(reads(SUMMARY_READ)).toBe(before + 1);
  });

  it('says a kept photo another organiser deleted is gone, in the reader’s words', async () => {
    await open();
    await showReported();
    const server = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
      path.endsWith('/keep')
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

    await click(buttons('Keep')[0]!);

    expect(text()).toContain('This photo was already deleted.');
    expect(text()).not.toContain('This photo is not in this Event.');
  });
});
