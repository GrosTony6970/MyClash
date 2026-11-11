// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { NotificationPreferences } from './NotificationPreferences';

/** The three FightBook notices share one switch, as the others do (ARCHITECTURE §11ter.2). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PREFS = {
  matchStartingMinutesBefore: 10,
  workshopStartingMinutesBefore: 15,
  refereeStartingMinutesBefore: 10,
  scheduleChanges: true,
  resultsPublished: true,
  organizerUpdates: true,
  swissRoundPublished: true,
  fightbook: true,
  enabled: true,
};

let container: HTMLDivElement;
let root: Root;
const calls: Array<{ method: string; body: unknown }> = [];
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init?.method ?? 'GET', body });
      return new Response(JSON.stringify({ ...PREFS, ...(body ?? {}) }), { status: 200 });
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('the FightBook notice switch', () => {
  it('is on the settings page and saves { fightbook: false }', async () => {
    await act(async () =>
      root.render(
        <I18nProvider locale="en">
          <NotificationPreferences apiUrl="http://api.test" />
        </I18nProvider>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="FightBook"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    await act(async () => toggle!.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ fightbook: false });
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
  });
});
