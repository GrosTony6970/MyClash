// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { QrTools } from './QrTools';

/**
 * "My FightBook QR": the panel shows the code the API minted and renews it before it lapses. The
 * code lives five minutes by the SERVER's clock and the answer carries no server time, so the
 * panel counts the lifetime on its own timers from the answer: a phone clock that is wrong must
 * not move the renewal.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { value: string }) => <svg data-qr={props.value} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MINT = 'POST /api/v1/me/fightbook/qr';
const MIN = 60_000;

// The panel is a lazy view; load it once up front so the fake clock never waits on a module read.
beforeAll(() => import('./QrPanel'));

let container: HTMLDivElement;
let root: Root;
let minted: number;
let answer: () => unknown;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  minted = 0;
  answer = () => {
    minted += 1;
    return {
      ok: true,
      data: { code: `fb:CODE${minted}`, expiresAt: new Date(Date.now() + 5 * MIN).toISOString() },
    };
  };
  vi.mocked(apiRequest).mockImplementation((async (
    _base: string,
    path: string,
    init?: RequestInit,
  ) => {
    if (`${init?.method ?? 'GET'} ${path}` !== MINT) throw new Error(`unexpected ${path}`);
    return answer();
  }) as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  vi.useRealTimers();
});

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const shown = () => container.querySelector('svg[data-qr]')?.getAttribute('data-qr') ?? null;
const text = () => container.textContent ?? '';

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

describe('My FightBook QR', () => {
  it('mints a code and shows it as a QR', async () => {
    await open();
    expect(minted).toBe(1);
    expect(shown()).toBe('fb:CODE1');
  });

  it('mints a new code when less than 30 s remain, counted from the answer', async () => {
    await open();
    await wait(4 * MIN + 20_000);
    expect(minted).toBe(1);
    expect(shown()).toBe('fb:CODE1');
    await wait(10_000 + 100);
    expect(minted).toBe(2);
    expect(shown()).toBe('fb:CODE2');
  });

  it('keeps its time when the phone clock is set 10 minutes ahead', async () => {
    await open();
    vi.setSystemTime(Date.now() + 10 * MIN);
    await wait(4 * MIN);
    expect(minted).toBe(1);
    await wait(30_000 + 100);
    expect(minted).toBe(2);
  });

  it('keeps its time when the phone clock is set 10 minutes behind', async () => {
    await open();
    vi.setSystemTime(Date.now() - 10 * MIN);
    await wait(4 * MIN + 20_000);
    expect(minted).toBe(1);
    await wait(10_000 + 100);
    expect(minted).toBe(2);
  });

  it('reuses the held code when the panel is closed and opened again', async () => {
    await open();
    await act(async () => (button('Close') as HTMLElement).click());
    expect(shown()).toBeNull();
    await wait(MIN);
    await act(async () => (button('My FightBook QR') as HTMLElement).click());
    await wait(0);
    expect(minted).toBe(1);
    expect(shown()).toBe('fb:CODE1');
  });

  it('mints again on opening when the held code has less than 30 s left', async () => {
    await open();
    await act(async () => (button('Close') as HTMLElement).click());
    await wait(4 * MIN + 40_000);
    await act(async () => (button('My FightBook QR') as HTMLElement).click());
    await wait(0);
    expect(minted).toBe(2);
    expect(shown()).toBe('fb:CODE2');
  });

  it('says so when the code could not be made, and tries again on a tap', async () => {
    answer = () => ({ ok: false, kind: 'http', status: 503, code: null });
    await open();
    expect(shown()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be made');
    answer = () => ({ ok: true, data: { code: 'fb:CODE9', expiresAt: 'x' } });
    await act(async () => (button('Try again') as HTMLElement).click());
    await wait(0);
    expect(shown()).toBe('fb:CODE9');
  });

  describe('after the phone slept (timers and the monotonic clock stopped, the wall clock ran)', () => {
    /** Sleep: `performance.now` frozen where it is, the wall clock 6 minutes on, no timer fired. */
    function sleep() {
      const frozen = performance.now();
      vi.spyOn(performance, 'now').mockReturnValue(frozen);
      vi.setSystemTime(Date.now() + 6 * MIN);
    }
    const wake = () =>
      act(async () => {
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
    afterEach(() => {
      vi.mocked(performance.now).mockRestore?.();
    });

    it('mints a new code when the phone wakes with the panel open', async () => {
      await open();
      sleep();
      await wake();
      expect(minted).toBe(2);
      expect(shown()).toBe('fb:CODE2');
    });

    it('mints a new code when the panel is opened again after the sleep', async () => {
      await open();
      await act(async () => (button('Close') as HTMLElement).click());
      sleep();
      await act(async () => (button('My FightBook QR') as HTMLElement).click());
      await wait(0);
      expect(minted).toBe(2);
      expect(shown()).toBe('fb:CODE2');
    });
  });

  it('a failed renewal shows the failure and mints nothing more on its own', async () => {
    await open();
    answer = () => {
      minted += 1;
      return { ok: false, kind: 'http', status: 503, code: null };
    };
    await wait(4 * MIN + 30_000 + 100);
    expect(minted).toBe(2);
    await wait(5 * MIN);
    expect(minted).toBe(2);
    expect(shown()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be made');
  });

  it('forgets a failure on closing: the next opening tries again, with no failure shown', async () => {
    answer = () => ({ ok: false, kind: 'http', status: 503, code: null });
    await open();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => (button('Close') as HTMLElement).click());
    answer = () => new Promise(() => undefined);
    await act(async () => (button('My FightBook QR') as HTMLElement).click());
    await wait(0);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(2);
  });

  it('says the hour is used up on a 429', async () => {
    answer = () => ({ ok: false, kind: 'http', status: 429, code: null });
    await open();
    expect(text()).toContain('Too many codes');
  });
});
