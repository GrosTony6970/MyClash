import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PoolsPage from './page';

/**
 * The Pools page of an archived Event (ruling 377). The server refuses every
 * save this page has: generate, add an empty Pool, delete one or all, move a
 * fighter by drag or by the x, rename a Pool. The page offered all of them.
 *
 * The three other tabs are stubbed. The bouts tab's stub shows the one thing
 * the page owes it: that it is told the Event is read-only.
 */
vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'org', eventId: 'ev1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('./_tabs/MatchesTab', () => ({
  MatchesTab: ({ isReadOnly }: { isReadOnly?: boolean }) => (
    <output data-bouts-tab-read-only={String(isReadOnly)} />
  ),
}));
vi.mock('./_tabs/StandingsTab', () => ({ StandingsTab: () => null }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const member = (registrationId: string, personName: string, seed: number) => ({
  registrationId,
  personName,
  clubLabel: null,
  seed,
  hemaWeightedRating: null,
});

const READS = {
  '/api/v1/events/ev1/tournaments': [{ id: 't1', name: 'Longsword' }],
  '/api/v1/tournaments/t1/pools': {
    phaseId: 'phase-1',
    pools: [
      { id: 'p1', name: 'Pool A', members: [member('r1', 'Ana', 1), member('r2', 'Ben', 2)] },
      { id: 'p2', name: 'Pool B', members: [member('r3', 'Cy', 3), member('r4', 'Dee', 4)] },
    ],
  },
  '/api/v1/tournaments/t1/unassigned-fighters': [
    { registrationId: 'r5', personName: 'Eve', clubLabel: null, hemaWeightedRating: null },
  ],
  '/api/v1/tournaments/t1/conflict-check': { conflicts: [] },
};

const buttons = (label: string) =>
  [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);
const button = (label: string) => buttons(label)[0]!;
/** A fighter's chip, in a Pool or in the unassigned panel. */
const chip = (name: string) =>
  [...document.body.querySelectorAll<HTMLElement>('[draggable]')].find((el) =>
    el.textContent?.includes(name),
  )!;
const renameField = () =>
  document.body.querySelector<HTMLInputElement>('input:not([type="checkbox"])');

/** Picks `from` up and lets it go over `onto`: the drop bubbles to the card or panel around it. */
async function drag(from: HTMLElement, onto: HTMLElement, page: OpenedPage) {
  await act(async () => from.dispatchEvent(new Event('dragstart', { bubbles: true })));
  await act(async () => onto.dispatchEvent(new Event('drop', { bubbles: true })));
  await page.settle();
}

/** Opens a Pool's name if the page lets her, then saves it by Enter and by Save. */
async function rename(poolName: string, page: OpenedPage) {
  const name = button(poolName);
  if (!name.disabled) await act(async () => name.click());
  const field = renameField();
  if (!field) return;
  await act(async () =>
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  await page.settle();
  await act(async () => buttons('Save')[0]?.click());
  await page.settle();
}

/** Every drag this page has: Pool to Pool, Pool to unassigned, unassigned to Pool. */
async function dragEveryWay(page: OpenedPage) {
  await drag(chip('Ana'), chip('Cy'), page);
  await drag(chip('Ana'), chip('Eve'), page);
  await drag(chip('Eve'), chip('Ana'), page);
}

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the Pools page of an archived Event', () => {
  it('sends no save with everything pressed', async () => {
    page = await openArchivedPage(<PoolsPage />, READS);
    expect(document.body.textContent).toContain('Ana');
    expect(document.body.textContent).toContain('Eve');

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });

  it('closes each save, and says why on the main one', async () => {
    page = await openArchivedPage(<PoolsPage />, READS);

    expect(button('Regenerate').disabled).toBe(true);
    expect(button('Regenerate').title).toBe('This event is archived and read-only.');
    expect(button('+ Add empty pool').disabled).toBe(true);
    expect(button('Delete all pools').disabled).toBe(true);
    expect(buttons('Delete').map((b) => b.disabled)).toEqual([true, true]);
    expect(buttons('×').map((b) => b.disabled)).toEqual([true, true, true, true]);
  });

  it('lets no fighter be dragged, and a drop sends nothing', async () => {
    page = await openArchivedPage(<PoolsPage />, READS);
    expect(document.body.querySelectorAll('[draggable]')).toHaveLength(5);

    // A drag driven by hand starts whatever the chip says: the drop is what holds.
    await dragEveryWay(page);

    expect(page.writes()).toEqual([]);
    expect(document.body.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it('opens no rename field, so neither Enter nor Save can send a name', async () => {
    page = await openArchivedPage(<PoolsPage />, READS);

    await rename('Pool A', page);

    expect(page.writes()).toEqual([]);
    expect(button('Pool A').disabled).toBe(true);
    expect(renameField()).toBeNull();
  });

  it('tells the bouts tab that the Event is read-only', async () => {
    page = await openArchivedPage(<PoolsPage />, READS);
    await act(async () => {
      window.location.hash = '#matches';
      window.dispatchEvent(new Event('hashchange'));
    });
    await page.settle();

    const boutsTab = document.body.querySelector('[data-bouts-tab-read-only]');
    expect(boutsTab?.getAttribute('data-bouts-tab-read-only')).toBe('true');
  });
});

// The contrast: on an Event that runs, the same steps DO send the saves.
describe('the Pools page of a running Event', () => {
  it('sends a move for each drag and a name for Enter and for Save', async () => {
    page = await openEventPage(<PoolsPage />, {
      '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'running' },
      ...READS,
    });
    expect(document.body.querySelectorAll('[draggable="true"]')).toHaveLength(5);

    await dragEveryWay(page);
    await rename('Pool A', page);

    expect(page.writes()).toEqual([
      'POST /api/v1/pools/p2/members',
      'DELETE /api/v1/pools/p1/members/r1',
      'POST /api/v1/pools/p1/members',
      'PATCH /api/v1/pools/p1',
      'PATCH /api/v1/pools/p1',
    ]);
  });
});
