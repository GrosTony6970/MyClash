// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FightBookClient } from './FightBookClient';

/**
 * Julie caps her sparring days. The settings panel shows a select of 1-20 and "No limit"; a pick
 * saves at once, a failed save puts the old value back, and the select waits while it saves.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { ok: boolean; data?: unknown; kind?: string };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
});

function serve(routes: Record<string, Answer | ((body: unknown) => Answer | Promise<Answer>)>) {
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return (typeof route === 'function' ? await route(init?.body) : route) as never;
  });
}

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FightBookClient />
      </I18nProvider>,
    ),
  );
  await settled();
}

const SETTINGS = {
  hasProfile: true,
  enabled: true,
  showStars: false,
  sparred: 0,
  stars: null,
  dailyLimit: 5,
};
const ON = {
  'GET /api/v1/me/fightbook/inbox': { ok: true, data: [] },
  'GET /api/v1/me/fightbook/spars': { ok: true, data: { spars: [], sent: [] } },
  'GET /api/v1/me/fightbook/thanks?page=0': { ok: true, data: { items: [], more: false } },
  'GET /api/v1/me/fightbook/blocks': { ok: true, data: [] },
};

const limitSelect = () =>
  container.querySelector<HTMLSelectElement>('select[aria-label="At most … spars a day"]');
const pick = (value: string) =>
  act(async () => {
    const select = limitSelect()!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
const patchBody = () =>
  vi.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === 'PATCH')?.[2]?.body;

describe('the daily limit select', () => {
  it('offers No limit and 1 to 20, with the saved value picked, and says what it does', async () => {
    serve({ 'GET /api/v1/me/fightbook/settings': { ok: true, data: SETTINGS }, ...ON });
    await open();
    const options = [...limitSelect()!.options].map((o) => o.textContent);
    expect(options).toEqual(['No limit', ...Array.from({ length: 20 }, (_, i) => String(i + 1))]);
    expect(limitSelect()!.value).toBe('5');
    expect(container.textContent).toContain(
      'Your own asks, QR scans and open calls are never stopped.',
    );
  });

  it('picks No limit when none is saved', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: { ...SETTINGS, dailyLimit: null } },
      ...ON,
    });
    await open();
    expect(limitSelect()!.value).toBe('');
  });

  it('choosing 3 sends dailyLimit 3 alone and keeps it', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: SETTINGS },
      'PATCH /api/v1/me/fightbook/settings': { ok: true, data: { ...SETTINGS, dailyLimit: 3 } },
      ...ON,
    });
    await open();
    await pick('3');
    await settled();
    expect(patchBody()).toEqual({ dailyLimit: 3 });
    expect(limitSelect()!.value).toBe('3');
  });

  it('choosing No limit sends dailyLimit null', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: SETTINGS },
      'PATCH /api/v1/me/fightbook/settings': { ok: true, data: { ...SETTINGS, dailyLimit: null } },
      ...ON,
    });
    await open();
    await pick('');
    await settled();
    expect(patchBody()).toEqual({ dailyLimit: null });
    expect(limitSelect()!.value).toBe('');
  });

  it('a failed save puts the old value back and says so', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: SETTINGS },
      'PATCH /api/v1/me/fightbook/settings': { ok: false, kind: 'network' },
      ...ON,
    });
    await open();
    await pick('3');
    await settled();
    expect(limitSelect()!.value).toBe('5');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
  });

  it('is disabled while the save is in flight', async () => {
    let release: (a: Answer) => void = () => undefined;
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: SETTINGS },
      'PATCH /api/v1/me/fightbook/settings': () => new Promise<Answer>((r) => (release = r)),
      ...ON,
    });
    await open();
    await pick('3');
    expect(limitSelect()!.disabled).toBe(true);
    await act(async () => release({ ok: true, data: { ...SETTINGS, dailyLimit: 3 } }));
    await settled();
    expect(limitSelect()!.disabled).toBe(false);
  });
});

/**
 * A disabled select drops keyboard focus in a browser. jsdom does not move focus off it, and
 * `blur()` on a disabled select does nothing, so the loss is done the other way: focus a throwaway
 * button, remove it, and jsdom sends focus to the body.
 */
describe('keyboard focus around a daily-limit save', () => {
  async function pickHeld(answer: Answer) {
    let release: (a: Answer) => void = () => undefined;
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: SETTINGS },
      'PATCH /api/v1/me/fightbook/settings': () => new Promise<Answer>((r) => (release = r)),
      ...ON,
    });
    await open();
    limitSelect()!.focus();
    await pick('3');
    return () => act(async () => release(answer));
  }
  const loseFocus = () => {
    const stray = document.createElement('button');
    document.body.append(stray);
    stray.focus();
    stray.remove();
    expect(document.activeElement).toBe(document.body);
  };

  it('comes back to the menu when the fighter had it and focus went nowhere', async () => {
    const answerSave = await pickHeld({ ok: true, data: { ...SETTINGS, dailyLimit: 3 } });
    loseFocus();
    await answerSave();
    await settled();
    expect(limitSelect()!.disabled).toBe(false);
    expect(document.activeElement).toBe(limitSelect());
  });

  it('stays where the fighter went during the save', async () => {
    const answerSave = await pickHeld({ ok: true, data: { ...SETTINGS, dailyLimit: 3 } });
    const elsewhere = document.createElement('button');
    container.append(elsewhere);
    elsewhere.focus();
    await answerSave();
    await settled();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('comes back after a failed save too, with the old value shown', async () => {
    const answerSave = await pickHeld({ ok: false, kind: 'network' });
    loseFocus();
    await answerSave();
    await settled();
    expect(limitSelect()!.value).toBe('5');
    expect(document.activeElement).toBe(limitSelect());
  });
});
