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
 * Julie opens FightBook. It is off until she switches it on; once on she sees her settings and the
 * fighters she blocked. A save that fails puts the switch back and says so.
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

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number; code?: string | null };

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

/** Answers by path and method; records every call. */
function serve(routes: Record<string, Answer | ((body: unknown) => Answer)>) {
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return (typeof route === 'function' ? route(init?.body) : route) as never;
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

const ON = {
  'GET /api/v1/me/fightbook/inbox': { ok: true, data: [] },
  'GET /api/v1/me/fightbook/spars': { ok: true, data: { spars: [], sent: [] } },
  'GET /api/v1/me/fightbook/blocks': {
    ok: true,
    data: [{ fighter: { globalPersonId: MARC, name: 'Marc Probe', photoUrl: null } }],
  },
};

const theSwitch = () => container.querySelector<HTMLButtonElement>('[role="switch"]');

describe('FightBookClient', () => {
  it('sends a fighter with no profile to their personal space', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': {
        ok: true,
        data: { hasProfile: false, enabled: false },
      },
    });
    await open();
    expect(container.textContent).toContain('FightBook needs a fighter profile');
    expect(container.querySelector('a[href="/me"]')).not.toBeNull();
    expect(theSwitch()).toBeNull();
  });

  it('shows what FightBook is and the switch while it is off, and nothing else', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: { hasProfile: true, enabled: false } },
    });
    await open();
    expect(container.textContent).toContain('FightBook is off');
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).not.toContain('Blocked fighters');
  });

  it('switching on saves it and opens FightBook', async () => {
    let enabled = false;
    serve({
      'GET /api/v1/me/fightbook/settings': () => ({
        ok: true,
        data: { hasProfile: true, enabled },
      }),
      'PATCH /api/v1/me/fightbook/settings': (body) => {
        enabled = (body as { enabled: boolean }).enabled;
        return { ok: true, data: { hasProfile: true, enabled } };
      },
      ...ON,
    });
    await open();
    await act(async () => theSwitch()!.click());
    await settled();
    expect(
      vi.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === 'PATCH')?.[2],
    ).toMatchObject({ body: { enabled: true } });
    expect(container.textContent).toContain('Blocked fighters');
    expect(container.textContent).toContain('Marc Probe');
  });

  it('a save that fails puts the switch back and says so', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: { hasProfile: true, enabled: false } },
      'PATCH /api/v1/me/fightbook/settings': { ok: false, kind: 'network' },
    });
    await open();
    await act(async () => theSwitch()!.click());
    await settled();
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
  });

  it('unblocking removes the fighter from the list', async () => {
    serve({
      'GET /api/v1/me/fightbook/settings': { ok: true, data: { hasProfile: true, enabled: true } },
      ...ON,
      [`DELETE /api/v1/me/fightbook/blocks/${MARC}`]: { ok: true, data: null },
    });
    await open();
    const unblock = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Unblock',
    );
    await act(async () => unblock!.click());
    await settled();
    expect(container.textContent).not.toContain('Marc Probe');
    expect(container.textContent).toContain('You have not blocked anyone.');
  });

  it('says a failed read and reads again on retry', async () => {
    let fail = true;
    serve({
      'GET /api/v1/me/fightbook/settings': () =>
        fail
          ? { ok: false, kind: 'network' }
          : { ok: true, data: { hasProfile: true, enabled: false } },
    });
    await open();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'FightBook could not be loaded.',
    );
    fail = false;
    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button');
    await act(async () => retry!.click());
    await settled();
    expect(container.textContent).toContain('FightBook is off');
  });
});
