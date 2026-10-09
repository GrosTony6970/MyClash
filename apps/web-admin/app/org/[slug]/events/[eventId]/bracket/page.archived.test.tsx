import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type, type OpenedPage } from '../archived-page.fixtures';
import { UNFOUGHT_BRACKET, bracketReads } from './page.archived.fixtures';
import BracketPage from './page';

/**
 * The bracket page of an archived Event (ruling 377). The server refuses every
 * save this page has: a bracket is not drawn, drawn again, filled, re-seeded,
 * configured or deleted, no fighter, piste or referee is put on a bout, and no
 * new forfeit is recorded. The page offered all of them.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/bracket',
  useSearchParams: () => new URLSearchParams('tournamentId=t1'),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
// The referees tab has its own reads and its own archived gate: it is not this test's.
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const ARCHIVED = 'This event is archived and read-only.';
const sentOnce = (opened: OpenedPage) => [...new Set(opened.writes())].sort();
const panel = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].pop()!;
const named = (label: string, within: ParentNode = document.body) =>
  [...within.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);

async function press(button: HTMLButtonElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await page.settle();
}

/** Opens the override panel of the first bout, `m1`. */
async function openPanel() {
  await press(
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Override slot"]')!,
  );
}

/** One change in the override panel of bout `m1`, then its Save, then the panel is closed. */
async function saveInPanel(change: (selects: HTMLSelectElement[]) => Promise<void>) {
  await openPanel();
  await change([...panel().querySelectorAll('select')]);
  await press(named('Save', panel())[0]);
  await press(named('Cancel', panel())[0]);
}

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the bracket page of an archived Event', () => {
  it('draws no bracket for a Tournament that has none', async () => {
    page = await openArchivedPage(<BracketPage />, bracketReads({ t1: null, t2: null }));
    const generate = named('Generate bracket');
    expect(generate).toHaveLength(2);

    await page.pressEverything(1);

    expect(sentOnce(page)).toEqual([]);
    expect(generate.map((button) => button.title)).toEqual([ARCHIVED, ARCHIVED]);
  }, 60_000);

  it('does not draw again, fill, re-seed, configure or delete a bracket', async () => {
    page = await openArchivedPage(<BracketPage />, bracketReads({ t1: UNFOUGHT_BRACKET }));
    expect(named('Re-seed Round 1')).toHaveLength(1);
    expect(named('Save configuration')).toHaveLength(1);

    await page.pressEverything(1);

    expect(sentOnce(page)).toEqual([]);
  }, 60_000);

  it('puts no fighter, no piste and no referee on a bout', async () => {
    page = await openArchivedPage(<BracketPage />, bracketReads({ t1: UNFOUGHT_BRACKET }));

    await saveInPanel(() => press(named('Cy', panel())[0]));
    await saveInPanel(async ([piste]) => act(async () => type(piste!, 'L2')));
    await saveInPanel(async ([, referee]) => act(async () => type(referee!, 'p9')));

    expect(page.writes()).toEqual([]);
  });

  it('records no forfeit on a bout', async () => {
    page = await openArchivedPage(<BracketPage />, bracketReads({ t1: UNFOUGHT_BRACKET }));
    await openPanel();
    await press(
      [...panel().querySelectorAll('button')].find((b) => b.textContent?.includes('1 forfeits')),
    );
    const record = named('Record forfeit', panel())[0];

    await press(record);

    expect(page.writes()).toEqual([]);
    expect(record?.disabled).toBe(true);
  });
});
