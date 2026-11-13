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
 * "My FightBook QR" never has two code requests out at once (ruling 754). Four writers race: the
 * mint's answer, the 10 s give-up timer, a wake, and an opening or a closing. Every request here is
 * held until the test answers it, so each case orders those writers by hand.
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
let answers: Array<(value: unknown) => void>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(signInAgainHere).mockReset();
  answers = [];
  vi.mocked(apiRequest).mockImplementation(
    (() => new Promise((resolve) => answers.push(resolve))) as never,
  );
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
const alerted = () => container.querySelector('[role="alert"]')?.textContent ?? null;
const requests = () => vi.mocked(apiRequest).mock.calls.length;
const tap = async (label: string) => {
  await act(async () => (button(label) as HTMLElement).click());
  await wait(0);
};
async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <QrTools apiUrl="http://api.test" events={[]} catalog={['Longsword']} onSent={vi.fn()} />
      </I18nProvider>,
    ),
  );
  await tap('My FightBook QR');
}
const reply = async (n: number, value: unknown) => {
  await act(async () => answers[n]?.(value));
  await wait(0);
};
const wake = () =>
  act(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
/** A sleep: `performance.now` frozen, no timer fired, the wall clock moved on. */
const sleep = (ms: number) => {
  vi.spyOn(performance, 'now').mockReturnValue(performance.now());
  vi.setSystemTime(Date.now() + ms);
};

describe('A wake while a code request is out', () => {
  it('B1 sends nothing: the one request out answers the code', async () => {
    await open();
    await wake();
    expect(requests()).toBe(1);
    await reply(0, code(1));
    expect(shown()).toBe('fb:CODE1');
  });

  it('B2 takes the dead code off at once, and a second wake asks nothing more', async () => {
    await open();
    await reply(0, code(1));
    expect(shown()).toBe('fb:CODE1');
    sleep(6 * MIN);
    await wake();
    expect(shown()).toBeNull();
    expect(requests()).toBe(2);
    await wake();
    expect(requests()).toBe(2);
  });

  it('B4 gives up a request out 10 s by the wall clock, and asks nothing more', async () => {
    await open();
    sleep(60_000);
    await wake();
    expect(alerted()).toContain('could not be made');
    expect(requests()).toBe(1);
  });

  it('B7 leaves the 10 s timer running', async () => {
    await open();
    await wake();
    expect(requests()).toBe(1);
    await wait(10_000);
    expect(alerted()).toContain('could not be made');
  });
});

describe('A request with no answer after 10 s', () => {
  it('B3 says the code failed, drops the late answer, and "Try again" asks once', async () => {
    await open();
    await wait(10_000);
    expect(alerted()).toContain('could not be made');
    expect(button('Try again')).toBeDefined();
    await reply(0, code(1));
    expect(shown()).toBeNull();
    await tap('Try again');
    expect(requests()).toBe(2);
  });

  it('B6 an answer at 9.9 s shows its code, and the timer changes nothing later', async () => {
    await open();
    await wait(9_900);
    await reply(0, code(1));
    await wait(1_000);
    expect(shown()).toBe('fb:CODE1');
    expect(alerted()).toBeNull();
  });

  it('B9 a renewal given up takes the old code off the screen', async () => {
    await open();
    await reply(0, code(1));
    await wait(4 * MIN + 30_000 + 100);
    expect(requests()).toBe(2);
    expect(shown()).toBe('fb:CODE1');
    await wait(10_000);
    expect(shown()).toBeNull();
    expect(alerted()).toContain('could not be made');
  });

  it('B10 the given-up answer neither shows nor frees the next request', async () => {
    await open();
    await wait(10_000);
    await tap('Try again');
    expect(requests()).toBe(2);
    await reply(0, code(1));
    expect(shown()).toBeNull();
    await wake();
    expect(requests()).toBe(2);
    await reply(1, code(2));
    expect(shown()).toBe('fb:CODE2');
  });

  it('B10b a request given up at a wake never fires its timer at the next one', async () => {
    await open();
    sleep(60_000);
    await wake();
    await wait(5_000);
    await tap('Try again');
    expect(requests()).toBe(2);
    await wait(6_000);
    expect(alerted()).toBeNull();
    await reply(1, code(2));
    expect(shown()).toBe('fb:CODE2');
  });
});

describe('Closing and opening while a code request is out', () => {
  it('B5 the opening sends nothing, and the answer is the code', async () => {
    await open();
    await tap('Close');
    await tap('My FightBook QR');
    expect(requests()).toBe(1);
    await reply(0, code(1));
    expect(shown()).toBe('fb:CODE1');
  });

  it('B7b the 10 s timer outlives a closing and an opening', async () => {
    await open();
    await tap('Close');
    await tap('My FightBook QR');
    await wait(10_000);
    expect(alerted()).toContain('could not be made');
    expect(requests()).toBe(1);
  });

  it('B8 a request given up while closed is asked again by the next opening', async () => {
    await open();
    await tap('Close');
    await wait(10_000);
    await tap('My FightBook QR');
    expect(requests()).toBe(2);
  });

  it('B11 a 401 that answers while closed sends nobody to sign in', async () => {
    await open();
    await tap('Close');
    await reply(0, { ok: false, kind: 'unauthenticated', status: 401 });
    expect(signInAgainHere).not.toHaveBeenCalled();
  });

  it('B12 an opening after a sleep drops the request out and asks once', async () => {
    await open();
    await tap('Close');
    sleep(60_000);
    await tap('My FightBook QR');
    expect(requests()).toBe(2);
  });

  it("B12b the dropped request's timer never fires at the new one", async () => {
    await open();
    await tap('Close');
    await wait(5_000);
    sleep(60_000);
    await tap('My FightBook QR');
    expect(requests()).toBe(2);
    await wait(6_000);
    expect(alerted()).toBeNull();
    await reply(1, code(2));
    expect(shown()).toBe('fb:CODE2');
  });
});
