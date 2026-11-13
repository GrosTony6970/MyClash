// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { FightBookEvent, OpenCallsAtEvent, SparFighter } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FindTab } from './FindTab';

/**
 * Marc is at an Event with an open day. His Find tab holds the floor tools: "Free to spar now", the
 * badge on a card of a fighter who is, and the open calls of today (his own and the others').
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

type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number; code?: string };
type Route = Answer | (() => Answer);

const EVENT = '11111111-1111-4111-8111-111111111111';
const CALLS = `/api/v1/me/fightbook/events/${EVENT}/calls`;
const FREE = `/api/v1/me/fightbook/events/${EVENT}/free`;
const fighter = (n: number): SparFighter => ({
  globalPersonId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `Probe Fighter ${n}`,
  photoUrl: null,
  club: null,
});
const eventOf = (today: string | null, freeUntil: string | null = null): FightBookEvent => ({
  id: EVENT,
  name: 'Probe Open',
  days: ['2026-11-13'],
  today,
  freeUntil,
});
const ok = (data: unknown): Answer => ({ ok: true, data });
const refused = (status: number, code?: string): Answer => ({
  ok: false,
  kind: 'http',
  status,
  code,
});
const NONE: OpenCallsAtEvent = { mine: [], others: [] };

let container: HTMLDivElement;
let root: Root;
let sent: string[];
let bodies: Record<string, unknown>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sent = [];
  bodies = {};
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
});

function serve(event: FightBookEvent, routes: Record<string, Route> = {}) {
  const all: Record<string, Route> = {
    'GET /api/v1/me/fightbook/events': ok([event]),
    'GET /api/v1/weapons?active=true': ok([
      { id: 'w1', name: 'Longsword' },
      { id: 'w2', name: 'Sabre' },
    ]),
    [`GET /api/v1/me/fightbook/events/${EVENT}/find`]: ok([]),
    'GET /api/v1/me/fightbook/find?page=0': ok({ items: [], more: false }),
    [`GET ${CALLS}`]: ok(NONE),
    ...routes,
  };
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    sent.push(key);
    bodies[key] = init?.body;
    const route = all[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return (typeof route === 'function' ? route() : route) as never;
  });
}

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FindTab apiUrl="http://api.test" onSent={vi.fn()} />
      </I18nProvider>,
    ),
  );
  await settled();
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
async function click(el: Element | undefined) {
  await act(async () => (el as HTMLElement).click());
  await settled();
}
const theSwitch = () => container.querySelector<HTMLButtonElement>('[role="switch"]');
const text = () => container.textContent ?? '';
const reads = (key: string) => sent.filter((k) => k === key).length;

describe('Free to spar now', () => {
  it('shows the switch and the open calls only when the Event has an open day', async () => {
    serve(eventOf(null));
    await open();
    expect(theSwitch()).toBeNull();
    expect(text()).not.toContain('Open calls');
    expect(sent).not.toContain(`GET ${CALLS}`);
    act(() => root.unmount());
    root = createRoot(container);
    serve(eventOf('2026-11-13'));
    await open();
    expect(theSwitch()).not.toBeNull();
    expect(text()).toContain('Open calls');
  });

  it('says "until HH:MM" from freeUntil and turns off on DELETE', async () => {
    const until = new Date(2099, 0, 1, 15, 30).toISOString();
    serve(eventOf('2026-11-13', until), { [`DELETE ${FREE}`]: { ok: true } });
    await open();
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('Free until 15:30');
    await click(theSwitch() ?? undefined);
    expect(sent).toContain(`DELETE ${FREE}`);
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(text()).not.toContain('Free until');
  });

  it('turns on with PUT and shows the end the API answered', async () => {
    const until = new Date(2099, 0, 1, 9, 5).toISOString();
    serve(eventOf('2026-11-13'), { [`PUT ${FREE}`]: ok({ until }) });
    await open();
    await click(theSwitch() ?? undefined);
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('Free until 09:05');
  });

  it('says so when the switch could not change, and stays off', async () => {
    serve(eventOf('2026-11-13'), { [`PUT ${FREE}`]: refused(400, 'bad_event') });
    await open();
    await click(theSwitch() ?? undefined);
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be changed',
    );
  });

  it('marks a free fighter in the Event block, and only that one', async () => {
    const card = (n: number, freeNow: boolean) => ({
      fighter: fighter(n),
      weapons: ['Longsword'],
      favourite: false,
      freeNow,
    });
    serve(eventOf('2026-11-13'), {
      [`GET /api/v1/me/fightbook/events/${EVENT}/find`]: ok([card(1, true), card(2, false)]),
    });
    await open();
    const cards = [...container.querySelectorAll('[data-find-card]')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector('[data-free-now]')?.textContent).toBe('Free now');
    expect(cards[1]?.querySelector('[data-free-now]')).toBeNull();
  });
});

const other = (myAnswer: 'none' | 'in' | 'picked' | 'not_this_time', open = true) => ({
  id: `call-${myAnswer}`,
  poster: fighter(7),
  weapons: ['Longsword', 'Sabre'],
  time: '15:00',
  open,
  myAnswer,
});

describe("Others' open calls", () => {
  it('shows the time, the weapons and the face per myAnswer', async () => {
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: ok({
        mine: [],
        others: [other('none'), other('in'), other('picked', false), other('not_this_time', false)],
      }),
    });
    await open();
    const rows = [...container.querySelectorAll('[data-open-call]')];
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('Longsword, Sabre at 15:00');
    expect(rows[0]?.textContent).toContain('Probe Fighter 7');
    expect(rows[0]?.textContent).toContain('I’m in');
    expect(rows[1]?.textContent).toContain('Take back');
    expect(rows[2]?.textContent).toContain('Picked — it’s in My spars');
    expect(rows[3]?.textContent).toContain('Not this time');
    // Ruling 712: nothing names how many are in.
    expect(rows.map((r) => r.querySelectorAll('button').length)).toEqual([1, 1, 0, 0]);
  });

  it('answers "I\'m in" with a PUT, once for two taps, and reads the list again', async () => {
    let answered = false;
    let finish: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: () => ok({ mine: [], others: [other(answered ? 'in' : 'none')] }),
      // A write still on its way when the second tap lands.
      'PUT /api/v1/me/fightbook/calls/call-none/answer': (async () => {
        await slow;
        answered = true;
        return { ok: true };
      }) as never,
    });
    await open();
    const imIn = button('I’m in');
    await act(async () => imIn?.click());
    await act(async () => imIn?.click());
    expect(imIn?.disabled).toBe(true);
    await act(async () => finish());
    await settled();
    expect(reads('PUT /api/v1/me/fightbook/calls/call-none/answer')).toBe(1);
    expect(button('Take back')).toBeDefined();
  });

  it('treats a 404 on take-back as already taken back: reads again, says nothing', async () => {
    let gone = false;
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: () => ok({ mine: [], others: [other(gone ? 'none' : 'in')] }),
      'DELETE /api/v1/me/fightbook/calls/call-in/answer': () => {
        gone = true;
        return refused(404);
      },
    });
    await open();
    await click(button('Take back'));
    expect(reads(`GET ${CALLS}`)).toBe(2);
    expect(button('I’m in')).toBeDefined();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('answering a call that is no longer open reads again and says so', async () => {
    let closed = false;
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: () =>
        ok({ mine: [], others: [other(closed ? 'not_this_time' : 'none', !closed)] }),
      'PUT /api/v1/me/fightbook/calls/call-none/answer': () => {
        closed = true;
        return refused(409, 'not_open');
      },
    });
    await open();
    await click(button('I’m in'));
    expect(text()).toContain('This call is no longer open.');
    expect(text()).not.toContain('This request is no longer open.');
    expect(text()).toContain('Not this time');
  });
});

describe('My open calls', () => {
  const mine = (state: 'open' | 'picked' | 'closed', answers = [fighter(3), fighter(4)]) => ({
    id: 'mine-1',
    weapons: ['Sabre'],
    time: '16:30',
    state,
    picked: state === 'picked' ? fighter(3) : null,
    answers: state === 'open' ? answers : [],
  });

  it('lists who is in with "Pick", and a "Close" button, on an open call', async () => {
    serve(eventOf('2026-11-13'), { [`GET ${CALLS}`]: ok({ mine: [mine('open')], others: [] }) });
    await open();
    const row = container.querySelector('[data-my-open-call]');
    expect(row?.textContent).toContain('Sabre at 16:30');
    expect(row?.textContent).toContain('Probe Fighter 3');
    expect(row?.textContent).toContain('Probe Fighter 4');
    expect([...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Pick',
      'Pick',
      'Close',
    ]);
  });

  it('offers neither Pick nor Close on a picked or a closed call', async () => {
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: ok({
        mine: [mine('picked'), { ...mine('closed'), id: 'mine-2' }],
        others: [],
      }),
    });
    await open();
    const rows = [...container.querySelectorAll('[data-my-open-call]')];
    expect(rows[0]?.textContent).toContain('Picked: Probe Fighter 3');
    expect(rows[1]?.textContent).toContain('Closed');
    expect(rows.flatMap((r) => [...r.querySelectorAll('button')])).toHaveLength(0);
  });

  it("picks with the fighter's id and tells the page (a spar was made)", async () => {
    const onSent = vi.fn();
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: ok({ mine: [mine('open')], others: [] }),
      'POST /api/v1/me/fightbook/calls/mine-1/pick': { ok: true },
    });
    await act(async () =>
      root.render(
        <I18nProvider locale="en">
          <FindTab apiUrl="http://api.test" onSent={onSent} />
        </I18nProvider>,
      ),
    );
    await settled();
    await click(button('Pick'));
    expect(bodies['POST /api/v1/me/fightbook/calls/mine-1/pick']).toEqual({
      globalPersonId: fighter(3).globalPersonId,
    });
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('a pick answering not_open reads the calls again and says the call is no longer open', async () => {
    let closed = false;
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: () => ok({ mine: [mine(closed ? 'closed' : 'open')], others: [] }),
      'POST /api/v1/me/fightbook/calls/mine-1/pick': () => {
        closed = true;
        return refused(409, 'not_open');
      },
    });
    await open();
    await click(button('Pick'));
    expect(reads(`GET ${CALLS}`)).toBe(2);
    expect(text()).toContain('This call is no longer open.');
    expect(button('Pick')).toBeUndefined();
  });

  it('closes a call with DELETE and reads again', async () => {
    let closed = false;
    serve(eventOf('2026-11-13'), {
      [`GET ${CALLS}`]: () => ok({ mine: [mine(closed ? 'closed' : 'open')], others: [] }),
      'DELETE /api/v1/me/fightbook/calls/mine-1': () => {
        closed = true;
        return { ok: true };
      },
    });
    await open();
    await click(button('Close'));
    expect(sent).toContain('DELETE /api/v1/me/fightbook/calls/mine-1');
    expect(text()).toContain('Closed');
  });
});
