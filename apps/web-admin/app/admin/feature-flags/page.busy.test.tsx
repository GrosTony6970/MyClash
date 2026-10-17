import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import type * as Ui from '@myclash/ui';
import { I18nProvider } from '@/i18n/I18nProvider';
import AdminFeatureFlagsPage from './page';

/**
 * After a save, the time-simulation panel stays busy until the clock visitors
 * see has re-read. Pause and the nudges compute from that clock; a click
 * before it landed would start from the pre-save instant — two +5 giving +5,
 * or a nudge right after Pause un-pausing the clock.
 */
const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  refreshRuntimeFlags: vi.fn(),
}));

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: mocks.apiRequest,
}));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  refreshRuntimeFlags: mocks.refreshRuntimeFlags,
  useSecondsClock: () => ({
    nowMs: Date.parse('2027-05-22T08:15:30.000Z'),
    simulated: true,
    frozen: false,
  }),
}));

const ROW = {
  key: 'time_simulation',
  enabled: true,
  description: null,
  payloadJson: {
    simulatedNowIso: '2027-05-22T08:00:00.000Z',
    anchorRealIso: '2026-07-13T12:00:00.000Z',
    mode: 'running',
  },
  updated_at: '2026-07-13T12:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.apiRequest.mockImplementation(
    async (_url: string, _path: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? { ok: true, data: null } : { ok: true, data: [ROW] },
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('the feature-flags page after a time-simulation save', () => {
  it('keeps the panel busy until the visitor clock has re-read', async () => {
    let landed!: () => void;
    mocks.refreshRuntimeFlags.mockReturnValue(
      new Promise<null>((resolve) => {
        landed = () => resolve(null);
      }),
    );
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <AdminFeatureFlagsPage />
        </I18nProvider>,
      );
    });

    await act(async () => button('Pause').click());
    expect(mocks.refreshRuntimeFlags).toHaveBeenCalledWith('http://api.test');
    expect(button('Pause').disabled).toBe(true);
    expect(button('+5 min').disabled).toBe(true);

    await act(async () => landed());
    expect(button('Pause').disabled).toBe(false);
    expect(button('+5 min').disabled).toBe(false);
  });
});
