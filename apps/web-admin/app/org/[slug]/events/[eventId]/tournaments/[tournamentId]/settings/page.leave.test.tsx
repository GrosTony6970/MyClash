import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type, type OpenedPage } from '../../../archived-page.fixtures';
import { TOURNAMENT_ID, TOURNAMENT_READS, TOURNAMENT_ROW, button } from './page.fixtures';
import TournamentSettingsPage from './page';

/**
 * O15 (ruled 2026-10-14): "Leave without saving?" before a tab switch. Each tab unmounts when
 * another opens, and reads afresh when it opens again, so an edit not saved was thrown away
 * without a word. The page names the Tournament it sets.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', tournamentId: 't-1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/t-1/settings',
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

const SAVE = `PATCH /api/v1/tournaments/${TOURNAMENT_ID}`;

let page: OpenedPage;
afterEach(() => page.unmount());

// A Tournament on its own copy of a ruleset: the Advanced tab's controls are live there.
const READS = {
  ...TOURNAMENT_READS,
  [`/api/v1/tournaments/${TOURNAMENT_ID}`]: { ...TOURNAMENT_ROW, ruleset_is_system: false },
};

async function openTab(tab: string): Promise<OpenedPage> {
  window.history.replaceState(null, '', `/#${tab}`);
  page = await openEventPage(<TournamentSettingsPage />, READS, { [SAVE]: {} });
  return page;
}

async function tap(label: string) {
  await act(async () => button(label).click());
  await page.settle();
}

const TAB_LABEL: Record<string, string> = {
  basics: 'Basics',
  'match-format': 'Match format',
  venues: 'Venues',
  display: 'Display',
  advanced: 'Advanced',
};

/** The tab's first live field gets another value, as a keystroke or a pick gives it. */
function changeFirstField() {
  const field = [
    ...document.body.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'section input[type="text"], section input[type="number"], section input:not([type]), section select',
    ),
  ].find((f) => !f.matches(':disabled'));
  if (!field) throw new Error('no live field');
  const other =
    field instanceof HTMLSelectElement
      ? [...field.options].find((o) => !o.disabled && o.value !== field.value)?.value
      : `${field.value}7`;
  act(() => type(field, other ?? ''));
}

const question = () => document.body.querySelector('[role="dialog"]');
const autoLock = () => document.body.querySelector<HTMLButtonElement>('[role="switch"]')!;
const tabShown = () => window.location.hash;

describe('the settings of a Tournament ask before an edit is lost', () => {
  it('asks before a tab switch: Stay keeps the edit, Leave opens the tab', async () => {
    await openTab('locks');
    expect(autoLock().getAttribute('aria-checked')).toBe('true');
    await act(async () => autoLock().click());

    await tap('Basics');
    expect(question()?.textContent).toContain('Leave without saving?');
    await tap('Stay');
    expect(question()).toBeNull();
    expect(tabShown()).toBe('#locks');
    expect(autoLock().getAttribute('aria-checked')).toBe('false');

    await tap('Basics');
    await tap('Leave');
    expect(tabShown()).toBe('#basics');
    expect(page.writes()).toEqual([]);

    // The edit went with its tab: nothing is unsaved any more.
    await tap('Display');
    expect(question()).toBeNull();
    expect(tabShown()).toBe('#display');
  });

  it('forgets a left edit on a tab with no form, as on any other', async () => {
    await openTab('locks');
    await act(async () => autoLock().click());
    await tap('Recap');
    await tap('Leave');
    expect(tabShown()).toBe('#recap');
    // Recap holds no form and reports nothing: the closed tab's own "nothing unsaved" counts.
    await tap('Display');
    expect(question()).toBeNull();
    expect(tabShown()).toBe('#display');
  });

  it('switches with no question once the edit is saved', async () => {
    await openTab('locks');
    await act(async () => autoLock().click());
    await tap('Save changes');
    expect(page.writes()).toEqual([SAVE]);

    await tap('Basics');
    expect(question()).toBeNull();
    expect(tabShown()).toBe('#basics');
  });

  it('switches with no question from a tab nobody touched', async () => {
    await openTab('display');
    await tap('Auto-lock');
    expect(question()).toBeNull();
    expect(tabShown()).toBe('#locks');
  });

  // Each form tab reports its own edits; its read alone is no edit.
  it.each(['basics', 'match-format', 'venues', 'display', 'advanced'])(
    'the %s tab asks once a field is changed, and not before',
    async (tab) => {
      await openTab(tab);
      await tap('Auto-lock');
      expect(question(), 'asked with nothing changed').toBeNull();
      await act(async () => button(TAB_LABEL[tab]!).click());
      await page.settle();

      changeFirstField();
      await tap('Auto-lock');
      expect(question()?.textContent).toContain('Leave without saving?');
    },
  );

  it('names the Tournament it sets', async () => {
    await openTab('basics');
    expect(document.body.querySelector('h1')?.textContent).toBe('Longsword');
  });

  // The header kept the old name after Basics saved a new one.
  it('names it by its new name once Basics saves one', async () => {
    await openTab('basics');
    const name = document.body.querySelector<HTMLInputElement>('section input')!;
    act(() => type(name, 'Longsword Open'));
    await tap('Save changes');
    expect(page.writes()).toEqual([SAVE]);
    expect(document.body.querySelector('h1')?.textContent).toBe('Longsword Open');
  });
});
