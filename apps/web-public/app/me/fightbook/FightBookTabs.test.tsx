// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { IncomingSparRequest, MySpars } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FightBookClient } from './FightBookClient';

/**
 * Julie has FightBook on. Marc asked her for a longsword spar after the Pools; Paul asked too.
 * She answers from the Inbox; My spars keeps what she agreed to, by day, and what she sent.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
let search = new URLSearchParams();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const marc = { globalPersonId: MARC, name: 'Marc Probe', photoUrl: null, club: null };
const paul = { globalPersonId: PAUL, name: 'Paul Probe', photoUrl: null, club: 'Club B' };

const incoming = (id: string, asker = marc): IncomingSparRequest => ({
  id,
  asker,
  kind: 'event',
  eventName: 'Probe Open',
  day: '2026-05-23',
  time: '18:30',
  place: null,
  weapons: ['Longsword', 'Sabre'],
  message: 'After the Pools?',
  markFrom: '2026-05-22T22:00:00.000Z',
  markUntil: '2026-05-26T04:00:00.000Z',
  cancelUntil: '2026-05-24T04:00:00.000Z',
});

type Answer = { ok: boolean; data?: unknown; kind?: string; status?: number; code?: string | null };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  search = new URLSearchParams();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-05-23T10:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  replace.mockReset();
});

type Route = Answer | (() => Answer | Promise<Answer>);

/** The reads answer the lists given; a list may change between reads (a function, read each time). */
function serve(
  inbox: IncomingSparRequest[] | (() => IncomingSparRequest[]),
  spars: MySpars | (() => MySpars),
  writes: Record<string, Route> = {},
) {
  const now = <T,>(list: T | (() => T)) =>
    typeof list === 'function' ? (list as () => T)() : list;
  const routes: Record<string, Route> = {
    'GET /api/v1/me/fightbook/settings': { ok: true, data: { hasProfile: true, enabled: true } },
    'GET /api/v1/me/fightbook/inbox': () => ({ ok: true, data: now(inbox) }),
    'GET /api/v1/me/fightbook/spars': () => ({ ok: true, data: now(spars) }),
    'GET /api/v1/me/fightbook/blocks': { ok: true, data: [] },
    'GET /api/v1/me/fightbook/thanks?page=0': { ok: true, data: { items: [], more: false } },
    ...writes,
  };
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    const route = routes[`${init?.method ?? 'GET'} ${path}`];
    if (!route) throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`);
    return (typeof route === 'function' ? await route() : route) as never;
  });
}

const reads = (path: string) =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(([, p, init]) => p === path && (init?.method ?? 'GET') === 'GET').length;
const NOT_OPEN: Answer = { ok: false, kind: 'http', status: 409, code: 'not_open' };

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
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const sent = (method: string, path: string) =>
  vi
    .mocked(apiRequest)
    .mock.calls.find(([, p, init]) => p === path && init?.method === method)?.[2];
const NONE: MySpars = { spars: [], sent: [] };

describe('the Inbox', () => {
  it('shows who asks, the weapons, the day and the message, with the count on the tab', async () => {
    serve([incoming('r-1'), incoming('r-2', paul)], NONE);
    await open();
    const text = container.textContent ?? '';
    expect(text).toContain('Inbox (2)');
    expect(text).toContain('Marc Probe');
    // The club shows under the name when the fighter has one, and only then.
    expect(container.querySelectorAll('[data-spar-card]')[1]?.textContent).toContain('Club B');
    expect(container.querySelectorAll('[data-spar-card]')[0]?.textContent).not.toContain('Club');
    expect(text).toContain('Weapons: Longsword, Sabre');
    expect(text).toContain('At Probe Open');
    expect(text).toContain('18:30');
    expect(text).toContain('After the Pools?');
  });

  it('a yes saves and leaves the Inbox (My spars: InboxYes.test.tsx)', async () => {
    let yes = false;
    serve(() => (yes ? [] : [incoming('r-1')]), NONE, {
      'POST /api/v1/me/fightbook/requests/r-1/answer': () => {
        yes = true;
        return { ok: true, data: { status: 'agreed' } };
      },
    });
    await open();
    await act(async () => button('Yes')!.click());
    await settled();
    expect(sent('POST', '/api/v1/me/fightbook/requests/r-1/answer')).toMatchObject({
      body: { answer: 'yes' },
    });
    expect(container.querySelectorAll('[data-spar-card]')).toHaveLength(0);
    expect(container.textContent).not.toContain('Inbox (1)');
  });

  it('"Not this time" keeps the comment private unless she ticks it', async () => {
    serve([incoming('r-1')], NONE, {
      'POST /api/v1/me/fightbook/requests/r-1/answer': {
        ok: true,
        data: { status: 'not_this_time' },
      },
    });
    await open();
    await act(async () => button('Not this time')!.click());
    const field = document.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(field, 'Not my weapon');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Send "Not this time"', document)!.click());
    await settled();
    expect(sent('POST', '/api/v1/me/fightbook/requests/r-1/answer')).toMatchObject({
      body: { answer: 'no', comment: 'Not my weapon', showComment: false },
    });
    expect(container.textContent).not.toContain('After the Pools?');
  });

  it('a request no longer open leaves the Inbox, says so, and the page reads again', async () => {
    let answered = false;
    serve(
      () => (answered ? [] : [incoming('r-1')]),
      () => NONE,
      {
        'POST /api/v1/me/fightbook/requests/r-1/answer': () => {
          answered = true;
          return NOT_OPEN;
        },
      },
    );
    await open();
    await act(async () => button('Yes')!.click());
    await settled();
    expect(container.textContent).not.toContain('After the Pools?');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'This request is no longer open.',
    );
    expect(reads('/api/v1/me/fightbook/inbox')).toBe(2);
    expect(reads('/api/v1/me/fightbook/spars')).toBe(2);
  });

  it("a card's buttons stay disabled while its answer is on its way", async () => {
    let land: (answer: Answer) => void = () => {};
    let yes = false;
    serve(() => (yes ? [incoming('r-2', paul)] : [incoming('r-1'), incoming('r-2', paul)]), NONE, {
      'POST /api/v1/me/fightbook/requests/r-1/answer': () =>
        new Promise<Answer>((resolve) => (land = (a) => ((yes = true), resolve(a)))),
    });
    await open();
    await act(async () => button('Yes')!.click());
    const [first, second] = [...container.querySelectorAll('[data-spar-card]')];
    const disabled = (card: Element) => [...card.querySelectorAll('button')].map((b) => b.disabled);
    expect(disabled(first!)).toEqual([true, true, true]);
    expect(disabled(second!)).toEqual([false, false, false]);
    await act(async () => land({ ok: true, data: { status: 'agreed' } }));
    await settled();
    expect(container.querySelectorAll('[data-spar-card]')).toHaveLength(1);
  });

  it('blocking asks first, then blocks the asker and clears their requests', async () => {
    serve([incoming('r-1'), incoming('r-2', paul)], NONE, {
      'POST /api/v1/me/fightbook/blocks': { ok: true, data: null },
    });
    await open();
    await act(async () => button('Block')!.click());
    await act(async () => button('Block', document.querySelector('[role="dialog"]')!)!.click());
    await settled();
    expect(sent('POST', '/api/v1/me/fightbook/blocks')).toMatchObject({
      body: { globalPersonId: MARC },
    });
    const cards = [...container.querySelectorAll('[data-spar-card]')];
    expect(cards.map((card) => card.textContent?.includes('Paul Probe'))).toEqual([true]);
    expect(container.textContent).toContain('Inbox (1)');
    // Marc is now in her blocked list instead.
    expect(container.textContent).toContain('Blocked fighters');
  });
});

describe('My spars', () => {
  const spar = (id: string, over: Partial<MySpars['spars'][number]> = {}) => ({
    id,
    partner: marc,
    iAsked: false,
    kind: 'event' as const,
    eventName: 'Probe Open',
    day: '2026-05-23',
    time: null,
    place: null,
    weapons: ['Longsword'],
    message: null,
    status: 'agreed' as const,
    cancelledByMe: null,
    cancelMessage: null,
    markFrom: '2026-05-22T22:00:00.000Z',
    markUntil: '2026-05-26T04:00:00.000Z',
    cancelUntil: '2026-05-24T04:00:00.000Z',
    myReview: null,
    theirThanks: null,
    note: null,
    partnerFavourite: null,
    iFlagged: false,
    ...over,
  });

  it('follows ?tab=spars, groups the spars of one day under one heading', async () => {
    search = new URLSearchParams('tab=spars');
    serve([], {
      spars: [spar('s-1'), spar('s-2', { partner: paul, iAsked: true })],
      sent: [],
    });
    await open();
    expect(container.querySelectorAll('h3[data-spar-day]')).toHaveLength(1);
    expect(container.textContent).toContain('Marc Probe');
    expect(container.textContent).toContain('Paul Probe');
  });

  it('says a cancelled spar, who cancelled, and the message', async () => {
    search = new URLSearchParams('tab=spars');
    serve([], {
      spars: [spar('s-1', { status: 'cancelled', cancelledByMe: false, cancelMessage: 'Injured' })],
      sent: [],
    });
    await open();
    expect(container.textContent).toContain('Spar cancelled');
    expect(container.textContent).toContain('They cancelled this spar.');
    expect(container.textContent).toContain('Injured');
  });

  it('never reads a done spar as cancelled, and offers no Cancel on it', async () => {
    search = new URLSearchParams('tab=spars');
    serve([], { spars: [spar('s-1', { status: 'done' })], sent: [] });
    await open();
    expect(container.textContent).toContain('Marc Probe');
    expect(container.textContent).not.toContain('Spar cancelled');
    expect(container.textContent).not.toContain('cancelled this spar');
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).not.toContain('Cancel the spar');
  });

  it('shows a sent "Not this time" the same way, with a comment only when shown', async () => {
    search = new URLSearchParams('tab=spars');
    const base = {
      receiver: paul,
      kind: 'free' as const,
      eventName: null,
      day: '2026-05-24',
      time: null,
      place: 'Salle Probe',
      weapons: ['Sabre'],
      message: null,
      status: 'not_this_time' as const,
    };
    serve([], {
      spars: [],
      sent: [
        { ...base, id: 'q-1', comment: null },
        { ...base, id: 'q-2', comment: 'Next Event!' },
      ],
    });
    await open();
    const cards = [...container.querySelectorAll('[data-spar-card]')].map((c) => c.textContent);
    expect(cards.filter((text) => text?.includes('Not this time'))).toHaveLength(2);
    expect(container.textContent).toContain('Next Event!');
    expect(container.textContent).toContain('At Salle Probe');
  });

  it('withdraws a request still waiting', async () => {
    search = new URLSearchParams('tab=spars');
    serve(
      [],
      {
        spars: [],
        sent: [
          {
            id: 'q-1',
            receiver: paul,
            kind: 'free',
            eventName: null,
            day: '2026-05-24',
            time: null,
            place: 'Salle Probe',
            weapons: ['Sabre'],
            message: null,
            status: 'pending',
            comment: null,
          },
        ],
      },
      { 'POST /api/v1/me/fightbook/requests/q-1/withdraw': { ok: true, data: null } },
    );
    await open();
    await act(async () => button('Take back')!.click());
    await settled();
    expect(sent('POST', '/api/v1/me/fightbook/requests/q-1/withdraw')).toBeDefined();
    expect(container.textContent).not.toContain('Waiting for an answer');
  });

  it('a Take back that loses to a yes reads again: the request is now a spar', async () => {
    search = new URLSearchParams('tab=spars');
    let julieSaidYes = false;
    const waiting = {
      id: 'q-1',
      receiver: paul,
      kind: 'free' as const,
      eventName: null,
      day: '2026-05-24',
      time: null,
      place: 'Salle Probe',
      weapons: ['Sabre'],
      message: null,
      status: 'pending' as const,
      comment: null,
    };
    serve(
      [],
      () =>
        julieSaidYes
          ? { spars: [spar('q-1', { partner: paul, iAsked: true, day: '2026-05-24' })], sent: [] }
          : { spars: [], sent: [waiting] },
      {
        'POST /api/v1/me/fightbook/requests/q-1/withdraw': () => {
          julieSaidYes = true;
          return NOT_OPEN;
        },
      },
    );
    await open();
    await act(async () => button('Take back')!.click());
    await settled();
    expect(button('Take back')).toBeUndefined();
    expect(container.textContent).toContain('You asked');
    expect(button('Cancel the spar')).toBeDefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'This request is no longer open.',
    );
  });
});
