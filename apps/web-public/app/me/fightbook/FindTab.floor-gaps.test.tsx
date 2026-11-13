// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { FightBookEvent } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FindTab } from './FindTab';
import { callRefusalKey } from './use-open-calls';

/**
 * Guards of the floor tools that the other Find tests do not hold: the switch ending on its own,
 * the switch following the Event picked, "I'm in" on a closed call, a double tap on "Post call",
 * and the sentence for a call refusal.
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

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const eventOf = (id: string, name: string, freeUntil: string | null): FightBookEvent => ({
  id,
  name,
  days: ['2026-11-13'],
  today: '2026-11-13',
  freeUntil,
});
const ok = (data: unknown) => ({ ok: true, data });

let container: HTMLDivElement;
let root: Root;
let sent: string[];
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sent = [];
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  vi.useRealTimers();
});

/** Every Find read, for the given Events; `extra` answers the rest (a call list, a write). */
function serve(events: FightBookEvent[], extra: Record<string, () => unknown> = {}) {
  vi.mocked(apiRequest).mockImplementation((async (
    _base: string,
    path: string,
    init?: RequestInit,
  ) => {
    const route = `${init?.method ?? 'GET'} ${path}`;
    sent.push(route);
    if (extra[route]) return extra[route]();
    if (route === 'GET /api/v1/me/fightbook/events') return ok(events);
    if (route === 'GET /api/v1/weapons?active=true') return ok([{ id: 'w1', name: 'Longsword' }]);
    if (route.endsWith('/find') || route === 'GET /api/v1/me/fightbook/find?page=0') {
      return ok(route.endsWith('/find') ? [] : { items: [], more: false });
    }
    if (route.endsWith('/calls')) return ok({ mine: [], others: [] });
    throw new Error(`unexpected request ${route}`);
  }) as never);
}

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FindTab apiUrl="http://api.test" onSent={vi.fn()} />
      </I18nProvider>,
    ),
  );
  await settle();
}
const theSwitch = () => container.querySelector<HTMLButtonElement>('[role="switch"]');
const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('The switch follows the clock and the Event', () => {
  it('turns itself off when its hour ends, without a tap', async () => {
    vi.useFakeTimers();
    serve([eventOf(EVENT_A, 'Probe Open', new Date(Date.now() + 60_000).toISOString())]);
    await open();
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('Free until');
    await act(async () => void (await vi.advanceTimersByTimeAsync(61_000)));
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(text()).not.toContain('Free until');
  });

  it('shows the end of the Event picked, not the one the page opened on', async () => {
    vi.useFakeTimers();
    serve([
      eventOf(EVENT_A, 'Alpha Open', new Date(2099, 0, 1, 15, 30).toISOString()),
      eventOf(EVENT_B, 'Beta Open', null),
    ]);
    await open();
    expect(text()).toContain('Free until 15:30');
    await act(async () => {
      const picker = [...container.querySelectorAll('select')].find((s) =>
        s.textContent?.includes('Beta Open'),
      )!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        picker,
        EVENT_B,
      );
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(container.querySelector('h2')?.textContent).toContain('Beta Open');
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(text()).not.toContain('Free until');
  });
});

describe('A call that is no longer open', () => {
  it('offers no "I’m in" on a closed call the fighter has not answered', async () => {
    vi.useFakeTimers();
    const closed = {
      id: 'call-none',
      poster: { globalPersonId: '00000000-0000-4000-8000-000000000007', name: 'Probe Fighter 7' },
      weapons: ['Longsword'],
      time: '15:00',
      open: false,
      myAnswer: 'none',
    };
    serve([eventOf(EVENT_A, 'Probe Open', null)], {
      [`GET /api/v1/me/fightbook/events/${EVENT_A}/calls`]: () =>
        ok({ mine: [], others: [closed] }),
    });
    await open();
    expect(container.querySelectorAll('[data-open-call]')).toHaveLength(1);
    expect(button('I’m in')).toBeUndefined();
  });
});

describe('Posting an open call', () => {
  it('sends one POST for two taps while the first is still on its way', async () => {
    vi.useFakeTimers();
    const postRoute = `POST /api/v1/me/fightbook/events/${EVENT_A}/calls`;
    let finish: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    serve([eventOf(EVENT_A, 'Probe Open', null)], {
      [postRoute]: (async () => {
        await slow;
        return ok({ id: 'c1' });
      }) as never,
    });
    await open();
    await act(async () => {
      [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        .find((c) => c.parentElement?.textContent === 'Longsword')
        ?.click();
      const input = container.querySelector<HTMLInputElement>('input[type="time"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '15:00',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const post = button('Post call');
    await act(async () => post?.click());
    await act(async () => post?.click());
    expect(post?.disabled).toBe(true);
    await act(async () => finish());
    await settle();
    expect(sent.filter((r) => r === postRoute)).toHaveLength(1);
  });
});

describe('The sentence for a call refusal', () => {
  it('says "this is your own call" for self, and the call’s words for not_open', () => {
    expect(callRefusalKey('self')).toBe('publicApp.fightBook.floor.self');
    expect(callRefusalKey('not_open')).toBe('publicApp.fightBook.floor.notOpen');
  });
});
