/**
 * The harness of the settings tabs' rules tests (operator rulings 43, 46): a tab opened on a row
 * whose `effectiveRules` the test chooses, every save body it sends captured, and the Tournament
 * read held, failed or answered with no rules. The test file owns its `vi.mock` calls, as
 * `archived-page.fixtures.tsx` says.
 */
import { act } from 'react';
import { vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import type { EffectiveRules } from '@myclash/types';
import { FAILED_READ, openEventPage, type OpenedPage } from '../../../archived-page.fixtures';
import { EFFECTIVE_RULES, TOURNAMENT_ID, TOURNAMENT_READS, TOURNAMENT_ROW } from './page.fixtures';
import TournamentSettingsPage from './page';

export const TOURNAMENT = `/api/v1/tournaments/${TOURNAMENT_ID}`;

type Answer = Awaited<ReturnType<typeof ApiClient.apiRequest>>;

export interface OpenedTab {
  page: OpenedPage;
  /** The body of every save the tab sent, in order. */
  saved: unknown[];
  /** Holds the next Tournament reads until `release` is called. */
  hold: () => { release: () => Promise<void> };
  /** Answers the Tournament reads from now on (after `read: 'failed'`), as a server back up does. */
  heal: () => void;
}

/**
 * Opens the settings page on `tab` (its hash key). `row` goes over TOURNAMENT_ROW, and
 * `effectiveRules` over EFFECTIVE_RULES (null: the API could not answer them). `read: 'failed'`
 * fails the Tournament reads until `heal` is called. Every save answers 200 with the row.
 */
export async function openTab(
  tab: string,
  options: {
    row?: Record<string, unknown>;
    effectiveRules?: Partial<EffectiveRules> | null;
    read?: 'failed';
  } = {},
): Promise<OpenedTab> {
  window.history.replaceState(null, '', `/#${tab}`);
  const rules =
    options.effectiveRules === null ? null : { ...EFFECTIVE_RULES, ...options.effectiveRules };
  const row = { ...TOURNAMENT_ROW, ...options.row, effectiveRules: rules };
  let failing = options.read === 'failed';
  const reads = { ...TOURNAMENT_READS, [TOURNAMENT]: failing ? FAILED_READ : row };
  const page = await openEventPage(<TournamentSettingsPage />, reads);
  const saved: unknown[] = [];
  const read = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
  const answered = { ok: true, data: row } as Answer;
  let held: Promise<void> | null = null;
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
    if (!init?.method || init.method === 'GET') {
      if (held && path === TOURNAMENT) await held;
      if (!failing && path === TOURNAMENT) return answered;
      return read(base, path, init);
    }
    saved.push(init.body);
    return { ok: true, data: row } as Answer;
  });
  const hold = () => {
    let release!: () => void;
    held = new Promise((resolve) => (release = resolve));
    return {
      release: async () => {
        held = null;
        release();
        await page.settle();
      },
    };
  };
  const heal = () => {
    failing = false;
  };
  return { page, saved, hold, heal };
}

/** The `label` element whose text starts with `text`, as a field's own label reads. */
export function labelled(text: string): HTMLLabelElement {
  const found = [...document.body.querySelectorAll('label')].find((l) =>
    l.textContent?.startsWith(text),
  );
  if (!found) throw new Error(`no field labelled "${text}"`);
  return found;
}

/** A field's control: the one its label names (`htmlFor`), or the one inside it. */
export function control(text: string): HTMLInputElement | HTMLSelectElement {
  const label = labelled(text);
  const named = label.htmlFor ? document.getElementById(label.htmlFor) : null;
  return (named ?? label.querySelector('input, select')) as HTMLInputElement | HTMLSelectElement;
}

/** The row a field's label sits in: its "modified" badge and its Reset are there. */
export const rowOf = (text: string): HTMLElement => labelled(text).closest('div')!;

/** The Save of a settings tab. */
export const hasSave = () =>
  [...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Save changes');

/** Opens another tab, as the organiser does: each tab reads afresh when it opens. */
export async function switchTo(page: OpenedPage, tab: string): Promise<void> {
  await act(async () => {
    window.location.hash = `#${tab}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await page.settle();
}

/** The page's alert: what a rules tab shows when its rules cannot be read. */
export const alertText = () => document.body.querySelector('[role="alert"]')?.textContent ?? null;
