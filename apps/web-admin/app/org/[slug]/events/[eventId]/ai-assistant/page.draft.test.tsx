import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { apiRequest } from '@myclash/api-client';
import { openEventPage, refused, type OpenedPage } from '../archived-page.fixtures';
import {
  DRAFT_ID,
  DRAFT_READ,
  DRAFTS_READ,
  EACH_KIND,
  OLDER_DRAFT_ID,
  POOLS,
  POOLS_EN,
  POOLS_FR,
  UUID,
  draftOf,
  httpFailure,
} from './draft.fixtures';
import EventAIAssistantPage from './page';

/**
 * The assistant page opens one draft from a link and shows it in words (rulings 989, 993; call
 * V): `?draft=<id>` reads that draft, even one older than the list's newest 50. Never an id,
 * never JSON. After Apply or Reject it reads the draft again (ruling 997 for a partly applied one).
 */
const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: nav.replace, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/ai-assistant',
  useSearchParams: () => new URLSearchParams(nav.search),
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

const PUBLISHED = { id: 'ev1', name: 'Open 2026', status: 'published' };

/** The page's reads, the open draft's answer among them; the list holds `listed`. */
const reads = (draft: unknown, listed: unknown[] = []) => ({
  '/api/v1/events/ev1': PUBLISHED,
  '/api/v1/organizations/org-1/ai-settings': { provider: 'anthropic' },
  '/api/v1/events/ev1/tournaments': [],
  [DRAFTS_READ]: listed,
  [DRAFT_READ]: draft,
});

const text = () => document.body.textContent ?? '';
const button = (name: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === name);
const draftReads = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, path, init]) => path === DRAFT_READ && !init?.method);

let page: OpenedPage;
beforeEach(() => {
  nav.search = `draft=${DRAFT_ID}`;
  nav.replace.mockReset();
});
afterEach(() => page.unmount());

describe('the assistant page opens the draft a link names', () => {
  it('reads it by its id, though the list does not hold it, and shows it in words', async () => {
    page = await openEventPage(<EventAIAssistantPage />, reads(draftOf([POOLS])));

    expect(draftReads()).toHaveLength(1);
    expect(text()).toContain(POOLS_EN);
    expect(text()).not.toMatch(UUID);
    expect(document.body.querySelector('textarea#ai-assistant-actions')).toBeNull();
    expect(button('Save')).toBeUndefined();
  });

  it('says in French what the draft does, for a French organiser', async () => {
    page = await openEventPage(
      <EventAIAssistantPage />,
      reads(draftOf([POOLS])),
      {},
      {
        locale: 'fr',
      },
    );

    expect(text()).toContain(POOLS_FR);
  });

  it('says the draft is not at this Event, not the API sentence that names the id', async () => {
    const notFound = httpFailure(404, 'not_found', `AI assistant draft ${DRAFT_ID} not found`);
    page = await openEventPage(<EventAIAssistantPage />, reads(refused(notFound)));

    expect(text()).toContain('This draft is not at this Event.');
    expect(text()).not.toContain('not found');
    expect(text()).not.toMatch(UUID);
  });

  it.each(EACH_KIND)('shows a %s action by name, never an id', async (_kind, action, line) => {
    page = await openEventPage(<EventAIAssistantPage />, reads(draftOf([action])));

    expect(text()).toContain(line);
    expect(text()).not.toMatch(UUID);
  });

  it('names the open draft in the address, so a reload keeps it', async () => {
    nav.search = '';
    const older = draftOf([POOLS], { id: OLDER_DRAFT_ID });
    page = await openEventPage(<EventAIAssistantPage />, reads(draftOf([]), [older]));

    const listed = [...document.body.querySelectorAll('aside button')];
    expect(listed).toHaveLength(1);
    await act(async () => (listed[0] as HTMLButtonElement).click());

    expect(nav.replace).toHaveBeenCalledWith(
      `/org/club/events/ev1/ai-assistant?draft=${OLDER_DRAFT_ID}`,
      { scroll: false },
    );
  });
});

describe('Apply and Reject', () => {
  it('after Apply, the draft reads again and shows it was applied', async () => {
    let applied = false;
    const draft = () =>
      applied ? draftOf([POOLS], { status: 'applied', applyStarted: true }) : draftOf([POOLS]);
    page = await openEventPage(<EventAIAssistantPage />, reads(draft), {
      [`POST ${DRAFT_READ}/apply`]: { ok: true },
    });
    applied = true;

    await act(async () => button('Apply')?.click());
    await page.settle();

    expect(page.writes()).toEqual([`POST ${DRAFT_READ}/apply`]);
    expect(draftReads()).toHaveLength(2);
    expect(document.body.querySelector('span.rounded-full.bg-border')?.textContent).toBe('Applied');
    expect(button('Apply')).toBeUndefined();
    expect(button('Reject')).toBeUndefined();
  });

  it('a partly applied draft says so, and offers neither Apply nor Reject (ruling 997)', async () => {
    const partly = draftOf([POOLS], { status: 'failed', applyStarted: true });
    page = await openEventPage(<EventAIAssistantPage />, reads(partly));

    expect(text()).toContain(
      'Partly applied before it failed. It cannot be applied again or rejected.',
    );
    expect(button('Apply')).toBeUndefined();
    expect(button('Reject')).toBeUndefined();
  });

  it('a draft that failed its check is not partly applied: it can still be rejected', async () => {
    page = await openEventPage(
      <EventAIAssistantPage />,
      reads(draftOf([POOLS], { status: 'failed' })),
    );

    expect(text()).not.toContain('Partly applied');
    expect(button('Reject')?.disabled).toBe(false);
  });

  it.each([
    ['Apply', 'POST', '/apply'],
    ['Reject', 'PATCH', ''],
  ])('%s of a draft closed in another tab says so in words', async (name, method, suffix) => {
    const closed = httpFailure(409, 'draft_closed', 'This draft is already applied.');
    page = await openEventPage(<EventAIAssistantPage />, reads(draftOf([POOLS])), {
      [`${method} ${DRAFT_READ}${suffix}`]: refused(closed),
    });

    await act(async () => button(name)?.click());
    await page.settle();

    expect(text()).toContain(
      'This draft is already applied, partly applied or rejected, perhaps in another tab.',
    );
    expect(text()).not.toContain('This draft is already applied.');
  });
});
