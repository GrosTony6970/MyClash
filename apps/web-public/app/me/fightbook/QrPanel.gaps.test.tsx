// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { signInAgainHere } from '../../../src/lib/sign-in-return';
import { QrTools } from './QrTools';

/**
 * Guards of the "My FightBook QR" panel that QrPanel.test.tsx does not hold: an ended login on the
 * mint, and a dead code that must leave the screen the moment the phone wakes. One mint out at a
 * time is QrPanel.flight.test.tsx.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('../../../src/lib/sign-in-return', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signInAgainHere: vi.fn(),
}));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { value: string }) => <svg data-qr={props.value} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MIN = 60_000;
const code = (n: number) => ({
  ok: true,
  data: { code: `fb:CODE${n}`, expiresAt: new Date(Date.now() + 5 * MIN).toISOString() },
});

beforeAll(() => import('./QrPanel'));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(signInAgainHere).mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const shown = () => container.querySelector('svg[data-qr]')?.getAttribute('data-qr') ?? null;
async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <QrTools apiUrl="http://api.test" events={[]} catalog={['Longsword']} onSent={vi.fn()} />
      </I18nProvider>,
    ),
  );
  await act(async () => (button('My FightBook QR') as HTMLElement).click());
  await wait(0);
}
const wake = () =>
  act(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });

describe('The mint answering that the login ended', () => {
  // A 403 reaches the web as `unauthenticated` too: only a 401 sends anyone to sign in.
  it('goes to sign in again on a 401, and says the code failed on a 403', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      ok: false,
      kind: 'unauthenticated',
      status: 403,
    } as never);
    await open();
    expect(signInAgainHere).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be made');
    act(() => root.unmount());
    root = createRoot(container);
    vi.mocked(apiRequest).mockResolvedValue({
      ok: false,
      kind: 'unauthenticated',
      status: 401,
    } as never);
    await open();
    expect(signInAgainHere).toHaveBeenCalledTimes(1);
  });
});

describe('After the phone slept', () => {
  it('takes the dead code off the screen at once, before the new mint answers', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(code(1) as never);
    await open();
    expect(shown()).toBe('fb:CODE1');
    vi.spyOn(performance, 'now').mockReturnValue(performance.now());
    vi.setSystemTime(Date.now() + 6 * MIN);
    vi.mocked(apiRequest).mockImplementation((() => new Promise(() => undefined)) as never);
    await wake();
    expect(shown()).toBeNull();
  });
});
