/**
 * A penalty ruleset page under test: its reads answered by path, its saves written down and
 * taken. The page's `vi.mock` of `next/navigation`, `@/lib/api-url` and `@myclash/api-client` is
 * the test file's own (a mock is hoisted only in the file that declares it).
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import { CLUB_START_FORFEIT_RULES, type ForfeitRules } from '@myclash/types/forfeit-rules';
import { ToastProvider } from '@myclash/ui';
import { I18nProvider } from '@/i18n/I18nProvider';

/** Forfeit rules no start value holds: a page that wrote a default instead is seen. */
export const MARKER: ForfeitRules = {
  ...CLUB_START_FORFEIT_RULES,
  reasons: {
    ...CLUB_START_FORFEIT_RULES.reasons,
    injury: { outcome: 'fixed_loss', opponentScore: 9, fighter: 'withdrawn' },
  },
  disqualifyAfter: 7,
  blackCardOpponentScore: 13,
};

/** A club's penalty ruleset `pr-1` as `GET /penalty-rulesets/:id` answers it. */
export function penaltyRow(forfeitRules: ForfeitRules): Record<string, unknown> {
  return {
    id: 'pr-1',
    code: 'house',
    version: '1.0.0',
    name: 'House cards',
    description: null,
    built_in: false,
    public_visibility: false,
    accumulation_scope: 'tournament',
    yellow_card_points: 0,
    red_card_points: -1,
    black_card_points: 0,
    first_black_card_forfeit: 'match',
    second_black_card_forfeit: 'tournament',
    forfeit_rules: forfeitRules,
    penalty_ruleset_entries: [],
  };
}

/** The reads of the edit pages of `pr-1`. */
export const editReads = (forfeitRules: ForfeitRules) => ({
  '/api/v1/penalty-rulesets/pr-1': penaltyRow(forfeitRules),
  '/api/v1/penalty-rulesets/pr-1/lineage': null,
  '/api/v1/penalty-rulesets/pr-1/versions': [],
});

export interface Save {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

export interface OpenedPenaltyPage {
  saves: Save[];
  unmount: () => void;
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

export async function openPenaltyPage(
  page: ReactNode,
  reads: Record<string, unknown>,
): Promise<OpenedPenaltyPage> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const saves: Save[] = [];
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method && init.method !== 'GET') {
      saves.push({ method: init.method, path, body: init.body as Record<string, unknown> });
      return { ok: true, data: { id: 'saved-1' } } as never;
    }
    if (path in reads) return { ok: true, data: reads[path] } as never;
    throw new Error(`unexpected request ${path}`);
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>{page}</ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
  return {
    saves,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function control<T extends HTMLElement>(testId: string): T {
  const found = document.querySelector<T>(`[data-testid="${testId}"]`);
  expect(found, `the control ${testId}`).not.toBeNull();
  return found!;
}

/** The field of the label whose words start with `words` ("Name", "Code"). */
export function labelled(words: string): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find((each) =>
    each.textContent?.trim().startsWith(words),
  );
  const field = label?.querySelector('input');
  if (!field) throw new Error(`no field labelled ${words}`);
  return field;
}

/** Types `value` into a text or number field, the way React hears a keystroke. */
export async function typeInto(testId: string | HTMLInputElement, value: string): Promise<void> {
  const field = typeof testId === 'string' ? control<HTMLInputElement>(testId) : testId;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function choose(testId: string, value: string): Promise<void> {
  const select = control<HTMLSelectElement>(testId);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export async function press(testId: string): Promise<void> {
  const target = control<HTMLElement>(testId);
  await act(async () => target.click());
}

/** Submits the editor's form and waits for its save. */
export async function save(): Promise<void> {
  const form = document.querySelector('form');
  if (!form) throw new Error('no form on the page');
  await act(async () => form.requestSubmit());
  await settle();
}
