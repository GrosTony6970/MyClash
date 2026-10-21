import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, type ApiResult } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PenaltyReviewsPage from './page';

/**
 * O11 (ruled 2026-10-14): Dismiss asks first; both buttons are off while one answer is saved;
 * a resolved review shows its date on the Event's clock; a dismissed one keeps "Disqualify
 * after all". Dismiss was one tap beside "Confirm disqualification".
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/penalties',
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

const review = (id: string, status: string, reviewedAt: string | null = null) => ({
  id,
  tournament_id: 't-1',
  registration_id: 'r-1',
  review_type: 'second_black_card',
  status,
  black_card_count: 2,
  created_at: '2026-10-14T09:00:00Z',
  reviewed_at: reviewedAt,
  updated_at: SEEN,
});
const SEEN = '2026-10-14T09:30:00.123456+00:00';
const EVENT = { id: EVENT_ID, name: 'Open 2026', status: 'running', timezone: 'America/New_York' };
const readsWith = (reviews: unknown[], event: object = EVENT) => ({
  [`/api/v1/events/${EVENT_ID}`]: event,
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [{ id: 't-1', name: 'Longsword' }],
  [`/api/v1/events/${EVENT_ID}/registrations`]: [
    { id: 'r-1', personId: 'p-1', tournamentId: 't-1' },
  ],
  [`/api/v1/events/${EVENT_ID}/persons`]: [{ id: 'p-1', givenName: 'Ana', familyName: 'Roux' }],
  '/api/v1/tournaments/t-1/penalty-reviews': reviews,
});
const ANSWER = (id: string) => `PATCH /api/v1/tournament-penalty-reviews/${id}`;

let page: OpenedPage;
afterEach(() => page.unmount());

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const buttons = (label: string, within: ParentNode = document.body) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === label);
const button = (label: string, within: ParentNode = document.body) => buttons(label, within)[0]!;
/** A pending review, and a confirmed one with its own Dismiss (ruling 119). */
const BOTH_DISMISSES = [
  review('rv-1', 'pending'),
  review('rv-3', 'confirmed', '2026-10-14T10:00:00Z'),
];
async function tap(target: HTMLElement) {
  await act(async () => target.click());
  await page.settle();
}
const sentBodies = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => init?.method === 'PATCH')
    .map(([, , init]) => init?.body);

describe('answering a penalty review', () => {
  it('asks before Dismiss, and No sends nothing', async () => {
    page = await openEventPage(<PenaltyReviewsPage />, readsWith([review('rv-1', 'pending')]));
    await tap(button('Dismiss'));
    expect(dialog()?.textContent).toContain(
      'Dismiss the review of Ana Roux in Longsword? They stay in the tournament.',
    );
    await tap(button('Cancel', dialog()!));
    expect(page.writes()).toEqual([]);
  });

  it('closes every answer while one is being saved', async () => {
    page = await openEventPage(<PenaltyReviewsPage />, readsWith(BOTH_DISMISSES));
    const served = vi.mocked(apiRequest).getMockImplementation()!;
    let land: (value: ApiResult<unknown>) => void = () => undefined;
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'PATCH'
        ? new Promise<ApiResult<unknown>>((resolve) => {
            land = resolve;
          })
        : served(base, path, init),
    );
    await tap(button('Dismiss'));
    await tap(button('Dismiss', dialog()!));
    expect(buttons('Dismiss').map((b) => b.disabled)).toEqual([true, true]);
    expect(button('Confirm disqualification').disabled).toBe(true);
    await act(async () => land({ ok: true, data: {} }));
    await page.settle();
    expect(sentBodies()).toEqual([{ status: 'dismissed', seenUpdatedAt: SEEN }]);
  });

  it('dates a resolved review on the Event clock', async () => {
    page = await openEventPage(
      <PenaltyReviewsPage />,
      readsWith([review('rv-1', 'confirmed', '2026-10-14T23:30:00Z')]),
    );
    // 23:30 UTC is 19:30 in New York.
    expect(document.body.querySelector('li')?.textContent).toMatch(/19:30/);
  });

  it('keeps "Disqualify after all" on a dismissed review, and it sends the disqualification', async () => {
    page = await openEventPage(
      <PenaltyReviewsPage />,
      readsWith([review('rv-2', 'dismissed', '2026-10-14T10:00:00Z')]),
      { [ANSWER('rv-2')]: {} },
    );
    await tap(button('Disqualify after all'));
    expect(dialog()?.textContent).toContain('Disqualify Ana Roux from Longsword?');
    await tap([...dialog()!.querySelectorAll<HTMLButtonElement>('button')].pop()!);
    expect(page.writes()).toEqual([ANSWER('rv-2')]);
    expect(sentBodies()).toEqual([{ status: 'confirmed', seenUpdatedAt: SEEN }]);
  });

  it('offers Dismiss on a confirmed review, saying she comes back, and sends it (ruling 119)', async () => {
    page = await openEventPage(
      <PenaltyReviewsPage />,
      readsWith([review('rv-3', 'confirmed', '2026-10-14T10:00:00Z')]),
      { [ANSWER('rv-3')]: {} },
    );
    expect(button('Dismiss'), 'a confirmed review offers Dismiss').toBeDefined();
    await tap(button('Dismiss'));
    expect(dialog()?.textContent).toContain(
      'If nothing else holds them out, they come back in the tournament',
    );
    await tap(button('Cancel', dialog()!));
    expect(page.writes()).toEqual([]);
    await tap(button('Dismiss'));
    await tap(button('Dismiss', dialog()!));
    expect(page.writes()).toEqual([ANSWER('rv-3')]);
    expect(sentBodies()).toEqual([{ status: 'dismissed', seenUpdatedAt: SEEN }]);
  });

  it('a confirmed disqualification says the Pool bouts will be forfeited (ruling 78)', async () => {
    page = await openEventPage(<PenaltyReviewsPage />, readsWith([review('rv-1', 'pending')]));
    await tap(button('Confirm disqualification'));
    expect(dialog()?.textContent).toContain('their remaining Pool bouts are forfeited');
  });

  // From the review of push 3: a card that landed after the page read the review.
  it('says a new card changed the review, and reads it again, when the answer is refused', async () => {
    page = await openEventPage(<PenaltyReviewsPage />, readsWith([review('rv-1', 'pending')]));
    const served = vi.mocked(apiRequest).getMockImplementation()!;
    const reads = () =>
      vi.mocked(apiRequest).mock.calls.filter(([, path]) => path.endsWith('/penalty-reviews'))
        .length;
    const before = reads();
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'PATCH'
        ? {
            ok: false,
            kind: 'http',
            status: 409,
            detail: 'changed',
            validationErrors: null,
            code: 'penalty_review_changed',
            details: null,
          }
        : served(base, path, init),
    );
    await tap(button('Dismiss'));
    await tap(button('Dismiss', dialog()!));
    expect(document.body.textContent).toContain(
      'A new black card changed the review of Ana Roux since it was shown.',
    );
    expect(reads()).toBeGreaterThan(before);
  });

  it('closes every answer on an archived Event', async () => {
    page = await openEventPage(
      <PenaltyReviewsPage />,
      readsWith([...BOTH_DISMISSES, review('rv-2', 'dismissed', '2026-10-14T10:00:00Z')], {
        ...EVENT,
        status: 'archived',
      }),
    );
    expect(buttons('Dismiss').map((b) => b.disabled)).toEqual([true, true]);
    for (const label of ['Confirm disqualification', 'Disqualify after all']) {
      expect(button(label).disabled, label).toBe(true);
    }
  });
});
